-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 015 — Lesson Plans & Schemes of Work.
--
-- NOTE: this feature was removed — see migration 017, which drops
-- everything this file creates. Kept here only for migration
-- history; do not run on a fresh install without 017 following it.
--
-- Adds what the new "Lesson Plans" screen needs:
--   • schemes_of_work  -> the term-long plan, one row per week/lesson
--     for a subject+class (Strand, Sub-strand, Specific Learning
--     Outcomes, Key Inquiry Question, Learning Experiences, Learning
--     Resources, Assessment Methods, Reflection). Supports a
--     "Generate weeks" skeleton-fill action from the UI.
--   • lesson_plans     -> a full single-lesson document (CBC format:
--     Strand/Sub-strand, Specific Learning Outcomes, Key Inquiry
--     Question, Core Competencies, Values, PCIs, Learning Resources,
--     Introduction/Lesson Development/Conclusion, Extended
--     Activities, Reflection), optionally generated from a scheme row.
--
-- Access mirrors competency_assessments: admins see/manage every
-- subject in their school; a teacher (role='user') only the
-- subject(s) assigned to them via teacher_subjects.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run. Safe to run on an existing
-- install — it only adds new tables/policies, it doesn't touch data.
-- ============================================================

-- ------------------------------------------------------------
-- TABLES
-- ------------------------------------------------------------

create table if not exists schemes_of_work (
  id                          uuid primary key default gen_random_uuid(),
  school_id                   uuid not null references schools(id) on delete cascade,
  subject_id                  uuid not null references subjects(id) on delete cascade,
  klass                       text not null,
  term                        text not null check (term in ('Term 1','Term 2','Term 3')),
  year                        int  not null,
  week                        int  not null,
  lesson_no                   int  not null default 1,
  strand                      text not null default '',
  sub_strand                  text not null default '',
  specific_learning_outcomes  text not null default '',
  key_inquiry_question        text not null default '',
  learning_experiences        text not null default '',
  learning_resources          text not null default '',
  assessment_methods          text not null default '',
  reflection                  text not null default '',
  created_by                  uuid references profiles(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (subject_id, klass, term, year, week, lesson_no)
);

create table if not exists lesson_plans (
  id                          uuid primary key default gen_random_uuid(),
  school_id                   uuid not null references schools(id) on delete cascade,
  subject_id                  uuid not null references subjects(id) on delete cascade,
  klass                       text not null,
  term                        text not null check (term in ('Term 1','Term 2','Term 3')),
  year                        int  not null,
  week                        int  not null,
  lesson_no                   int  not null default 1,
  lesson_date                 date,
  strand                      text not null default '',
  sub_strand                  text not null default '',
  specific_learning_outcomes  text not null default '',
  key_inquiry_question        text not null default '',
  core_competencies           text not null default '',
  values_taught                text not null default '',
  pcis                        text not null default '',
  learning_resources          text not null default '',
  introduction                text not null default '',
  lesson_development          text not null default '',
  conclusion                  text not null default '',
  extended_activities         text not null default '',
  reflection                  text not null default '',
  created_by                  uuid references profiles(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (subject_id, klass, term, year, week, lesson_no)
);

create index if not exists idx_schemes_school   on schemes_of_work(school_id);
create index if not exists idx_schemes_lookup   on schemes_of_work(school_id, subject_id, klass, term, year);
create index if not exists idx_lessonplans_school on lesson_plans(school_id);
create index if not exists idx_lessonplans_lookup on lesson_plans(school_id, subject_id, klass, term, year);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table schemes_of_work enable row level security;
alter table lesson_plans    enable row level security;

-- ===== schemes_of_work =====
create policy "select schemes in own school" on schemes_of_work
  for select using (is_superadmin() or school_id = current_school_id());

create policy "admin or user insert schemes" on schemes_of_work
  for insert with check (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_has_subject(subject_id))
      )
    )
  );

create policy "admin or user update schemes" on schemes_of_work
  for update using (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_has_subject(subject_id))
      )
    )
  );

create policy "admin or user delete schemes" on schemes_of_work
  for delete using (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_has_subject(subject_id))
      )
    )
  );

-- ===== lesson_plans =====
create policy "select lesson plans in own school" on lesson_plans
  for select using (is_superadmin() or school_id = current_school_id());

create policy "admin or user insert lesson plans" on lesson_plans
  for insert with check (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_has_subject(subject_id))
      )
    )
  );

create policy "admin or user update lesson plans" on lesson_plans
  for update using (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_has_subject(subject_id))
      )
    )
  );

create policy "admin or user delete lesson plans" on lesson_plans
  for delete using (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_has_subject(subject_id))
      )
    )
  );
