// ============================================================
// supabase/functions/sms-get-queue/index.ts
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
//
// Deploy with:  supabase functions deploy sms-get-queue
//
// The Android gateway polls this every few seconds. Each call:
//   1. Recovers any of THIS device's messages stuck in 'sending'
//      for too long (e.g. the phone lost signal mid-send last time),
//      putting them back to 'pending' so they get retried.
//   2. Atomically claims up to `batchSize` pending messages assigned
//      to this device (sms_claim_queue_batch uses FOR UPDATE SKIP
//      LOCKED, so two overlapping polls can never claim the same
//      row — see 13. SMS Queue Safety).
//   3. Marks the device online (a successful poll IS a heartbeat).
//
// Deliberately batched (default/most 10, hard cap 50) rather than
// handing over the whole queue at once, per spec section 11.
//
// Header:    X-Device-Token: <token from sms-register-device>
// Request:   { batchSize?: number }
// Response:  { ok: true, messages: [{ id, phone, message, campaignId, attempts }] }
// ============================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { authenticateDevice } from "../_shared/deviceAuth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_BATCH = 10;
const MAX_BATCH = 50;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const device = await authenticateDevice(admin, req);
    if (!device) return json({ error: "Unknown, disabled, or missing device token" }, 401);

    const body = await req.json().catch(() => ({}));
    let batchSize = Number(body.batchSize) || DEFAULT_BATCH;
    batchSize = Math.max(1, Math.min(batchSize, MAX_BATCH));

    // Recover this school's messages this device left stuck mid-send.
    await admin.rpc("sms_recover_stuck_queue", { p_school_id: device.school_id, p_stuck_minutes: 10 });

    const { data: claimed, error: claimErr } = await admin.rpc("sms_claim_queue_batch", {
      p_device_id: device.id,
      p_limit: batchSize,
    });
    if (claimErr) return json({ error: claimErr.message }, 400);

    await admin.from("sms_devices").update({
      status: "online",
      last_seen: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", device.id);

    const messages = (claimed || []).map((row: any) => ({
      id: row.id,
      phone: row.phone_number,
      message: row.message,
      campaignId: row.campaign_id,
      attempts: row.attempts,
    }));

    return json({ ok: true, messages });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
