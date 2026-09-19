-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 025 — Section-scoped TEACHER logins, and Lower/Upper
-- Primary support for profiles.section_scope.
--
-- BACKGROUND
--   013_admin_section_scope.sql let a superadmin restrict an ADMIN
--   login to one CBC section (Primary / Junior Secondary / Senior
--   School). It explicitly did NOT touch teachers — a teacher's
--   visible subjects/classes came only from explicit picks in
--   "Manage subjects" / "Manage classes" (teacher_subjects /
--   teacher_classes), ticked one at a time.
--
--   That's real friction for a school where a teacher's whole job is
--   "everything in Grade 4-6" — an admin had to tick every Upper
--   Primary subject and every Upper Primary class by hand, and any
--   new subject added later needed the same manual step for every
--   affected teacher.
--
-- WHAT THIS ADDS
--   • profiles.section_scope now also accepts 'lower-primary' and
--     'upper-primary' (matching 024_primary_bands.sql for subjects),
--     for BOTH admin and teacher ('user') logins — the column was
--     never actually role-restricted at the database level; only the
--     app UI and the manage-user Edge Function forced it to null for
--     teachers. Both are fixed alongside this migration.
--   • class_section(klass) now splits Grade 1-3 / Grade 4-6 into
--     'lower-primary' / 'upper-primary' (previously both just
--     'primary'), matching gradeSection() in js/views.js.
--   • section_scope_covers(scope, band) — true if `scope` (which may
--     be the parent 'primary') covers grade-band `band` (always a
--     leaf, since a class only ever parses to one specific band).
--     Replaces the old bare equality check in admin_class_allowed(),
--     which broke the moment Grade 1-6 stopped being a single
--     'primary' band above.
--   • section_scope_overlaps(a, b) — like the above but SYMMETRIC:
--     true if bands `a` and `b` overlap at all, regardless of which
--     side is the parent. Needed for subjects specifically, since —
--     unlike a class — a subject's own `section` can itself be the
--     parent 'primary' (shared across both primary bands). A
--     Lower-Primary-scoped teacher must see a subject scoped to
--     'primary'; a Primary-scoped teacher must see a subject scoped
--     narrowly to just 'upper-primary'. Plain equality catches
--     neither.
--   • teacher_has_subject(subj) and teacher_has_class(cls) — the two
--     functions every teacher-facing RLS policy across the whole
--     project already calls (exams, results, lesson plans, curriculum
--     documents, attendance, competency assessments — see the long
--     list of policies in 005/009/010/013/015/016) — are redefined to
--     ALSO return true when the calling teacher's section_scope
--     overlaps/covers the subject/class in question. Explicit
--     teacher_subjects/teacher_classes rows keep working exactly as
--     before; section_scope is an ADDITIONAL grant on top, not a
--     replacement. Because every dependent policy calls through
--     these two functions rather than checking teacher_subjects
--     directly, this one change is enough to apply everywhere —
--     no other policy in the project needs editing.
--   • admin_class_allowed(klass) is redefined to use
--     section_scope_covers() instead of the old equality check, so a
--     'primary'-scoped admin still correctly covers Grade 1-6 now
--     that Grade 1-6 classifies as two narrower bands, and so
--     'lower-primary'/'upper-primary'-scoped admins work too.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   Doesn't touch teacher_has_class_via_subject() (010) — it already
--   calls teacher_has_subject() internally, so it inherits the new
--   section-scope grant automatically.
--
--   Doesn't remove or restrict teacher_subjects/teacher_classes — a
--   teacher can still be given one-off extra subjects/classes outside
--   their section (e.g. an Upper Primary teacher who also covers one
--   Junior Secondary subject) by ticking them individually, same as
--   today.
--
-- Depends on 013_admin_section_scope.sql having already been run
-- (it adds the profiles.section_scope column and class_section()
-- this migration redefines). Run 013 first on any install that
-- hasn't already. Also pairs with 024_primary_bands.sql for subjects.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run. Safe to run more than once, and
-- safe on an existing install — it only redefines functions and one
-- CHECK constraint, it doesn't touch data.
-- ============================================================

-- ------------------------------------------------------------
-- COLUMN — widen to accept Lower/Upper Primary, for either role.
-- ------------------------------------------------------------

alter table profiles drop constraint if exists profiles_section_scope_check;
alter table profiles add constraint profiles_section_scope_check
  check (section_scope in ('primary', 'lower-primary', 'upper-primary', 'junior-secondary', 'senior-school'));

comment on column profiles.section_scope is
  'NULL = unrestricted. For role=admin, limits that login to managing one CBC section. For role=user (teacher), automatically grants every subject and class in that section on top of any explicit teacher_subjects/teacher_classes picks.';

-- ------------------------------------------------------------
-- HELPER FUNCTIONS
-- ------------------------------------------------------------

-- Same CBC grade bands as gradeSection() in js/views.js, now split
-- into Lower Primary (Grade 1-3) and Upper Primary (Grade 4-6)
-- instead of one flat 'primary' for the whole Grade 1-6 range.
-- PP1/PP2 stay 'primary' (unbanded pre-primary). Returns null for a
-- class name that doesn't match a recognised CBC grade.
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
    if n between 1 and 3 then return 'lower-primary'; end if;
    if n between 4 and 6 then return 'upper-primary'; end if;
    if n between 7 and 9 then return 'junior-secondary'; end if;
    if n between 10 and 12 then return 'senior-school'; end if;
  end if;
  return null;
end;
$$;

-- True if `scope` covers grade-band `band`. `band` is always a leaf
-- (a class only ever parses to one specific grade band); `scope` may
-- be that same leaf, or the parent 'primary' (which covers both
-- 'lower-primary' and 'upper-primary'). Mirrors sectionCovers() in
-- js/views.js exactly.
create or replace function public.section_scope_covers(scope text, band text)
returns boolean
language sql immutable as $$
  select
    scope is null or scope = ''
    or scope = band
    or (band in ('lower-primary', 'upper-primary') and scope = 'primary');
$$;

-- Symmetric version for comparing two things that could EITHER be the
-- parent 'primary': used for subject.section vs a teacher's
-- section_scope, since (unlike a class) a subject can itself be
-- scoped to the parent band. Mirrors sectionsOverlap() in
-- js/views.js exactly.
create or replace function public.section_scope_overlaps(a text, b text)
returns boolean
language sql immutable as $$
  select
    a is null or a = '' or b is null or b = ''
    or a = b
    or (a in ('lower-primary', 'upper-primary') and b = 'primary')
    or (b in ('lower-primary', 'upper-primary') and a = 'primary');
$$;

create or replace function public.admin_section_scope()
returns text
language sql stable security definer set search_path = public as $$
  select section_scope from profiles where id = auth.uid();
$$;

-- True unless the caller is a section-scoped admin touching a class
-- outside their section. Everyone else (superadmin, unrestricted
-- admin, teachers) is always allowed — section_scope never affects
-- them here (a teacher's OWN section_scope is handled separately, in
-- teacher_has_subject/teacher_has_class below, since it GRANTS rather
-- than restricts). A class name that doesn't parse as a CBC grade
-- (custom name) is left visible/editable to every admin, scoped or
-- not, rather than silently locked out.
create or replace function public.admin_class_allowed(klass text)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    app_current_role() <> 'admin'
    or admin_section_scope() is null
    or class_section(klass) is null
    or section_scope_covers(admin_section_scope(), class_section(klass));
$$;

-- true when the calling teacher (role='user') has this subject
-- assigned to them — EITHER explicitly via teacher_subjects, OR
-- automatically because their profiles.section_scope overlaps this
-- subject's own section. Every teacher-facing policy in the project
-- (exams, results, lesson plans, curriculum documents, gradebook)
-- calls this one function, so section-scoping a teacher takes effect
-- everywhere at once.
create or replace function public.teacher_has_subject(subj uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    exists(
      select 1 from teacher_subjects where teacher_id = auth.uid() and subject_id = subj
    )
    or (
      admin_section_scope() is not null
      and exists(
        select 1 from subjects s
        where s.id = subj
        and section_scope_overlaps(coalesce(s.section, ''), admin_section_scope())
      )
    );
$$;

-- true when the calling teacher (role='user') has this class assigned
-- to them — explicitly via teacher_classes, OR automatically because
-- their profiles.section_scope covers this class's grade band.
-- Mirrors teacher_has_subject().
create or replace function public.teacher_has_class(cls uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    exists(
      select 1 from teacher_classes where teacher_id = auth.uid() and class_id = cls
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
