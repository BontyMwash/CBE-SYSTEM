// ============================================================
// supabase/functions/sms-register-device/index.ts
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
//
// Deploy with:  supabase functions deploy sms-register-device
//
// Step 2 of pairing an Android phone as an SMS gateway (step 1 is an
// admin creating a 'pending' sms_devices row + short-lived pair code
// from the SMS -> Gateway Devices screen in the web app — that part
// is a normal RLS-checked insert, no Edge Function needed for it).
//
// The Android app calls this ONCE, with the pair code the admin
// showed/typed on the phone. On success it gets back a device token
// — shown here and only here. The server keeps just its SHA-256
// hash from this point on, so store the raw token securely on the
// device (EncryptedSharedPreferences) and never log it.
//
// Request:   { pairCode: string, phoneNumber?: string, deviceLabel?: string }
// Response:  { ok: true, deviceId, deviceToken, deviceName, schoolId }
// ============================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { sha256Hex, randomToken } from "../_shared/deviceAuth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const pairCode = String(body.pairCode || "").trim().toUpperCase();
    if (!pairCode) return json({ error: "pairCode is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: device, error } = await admin
      .from("sms_devices")
      .select("*")
      .eq("pair_code", pairCode)
      .eq("status", "pending")
      .maybeSingle();

    if (error || !device) {
      return json({ error: "Invalid or already-used pairing code. Ask your administrator to generate a new one." }, 400);
    }
    if (!device.pair_code_expires_at || new Date(device.pair_code_expires_at) < new Date()) {
      return json({ error: "This pairing code has expired. Ask your administrator to generate a new one." }, 400);
    }

    const rawToken = randomToken(32);
    const tokenHash = await sha256Hex(rawToken);

    const { error: updateErr } = await admin
      .from("sms_devices")
      .update({
        device_token_hash: tokenHash,
        pair_code: null,
        pair_code_expires_at: null,
        status: "offline",
        phone_number: body.phoneNumber ? String(body.phoneNumber).trim() : device.phone_number,
        device_name: body.deviceLabel ? String(body.deviceLabel).trim() : device.device_name,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", device.id)
      .eq("status", "pending"); // guards against a double-claim race

    if (updateErr) return json({ error: updateErr.message }, 400);

    return json({
      ok: true,
      deviceId: device.id,
      deviceToken: rawToken,
      deviceName: body.deviceLabel || device.device_name,
      schoolId: device.school_id,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
