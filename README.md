# CBE Exam Register — Supabase edition

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
│   ├── broadsheet.js             # class broadsheet view
│   └── app.js                    # router + login gate + sidebar
├── sql/
│   ├── schema.sql                # ⚠️ RUN THIS in Supabase SQL Editor
│   └── bootstrap_superadmin.sql  # ⚠️ RUN THIS ONCE to create your first login
└── supabase/
    └── functions/
        └── manage-user/
            └── index.ts          # ⚠️ DEPLOY THIS as a Supabase Edge Function
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
`sql/schema.sql` → Run. This creates all six tables, the helper
functions, and every Row Level Security policy.

### 3. Deploy the Edge Function
This requires the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy manage-user
```

The function needs your service role key available to it — Supabase
sets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically for
Edge Functions in your own project, so no extra config is needed here.

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
  own school (teachers).
- **User (teacher)** — Dashboard, Results Entry (including setting "out
  of how many" for their subject), Report Cards, Broadsheet. Can't touch
  student/subject/exam setup or settings.

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

## Why an Edge Function, not just direct table access?

Creating a login *for someone else* (an admin creating a teacher's
account), resetting someone else's password, or deleting a login all
require Supabase's Admin API, which needs the **service role key** — a
key that bypasses Row Level Security entirely. That key must never reach
the browser. `supabase/functions/manage-user/index.ts` runs server-side
inside Supabase, checks the caller's own role/school before doing
anything, and is the only place that key is ever used.

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
