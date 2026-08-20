-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 016 — Curriculum Documents (for AI-assisted
-- schemes of work & lesson plans).
--
-- Adds a place to upload the official KICD curriculum design
-- PDF for a subject+class, so the "Generate with AI" buttons on
-- the Lesson Plans screen have an authoritative source to ground
-- their output in — rather than the AI inventing strands from
-- general knowledge.
--
--   • curriculum_documents -> metadata row per uploaded PDF
--     (school, subject, class, storage path).
--   • storage bucket "curriculum-designs" (private) -> the PDF
--     bytes themselves, one file per row above. Path convention:
--     {school_id}/{subject_id}/{klass}/{filename}
--
-- Access mirrors schemes_of_work/lesson_plans: admins manage
-- every subject in their school; a teacher (role='user') only
-- the subject(s) assigned to them via teacher_subjects.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run. Safe to run on an existing
-- install — it only adds a new table/bucket/policies, it doesn't
-- touch existing data.
-- ============================================================

-- ------------------------------------------------------------
-- TABLE
-- ------------------------------------------------------------

create table if not exists curriculum_documents (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references schools(id) on delete cascade,
  subject_id    uuid not null references subjects(id) on delete cascade,
  klass         text not null,
  title         text not null default '',
  storage_path  text not null,
  file_size     int,
  uploaded_by   uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_curriculum_docs_school on curriculum_documents(school_id);
create index if not exists idx_curriculum_docs_lookup on curriculum_documents(school_id, subject_id, klass);

alter table curriculum_documents enable row level security;

create policy "select curriculum docs in own school" on curriculum_documents
  for select using (is_superadmin() or school_id = current_school_id());

create policy "admin or user insert curriculum docs" on curriculum_documents
  for insert with check (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_has_subject(subject_id))
      )
    )
  );

create policy "admin or user delete curriculum docs" on curriculum_documents
  for delete using (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_has_subject(subject_id))
      )
    )
  );

-- ------------------------------------------------------------
-- STORAGE BUCKET
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('curriculum-designs', 'curriculum-designs', false)
on conflict (id) do nothing;

-- Files are uploaded to  {school_id}/{subject_id}/{klass}/{filename},
-- so (storage.foldername(name))[1] is the school and [2] the subject.
create policy "select curriculum pdfs in own school" on storage.objects
  for select using (
    bucket_id = 'curriculum-designs' and (
      is_superadmin() or (
        (storage.foldername(name))[1]::uuid = current_school_id() and (
          app_current_role() = 'admin'
          or (app_current_role() = 'user' and teacher_has_subject((storage.foldername(name))[2]::uuid))
        )
      )
    )
  );

create policy "admin or user upload curriculum pdfs" on storage.objects
  for insert with check (
    bucket_id = 'curriculum-designs' and (
      is_superadmin() or (
        (storage.foldername(name))[1]::uuid = current_school_id() and school_active() and (
          app_current_role() = 'admin'
          or (app_current_role() = 'user' and teacher_has_subject((storage.foldername(name))[2]::uuid))
        )
      )
    )
  );

create policy "admin or user delete curriculum pdfs" on storage.objects
  for delete using (
    bucket_id = 'curriculum-designs' and (
      is_superadmin() or (
        (storage.foldername(name))[1]::uuid = current_school_id() and school_active() and (
          app_current_role() = 'admin'
          or (app_current_role() = 'user' and teacher_has_subject((storage.foldername(name))[2]::uuid))
        )
      )
    )
  );
