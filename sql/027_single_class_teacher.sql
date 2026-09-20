-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 027 — A class has exactly ONE class teacher. Attendance
-- and adding a learner now check that specific person, not "any
-- teacher ticked in Manage classes for this class".
--
-- THE BUG THIS FIXES
--
--   teacher_classes (Users page -> "Manage classes") is a MANY-TO-
--   MANY table — an admin can tick more than one teacher into the
--   same class. That's fine for whatever else a school might use it
--   for, but attendance and "add a learner" were treated as "any
--   teacher in teacher_classes for this class may do this" (see
--   026_teacher_subject_per_class.sql), which isn't what "the class
--   teacher" means in a CBC school: it's one specific person. A
--   teacher who was ticked into a class for some other reason, but
--   isn't actually its class teacher, could still take attendance or
--   add a learner there.
--
-- THE FIX
--
--   • classes.class_teacher_id — a new column, ONE profile per
--     class (or null, if nobody's been designated yet).
--
--   • Backfilled from today's teacher_classes data ONLY where it's
--     unambiguous: a class with exactly one teacher ticked in
--     teacher_classes becomes that teacher's class_teacher_id. A
--     class with zero or more than one is left null — go to the
--     Users page -> "Manage classes" for the person who should
--     actually be its class teacher and (re-)tick it there; saving
--     now sets class_teacher_id instead of just adding a row to the
--     old many-to-many table, and — since a class can only have ONE
--     class teacher — ticking a class for someone there un-ticks it
--     from whoever had it before.
--
--   • A new function, teacher_is_class_teacher(class_id), checks
--     classes.class_teacher_id = auth.uid() (or the calling
--     teacher's section_scope covering that class's band, same
--     generalist grant as everywhere else). Attendance
--     INSERT/UPDATE/DELETE and the "class teacher insert own class
--     students" policy (012) now call this instead of the looser
--     teacher_has_class().
--
--   • teacher_classes and teacher_has_class() are UNCHANGED and left
--     in place — Marks Entry/Assessments/Gradebook/Competency
--     Assessment never used them for permissions (that's
--     teacher_subject_classes, from 026), and nothing else in the
--     project reads teacher_classes for a security decision. The
--     app's front end now also reads class_teacher_id directly
--     rather than teacher_classes for "is this login the class
--     teacher", so what's shown always matches what's enforced here.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query ->
-- paste this whole file -> Run. Safe on an existing install: it adds
-- one column, backfills it only where unambiguous, and re-defines
-- three policies — it does not delete any data.
-- ============================================================

alter table classes add column if not exists class_teacher_id uuid references profiles(id) on delete set null;

-- Backfill: only classes with EXACTLY ONE teacher_classes row get an
-- automatic class_teacher_id. Anything ambiguous (0 or 2+) is left
-- null on purpose rather than guessed — an admin should pick.
update classes c
set class_teacher_id = only_teacher.teacher_id
from (
  select class_id, min(teacher_id) as teacher_id
  from teacher_classes
  group by class_id
  having count(*) = 1
) only_teacher
where only_teacher.class_id = c.id
and c.class_teacher_id is null;

-- True when the calling teacher (role='user') IS the class teacher
-- for `cls` — either the specific person in classes.class_teacher_id,
-- or (same generalist grant used throughout the app) their
-- section_scope covers this class's grade band.
create or replace function public.teacher_is_class_teacher(cls uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    exists(
      select 1 from classes where id = cls and class_teacher_id = auth.uid()
    )
    or (
      admin_section_scope() is not null
      and exists(
        select 1 from classes c
        where c.id = cls
        and class_section(c.name) is not null
        and section_scope_covers(admin_section_scope(), class_section(c.name))
      )
    );
$$;

-- ------------------------------------------------------------
-- Attendance — the class teacher (or admin), and only them.
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
          and teacher_is_class_teacher(c.id)
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
          and teacher_is_class_teacher(c.id)
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
          and teacher_is_class_teacher(c.id)
        ))
      )
    )
  );

-- ------------------------------------------------------------
-- Adding a learner — the class teacher (or admin), and only them.
-- ------------------------------------------------------------

drop policy if exists "class teacher insert own class students" on students;
create policy "class teacher insert own class students" on students
  for insert with check (
    school_id = current_school_id() and school_active() and
    app_current_role() = 'user' and
    exists (
      select 1 from classes c where c.school_id = students.school_id
      and (case when c.stream <> '' then c.name || ' ' || c.stream else c.name end) = students.klass
      and teacher_is_class_teacher(c.id)
    )
  );
