-- ============================================================
-- CBE Exam Register — Supabase schema
-- Run this once in Supabase: Dashboard → SQL Editor → New query
-- ============================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- TABLES
-- ------------------------------------------------------------

create table schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  motto       text default '',
  term        text not null default 'Term 1' check (term in ('Term 1','Term 2','Term 3')),
  year        int  not null default extract(year from now())::int,
  grading_bands jsonb not null default '[
    {"code":"EE","label":"Exceeding Expectation","min":80,"max":100},
    {"code":"ME","label":"Meeting Expectation","min":50,"max":79},
    {"code":"AE","label":"Approaching Expectation","min":30,"max":49},
    {"code":"BE","label":"Below Expectation","min":0,"max":29}
  ]'::jsonb,
  frozen        boolean not null default false,
  frozen_at     timestamptz,
  frozen_reason text not null default '',
  created_at  timestamptz not null default now()
);

-- One row per login. id is the SAME id as auth.users.id (1:1).
-- school_id is null only for superadmins.
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  school_id   uuid references schools(id) on delete cascade,
  role        text not null check (role in ('superadmin','admin','user')),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- One row per class/grade, optionally split into streams (e.g.
-- "Grade 7" with no stream, or "Grade 7" + "East"/"West" streams).
-- Students and exams still store their class as plain text (klass) for
-- backward compatibility, but the UI now sources that text from here
-- instead of free typing, so it stays consistent across the school.
create table classes (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  name        text not null,
  stream      text not null default '',
  created_at  timestamptz not null default now(),
  unique (school_id, name, stream)
);

create table students (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references schools(id) on delete cascade,
  name          text not null,
  admission_no  text default '',
  klass         text not null,
  created_at    timestamptz not null default now()
);

create table subjects (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  name        text not null,
  -- Short code (e.g. "MAT", "ENG") used on the broadsheet instead of the
  -- full subject name, so more subject columns fit the printable page width.
  code        text not null default '',
  created_at  timestamptz not null default now()
);

create table exams (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  type        text not null check (type in ('Opener','Midterm','Endterm')),
  term        text not null check (term in ('Term 1','Term 2','Term 3')),
  year        int  not null,
  klass       text not null,
  subject_id  uuid not null references subjects(id) on delete cascade,
  total_marks numeric not null default 100,
  exam_date   date,
  created_at  timestamptz not null default now()
);

create table results (
  id          uuid primary key default gen_random_uuid(),
  exam_id     uuid not null references exams(id) on delete cascade,
  student_id  uuid not null references students(id) on delete cascade,
  marks       numeric not null,
  created_at  timestamptz not null default now(),
  unique (exam_id, student_id)
);

-- Helpful indexes
create index idx_profiles_school on profiles(school_id);
create index idx_classes_school on classes(school_id);
create index idx_students_school on students(school_id);
create index idx_subjects_school on subjects(school_id);
create index idx_exams_school on exams(school_id);
create index idx_exams_lookup on exams(school_id, type, term, year, klass);
create index idx_results_exam on results(exam_id);
create index idx_results_student on results(student_id);

-- ------------------------------------------------------------
-- HELPER FUNCTIONS
-- security definer + fixed search_path so these can be safely
-- called from inside RLS policies without recursive-lookup or
-- search-path-hijack issues.
-- ------------------------------------------------------------

create or replace function public.app_current_role()
returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function public.current_school_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select school_id from profiles where id = auth.uid();
$$;

create or replace function public.is_superadmin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'superadmin' from profiles where id = auth.uid()), false);
$$;

-- true when the CALLER is allowed to write: superadmins always can;
-- everyone else only when their own school isn't frozen (see
-- "freeze schools that don't pay" in Schools, superadmin-only).
create or replace function public.school_active()
returns boolean
language sql stable security definer set search_path = public as $$
  select
    coalesce((select role = 'superadmin' from profiles where id = auth.uid()), false)
    or not coalesce(
      (select frozen from schools where id = (select school_id from profiles where id = auth.uid())),
      false
    );
$$;

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table schools  enable row level security;
alter table profiles enable row level security;
alter table classes  enable row level security;
alter table students enable row level security;
alter table subjects enable row level security;
alter table exams    enable row level security;
alter table results  enable row level security;

-- ===== schools =====
create policy "superadmin full access to schools" on schools
  for all using (is_superadmin()) with check (is_superadmin());

create policy "members can view own school" on schools
  for select using (id = current_school_id());

create policy "admin can update own school" on schools
  for update using (app_current_role() = 'admin' and id = current_school_id() and school_active())
  with check (app_current_role() = 'admin' and id = current_school_id() and school_active());

-- ===== profiles =====
create policy "view own profile" on profiles
  for select using (id = auth.uid());

create policy "view profiles in own school" on profiles
  for select using (school_id = current_school_id());

create policy "superadmin manage all profiles" on profiles
  for all using (is_superadmin()) with check (is_superadmin());

create policy "admin manage own school profiles" on profiles
  for update using (app_current_role() = 'admin' and school_id = current_school_id() and school_active())
  with check (app_current_role() = 'admin' and school_id = current_school_id() and school_active());

create policy "admin delete own school profiles" on profiles
  for delete using (
    app_current_role() = 'admin' and school_id = current_school_id() and id <> auth.uid() and school_active()
  );

create policy "user can update own profile" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Note: new profile rows are created by the create-user Edge Function
-- using the service role key (bypasses RLS), not by direct client insert.
-- This keeps "who can create logins" enforced server-side.

-- ===== classes =====
create policy "select classes in own school" on classes
  for select using (is_superadmin() or school_id = current_school_id());

create policy "admin insert classes" on classes
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin update classes" on classes
  for update using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin delete classes" on classes
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- ===== students =====
create policy "select students in own school" on students
  for select using (is_superadmin() or school_id = current_school_id());

create policy "admin manage students" on students
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin update students" on students
  for update using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin delete students" on students
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- ===== subjects =====
create policy "select subjects in own school" on subjects
  for select using (is_superadmin() or school_id = current_school_id());

create policy "admin insert subjects" on subjects
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin update subjects" on subjects
  for update using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin delete subjects" on subjects
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- ===== exams =====
-- Admins create/delete exams; Admins AND Users (subject teachers) can
-- update an exam — this is what lets a teacher set "total marks (out of)"
-- for their subject from the Results Entry screen.
create policy "select exams in own school" on exams
  for select using (is_superadmin() or school_id = current_school_id());

create policy "admin insert exams" on exams
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin or user update exams" on exams
  for update using (is_superadmin() or (app_current_role() in ('admin','user') and school_id = current_school_id() and school_active()));
create policy "admin delete exams" on exams
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- ===== results =====
-- Admins and Users (subject teachers) can enter/edit/clear marks for
-- exams that belong to their own school.
create policy "select results in own school" on results
  for select using (
    is_superadmin() or exists (
      select 1 from exams e where e.id = results.exam_id and e.school_id = current_school_id()
    )
  );

create policy "admin or user insert results" on results
  for insert with check (
    is_superadmin() or (
      app_current_role() in ('admin','user') and school_active() and exists (
        select 1 from exams e where e.id = results.exam_id and e.school_id = current_school_id()
      )
    )
  );

create policy "admin or user update results" on results
  for update using (
    is_superadmin() or (
      app_current_role() in ('admin','user') and school_active() and exists (
        select 1 from exams e where e.id = results.exam_id and e.school_id = current_school_id()
      )
    )
  );

create policy "admin or user delete results" on results
  for delete using (
    is_superadmin() or (
      app_current_role() in ('admin','user') and school_active() and exists (
        select 1 from exams e where e.id = results.exam_id and e.school_id = current_school_id()
      )
    )
  );
