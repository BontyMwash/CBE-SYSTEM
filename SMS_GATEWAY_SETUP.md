# CBE Bulk SMS Module — Setup Guide

Copyright (c) 2026 B~CBE Analytics. All rights reserved.

This module lets the CBE system send bulk SMS to parents/guardians
using an ordinary Android phone with a Kenyan SIM as the "gateway" —
no paid SMS API subscription required. The web app queues messages;
a paired Android phone (running the small "CBE SMS Gateway" app in
`android-gateway/`) polls for them and sends each one on its own SIM.

```
Web app  ──▶  sms_campaigns / sms_queue (Supabase)
                        ▲
                        │  service-role only
                        ▼
        sms-get-queue / sms-heartbeat / sms-update-result
                (Supabase Edge Functions)
                        ▲
                        │  per-device hashed token, HTTPS
                        ▼
          "CBE SMS Gateway" Android app  ──▶  sends via SmsManager
```

The browser never sends SMS directly, and neither the browser nor
the Android app ever holds your Supabase **service role** key — only
the Edge Functions do, and they run on Supabase's servers.

---

## 1. Apply the database migration

Supabase Dashboard → **SQL Editor** → New query → paste the entire
contents of `sql/022_sms_module.sql` → **Run**.

This adds six new tables (`sms_devices`, `sms_templates`,
`sms_campaigns`, `sms_queue`, `sms_logs`, `sms_settings`), their
indexes, and Row Level Security — it does not touch any existing
table. Safe to run once on your existing project.

## 2. Deploy the Edge Functions

You'll need the [Supabase CLI](https://supabase.com/docs/guides/cli)
logged in and linked to your project (the same one the web app in
`js/supabaseClient.js` points at). From the project root:

```bash
supabase functions deploy sms-register-device
supabase functions deploy sms-heartbeat
supabase functions deploy sms-get-queue
supabase functions deploy sms-update-result
```

No extra environment variables to set — `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are already available to every Edge
Function automatically.

If you're not set up to deploy via the CLI, you can instead paste
each function's `index.ts` into **Dashboard → Edge Functions → Deploy
a new function** one at a time (also copy `_shared/cors.ts` and
`_shared/deviceAuth.ts` into each function's own folder in that case,
since the dashboard editor doesn't support the shared-folder import
path).

## 3. Reload the web app

Nothing else to configure — a new **SMS** item appears in the sidebar
for admins and superadmins (teachers don't get it by default, same as
the existing **Users** page). Refresh the page after deploying.

## 4. Build the Android gateway app

The `android-gateway/` folder is a standard Android Studio project
(Kotlin, minSdk 26 / Android 8+).

1. Open `android-gateway/` in Android Studio → let it sync (it will
   offer to generate the Gradle wrapper automatically if it's
   missing — accept that).
2. Build → **Generate Signed Bundle / APK** (or just run it on a
   test device via the Run button first).
3. Install the APK on the phone(s) you want to use as gateways. One
   phone can handle a busy school on its own; you can pair more than
   one device if you want to split load or have a backup SIM.

The app only ever requests: **Send SMS** and **Notifications**
(Android 13+, for the "gateway running" status notification) as
runtime permissions, plus a background-run allowance you can grant
from its own screen (recommended, not required) so aggressive
battery managers don't kill it. It never asks for contacts, storage,
location, or anything else.

## 5. Pair a phone

1. In the web app: **SMS → Gateway Devices → + Pair a phone**. This
   shows an 8-character code, valid for 15 minutes.
2. On the Android phone: open **CBE SMS Gateway** →
   - Under "1. Project setup", enter your Supabase project URL
     (e.g. `https://gxebywxbkeqigabajffi.supabase.co` — the same URL
     used in `js/supabaseClient.js`) and tap **Save**.
   - Under "2. Pair this phone", enter the code and tap **Pair
     device**.
3. Tap **Start Gateway**. The phone now polls for pending messages
   every few seconds and sends them on its SIM.

Re-pairing (e.g. after "Remove" or if a token needs rotating) just
means generating a fresh code from Gateway Devices and repeating step
5 on the phone.

## 6. Using it

- **Bulk SMS** tab — pick recipients (all parents, a class, hand-picked
  students, or pasted phone numbers), write or pick a template, and
  send. `{student_name}`, `{parent_name}`, `{class}`, `{school_name}`
  and `{average}` are filled in per recipient where the data is
  available.
- **History** — every campaign, with per-recipient status, a
  **Retry failed** button, and **Cancel** for anything still pending.
- **Templates** — save reusable messages.
- **Settings** — retry limit, batch size per poll, and the three
  "Automatic SMS" switches. Those switches are just flags for other
  parts of the app to check before auto-queuing a message (e.g. when
  results are published) — this release ships the switches and the
  sending pipeline; wiring each trigger into its originating screen
  (Results/Attendance/Fees) is the natural next increment.

## Notes and limitations

- **No separate "parents" table.** This schema keeps guardian contact
  info on `students.parent_name` / `parent_phone`, so `sms_queue`
  links to `students` directly — there's nothing to migrate.
- **Kenyan numbers only**, normalized to `+254…`. Anything that
  doesn't look like a Safaricom/Airtel-style Kenyan mobile number is
  reported as invalid and skipped rather than guessed at.
- **Multiple phones**: if more than one device is online, a campaign
  is split round-robin across them (or you can pin it to one device
  from the composer).
- **If the gateway phone goes offline**, messages simply stay queued
  — nothing is lost, and they're picked up as soon as it reconnects
  (a WorkManager job also nudges things along roughly every 15
  minutes even if the app's foreground service gets killed by the
  OS).
