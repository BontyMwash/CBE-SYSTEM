// ============================================================
// supabase/functions/sms-update-result/index.ts
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
//
// Deploy with:  supabase functions deploy sms-update-result
//
// The Android gateway calls this after attempting each message (or
// batches several results into one call). For every result:
//   - Only a queue row this SAME device currently holds (status
//     'sending', device_id = caller) can be updated — this stops
//     one device from tampering with another device's or another
//     school's messages even if a token ever leaked.
//   - 'sent'   -> queue row becomes 'sent', sent_at = now().
//   - 'failed' -> retried (put back to 'pending') while
//                 attempts < max_attempts, otherwise becomes a
//                 terminal 'failed' — the safe retry limit from
//                 13. SMS Queue Safety / 19. SMS Settings.
//   - Every result is written to sms_logs regardless, for the full
//     audit trail (23. Audit Logging).
//
// Header:    X-Device-Token: <token from sms-register-device>
// Request:   { results: [{ queueId, status: 'sent'|'failed', errorMessage? }] }
// Response:  { ok: true, updated: number }
// ============================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { authenticateDevice } from "../_shared/deviceAuth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const device = await authenticateDevice(admin, req);
    if (!device) return json({ error: "Unknown, disabled, or missing device token" }, 401);

    const body = await req.json().catch(() => ({}));
    const results: { queueId: string; status: string; errorMessage?: string }[] = body.results || [];
    if (!Array.isArray(results) || results.length === 0) return json({ error: "results is required" }, 400);
    if (results.length > 100) return json({ error: "Too many results in one request (max 100)." }, 400);

    let updated = 0;

    for (const r of results) {
      if (!r.queueId || !["sent", "failed"].includes(r.status)) continue;

      // Must be a row THIS device currently holds — prevents a stray
      // or malicious report from touching someone else's message.
      const { data: row } = await admin
        .from("sms_queue")
        .select("*")
        .eq("id", r.queueId)
        .eq("device_id", device.id)
        .eq("status", "sending")
        .maybeSingle();
      if (!row) continue;

      const willRetry = r.status === "failed" && row.attempts < row.max_attempts;
      const nextStatus = r.status === "sent" ? "sent" : (willRetry ? "pending" : "failed");

      await admin.from("sms_queue").update({
        status: nextStatus,
        error_message: r.status === "failed" ? (r.errorMessage || "Send failed") : null,
        sent_at: r.status === "sent" ? new Date().toISOString() : row.sent_at,
        locked_at: null,
      }).eq("id", row.id);

      await admin.from("sms_logs").insert({
        school_id: row.school_id,
        queue_id: row.id,
        device_id: device.id,
        phone_number: row.phone_number,
        status: r.status,
        error_message: r.errorMessage || null,
      });

      updated++;
    }

    await admin.from("sms_devices").update({
      status: "online",
      last_seen: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", device.id);

    return json({ ok: true, updated });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
