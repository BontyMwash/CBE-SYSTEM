-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 010 — Fix Attendance saving for subject teachers who
-- haven't been explicitly assigned a class.
--
-- THE BUG:
-- The Attendance screen (js/attendance.js -> teacherScope() in
-- js/views.js) shows a teacher their class list from one of two
-- places:
--   1. Classes explicitly assigned via the Users page ("Manage
--      classes") -> the `teacher_classes` table.
--   2. A FALLBACK, only used when (1) is empty: classes derived from
--      whichever classes have an exam in a subject the teacher is
--      assigned to teach (`teacher_subjects`).
--
-- The fallback is there so a brand-new subject teacher's screens
-- aren't empty before an admin has done the "Manage classes" step.
-- But the RLS policies added in migration 009 only checked path (1)
-- (`teacher_has_class`) — so a teacher relying on the fallback could
-- SEE their class in the Attendance dropdown and mark a register, but
-- every save failed silently against Row Level Security ("Could not
-- save attendance: ..."), because the database had no matching grant
-- for path (2).
--
-- THE FIX: teach the attendance INSERT/UPDATE/DELETE policies the
-- exact same fallback rule the UI already uses, so what a teacher can
-- see always matches what they can actually save.
--
-- Safe to run on an existing install — it only replaces the three
-- attendance write policies, it doesn't touch data or any other table.
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query ->
-- paste this whole file -> Run.
-- ============================================================

-- true when the calling teacher (role='user') teaches at least one
-- subject that has an exam recorded for this class label, in this
-- school — i.e. the same rule teacherScope()'s fallback uses in
-- js/views.js to derive "my classes" when no explicit assignment
-- exists yet.
create or replace function public.teacher_has_class_via_subject(sch uuid, klass_label text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from exams e
    where e.school_id = sch
      and e.klass = klass_label
      and teacher_has_subject(e.subject_id)
  );
$$;

drop policy if exists "admin or class teacher insert attendance" on attendance;
create policy "admin or class teacher insert attendance" on attendance
  for insert with check (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and (
          exists (
            select 1 from classes c where c.school_id = attendance.school_id
            and (case when c.stream <> '' then c.name || ' ' || c.stream else c.name end) = attendance.klass
            and teacher_has_class(c.id)
          )
          or teacher_has_class_via_subject(attendance.school_id, attendance.klass)
        ))
      )
    )
  );

drop policy if exists "admin or class teacher update attendance" on attendance;
create policy "admin or class teacher update attendance" on attendance
  for update using (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and (
          exists (
            select 1 from classes c where c.school_id = attendance.school_id
            and (case when c.stream <> '' then c.name || ' ' || c.stream else c.name end) = attendance.klass
            and teacher_has_class(c.id)
          )
          or teacher_has_class_via_subject(attendance.school_id, attendance.klass)
        ))
      )
    )
  );

drop policy if exists "admin or class teacher delete attendance" on attendance;
create policy "admin or class teacher delete attendance" on attendance
  for delete using (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and (
          exists (
            select 1 from classes c where c.school_id = attendance.school_id
            and (case when c.stream <> '' then c.name || ' ' || c.stream else c.name end) = attendance.klass
            and teacher_has_class(c.id)
          )
          or teacher_has_class_via_subject(attendance.school_id, attendance.klass)
        ))
      )
    )
  );

-- ------------------------------------------------------------
-- Same fix isn't needed for competency_assessments — that table is
-- keyed by subject_id and already uses teacher_has_subject() directly
-- (no class-derivation step to fall out of sync with).
-- ------------------------------------------------------------
