-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 026 — Subject assignment becomes PER CLASS, and
-- marks-entry / attendance / assessment access is tightened to
-- match.
--
-- THE BUGS THIS FIXES
--
--   1. "Manage subjects" (teacher_subjects) assigned a subject to a
--      teacher GLOBALLY — every RLS policy on exams/results/
--      competency_assessments only ever checked
--      teacher_has_subject(subject_id), never the exam's class too.
--      A subject like "Mathematics" is often a single shared row
--      used by every grade (subjects.section = ''), so a teacher
--      given "Mathematics" for their one Upper Primary class could
--      also open Marks Entry for a completely different Grade 7
--      class's Mathematics exam, or even a Grade 1 one — because the
--      database never checked which class the assignment was for.
--      This was already patched on the FRONT END in the previous
--      change (teacherScope() in js/views.js now intersects subject
--      AND class), but the database itself had no such check, so a
--      teacher could still write those marks by calling the API
--      directly. This migration closes that at the database level,
--      which is the layer that actually matters for security.
--
--   2. Attendance write policies (010_fix_attendance_access.sql)
--      let ANY teacher who teaches ANY subject with an exam recorded
--      for a class mark that class's attendance — not just the
--      actual class teacher. That's removed: only a real class
--      teacher (teacher_classes / section_scope) or an admin may
--      take attendance, per the current requirement that adding
--      learners and taking attendance are a CLASS TEACHER's job (or
--      admin's), full stop — never a subject-only teacher's.
--
-- THE FIX
--
--   • New table `teacher_subject_classes` — a real (teacher,
--     subject, class) triple: "this teacher teaches this subject in
--     this specific class." This replaces the flat, class-blind
--     `teacher_subjects` table for permission purposes going
--     forward. `teacher_subjects` itself is left in place (existing
--     data isn't deleted) but is no longer consulted by any RLS
--     policy after this migration — see the backfill below, which
--     converts every existing assignment into the new, precise
--     shape so nothing an admin already configured breaks.
--
--   • teacher_teaches_subject_in_klass(subject, klass_label, school)
--     — true when an explicit (teacher, subject, class) triple
--     exists for the calling teacher, OR the teacher's
--     profiles.section_scope fully covers both that subject and
--     that class's grade band (the existing "generalist" grant for
--     a teacher whose whole job is "everything in Upper Primary",
--     unchanged and still school-wide within their band). This is
--     "subject assignment, per level" — a teacher can be given
--     Science in ONE Junior Secondary class without that
--     automatically handing them every other class that also
--     happens to use the "Science" subject row, anywhere in the
--     school.
--
--   • exams/results/competency_assessments write policies now call
--     the new function instead of the old class-blind
--     teacher_has_subject().
--
--   • Teachers can no longer INSERT into exams at all (the
--     "Assessments" screen that let a subject teacher create their
--     own exam sittings was already removed from the teacher
--     sidebar; this drops the matching database policy too, so
--     creating an exam/assessment is admin-only end to end).
--
--   • Attendance INSERT/UPDATE/DELETE policies drop the
--     teacher_has_class_via_subject(...) fallback branch entirely.
--
--   • Deleting a learner was already admin-only (no teacher DELETE
--     policy on `students` has ever existed) — confirmed, no change
--     needed there.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query ->
-- paste this whole file -> Run. Safe on an existing install: it adds
-- one new table, backfills it from data that already exists, and
-- re-defines a handful of policies — it does not delete any exams,
-- results, or attendance rows.
-- ============================================================

-- ------------------------------------------------------------
-- 1. teacher_subject_classes — the new, precise assignment
-- ------------------------------------------------------------

create table if not exists teacher_subject_classes (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  teacher_id  uuid not null references profiles(id) on delete cascade,
  subject_id  uuid not null references subjects(id) on delete cascade,
  class_id    uuid not null references classes(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (teacher_id, subject_id, class_id)
);

create index if not exists idx_tsc_school  on teacher_subject_classes(school_id);
create index if not exists idx_tsc_teacher on teacher_subject_classes(teacher_id);
create index if not exists idx_tsc_class   on teacher_subject_classes(class_id);
create index if not exists idx_tsc_subject on teacher_subject_classes(subject_id);

alter table teacher_subject_classes enable row level security;

drop policy if exists "view own teacher subject class assignments" on teacher_subject_classes;
create policy "view own teacher subject class assignments" on teacher_subject_classes
  for select using (teacher_id = auth.uid());

drop policy if exists "admin view teacher subject class assignments" on teacher_subject_classes;
create policy "admin view teacher subject class assignments" on teacher_subject_classes
  for select using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id()));

drop policy if exists "admin insert teacher subject class assignments" on teacher_subject_classes;
create policy "admin insert teacher subject class assignments" on teacher_subject_classes
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

drop policy if exists "admin delete teacher subject class assignments" on teacher_subject_classes;
create policy "admin delete teacher subject class assignments" on teacher_subject_classes
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- ------------------------------------------------------------
-- 2. Backfill — cross the existing flat teacher_subjects list with
--    the existing flat teacher_classes list, per teacher, so every
--    admin's current setup keeps working exactly as it does today
--    immediately after this migration runs. From here on, an admin
--    can (and should) tighten each teacher down to the exact
--    class(es) they actually teach a given subject in, using the new
--    "Manage subjects" screen — this backfill is only a safety net,
--    not the intended long-term shape.
-- ------------------------------------------------------------

insert into teacher_subject_classes (school_id, teacher_id, subject_id, class_id)
select distinct ts.school_id, ts.teacher_id, ts.subject_id, tc.class_id
from teacher_subjects ts
join teacher_classes tc on tc.teacher_id = ts.teacher_id
on conflict (teacher_id, subject_id, class_id) do nothing;

-- ------------------------------------------------------------
-- 3. Helper functions
-- ------------------------------------------------------------

-- True when the calling teacher teaches `subj` in the class whose
-- free-text label is `klass_label` (matching how exams.klass /
-- students.klass / attendance.klass are all stored) — either via an
-- explicit teacher_subject_classes triple, or because their
-- section_scope is a generalist grant covering both that subject and
-- that class's grade band.
create or replace function public.teacher_teaches_subject_in_klass(subj uuid, klass_label text, sch uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    exists (
      select 1
      from teacher_subject_classes tsc
      join classes c on c.id = tsc.class_id
      where tsc.teacher_id = auth.uid()
        and tsc.subject_id = subj
        and c.school_id = sch
        and (case when c.stream <> '' then c.name || ' ' || c.stream else c.name end) = klass_label
    )
    or (
      admin_section_scope() is not null
      and class_section(klass_label) is not null
      and section_scope_covers(admin_section_scope(), class_section(klass_label))
      and exists (
        select 1 from subjects s
        where s.id = subj and s.school_id = sch
        and section_scope_overlaps(coalesce(s.section, ''), admin_section_scope())
      )
    );
$$;

-- Same idea, resolved from a student id instead of a klass label
-- directly — used by competency_assessments, which is keyed by
-- student rather than by a klass column of its own.
create or replace function public.teacher_teaches_subject_for_student(subj uuid, stud uuid, sch uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from students st
    where st.id = stud and st.school_id = sch
    and teacher_teaches_subject_in_klass(subj, st.klass, sch)
  );
$$;

-- ------------------------------------------------------------
-- 4. exams — teachers can no longer INSERT (admin-only, end to
--    end); UPDATE now requires subject AND class to both be theirs.
-- ------------------------------------------------------------

drop policy if exists "user insert exams for own subject" on exams;

drop policy if exists "admin or user update exams" on exams;
create policy "admin or user update exams" on exams
  for update using (
    is_superadmin()
    or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(klass))
    or (app_current_role() = 'user' and school_id = current_school_id() and school_active() and teacher_teaches_subject_in_klass(subject_id, klass, school_id))
  );

-- ------------------------------------------------------------
-- 5. results — subject AND class both required for a teacher.
-- ------------------------------------------------------------

drop policy if exists "admin or user insert results" on results;
create policy "admin or user insert results" on results
  for insert with check (
    is_superadmin() or (
      school_active() and exists (
        select 1 from exams e where e.id = results.exam_id and e.school_id = current_school_id()
        and (
          (app_current_role() = 'admin' and admin_class_allowed(e.klass))
          or (app_current_role() = 'user' and teacher_teaches_subject_in_klass(e.subject_id, e.klass, e.school_id))
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
          or (app_current_role() = 'user' and teacher_teaches_subject_in_klass(e.subject_id, e.klass, e.school_id))
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
          or (app_current_role() = 'user' and teacher_teaches_subject_in_klass(e.subject_id, e.klass, e.school_id))
        )
      )
    )
  );

-- ------------------------------------------------------------
-- 6. competency_assessments — same subject+class requirement,
--    resolved via the student's own klass.
-- ------------------------------------------------------------

drop policy if exists "admin or user insert competencies" on competency_assessments;
create policy "admin or user insert competencies" on competency_assessments
  for insert with check (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_teaches_subject_for_student(subject_id, student_id, school_id))
      )
    )
  );

drop policy if exists "admin or user update competencies" on competency_assessments;
create policy "admin or user update competencies" on competency_assessments
  for update using (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_teaches_subject_for_student(subject_id, student_id, school_id))
      )
    )
  );

drop policy if exists "admin or user delete competencies" on competency_assessments;
create policy "admin or user delete competencies" on competency_assessments
  for delete using (
    is_superadmin() or (
      school_id = current_school_id() and school_active() and (
        app_current_role() = 'admin'
        or (app_current_role() = 'user' and teacher_teaches_subject_for_student(subject_id, student_id, school_id))
      )
    )
  );

-- ------------------------------------------------------------
-- 7. attendance — drop the subject-derived fallback. Only a real
--    class teacher (teacher_has_class, which already includes the
--    section_scope generalist grant) or an admin may take attendance
--    or add/remove attendance rows for a class — never a
--    subject-only teacher.
-- ------------------------------------------------------------

drop policy if exists "admin or class teacher insert attendance" on attendance;
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

drop policy if exists "admin or class teacher update attendance" on attendance;
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

drop policy if exists "admin or class teacher delete attendance" on attendance;
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

-- Note: teacher_has_class_via_subject() (from 010) is intentionally
-- left defined (dropping it isn't necessary and something else may
-- reference it) but is no longer called by any policy after this
-- migration.

-- ------------------------------------------------------------
-- 8. students — confirm delete stays admin-only. No teacher DELETE
--    policy has ever existed on `students`; this is just a marker so
--    a future migration doesn't accidentally add one. The existing
--    "class teacher insert own class students" policy (012) is
--    UNCHANGED — a class teacher (or admin) may still add a learner
--    into their own class; only an admin may remove one.
-- ------------------------------------------------------------
