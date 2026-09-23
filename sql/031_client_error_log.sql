-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 031 — Client error log ("Diagnostics" page).
--
-- WHY
--   Up to now, when a save silently failed (most commonly: a mark
--   in Marks Entry, but also an exam or subject create/update), the
--   ONLY place the real reason ever showed up was a toast on the
--   device that hit it — gone in a few seconds, on a screen the
--   admin usually isn't looking at (a teacher's phone). An admin
--   troubleshooting "marks aren't saving for this new subject" had
--   no way to see what the database actually said no to, or who it
--   happened to, without standing over the teacher's shoulder.
--
-- WHAT THIS ADDS
--   • client_error_log — one row per failed write, capturing which
--     school/user/role hit it, what they were trying to do (action +
--     a small JSON context: examId, subjectId, klass, studentId,
--     etc.), and the raw Postgres/PostgREST error (code, message,
--     details, hint) — the same fields Supabase already returns,
--     just captured before the toast throws them away.
--   • Any signed-in member of a school can INSERT a row logging
--     their OWN failure (school_id/user_id must match who they are)
--     — this is deliberately simple and independent of every other
--     table's policies, so logging a permission problem is never
--     itself blocked by that same permission problem.
--   • Only admins/superadmins can SELECT or DELETE the log for their
--     school — it's a diagnostics tool, and it can contain other
--     people's context (student/subject ids), so it isn't teacher-
--     visible. See js/views.js Views.diagnostics (Settings ->
--     Diagnostics, admin only) for the page that reads it.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query ->
-- paste this whole file -> Run. Safe on an existing install: it only
-- adds one new table, nothing else is touched.
-- ============================================================

create table if not exists client_error_log (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references schools(id) on delete cascade,
  user_id       uuid references profiles(id) on delete set null,
  role          text not null default '',
  -- What the user was trying to do — 'save_result', 'add_exam',
  -- 'update_exam', 'add_subject', 'update_subject', etc. Free text
  -- (not a check constraint) so a new call site can log a new action
  -- name without a migration.
  action        text not null,
  -- Small, free-form JSON with whatever identifiers make the failure
  -- reproducible: e.g. {"examId":"...", "studentId":"...", "klass":"Grade 7",
  -- "subjectId":"..."} — never marks/grades themselves, just ids.
  context       jsonb not null default '{}'::jsonb,
  error_code    text not null default '',
  error_message text not null default '',
  error_details text not null default '',
  error_hint    text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists idx_client_error_log_school on client_error_log(school_id, created_at desc);

alter table client_error_log enable row level security;

drop policy if exists "any member logs own errors" on client_error_log;
create policy "any member logs own errors" on client_error_log
  for insert with check (
    user_id = auth.uid()
    and (is_superadmin() or school_id = current_school_id())
  );

drop policy if exists "admin view own school error log" on client_error_log;
create policy "admin view own school error log" on client_error_log
  for select using (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id())
  );

drop policy if exists "admin clear own school error log" on client_error_log;
create policy "admin clear own school error log" on client_error_log
  for delete using (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id())
  );
