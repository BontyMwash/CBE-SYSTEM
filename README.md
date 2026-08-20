# B~CBE Analytics — Supabase edition

The same exam register, now backed by a real Postgres database via
Supabase: real login (email + password), Row Level Security instead of
"trust the browser," and genuine multi-school support — different
schools' data is isolated at the database level, not just hidden in the
UI, and it's accessible from any device, not just one browser.

## What changed from the offline version

| | Offline version | This version |
|---|---|---|
| Data storage | Browser localStorage | Supabase Postgres |
| Login | Made-up username/password in localStorage | Real Supabase Auth (email/password) |
| Access control | Hidden nav items only | Row Level Security policies (enforced in the database) |
| Multi-device | No — one browser only | Yes — log in from anywhere |
| Multi-school | Simulated in one browser | Real, isolated per school |

## File structure — where everything belongs

```
project/
├── index.html                    # the app shell — deploy as-is to any static host
├── css/
│   └── style.css                 # unchanged from the original design
├── js/
│   ├── supabaseClient.js         # ⚠️ EDIT THIS — your project URL + anon key
│   ├── data.js                   # all CRUD — talks to Supabase tables
│   ├── grading.js                # pure functions, no data access (unchanged)
│   ├── ui.js                     # modal/toast helpers (unchanged)
│   ├── auth.js                   # Supabase Auth wrapper, roles, routing
│   ├── import.js                 # bulk CSV/Excel student import
│   ├── views.js                  # Dashboard/Students/Subjects/Exams/Results/Reports/Settings
│   ├── auth-views.js             # Login/Schools/Users screens
│   ├── broadsheet.js             # class broadsheet view + subject/class/stream analysis
│   ├── analysis.js                # Marks Analysis (admin publish + class/subject analysis)
│   ├── notify.js                  # Send Results to Parents (WhatsApp/SMS/email)
│   ├── teacher.js                 # My Classes / Learners / Assessments / Gradebook / Reports hub
│   ├── attendance.js              # Attendance register + Competency Assessment (CBC strands)
│   ├── lessonplans.js              # Lesson Plans & Schemes of Work (generate + edit + print)
│   └── app.js                    # router + login gate + sidebar
├── sql/
│   ├── schema.sql                # ⚠️ RUN THIS in Supabase SQL Editor
│   ├── bootstrap_superadmin.sql  # ⚠️ RUN THIS ONCE to create your first login
│   ├── 006_published_results.sql # migration for existing installs — adds "publish results" support
│   ├── 008_parent_contacts_and_notifications.sql # migration for existing installs — adds parent contact fields + notification log
│   └── 009_teacher_classes_attendance_competency.sql # migration for existing installs — adds My Classes/Attendance/Competency Assessment support
│   └── 010_fix_attendance_access.sql # migration for existing installs — fixes Attendance saving for teachers only assigned a subject (not yet a class)
│   └── 011_allow_manual_notification_channel.sql # migration for existing installs — lets "mark as sent" (bulk, no message) log a notification
│   └── 012_class_teacher_add_students.sql # migration for existing installs — lets a class teacher add learners into their own class(es)
│   ├── 013_admin_section_scope.sql # migration for existing installs — lets a superadmin restrict an admin login to Primary, Junior Secondary, or Senior School only
│   ├── 015_lesson_plans_and_schemes.sql # migration for existing installs — adds Lesson Plans & Schemes of Work
│   └── 016_curriculum_documents.sql # migration for existing installs — adds curriculum design PDF uploads + storage bucket, for AI-generated schemes/lesson plans
└── supabase/
    └── functions/
        ├── manage-user/
        │   └── index.ts          # ⚠️ DEPLOY THIS as a Supabase Edge Function
        └── generate-curriculum-content/
            └── index.ts          # ⚠️ DEPLOY THIS too — AI scheme/lesson-plan generation (needs OPENROUTER_API_KEY secret, see step 3)
```

**Everything in `js/`, `css/`, and `index.html` is a static site** — host
it anywhere that serves static files (Netlify, Vercel, GitHub Pages,
Cloudflare Pages, or even a plain S3 bucket). It talks to Supabase
entirely over the network via the JS SDK, so there's no server of your
own to run for the frontend.

The `sql/` and `supabase/functions/` folders are **not** part of the
deployed website — they're one-time setup you run against your Supabase
project directly (SQL Editor and the Supabase CLI, respectively).

## Setup, step by step

### 1. Create a Supabase project
Go to [supabase.com](https://supabase.com) → New Project. Note your
project's **URL** and **anon (public) key** from Project Settings → API
— you'll need both shortly.

### 2. Run the database schema
Dashboard → **SQL Editor** → New query → paste the entire contents of
`sql/schema.sql` → Run. This creates every table, the helper
functions, and every Row Level Security policy. (Already ran an older
`schema.sql` on an existing project? Run `sql/006_published_results.sql`
instead to add just the new "publish results" table without touching
anything else — `sql/008_parent_contacts_and_notifications.sql` to
add parent contact fields + the "Send Results to Parents" notification
log — and `sql/009_teacher_classes_attendance_competency.sql` to add
teacher↔class assignments, Attendance, and Competency Assessment,
plus let a subject teacher create their own Assessments (exams) for
a subject already assigned to them. If you've already run 009, also
run `sql/010_fix_attendance_access.sql` — it fixes a bug where a
teacher who's only been assigned a **subject** (not yet a class) could
see their class on the Attendance page but every save silently failed;
010 makes the database permission match what the screen already shows.
Also run `sql/011_allow_manual_notification_channel.sql` — it lets the
new bulk "Mark all as sent (no message)" action on Send Results to
Parents log correctly; without it that one action fails. Also run
`sql/012_class_teacher_add_students.sql` — it lets a class teacher use
the new "+ Add learner" button on their Learners page; without it the
button is visible but every save is silently rejected by the database.
Also run `sql/013_admin_section_scope.sql` — it adds the optional
"Section" restriction on an admin login (Primary / Junior Secondary /
Senior School), used by the level switcher near the logo and the
"Section" field on the Users page; without it, admin logins stay
unrestricted as before, but the Section field/switcher won't have any
effect at the database level. Also run
`sql/015_lesson_plans_and_schemes.sql` — it adds the **Lesson Plans &
Schemes of Work** screen (tables `schemes_of_work` and `lesson_plans`,
scoped the same way as Competency Assessment: admins see every
subject in their school, a subject teacher only their own); without
it the sidebar entry still appears but every save fails since the
tables don't exist yet. Also run `sql/016_curriculum_documents.sql` —
it adds the `curriculum_documents` table and a private
`curriculum-designs` storage bucket, for uploading the official KICD
curriculum design PDF that grounds the **"Generate with AI"** buttons
on the Lesson Plans screen; without it, "Manage curriculum PDFs" and
"Generate with AI" will fail.)

### 3. Deploy the Edge Functions
This requires the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy manage-user
supabase functions deploy generate-curriculum-content
```

Both functions need your service role key available to them —
Supabase sets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
automatically for Edge Functions in your own project, so no extra
config is needed for `manage-user`.

`generate-curriculum-content` additionally needs an **Anthropic API
key** (it calls Claude, via OpenRouter, to draft schemes/lesson
plans from the uploaded curriculum PDF). Get one from
[openrouter.ai/keys](https://openrouter.ai/keys), then set it as a
secret — it's never exposed to the browser:

```bash
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...
```

Without this secret set, the SQL/table/UI for AI generation all work,
but clicking "Generate with AI" will return an error. Note this uses
your own Anthropic account and is billed per generation — it's
separate from anything to do with Claude.ai.

### 4. Create your first superadmin
Every login *after* this one is created from inside the app — but the
very first one has to be bootstrapped manually, since there's no admin
yet to create it. Follow the steps in `sql/bootstrap_superadmin.sql`
(create the user in Dashboard → Authentication → Users, then run one
SQL insert to give them the `superadmin` role).

### 5. Configure the frontend
Open `js/supabaseClient.js` and replace the two placeholder values:

```js
const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
```

The anon key is safe to commit/expose — it's designed to be public. Row
Level Security is what actually protects your data, not this key.

### 6. Deploy the static site
Drag the project folder (minus `sql/` and `supabase/`, though it's
harmless to leave them) onto [Netlify Drop](https://app.netlify.com/drop),
or push it to a GitHub repo and connect it to Netlify/Vercel/Cloudflare
Pages for automatic deploys. Any static host works.

### 7. Log in and go
Open your deployed URL, log in with the superadmin account from step 4,
and create your first school from the **Schools** page — that also
creates the school's first Admin login in the same step.

## Roles (enforced by RLS, not just hidden buttons)

- **Superadmin** — creates/renames/deletes schools, creates each
  school's first Admin. Can "Open" a school to browse/manage it directly.
- **Admin** — runs one school: students, subjects, exams, results,
  reports, broadsheets, settings, and creates **User** logins for their
  own school (teachers). Also **publishes results** (Analysis page) once
  a sitting's marks are all in — that's what makes it visible to teachers.
- **User (teacher)** — full teacher-section sidebar: Dashboard, My
  Classes, Learners, Assessments (create/edit exams for their own
  subject), Marks Entry (including setting "out of how many"), Marks
  Analysis for sittings their admin has published, Gradebook,
  Report Cards (scoped to their own class(es) only), Attendance,
  Competency Assessment, and Reports (a hub of every export above).
  **Broadsheet** and **Send Results to Parents** are *not* shown to a
  plain subject teacher — both expose every subject for a whole class,
  so they only appear for a **class teacher** (a teacher who's been
  assigned at least one class from the Users page). Which classes show
  up under My Classes/Learners/Attendance/Report Cards/Broadsheet, and
  which subjects under Assessments/Marks Entry/Gradebook/Competency
  Assessment, are set per teacher from the Users page ("Manage
  classes" / "Manage subjects") — everything else stays out of reach.
  Can't touch student/subject/exam-type setup or settings, and can't
  see Marks Analysis for anything not yet published.

  Report Cards, Broadsheet, class lists (Learners / Students), and
  Send Results to Parents all have a **Download CSV** button alongside
  the existing Print/Save-as-PDF button. Send Results to Parents also
  supports **bulk sending**: select several parents (or "Select all
  not-yet-sent") and send WhatsApp/SMS/Email to the whole batch —
  each message still opens one at a time so browsers don't block the
  pop-up, but it auto-advances after each one — or download a CSV with
  a ready-to-use message column for pasting into an external bulk SMS
  tool.

These aren't just UI restrictions — a User's Supabase session literally
cannot read or write rows outside their school, or delete a student, no
matter what requests their browser sends, because the RLS policies in
`schema.sql` check `auth.uid()` against the `profiles` table on every
query at the database level.

## CRUD coverage

Every entity below has full Create/Read/Update/Delete wired through
`js/data.js` to a real table, gated by the RLS policies in
`sql/schema.sql`:

- **Schools** — `schools` table (superadmin only, plus admins can update
  their own school's details)
- **Users/logins** — `profiles` table + Supabase Auth (create/delete/
  password-reset go through the `manage-user` Edge Function, since those
  need the service role key)
- **Students** — `students` table, plus bulk insert for CSV/Excel import
- **Subjects** — `subjects` table
- **Exams** — `exams` table
- **Results** — `results` table, upserted so re-entering a mark updates
  rather than duplicates
- **Published results** — `published_results` table (admin-only publish/
  unpublish; everyone in the school can read it, which is what gates
  the Analysis page for teachers)
- **Teacher ↔ class assignments** — `teacher_classes` table (admin-only,
  from Users → "Manage classes"; scopes My Classes/Learners/Attendance)
- **Attendance** — `attendance` table, one row per learner per class per
  day, upserted so re-marking a day updates rather than duplicates
- **Competency Assessment** — `competency_assessments` table, one row
  per learner/subject/strand/term, rated EE/ME/AE/BE
- **Lesson Plans & Schemes of Work** — `schemes_of_work` table (one row
  per subject/class/term/week/lesson) and `lesson_plans` table (one full
  CBC-format lesson document per subject/class/term/week/lesson); both
  scoped like Competency Assessment (admin: whole school, teacher: own
  assigned subject only)

## Lesson Plans & Schemes of Work

Reachable from the sidebar for both Admins and subject teachers (route
`lessonPlans`, in `js/lessonplans.js`), scoped the same way as
Assessments/Gradebook/Competency Assessment.

- **Scheme of Work** tab — a term-long ledger, one row per week/lesson
  (Strand, Sub-strand, Specific Learning Outcomes, Key Inquiry
  Question, Learning Experiences, Learning Resources, Assessment
  Methods, Reflection). **Generate weeks** fills in blank week/lesson
  rows for the whole term in one click, so a teacher starts from a
  skeleton instead of a blank page — it never overwrites a row that's
  already been filled in (uses `ignoreDuplicates` on insert).
- **Lesson Plans** tab — one full CBC-format lesson document per
  week/lesson (adds Core Competencies, Values, Pertinent & Contemporary
  Issues, Learning Resources, Introduction / Lesson Development /
  Conclusion, Extended Activities, Reflection). **Use for Lesson
  Plan** on any scheme row drafts a starting Introduction / Lesson
  Development / Conclusion from that row's strand, outcomes, inquiry
  question, resources, and assessment method — a template the teacher
  edits before saving (same "computed from what's already on screen"
  approach as the Marks Analysis page's AI Insights, no external AI
  call).
- **Generate with AI** (both tabs) — a genuine external AI call
  (Claude, via the `generate-curriculum-content` Edge Function),
  grounded in the school's own uploaded KICD curriculum design PDF
  for that subject+class ("Manage curriculum PDFs" next to the
  class/subject picker). On the Scheme of Work tab it drafts full
  content for every week/lesson of the term and only writes into
  rows that are still blank; on the Lesson Plans tab it drafts one
  full lesson into the open form, which is then reviewed and edited
  before saving — same "draft, don't auto-save" pattern as the rest
  of the screen. **"Generate all with AI"** on the Lesson Plans tab
  runs this for every scheme-of-work row that doesn't have a lesson
  plan yet, one at a time (with live progress and a Stop button),
  saving each one as it's generated — rows that already have a plan
  are left alone. Requires `sql/016_curriculum_documents.sql`, the
  `generate-curriculum-content` function deployed, and an
  `OPENROUTER_API_KEY` secret set (see Setup, step 3).
- Both tabs support Print / Save as PDF (reusing the same school
  masthead/footer as report cards and broadsheets) and Download CSV.

## Why an Edge Function, not just direct table access?

Creating a login *for someone else* (an admin creating a teacher's
account), resetting someone else's password, or deleting a login all
require Supabase's Admin API, which needs the **service role key** — a
key that bypasses Row Level Security entirely. That key must never reach
the browser. `supabase/functions/manage-user/index.ts` runs server-side
inside Supabase, checks the caller's own role/school before doing
anything, and is the only place that key is ever used.

Same reasoning for the Anthropic API key used by "Generate with AI":
it must never reach the browser either, since anyone with it could
run up your Anthropic bill from outside the app.
`supabase/functions/generate-curriculum-content/index.ts` checks the
caller is actually allowed to generate for that subject (admin in
their own school, or a teacher assigned that subject) before it ever
calls the Anthropic API, and the key itself lives only in the
function's `OPENROUTER_API_KEY` secret.

## Installable / offline app shell (PWA)

The site is now a Progressive Web App:

- **`manifest.json`** — app name, theme colors, and icon set. Lets
  browsers offer "Install app" / "Add to Home Screen" on desktop and
  mobile, opening in its own standalone window (no browser chrome).
- **`icons/`** — generated app icons in all standard sizes, plus
  maskable variants for Android's adaptive icon shapes.
- **`service-worker.js`** — caches the static app shell (HTML, CSS, JS,
  icons) so the app installs instantly and reopens even with no
  connection. It deliberately does **not** cache anything from
  Supabase, jsDelivr, cdnjs, or Google Fonts — results, students, and
  auth always go straight to the network, so data is never stale or
  served from cache. If you're fully offline, the app shell still
  loads and shows `offline.html` for any page it hasn't cached yet.
- **`offline.html`** — friendly fallback shown only when a navigation
  can't reach the network and isn't already cached.

No setup needed for this part — it's plain static files like the rest
of the site. When you edit any file listed in `service-worker.js`'s
`APP_SHELL` array, bump `CACHE_VERSION` in that file so returning users
get the update instead of a stale cached copy.

## Mobile responsiveness

Unchanged from the original design: the sidebar collapses into a
slide-out drawer (tap ☰) below 900px, tables scroll horizontally where
needed, and forms/modals resize to fit — same behavior as before, now
just backed by real data instead of localStorage.

## What's intentionally simplified

- **Login is by email**, not the old made-up "username," since that's
  how Supabase Auth actually works. Usernames aren't stored anywhere.
- **Settings → Data** now only offers **Export** (a JSON download of
  that school's current data). Import/reset were dropped for this
  version — the database is already durable and backed up by Supabase
  itself, so a bulk "wipe and reimport" flow adds risk without much
  benefit. If you need to restore from a backup, Supabase's own
  dashboard (Database → Backups) is the safer path.
- **Login list doesn't show emails** in the Users screen, for a little
  privacy between staff — only name and role are shown there.
