-- ============================================================
-- Migration: freeze schools that haven't paid
-- Run this once in Supabase: Dashboard → SQL Editor → New query.
-- Safe to run on the existing live database — it only adds a few
-- columns, one helper function, and tightens existing policies;
-- it doesn't touch any data.
--
-- What "frozen" means here: a frozen school's admin/teacher logins
-- can still LOG IN and VIEW everything (so nobody loses access to
-- report cards or history), but can no longer add or edit anything
-- — no new students, marks, exams, subjects, logins, or settings
-- changes — until a superadmin unfreezes the school. Superadmins
-- are never affected by a freeze.
-- ============================================================

alter table schools add column if not exists frozen boolean not null default false;
alter table schools add column if not exists frozen_at timestamptz;
alter table schools add column if not exists frozen_reason text not null default '';

-- true when the CALLER is allowed to write: superadmins always can;
-- everyone else only when their own school isn't frozen.
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

-- ----- schools: admin can't edit school settings while frozen -----
alter policy "admin can update own school" on schools
  using (app_current_role() = 'admin' and id = current_school_id() and school_active())
  with check (app_current_role() = 'admin' and id = current_school_id() and school_active());

-- ----- profiles: admin can't manage logins while frozen -----
alter policy "admin manage own school profiles" on profiles
  using (app_current_role() = 'admin' and school_id = current_school_id() and school_active())
  with check (app_current_role() = 'admin' and school_id = current_school_id() and school_active());

alter policy "admin delete own school profiles" on profiles
  using (
    app_current_role() = 'admin' and school_id = current_school_id() and id <> auth.uid() and school_active()
  );

-- ----- students -----
alter policy "admin manage students" on students
  with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
alter policy "admin update students" on students
  using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
alter policy "admin delete students" on students
  using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- ----- subjects -----
alter policy "admin insert subjects" on subjects
  with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
alter policy "admin update subjects" on subjects
  using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
alter policy "admin delete subjects" on subjects
  using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- ----- exams -----
alter policy "admin insert exams" on exams
  with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
alter policy "admin or user update exams" on exams
  using (is_superadmin() or (app_current_role() in ('admin','user') and school_id = current_school_id() and school_active()));
alter policy "admin delete exams" on exams
  using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- ----- results -----
alter policy "admin or user insert results" on results
  with check (
    is_superadmin() or (
      app_current_role() in ('admin','user') and school_active() and exists (
        select 1 from exams e where e.id = results.exam_id and e.school_id = current_school_id()
      )
    )
  );
alter policy "admin or user update results" on results
  using (
    is_superadmin() or (
      app_current_role() in ('admin','user') and school_active() and exists (
        select 1 from exams e where e.id = results.exam_id and e.school_id = current_school_id()
      )
    )
  );
alter policy "admin or user delete results" on results
  using (
    is_superadmin() or (
      app_current_role() in ('admin','user') and school_active() and exists (
        select 1 from exams e where e.id = results.exam_id and e.school_id = current_school_id()
      )
    )
  );
