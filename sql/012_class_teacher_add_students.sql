-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 012 — Let a class teacher add learners into their own
-- class(es).
--
-- Previously only admins/superadmins could INSERT into `students`.
-- The Learners screen now shows an "+ Add learner" button to a
-- teacher (role='user') who is a CLASS teacher (assigned via
-- teacher_classes / the Users page "Manage classes" — as distinct
-- from a subject-only teacher). This policy is what actually allows
-- that insert at the database level; the UI restriction alone isn't
-- enough since Supabase clients can call the API directly.
--
-- Mirrors the same "match klass text to an assigned class row" shape
-- already used for attendance in 009_teacher_classes_attendance_
-- competency.sql, since students.klass is free text (name + stream)
-- rather than a foreign key.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run. Safe to run on an existing
-- install — it only adds a new policy, it doesn't touch data.
-- ============================================================

create policy "class teacher insert own class students" on students
  for insert with check (
    school_id = current_school_id() and school_active() and
    app_current_role() = 'user' and
    exists (
      select 1 from classes c where c.school_id = students.school_id
      and (case when c.stream <> '' then c.name || ' ' || c.stream else c.name end) = students.klass
      and teacher_has_class(c.id)
    )
  );
