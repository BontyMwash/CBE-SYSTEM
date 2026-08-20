// ============================================================
// supabase/functions/generate-curriculum-content/index.ts
//
// Deploy:
//   supabase functions deploy generate-curriculum-content
//
// Secret:
//   supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...
//
// This function:
//   - Uses OpenRouter's openrouter/free router
//   - Keeps OPENROUTER_API_KEY server-side
//   - Generates CBC/CBE schemes of work
//   - Generates CBC/CBE lesson plans
//   - Grounds generation in uploaded KICD curriculum PDFs
//   - Uses structured JSON output where supported
//   - Validates AI output before returning it
//   - Returns clean JSON to the frontend
//   - Preserves the existing Supabase setup
//
// Request:
//
// Scheme:
// {
//   action: "scheme",
//   subjectId,
//   klass,
//   term,
//   year,
//   weeks,
//   lessonsPerWeek
// }
//
// Lesson:
// {
//   action: "lesson",
//   subjectId,
//   klass,
//   term,
//   year,
//   week,
//   lessonNo,
//   schemeRow?: {
//     strand,
//     subStrand,
//     outcomes,
//     inquiryQuestion,
//     experiences,
//     resources,
//     assessment
//   }
// }
// ============================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ------------------------------------------------------------
// Environment
// ------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");

// IMPORTANT:
// Do not put the API key in frontend code.
// Do not return this value to the browser.
if (!SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL environment variable");
}

if (!SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
}

if (!OPENROUTER_API_KEY) {
  throw new Error("Missing OPENROUTER_API_KEY environment variable");
}

// OpenRouter's free-model router.
// This is intentionally NOT a Claude model slug.
const OPENROUTER_MODEL = "openrouter/free";

const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

const MAX_DOCS = 3;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const OPENROUTER_TIMEOUT_MS = 120_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

type CurriculumDocument = {
  id: string;
  title: string | null;
  storage_path: string;
};

type Subject = {
  id: string;
  name: string;
  school_id: string;
};

type CallerProfile = {
  role: string;
  school_id: string | null;
};

type SchemeRow = {
  week: number;
  lessonNo: number;
  strand: string;
  subStrand: string;
  outcomes: string;
  inquiryQuestion: string;
  experiences: string;
  resources: string;
  assessment: string;
};

type LessonPlan = {
  strand: string;
  subStrand: string;
  outcomes: string;
  inquiryQuestion: string;
  coreCompetencies: string;
  values: string;
  pcis: string;
  resources: string;
  introduction: string;
  development: string;
  conclusion: string;
  extendedActivities: string;
};

// ------------------------------------------------------------
// Main handler
// ------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonError(
      "Method not allowed. Use POST.",
      405
    );
  }

  try {
    // --------------------------------------------------------
    // Authenticate caller
    // --------------------------------------------------------

    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return jsonError(
        "Missing Authorization header.",
        401
      );
    }

    const callerClient = createClient(
      SUPABASE_URL,
      SERVICE_ROLE_KEY,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    );

    const {
      data: { user: caller },
      error: callerErr,
    } = await callerClient.auth.getUser();

    if (callerErr || !caller) {
      return jsonError(
        "Invalid or expired session.",
        401
      );
    }

    // --------------------------------------------------------
    // Admin Supabase client
    // --------------------------------------------------------

    const adminClient = createClient(
      SUPABASE_URL,
      SERVICE_ROLE_KEY
    );

    // --------------------------------------------------------
    // Caller profile
    // --------------------------------------------------------

    const {
      data: callerProfile,
      error: profileErr,
    } = await adminClient
      .from("profiles")
      .select("role, school_id")
      .eq("id", caller.id)
      .single();

    if (profileErr || !callerProfile) {
      return jsonError(
        "Caller profile not found.",
        403
      );
    }

    // --------------------------------------------------------
    // Parse request body safely
    // --------------------------------------------------------

    let body: any;

    try {
      body = await req.json();
    } catch {
      return jsonError(
        "Request body must contain valid JSON.",
        400
      );
    }

    if (!body || typeof body !== "object") {
      return jsonError(
        "Invalid request body.",
        400
      );
    }

    if (!body.action) {
      return jsonError(
        "action is required.",
        400
      );
    }

    if (!["scheme", "lesson"].includes(body.action)) {
      return jsonError(
        "Unknown action. Expected 'scheme' or 'lesson'.",
        400
      );
    }

    if (!body.subjectId) {
      return jsonError(
        "subjectId is required.",
        400
      );
    }

    if (!body.klass) {
      return jsonError(
        "klass is required.",
        400
      );
    }

    // --------------------------------------------------------
    // Get subject
    // --------------------------------------------------------

    const {
      data: subject,
      error: subjectErr,
    } = await adminClient
      .from("subjects")
      .select("id, name, school_id")
      .eq("id", body.subjectId)
      .single();

    if (subjectErr || !subject) {
      return jsonError(
        "Subject not found.",
        404
      );
    }

    // --------------------------------------------------------
    // Authorization
    // --------------------------------------------------------

    const allowed = await canUseSubject(
      adminClient,
      callerProfile as CallerProfile,
      caller.id,
      subject as Subject
    );

    if (!allowed) {
      return jsonError(
        "You are not authorized to generate content for this subject.",
        403
      );
    }

    // --------------------------------------------------------
    // Load curriculum PDFs
    // --------------------------------------------------------

    const {
      data: docs,
      error: docsErr,
    } = await adminClient
      .from("curriculum_documents")
      .select("id, title, storage_path")
      .eq("school_id", subject.school_id)
      .eq("subject_id", body.subjectId)
      .eq("klass", body.klass)
      .order("created_at", {
        ascending: false,
      })
      .limit(MAX_DOCS);

    if (docsErr) {
      console.error("curriculum_documents error:", docsErr);

      return jsonError(
        "Could not load curriculum documents.",
        500
      );
    }

    if (!docs || docs.length === 0) {
      return jsonError(
        "No curriculum design PDF has been uploaded for this subject and class. Upload one first using Manage Curriculum PDFs.",
        400
      );
    }

    // --------------------------------------------------------
    // Convert PDFs to OpenRouter file parts
    // --------------------------------------------------------

    const documentBlocks: any[] = [];

    for (const doc of docs as CurriculumDocument[]) {
      try {
        const {
          data: fileData,
          error: downloadErr,
        } = await adminClient
          .storage
          .from("curriculum-designs")
          .download(doc.storage_path);

        if (downloadErr || !fileData) {
          console.error(
            "Could not download curriculum PDF:",
            doc.storage_path,
            downloadErr
          );
          continue;
        }

        const buf = new Uint8Array(
          await fileData.arrayBuffer()
        );

        if (buf.byteLength > MAX_PDF_BYTES) {
          console.warn(
            `Skipping oversized curriculum PDF: ${doc.storage_path}`
          );
          continue;
        }

        documentBlocks.push({
          type: "file",
          file: {
            filename:
              doc.title ||
              doc.storage_path.split("/").pop() ||
              "curriculum-design.pdf",
            file_data:
              `data:application/pdf;base64,${base64Encode(buf)}`,
          },
        });
      } catch (err) {
        console.error(
          "PDF processing error:",
          doc.storage_path,
          err
        );
      }
    }

    if (documentBlocks.length === 0) {
      return jsonError(
        "The uploaded curriculum PDF could not be read. Try re-uploading the curriculum design PDF.",
        400
      );
    }

    // --------------------------------------------------------
    // Generate requested content
    // --------------------------------------------------------

    if (body.action === "scheme") {
      return await handleScheme(
        subject as Subject,
        body,
        documentBlocks
      );
    }

    return await handleLesson(
      subject as Subject,
      body,
      documentBlocks
    );
  } catch (error) {
    console.error("generate-curriculum-content error:", error);

    return jsonError(
      "An unexpected server error occurred while generating curriculum content.",
      500
    );
  }
});

// ============================================================
// Authorization
// ============================================================

async function canUseSubject(
  adminClient: any,
  callerProfile: CallerProfile,
  callerId: string,
  subject: Subject
): Promise<boolean> {
  if (callerProfile.role === "superadmin") {
    return true;
  }

  if (callerProfile.school_id !== subject.school_id) {
    return false;
  }

  if (callerProfile.role === "admin") {
    return true;
  }

  if (callerProfile.role === "user") {
    const { data, error } = await adminClient
      .from("teacher_subjects")
      .select("id")
      .eq("teacher_id", callerId)
      .eq("subject_id", subject.id)
      .limit(1);

    if (error) {
      console.error(
        "teacher_subjects authorization error:",
        error
      );
      return false;
    }

    return !!(data && data.length > 0);
  }

  return false;
}

// ============================================================
// SCHEME OF WORK
// ============================================================

async function handleScheme(
  subject: Subject,
  body: any,
  documentBlocks: any[]
) {
  const weeks = clampInt(
    body.weeks,
    1,
    40,
    13
  );

  const lessonsPerWeek = clampInt(
    body.lessonsPerWeek,
    1,
    10,
    1
  );

  const total = weeks * lessonsPerWeek;

  if (total > 200) {
    return jsonError(
      "That is too many lessons for one generation request. Try fewer weeks or lessons per week.",
      400
    );
  }

  const instructions = `
You are an expert Kenyan CBC/CBE curriculum specialist.

Create a Scheme of Work for:

Subject: ${subject.name}
Class/Grade: ${body.klass}
Term: ${body.term || "Not specified"}
Year: ${body.year || "Not specified"}

The attached PDF documents are the school's uploaded KICD curriculum design.
Treat the curriculum design as the primary authority.

Use the curriculum documents to identify:
- Strands
- Sub-strands
- Specific learning outcomes
- Key inquiry questions
- Suggested learning experiences
- Suggested resources
- Suggested assessment methods

Do not invent curriculum content that contradicts the uploaded documents.

Generate exactly ${total} lesson rows.

There should be:
${weeks} teaching weeks
${lessonsPerWeek} lesson(s) per week

Arrange the content in a logical teaching sequence.
Follow the order of strands/sub-strands in the curriculum document where practical.
Do not unnecessarily repeat the same content.

This is a teacher's Scheme of Work, so keep entries concise.

CBC/CBE requirements:
- Outcomes must be learner-centred.
- Learning experiences should describe what learners actually do.
- Assessment should be practical and aligned to the outcomes.
- Include relevant CBC/CBE inquiry questions.
- Avoid generic filler.
- Use Kenyan educational terminology.

Return ONLY valid JSON.
Do not use Markdown.
Do not wrap the JSON in code fences.

The JSON must have exactly this top-level structure:

{
  "rows": [
    {
      "week": 1,
      "lessonNo": 1,
      "strand": "...",
      "subStrand": "...",
      "outcomes": "...",
      "inquiryQuestion": "...",
      "experiences": "...",
      "resources": "...",
      "assessment": "..."
    }
  ]
}
`;

  const result = await callOpenRouter(
    instructions,
    documentBlocks,
    schemeSchema
  );

  if (!result.ok) {
    return jsonError(
      result.error,
      result.status
    );
  }

  const parsed = result.data;

  if (
    !parsed ||
    !Array.isArray(parsed.rows)
  ) {
    return jsonError(
      "The AI returned an invalid Scheme of Work format. Please try again.",
      502
    );
  }

  const rows: SchemeRow[] = parsed.rows
    .filter((r: any) =>
      r &&
      Number.isFinite(Number(r.week)) &&
      Number.isFinite(Number(r.lessonNo))
    )
    .map((r: any) => ({
      week: Number(r.week),
      lessonNo: Number(r.lessonNo),
      strand: cleanString(r.strand),
      subStrand: cleanString(r.subStrand),
      outcomes: cleanString(r.outcomes),
      inquiryQuestion: cleanString(
        r.inquiryQuestion
      ),
      experiences: cleanString(r.experiences),
      resources: cleanString(r.resources),
      assessment: cleanString(r.assessment),
    }))
    .filter((r: SchemeRow) =>
      r.week >= 1 &&
      r.week <= weeks &&
      r.lessonNo >= 1 &&
      r.lessonNo <= lessonsPerWeek
    );

  if (rows.length === 0) {
    return jsonError(
      "The AI did not return any valid Scheme of Work rows. Please try again.",
      502
    );
  }

  // Sort consistently for the website.
  rows.sort((a, b) =>
    a.week - b.week ||
    a.lessonNo - b.lessonNo
  );

  return json({
    ok: true,
    action: "scheme",
    subjectId: subject.id,
    subject: subject.name,
    klass: body.klass,
    term: body.term || null,
    year: body.year || null,
    rows,
  });
}

// ============================================================
// LESSON PLAN
// ============================================================

async function handleLesson(
  subject: Subject,
  body: any,
  documentBlocks: any[]
) {
  const week = clampInt(
    body.week,
    1,
    40,
    1
  );

  const lessonNo = clampInt(
    body.lessonNo,
    1,
    10,
    1
  );

  let anchor: string;

  if (body.schemeRow) {
    anchor = `
Base this lesson on the following already-approved
Scheme of Work row:

${JSON.stringify(body.schemeRow, null, 2)}

Remain consistent with its:
- strand
- sub-strand
- outcomes
- inquiry question
- learning experiences
- resources
- assessment

Expand the row into a complete classroom-ready lesson plan.
`;
  } else {
    anchor = `
Use the uploaded curriculum design to determine appropriate
strand, sub-strand, outcomes, inquiry question, learning
experiences and resources for Week ${week}, Lesson ${lessonNo}.

Choose content that fits the sequence of the term.
`;
  }

  const instructions = `
You are an expert Kenyan CBC/CBE curriculum specialist.

Create ONE complete lesson plan.

Subject: ${subject.name}
Class/Grade: ${body.klass}
Term: ${body.term || "Not specified"}
Year: ${body.year || "Not specified"}
Week: ${week}
Lesson: ${lessonNo}

The attached PDF documents are the school's uploaded KICD
curriculum designs. Ground the lesson in those documents.

${anchor}

The lesson must be:
- CBC/CBE aligned
- learner-centred
- practical
- specific to the subject
- suitable for the stated grade
- usable by a Kenyan teacher
- consistent with the curriculum design

Do not invent content that contradicts the curriculum document.

Core competencies should use appropriate CBC competency categories.

Values should use relevant Kenyan CBC values.

PCIs should refer to relevant Pertinent and Contemporary Issues
where appropriate. If none is genuinely relevant, use an empty
string.

The introduction, development and conclusion must be concrete
teacher instructions and learner activities, not generic filler.

Return ONLY valid JSON.
Do not use Markdown.
Do not use code fences.

Use exactly this structure:

{
  "strand": "",
  "subStrand": "",
  "outcomes": "",
  "inquiryQuestion": "",
  "coreCompetencies": "",
  "values": "",
  "pcis": "",
  "resources": "",
  "introduction": "",
  "development": "",
  "conclusion": "",
  "extendedActivities": ""
}
`;

  const result = await callOpenRouter(
    instructions,
    documentBlocks,
    lessonSchema
  );

  if (!result.ok) {
    return jsonError(
      result.error,
      result.status
    );
  }

  const parsed = result.data;

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return jsonError(
      "The AI returned an invalid lesson-plan format. Please try again.",
      502
    );
  }

  const plan: LessonPlan = {
    strand: cleanString(parsed.strand),
    subStrand: cleanString(parsed.subStrand),
    outcomes: cleanString(parsed.outcomes),
    inquiryQuestion: cleanString(
      parsed.inquiryQuestion
    ),
    coreCompetencies: cleanString(
      parsed.coreCompetencies
    ),
    values: cleanString(parsed.values),
    pcis: cleanString(parsed.pcis),
    resources: cleanString(parsed.resources),
    introduction: cleanString(
      parsed.introduction
    ),
    development: cleanString(
      parsed.development
    ),
    conclusion: cleanString(
      parsed.conclusion
    ),
    extendedActivities: cleanString(
      parsed.extendedActivities
    ),
  };

  // Basic validation.
  if (
    !plan.strand ||
    !plan.subStrand ||
    !plan.outcomes ||
    !plan.development
  ) {
    return jsonError(
      "The AI returned an incomplete lesson plan. Please try again.",
      502
    );
  }

  return json({
    ok: true,
    action: "lesson",
    subjectId: subject.id,
    subject: subject.name,
    klass: body.klass,
    term: body.term || null,
    year: body.year || null,
    week,
    lessonNo,
    plan,
  });
}

// ============================================================
// OPENROUTER
// ============================================================

async function callOpenRouter(
  instructionText: string,
  documentBlocks: any[],
  schema: any
): Promise<{
  ok: true;
  data: any;
} | {
  ok: false;
  error: string;
  status: number;
}> {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    OPENROUTER_TIMEOUT_MS
  );

  try {
    const content = [
      ...documentBlocks,
      {
        type: "text",
        text: instructionText,
      },
    ];

    const requestBody = {
      model: OPENROUTER_MODEL,

      messages: [
        {
          role: "system",
          content:
            "You are a Kenyan CBC/CBE curriculum specialist. Follow the requested JSON schema exactly. Never return Markdown or commentary outside the JSON.",
        },
        {
          role: "user",
          content,
        },
      ],

      max_tokens: 8000,

      // OpenRouter supports structured output on
      // compatible routed models.
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schema.name,
          strict: true,
          schema: schema.schema,
        },
      },
    };

    const response = await fetch(
      OPENROUTER_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${OPENROUTER_API_KEY}`,

          // These are optional OpenRouter metadata headers.
          "HTTP-Referer":
            "https://cbe-system.example",
          "X-Title":
            "CBE System - Curriculum Generator",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    );

    const rawText = await response.text();

    let data: any = null;

    try {
      data = rawText
        ? JSON.parse(rawText)
        : null;
    } catch {
      console.error(
        "OpenRouter returned non-JSON:",
        rawText.slice(0, 1000)
      );

      return {
        ok: false,
        status: 502,
        error:
          "OpenRouter returned an invalid response.",
      };
    }

    // --------------------------------------------------------
    // OpenRouter errors
    // --------------------------------------------------------

    if (!response.ok) {
      const providerMessage =
        data?.error?.message ||
        data?.error?.metadata?.raw ||
        "OpenRouter request failed.";

      if (response.status === 401) {
        console.error(
          "OpenRouter authentication failed."
        );

        return {
          ok: false,
          status: 502,
          error:
            "The AI service is not configured correctly. Check the OPENROUTER_API_KEY Supabase secret.",
        };
      }

      if (response.status === 429) {
        return {
          ok: false,
          status: 429,
          error:
            "The AI service is temporarily rate-limited. Please wait a moment and try again.",
        };
      }

      if (response.status === 402) {
        return {
          ok: false,
          status: 502,
          error:
            "The OpenRouter account cannot currently process this request. Check the OpenRouter account/API key.",
        };
      }

      if (response.status >= 500) {
        console.error(
          "OpenRouter server error:",
          providerMessage
        );

        return {
          ok: false,
          status: 502,
          error:
            "The AI service is temporarily unavailable. Please try again.",
        };
      }

      console.error(
        "OpenRouter error:",
        response.status,
        providerMessage
      );

      return {
        ok: false,
        status: 502,
        error:
          "The AI service rejected the request. Please try again.",
      };
    }

    // --------------------------------------------------------
    // Extract completion
    // --------------------------------------------------------

    const message =
      data?.choices?.[0]?.message;

    if (!message) {
      console.error(
        "OpenRouter response had no message:",
        data
      );

      return {
        ok: false,
        status: 502,
        error:
          "The AI service returned no usable response.",
      };
    }

    const rawContent =
      typeof message.content === "string"
        ? message.content
        : "";

    if (!rawContent.trim()) {
      return {
        ok: false,
        status: 502,
        error:
          "The AI service returned an empty response.",
      };
    }

    // --------------------------------------------------------
    // Parse JSON defensively
    // --------------------------------------------------------

    const parsed = safeParseJSON(
      rawContent
    );

    if (!parsed) {
      console.error(
        "Invalid AI JSON:",
        rawContent.slice(0, 2000)
      );

      return {
        ok: false,
        status: 502,
        error:
          "The AI returned invalid JSON. Please try again.",
      };
    }

    return {
      ok: true,
      data: parsed,
    };
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      return {
        ok: false,
        status: 504,
        error:
          "The AI request timed out. Please try again.",
      };
    }

    console.error(
      "OpenRouter network error:",
      error
    );

    return {
      ok: false,
      status: 502,
      error:
        "Could not connect to the AI service. Please try again.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// JSON SCHEMAS
// ============================================================

const schemeSchema = {
  name: "cbc_scheme_of_work",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            week: {
              type: "integer",
            },
            lessonNo: {
              type: "integer",
            },
            strand: {
              type: "string",
            },
            subStrand: {
              type: "string",
            },
            outcomes: {
              type: "string",
            },
            inquiryQuestion: {
              type: "string",
            },
            experiences: {
              type: "string",
            },
            resources: {
              type: "string",
            },
            assessment: {
              type: "string",
            },
          },
          required: [
            "week",
            "lessonNo",
            "strand",
            "subStrand",
            "outcomes",
            "inquiryQuestion",
            "experiences",
            "resources",
            "assessment",
          ],
        },
      },
    },
    required: ["rows"],
  },
};

const lessonSchema = {
  name: "cbc_lesson_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      strand: {
        type: "string",
      },
      subStrand: {
        type: "string",
      },
      outcomes: {
        type: "string",
      },
      inquiryQuestion: {
        type: "string",
      },
      coreCompetencies: {
        type: "string",
      },
      values: {
        type: "string",
      },
      pcis: {
        type: "string",
      },
      resources: {
        type: "string",
      },
      introduction: {
        type: "string",
      },
      development: {
        type: "string",
      },
      conclusion: {
        type: "string",
      },
      extendedActivities: {
        type: "string",
      },
    },
    required: [
      "strand",
      "subStrand",
      "outcomes",
      "inquiryQuestion",
      "coreCompetencies",
      "values",
      "pcis",
      "resources",
      "introduction",
      "development",
      "conclusion",
      "extendedActivities",
    ],
  },
};

// ============================================================
// HELPERS
// ============================================================

function safeParseJSON(
  text: string
): any | null {
  let cleaned = text.trim();

  // Remove accidental Markdown fences.
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Sometimes a model adds a small amount of text
    // around an otherwise valid JSON object.
    const firstObject = cleaned.indexOf("{");
    const lastObject = cleaned.lastIndexOf("}");

    if (
      firstObject >= 0 &&
      lastObject > firstObject
    ) {
      try {
        return JSON.parse(
          cleaned.slice(
            firstObject,
            lastObject + 1
          )
        );
      } catch {
        return null;
      }
    }

    return null;
  }
}

function cleanString(
  value: unknown
): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => String(item))
      .join(", ")
      .trim();
  }

  return String(value).trim();
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(
      min,
      Math.round(number)
    )
  );
}

function base64Encode(
  bytes: Uint8Array
): string {
  let binary = "";

  const chunkSize = 0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {
    binary += String.fromCharCode(
      ...bytes.subarray(
        i,
        i + chunkSize
      )
    );
  }

  return btoa(binary);
}

// ============================================================
// CLEAN JSON RESPONSES
// ============================================================

function json(
  body: unknown,
  status = 200
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: corsHeaders,
    }
  );
}

function jsonError(
  message: string,
  status: number
): Response {
  return json(
    {
      ok: false,
      error: message,
    },
    status
  );
}
