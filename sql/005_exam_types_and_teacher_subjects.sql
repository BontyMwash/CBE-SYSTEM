-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration: admin-defined exam types + teacher-subject
-- assignments ("which subjects can this teacher see/edit").
-- Run this once in Supabase SQL Editor. Safe to re-run — every
-- statement is guarded with IF NOT EXISTS / ON CONFLICT / DROP
-- POLICY IF EXISTS.
-- ============================================================

-- ------------------------------------------------------------
-- 1. exam_types — replaces the old hard-coded
--    Opener/Midterm/Endterm check constraint. Each school now
--    manages its own list from Settings -> Exam types.
-- ------------------------------------------------------------
create table if not exists exam_types (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (school_id, name)
);

create index if not exists idx_exam_types_school on exam_types(school_id);

alter table exam_types enable row level security;

drop policy if exists "select exam types in own school" on exam_types;
create policy "select exam types in own school" on exam_types
  for select using (is_superadmin() or school_id = current_school_id());

drop policy if exists "admin insert exam types" on exam_types;
create policy "admin insert exam types" on exam_types
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

drop policy if exists "admin update exam types" on exam_types;
create policy "admin update exam types" on exam_types
  for update using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

drop policy if exists "admin delete exam types" on exam_types;
create policy "admin delete exam types" on exam_types
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- Seed every existing school with the three types it already had, so
-- current exams keep working and admins can rename/add/remove from here.
insert into exam_types (school_id, name, sort_order)
select id, 'Opener', 1 from schools
union all
select id, 'Midterm', 2 from schools
union all
select id, 'Endterm', 3 from schools
on conflict (school_id, name) do nothing;

-- Drop the old hard-coded check constraint on exams.type (name is
-- Postgres's default for `check (type in (...))` on this table).
-- Exam type is now free text, validated against exam_types in the app.
alter table exams drop constraint if exists exams_type_check;

-- ------------------------------------------------------------
-- 2. teacher_subjects — which subjects a "user" (teacher) login
--    is allowed to see/edit exams and results for. Admins are
--    never restricted by this table.
-- ------------------------------------------------------------
create table if not exists teacher_subjects (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  teacher_id  uuid not null references profiles(id) on delete cascade,
  subject_id  uuid not null references subjects(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (teacher_id, subject_id)
);

create index if not exists idx_teacher_subjects_school on teacher_subjects(school_id);
create index if not exists idx_teacher_subjects_teacher on teacher_subjects(teacher_id);

alter table teacher_subjects enable row level security;

-- Helper: does the CALLING teacher have this subject assigned?
-- Admins/superadmins are handled separately in the exam/result
-- policies below (this function is only consulted for role='user').
create or replace function public.teacher_has_subject(subj uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from teacher_subjects where teacher_id = auth.uid() and subject_id = subj
  );
$$;

drop policy if exists "view own teacher subject assignments" on teacher_subjects;
create policy "view own teacher subject assignments" on teacher_subjects
  for select using (teacher_id = auth.uid());

drop policy if exists "admin view teacher subject assignments" on teacher_subjects;
create policy "admin view teacher subject assignments" on teacher_subjects
  for select using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id()));

drop policy if exists "admin insert teacher subject assignments" on teacher_subjects;
create policy "admin insert teacher subject assignments" on teacher_subjects
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

drop policy if exists "admin delete teacher subject assignments" on teacher_subjects;
create policy "admin delete teacher subject assignments" on teacher_subjects
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- ------------------------------------------------------------
-- 3. Restrict teacher ("user") writes on exams/results to only
--    their assigned subjects. Admins/superadmins are unaffected.
--    (Viewing — SELECT — stays school-wide so a teacher can still
--    open the whole-class Report Cards / Broadsheet pages.)
-- ------------------------------------------------------------
drop policy if exists "admin or user update exams" on exams;
create policy "admin or user update exams" on exams
  for update using (
    is_superadmin()
    or (app_current_role() = 'admin' and school_id = current_school_id() and school_active())
    or (app_current_role() = 'user' and school_id = current_school_id() and school_active() and teacher_has_subject(subject_id))
  );

drop policy if exists "admin or user insert results" on results;
create policy "admin or user insert results" on results
  for insert with check (
    is_superadmin() or (
      school_active() and exists (
        select 1 from exams e where e.id = results.exam_id and e.school_id = current_school_id()
        and (
          app_current_role() = 'admin'
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
          app_current_role() = 'admin'
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
          app_current_role() = 'admin'
          or (app_current_role() = 'user' and teacher_has_subject(e.subject_id))
        )
      )
    )
  );
