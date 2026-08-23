// ============================================================
// supabase/functions/send-sms/index.ts
//
// Deploy with:  supabase functions deploy send-sms
//
// Sends "results ready" SMS to parents through a real SMS gateway
// (Africa's Talking — widely used and affordable for Kenyan schools)
// instead of opening the SMS app on the staff member's own phone.
// The gateway credentials are secrets that only live on the server,
// never in the browser.
//
// ---- ONE-TIME SETUP (do this before the "Send via System" button
//      in Send Results to Parents will work) ----
//   1. Create a free account at https://africastalking.com and buy
//      SMS credit (Kenyan schools can also apply for a custom Sender
//      ID/short code there, e.g. "B-CBE" instead of a long number).
//   2. Get your Username and API Key from the Africa's Talking
//      dashboard (Settings -> API Key).
//   3. Set them as secrets on this Supabase project:
//        supabase secrets set AT_USERNAME=yourusername
//        supabase secrets set AT_API_KEY=your_api_key
//        supabase secrets set AT_SENDER_ID=YourSenderId   (optional)
//   4. Deploy this function:  supabase functions deploy send-sms
// Until step 3/4 are done, the button in the app will tell the user
// system SMS isn't configured yet and they should keep using the
// "Open in Messages" option instead.
//
// Request body:  { recipients: [{ phone: "+2547...", message: "..." }, ...] }
// Response:      { ok: true, results: [{ phone, ok, error? }, ...] }
// ============================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AT_USERNAME = Deno.env.get("AT_USERNAME");
const AT_API_KEY = Deno.env.get("AT_API_KEY");
const AT_SENDER_ID = Deno.env.get("AT_SENDER_ID"); // optional

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Must be a logged-in user of the app — same check pattern as
    // manage-user, just without the extra role checks (any teacher/
    // admin who can already open "Send Results to Parents" is allowed
    // to send through the school's own gateway too).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Invalid session" }, 401);

    if (!AT_USERNAME || !AT_API_KEY) {
      return json({
        error: "System SMS isn't set up yet. An administrator needs to add an SMS gateway (see supabase/functions/send-sms/index.ts for setup steps) before this button will work — use \"Open in Messages\" for now.",
        notConfigured: true,
      }, 400);
    }

    const body = await req.json();
    const recipients: { phone: string; message: string }[] = body.recipients || [];
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return json({ error: "recipients is required" }, 400);
    }
    if (recipients.length > 200) {
      return json({ error: "Too many recipients in one request (max 200)." }, 400);
    }

    const results = await Promise.all(recipients.map((r) => sendOne(r.phone, r.message)));
    return json({ ok: true, results });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

async function sendOne(phone: string, message: string): Promise<{ phone: string; ok: boolean; error?: string }> {
  if (!phone || !message) return { phone: phone || "", ok: false, error: "Missing phone or message" };
  try {
    const form = new URLSearchParams();
    form.set("username", AT_USERNAME!);
    form.set("to", phone);
    form.set("message", message);
    if (AT_SENDER_ID) form.set("from", AT_SENDER_ID);

    const res = await fetch("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: {
        "apiKey": AT_API_KEY!,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: form.toString(),
    });
    const data = await res.json().catch(() => null);
    const recipient = data?.SMSMessageData?.Recipients?.[0];
    if (!res.ok || !recipient || !/Success/i.test(recipient.status || "")) {
      return { phone, ok: false, error: recipient?.status || data?.SMSMessageData?.Message || `HTTP ${res.status}` };
    }
    return { phone, ok: true };
  } catch (e) {
    return { phone, ok: false, error: String(e) };
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
