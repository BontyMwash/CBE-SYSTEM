// ============================================================
// supabase/functions/_shared/deviceAuth.ts
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
//
// The Android gateway app is NOT a Supabase Auth user — it never
// logs in and never sees the service role key. Instead it holds one
// per-device bearer token (issued once, at pairing time, by
// sms-register-device) and sends it as the `X-Device-Token` header
// on every request. We store only sha256(token) in
// sms_devices.device_token_hash, so a leaked database row can never
// be replayed as a working token, and hash the incoming header the
// same way before comparing.
// ============================================================

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomPairCode(): string {
  // 8 characters, unambiguous alphabet (no 0/O/1/I) — short enough to
  // type into the Android app by hand while pairing.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 8; i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}

// Looks up the device by its hashed token. Returns null if missing,
// disabled, or the header wasn't sent at all — callers should treat
// every null the same way (401), so as not to leak which case it was.
export async function authenticateDevice(adminClient: any, req: Request): Promise<any | null> {
  const token = req.headers.get("X-Device-Token");
  if (!token) return null;
  const hash = await sha256Hex(token);
  const { data: device, error } = await adminClient
    .from("sms_devices")
    .select("*")
    .eq("device_token_hash", hash)
    .maybeSingle();
  if (error || !device) return null;
  if (device.status === "disabled") return null;
  return device;
}
