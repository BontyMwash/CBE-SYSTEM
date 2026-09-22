// ============================================================
// supabase/functions/sms-heartbeat/index.ts
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
//
// Deploy with:  supabase functions deploy sms-heartbeat
//
// The Android gateway calls this every ~20-30s while its foreground
// service is running, so the SMS Dashboard can show "online" /
// "last seen Ns ago" without waiting for a poll that finds messages.
//
// Header:    X-Device-Token: <token from sms-register-device>
// Request:   { phoneNumber?: string, pendingCount?: number }
// Response:  { ok: true }
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

    const patch: Record<string, unknown> = {
      status: "online",
      last_seen: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (body.phoneNumber) patch.phone_number = String(body.phoneNumber).trim();

    const { error } = await admin.from("sms_devices").update(patch).eq("id", device.id);
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
