-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 013 — Section-scoped admins (Primary / Junior
-- Secondary / Senior School) and "promote to next class" support.
--
-- WHAT THIS ADDS
--   • profiles.section_scope — optional, only meaningful for
--     role='admin'. NULL means "unrestricted, sees the whole
--     school" (unchanged behaviour, so nothing breaks for existing
--     single-admin schools). Set to 'primary', 'junior-secondary'
--     or 'senior-school' to make that admin login only able to
--     create/edit/delete classes, students, exams and results for
--     that section — letting one school run Primary and Junior
--     Secondary as day-to-day independent units, each with its own
--     admin, while a superadmin still oversees both.
--   • class_section(klass text) — a SQL copy of the same CBC
--     grade-band logic the front end already uses (gradeSection()
--     in js/views.js) so RLS can classify a class/klass string the
--     same way the UI does, without a separate "section" column to
--     keep in sync by hand.
--   • admin_class_allowed(klass text) — true unless the CALLER is a
--     section-scoped admin trying to touch a class outside their
--     section. Wired into the write policies (insert/update/delete)
--     for classes, students, exams and results.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   Teachers are NOT restricted by section_scope — a teacher who is
--   assigned classes in both Primary and Junior Secondary (via
--   teacher_classes, see 009_teacher_classes_attendance_competency.sql)
--   keeps seeing both, same as today. Only the 'admin' role is
--   affected.
--
--   Subjects and exam types stay school-wide (shared vocabulary
--   like "Mathematics" or "Opener" makes sense across both
--   sections), so they are NOT section-scoped here.
--
--   This migration only gates WRITES (insert/update/delete) at the
--   database level. A section-scoped admin is additionally kept
--   from ever seeing the other section's data because the app UI
--   filters what it fetches/renders for them — but a full
--   database-level READ split (so an admin's own Supabase queries
--   could never return the other section's rows even if they
--   bypassed the app) is a bigger change to the SELECT policies
--   below, and isn't included here.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run. Safe on an existing install —
-- it only adds a column/functions and re-defines a handful of
-- write policies, it doesn't touch data.
-- ============================================================

-- ------------------------------------------------------------
-- COLUMN
-- ------------------------------------------------------------

alter table profiles
  add column if not exists section_scope text
  check (section_scope in ('primary', 'junior-secondary', 'senior-school'));

comment on column profiles.section_scope is
  'Only meaningful when role=admin. NULL = unrestricted (sees/manages the whole school). Otherwise limits that admin login to one CBC section.';

-- ------------------------------------------------------------
-- HELPER FUNCTIONS
-- ------------------------------------------------------------

-- Same CBC grade bands as gradeSection() in js/views.js:
-- PP1/PP2 -> primary, Grade 1-6 -> primary, Grade 7-9 ->
-- junior-secondary, Grade 10-12 -> senior-school. Returns null for
-- a class name that doesn't match a recognised CBC grade (a custom
-- class name) — callers should treat null as "not section-locked".
create or replace function public.class_section(klass text)
returns text
language plpgsql immutable as $$
declare
  s text := lower(coalesce(klass, ''));
  m text[];
  n int;
begin
  if s ~ 'pp\s*-?\s*[12]\y' or s ~ 'pre[- ]?primary' then
    return 'primary';
  end if;
  m := regexp_match(s, 'grade\s*-?\s*([0-9]{1,2})');
  if m is not null then
    n := m[1]::int;
    if n between 1 and 6 then return 'primary'; end if;
    if n between 7 and 9 then return 'junior-secondary'; end if;
    if n between 10 and 12 then return 'senior-school'; end if;
  end if;
  return null;
end;
$$;

create or replace function public.admin_section_scope()
returns text
language sql stable security definer set search_path = public as $$
  select section_scope from profiles where id = auth.uid();
$$;

-- True unless the caller is a section-scoped admin touching a class
-- outside their section. Everyone else (superadmin, unrestricted
-- admin, teachers) is always allowed — section_scope never affects
-- them. A class name that doesn't parse as a CBC grade (custom
-- name) is left visible/editable to every admin, scoped or not,
-- rather than silently locked out.
create or replace function public.admin_class_allowed(klass text)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    app_current_role() <> 'admin'
    or admin_section_scope() is null
    or class_section(klass) is null
    or class_section(klass) = admin_section_scope();
$$;

-- ------------------------------------------------------------
-- POLICIES — re-defined to add the admin_class_allowed(...) gate.
-- Everything else about these policies (superadmin/school/frozen
-- checks) is unchanged from schema.sql; only the admin branch gets
-- the extra AND.
-- ------------------------------------------------------------

-- ===== classes =====
drop policy if exists "admin insert classes" on classes;
create policy "admin insert classes" on classes
  for insert with check (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(name))
  );

drop policy if exists "admin update classes" on classes;
create policy "admin update classes" on classes
  for update using (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(name))
  ) with check (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(name))
  );

drop policy if exists "admin delete classes" on classes;
create policy "admin delete classes" on classes
  for delete using (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(name))
  );

-- ===== students =====
drop policy if exists "admin manage students" on students;
create policy "admin manage students" on students
  for insert with check (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(klass))
  );

drop policy if exists "admin update students" on students;
create policy "admin update students" on students
  for update using (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(klass))
  ) with check (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(klass))
  );

drop policy if exists "admin delete students" on students;
create policy "admin delete students" on students
  for delete using (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(klass))
  );

-- ===== exams =====
drop policy if exists "admin insert exams" on exams;
create policy "admin insert exams" on exams
  for insert with check (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(klass))
  );

drop policy if exists "admin or user update exams" on exams;
create policy "admin or user update exams" on exams
  for update using (
    is_superadmin()
    or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(klass))
    or (app_current_role() = 'user' and school_id = current_school_id() and school_active() and teacher_has_subject(subject_id))
  );

drop policy if exists "admin delete exams" on exams;
create policy "admin delete exams" on exams
  for delete using (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(klass))
  );

-- ===== results ===== (gated via the parent exam's klass)
drop policy if exists "admin or user insert results" on results;
create policy "admin or user insert results" on results
  for insert with check (
    is_superadmin() or (
      school_active() and exists (
        select 1 from exams e where e.id = results.exam_id and e.school_id = current_school_id()
        and (
          (app_current_role() = 'admin' and admin_class_allowed(e.klass))
          or (app_current_role() = 'user' and teacher_has_subject(e.subject_id))
        )
      )
    )
  );

drop policy if exists "admin or user update results" on results;
create policy "admin or user update results" on results
  for update using (
    is_superadmin() or (
      school_active() and exists (
        select 1 from exams e where e.id = results.exam_id and e.school_id = current_school_id()
        and (
          (app_current_role() = 'admin' and admin_class_allowed(e.klass))
          or (app_current_role() = 'user' and teacher_has_subject(e.subject_id))
        )
      )
    )
  );

drop policy if exists "admin or user delete results" on results;
create policy "admin or user delete results" on results
  for delete using (
    is_superadmin() or (
      school_active() and exists (
        select 1 from exams e where e.id = results.exam_id and e.school_id = current_school_id()
        and (
          (app_current_role() = 'admin' and admin_class_allowed(e.klass))
          or (app_current_role() = 'user' and teacher_has_subject(e.subject_id))
        )
      )
    )
  );
