// ============================================================
// supabase/functions/generate-curriculum-content/index.ts
//
// Deploy with:  supabase functions deploy generate-curriculum-content
// Requires a secret:  supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...
// (get one at https://openrouter.ai/keys — billed through your
// OpenRouter account, not directly through Anthropic)
//
// Uses Claude (via OpenRouter) to draft CBC scheme-of-work rows or a full lesson
// plan, grounded in the school's own uploaded KICD curriculum
// design PDF(s) for that subject+class (see curriculum_documents
// / the "curriculum-designs" storage bucket, migration 016).
// The OpenRouter API key must never reach the browser, so this
// call happens only here, server-side — same reasoning as
// manage-user for the service role key.
//
// Request body shapes:
//   { action: 'scheme', subjectId, klass, term, year, weeks, lessonsPerWeek }
//   { action: 'lesson', subjectId, klass, term, year, week, lessonNo,
//     schemeRow?: { strand, subStrand, outcomes, inquiryQuestion, experiences, resources, assessment } }
// ============================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

// OpenRouter model slug — check https://openrouter.ai/models for
// the current Claude model slugs before changing this.
const OPENROUTER_MODEL = "anthropic/claude-sonnet-4.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_DOCS = 3; // cap how many PDFs get sent per request (cost/size)

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Invalid session" }, 401);

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerProfile, error: profileErr } = await adminClient
      .from("profiles").select("role, school_id").eq("id", caller.id).single();
    if (profileErr || !callerProfile) return json({ error: "Caller has no profile" }, 403);

    const body = await req.json();
    if (!body.subjectId || !body.klass) return json({ error: "subjectId and klass are required" }, 400);

    // ---- authorize: caller must be superadmin, an admin in the
    // subject's school, or a teacher assigned to that subject ----
    const { data: subject, error: subjectErr } = await adminClient
      .from("subjects").select("id, name, school_id").eq("id", body.subjectId).single();
    if (subjectErr || !subject) return json({ error: "Subject not found" }, 404);

    const allowed = await canUseSubject(adminClient, callerProfile, caller.id, subject);
    if (!allowed) return json({ error: "Not authorized to generate content for this subject" }, 403);

    // ---- gather the curriculum design PDF(s) for this subject+class ----
    const { data: docs, error: docsErr } = await adminClient
      .from("curriculum_documents").select("id, title, storage_path")
      .eq("school_id", subject.school_id).eq("subject_id", body.subjectId).eq("klass", body.klass)
      .order("created_at", { ascending: false }).limit(MAX_DOCS);
    if (docsErr) return json({ error: docsErr.message }, 400);
    if (!docs || docs.length === 0) {
      return json({ error: "No curriculum design PDF uploaded yet for this subject and class. Upload one first with \"Manage curriculum PDFs\"." }, 400);
    }

    const documentBlocks: any[] = [];
    for (const doc of docs) {
      const { data: fileData, error: downloadErr } = await adminClient
        .storage.from("curriculum-designs").download(doc.storage_path);
      if (downloadErr || !fileData) continue;
      const buf = new Uint8Array(await fileData.arrayBuffer());
      documentBlocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64Encode(buf) },
        title: doc.title || doc.storage_path.split("/").pop(),
      });
    }
    if (documentBlocks.length === 0) {
      return json({ error: "Could not read the uploaded curriculum design PDF(s). Try re-uploading." }, 400);
    }

    if (body.action === "scheme") return await handleScheme(subject, body, documentBlocks);
    if (body.action === "lesson") return await handleLesson(subject, body, documentBlocks);
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

async function canUseSubject(adminClient: any, callerProfile: any, callerId: string, subject: any): Promise<boolean> {
  if (callerProfile.role === "superadmin") return true;
  if (callerProfile.school_id !== subject.school_id) return false;
  if (callerProfile.role === "admin") return true;
  if (callerProfile.role === "user") {
    const { data } = await adminClient
      .from("teacher_subjects").select("id").eq("teacher_id", callerId).eq("subject_id", subject.id).limit(1);
    return !!(data && data.length);
  }
  return false;
}

async function handleScheme(subject: any, body: any, documentBlocks: any[]) {
  const weeks = clampInt(body.weeks, 1, 40, 13);
  const lessonsPerWeek = clampInt(body.lessonsPerWeek, 1, 10, 1);
  const total = weeks * lessonsPerWeek;
  if (total > 200) return json({ error: "That's too many rows to generate in one go — try fewer weeks or lessons per week." }, 400);

  const instructions = `You are a Kenyan CBC/CBE curriculum specialist helping a teacher draft a Scheme of Work.
Subject: ${subject.name}. Class/Grade: ${body.klass}. ${body.term || ""} ${body.year || ""}.
The attached PDF(s) are the official KICD curriculum design for this subject and grade — use them as the authoritative source for strands, sub-strands, specific learning outcomes and suggested key inquiry questions, learning experiences, resources and assessment methods. Do not invent content that contradicts the document; where the document doesn't cover something, use standard CBC practice.

Produce exactly ${total} rows covering ${weeks} teaching week(s) with ${lessonsPerWeek} lesson(s) per week, in a sensible teaching sequence drawn from the curriculum design (spread the strands/sub-strands across the weeks in the order they appear in the document, rather than repeating the same one).

Respond with ONLY a JSON object, no markdown fences, no commentary, in exactly this shape:
{"rows":[{"week":1,"lessonNo":1,"strand":"...","subStrand":"...","outcomes":"By the end of the lesson, the learner should be able to: ...","inquiryQuestion":"...","experiences":"...","resources":"...","assessment":"..."}, ...]}
"outcomes" and "experiences" may use "\\n" for multiple bullet-style lines within the string. Keep each field concise (a few sentences at most) — this is a scheme ledger, not a full lesson plan.`;

  const result = await callClaude(instructions, documentBlocks);
  const parsed = safeParseJSON(result);
  if (!parsed || !Array.isArray(parsed.rows)) return json({ error: "The AI response wasn't in the expected format — try again." }, 502);

  const rows = parsed.rows
    .filter((r: any) => r && r.week && r.lessonNo)
    .map((r: any) => ({
      week: Number(r.week), lessonNo: Number(r.lessonNo),
      strand: String(r.strand || "").trim(), subStrand: String(r.subStrand || "").trim(),
      outcomes: String(r.outcomes || "").trim(), inquiryQuestion: String(r.inquiryQuestion || "").trim(),
      experiences: String(r.experiences || "").trim(), resources: String(r.resources || "").trim(),
      assessment: String(r.assessment || "").trim()
    }));

  return json({ ok: true, rows });
}

async function handleLesson(subject: any, body: any, documentBlocks: any[]) {
  const anchor = body.schemeRow
    ? `Base this specific lesson on this scheme-of-work row already agreed for Week ${body.week}, Lesson ${body.lessonNo}: ${JSON.stringify(body.schemeRow)}. Stay consistent with its strand, sub-strand, outcomes, inquiry question, and resources — expand them into a full lesson.`
    : `Draw the strand/sub-strand/outcomes for Week ${body.week}, Lesson ${body.lessonNo} from the curriculum design PDF(s), choosing the content that would fall at that point in the term's sequence.`;

  const instructions = `You are a Kenyan CBC/CBE curriculum specialist drafting one full lesson plan document for a teacher.
Subject: ${subject.name}. Class/Grade: ${body.klass}. ${body.term || ""} ${body.year || ""}. Week ${body.week}, Lesson ${body.lessonNo}.
The attached PDF(s) are the official KICD curriculum design for this subject and grade — ground the content in it. ${anchor}

Respond with ONLY a JSON object, no markdown fences, no commentary, in exactly this shape:
{"strand":"...","subStrand":"...","outcomes":"By the end of the lesson, the learner should be able to: ...","inquiryQuestion":"...","coreCompetencies":"...","values":"...","pcis":"...","resources":"...","introduction":"...","development":"...","conclusion":"...","extendedActivities":"..."}
"coreCompetencies", "values" and "pcis" should be short comma-separated lists drawn from standard CBC categories. "introduction", "development" and "conclusion" should each be a full paragraph a teacher could actually follow in class — specific to this lesson's content, not generic filler. "extendedActivities" is optional (homework/extension); leave it as an empty string if none fits.`;

  const result = await callClaude(instructions, documentBlocks);
  const parsed = safeParseJSON(result);
  if (!parsed || typeof parsed !== "object") return json({ error: "The AI response wasn't in the expected format — try again." }, 502);

  const plan = {
    strand: String(parsed.strand || "").trim(), subStrand: String(parsed.subStrand || "").trim(),
    outcomes: String(parsed.outcomes || "").trim(), inquiryQuestion: String(parsed.inquiryQuestion || "").trim(),
    coreCompetencies: String(parsed.coreCompetencies || "").trim(), values: String(parsed.values || "").trim(),
    pcis: String(parsed.pcis || "").trim(), resources: String(parsed.resources || "").trim(),
    introduction: String(parsed.introduction || "").trim(), development: String(parsed.development || "").trim(),
    conclusion: String(parsed.conclusion || "").trim(), extendedActivities: String(parsed.extendedActivities || "").trim()
  };

  return json({ ok: true, plan });
}

async function callClaude(instructionText: string, documentBlocks: any[]): Promise<string> {
  // OpenRouter speaks the OpenAI chat-completions shape, not Anthropic's
  // native messages shape. PDFs go in as "file" parts (data URL), not
  // Anthropic's native "document" blocks.
  const fileParts = documentBlocks.map((d) => ({
    type: "file",
    file: {
      filename: d.title || "curriculum-design.pdf",
      file_data: `data:application/pdf;base64,${d.source.data}`,
    },
  }));

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      // Optional but recommended by OpenRouter for their leaderboards/rate limiting:
      "HTTP-Referer": "https://cbe-system.example",
      "X-Title": "CBE System - Curriculum Content Generator",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: [...fileParts, { type: "text", text: instructionText }],
      }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenRouter API error (${res.status})`);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("No text in AI response");
  return text;
}

function safeParseJSON(text: string): any {
  let cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

function clampInt(v: any, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
