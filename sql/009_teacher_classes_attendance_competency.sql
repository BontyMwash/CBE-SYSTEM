-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 009 — Teacher class assignments, Attendance, and
-- Competency Assessment.
--
-- Adds what the Teacher sidebar needs beyond what already existed:
--   • teacher_classes         -> powers "My Classes" / "Learners"
--     (which classes a teacher/homeroom login may see, same idea
--     as teacher_subjects but for classes instead of subjects)
--   • attendance              -> powers "Attendance"
--   • competency_assessments  -> powers "Competency Assessment"
--   • a new insert policy on exams so a subject teacher can create
--     their own "Assessments" (exams) for a subject assigned to
--     them, not just edit total marks on ones an admin already made
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run. Safe to run on an existing
-- install — it only adds new tables/policies, it doesn't touch data.
-- ============================================================

-- ------------------------------------------------------------
-- TABLES
-- ------------------------------------------------------------

-- Which classes a teacher (role='user') login is attached to — for
-- "My Classes", "Learners" (roster) and "Attendance". Independent of
-- teacher_subjects: a class teacher may hold a class without teaching
-- every subject in it, and a subject teacher may teach a subject
-- across classes they aren't the class teacher of.
create table if not exists teacher_classes (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  teacher_id  uuid not null references profiles(id) on delete cascade,
  class_id    uuid not null references classes(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (teacher_id, class_id)
);

-- One row per learner, per class, per day. `klass` is stored as the
-- same free-text label (name + stream) used everywhere else
-- (students.klass, exams.klass) so Attendance lines up with rosters
-- without needing a join.
create table if not exists attendance (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  klass       text not null,
  att_date    date not null,
  student_id  uuid not null references students(id) on delete cascade,
  status      text not null default 'present' check (status in ('present','absent','late','excused')),
  remarks     text not null default '',
  marked_by   uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (klass, att_date, student_id)
);

-- CBC-style competency ratings — one row per learner, per subject,
-- per strand (and optional sub-strand), per term/year. Uses the same
-- EE/ME/AE/BE scale as marks bands so it reads consistently with the
-- rest of the app, but is rated directly by the teacher rather than
-- computed from marks.
create table if not exists competency_assessments (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references schools(id) on delete cascade,
  student_id   uuid not null references students(id) on delete cascade,
  subject_id   uuid not null references subjects(id) on delete cascade,
  term         text not null check (term in ('Term 1','Term 2','Term 3')),
  year         int  not null,
  strand       text not null,
  sub_strand   text not null default '',
  rating       text not null check (rating in ('EE','ME','AE','BE')),
  remarks      text not null default '',
  assessed_by  uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (student_id, subject_id, term, year, strand, sub_strand)
);

-- Helpful indexes
create index if not exists idx_teacher_classes_school on teacher_classes(school_id);
create index if not exists idx_teacher_classes_teacher on teacher_classes(teacher_id);
create index if not exists idx_attendance_school on attendance(school_id);
create index if not exists idx_attendance_lookup on attendance(school_id, klass, att_date);
create index if not exists idx_attendance_student on attendance(student_id);
create index if not exists idx_competency_school on competency_assessments(school_id);
create index if not exists idx_competency_lookup on competency_assessments(school_id, subject_id, term, year);
create index if not exists idx_competency_student on competency_assessments(student_id);

-- ------------------------------------------------------------
-- HELPER FUNCTION
-- ------------------------------------------------------------

-- true when the calling teacher (role='user') has this class
-- assigned to them via teacher_classes. Mirrors teacher_has_subject.
create or replace function public.teacher_has_class(cls uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from teacher_classes where teacher_id = auth.uid() and class_id = cls
  );
$$;

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table teacher_classes         enable row level security;
alter table attendance              enable row level security;
alter table competency_assessments  enable row level security;

-- ===== teacher_classes =====
create policy "view own teacher class assignments" on teacher_classes
  for select using (teacher_id = auth.uid());
create policy "admin view teacher class assignments" on teacher_classes
  for select using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id()));

create policy "admin insert teacher class assignments" on teacher_classes
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin delete teacher class assignments" on teacher_classes
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- ===== attendance =====
-- Admins can mark/edit attendance for any class. Teachers can only do
-- so for a class assigned to them via teacher_classes.
create policy "select attendance in own school" on attendance
  for select using (is_superadmin() or school_id = current_school_id());

create policy "admin or class teacher insert attendance" on attendance
  for insert with check (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and exists (
          select 1 from classes c where c.school_id = attendance.school_id
          and (case when c.stream <> '' then c.name || ' ' || c.stream else c.name end) = attendance.klass
          and teacher_has_class(c.id)
        ))
      )
    )
  );

create policy "admin or class teacher update attendance" on attendance
  for update using (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and exists (
          select 1 from classes c where c.school_id = attendance.school_id
          and (case when c.stream <> '' then c.name || ' ' || c.stream else c.name end) = attendance.klass
          and teacher_has_class(c.id)
        ))
      )
    )
  );

create policy "admin or class teacher delete attendance" on attendance
  for delete using (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and exists (
          select 1 from classes c where c.school_id = attendance.school_id
          and (case when c.stream <> '' then c.name || ' ' || c.stream else c.name end) = attendance.klass
          and teacher_has_class(c.id)
        ))
      )
    )
  );

-- ===== competency_assessments =====
-- Same shape as results: admins can rate any subject, subject
-- teachers only the subject(s) assigned to them.
create policy "select competencies in own school" on competency_assessments
  for select using (is_superadmin() or school_id = current_school_id());

create policy "admin or user insert competencies" on competency_assessments
  for insert with check (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_has_subject(subject_id))
      )
    )
  );

create policy "admin or user update competencies" on competency_assessments
  for update using (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_has_subject(subject_id))
      )
    )
  );

create policy "admin or user delete competencies" on competency_assessments
  for delete using (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_has_subject(subject_id))
      )
    )
  );

-- ===== exams — let a subject teacher create their own Assessments =====
-- Previously only admins could INSERT into exams (teachers could only
-- UPDATE total marks on an exam an admin already created). The new
-- "Assessments" screen lets a subject teacher create an exam/sitting
-- for a subject already assigned to them via teacher_subjects.
create policy "user insert exams for own subject" on exams
  for insert with check (
    app_current_role() = 'user' and school_id = current_school_id() and school_active() and teacher_has_subject(subject_id)
  );
