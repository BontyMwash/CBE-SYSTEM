-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration: classes/streams table + subject short codes
-- Run this once in Supabase SQL Editor if your project was
-- created BEFORE this change (i.e. schema.sql doesn't already
-- have a `classes` table). Safe to re-run — every statement is
-- guarded with IF NOT EXISTS / ON CONFLICT.
-- ============================================================

-- ------------------------------------------------------------
-- 1. classes table
-- ------------------------------------------------------------
create table if not exists classes (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  name        text not null,
  stream      text not null default '',
  created_at  timestamptz not null default now(),
  unique (school_id, name, stream)
);

create index if not exists idx_classes_school on classes(school_id);

alter table classes enable row level security;

drop policy if exists "select classes in own school" on classes;
create policy "select classes in own school" on classes
  for select using (is_superadmin() or school_id = current_school_id());

drop policy if exists "admin insert classes" on classes;
create policy "admin insert classes" on classes
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

drop policy if exists "admin update classes" on classes;
create policy "admin update classes" on classes
  for update using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

drop policy if exists "admin delete classes" on classes;
create policy "admin delete classes" on classes
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- Backfill: turn every distinct class name already used by a student or
-- an exam into a class row (no stream), per school, so existing data
-- shows up immediately in the new Classes page and dropdowns.
insert into classes (school_id, name, stream)
select distinct school_id, klass, ''
from (
  select school_id, klass from students
  union
  select school_id, klass from exams
) x
where klass is not null and klass <> ''
on conflict (school_id, name, stream) do nothing;

-- ------------------------------------------------------------
-- 2. subject short codes
-- ------------------------------------------------------------
alter table subjects add column if not exists code text not null default '';

-- Backfill a reasonable default code (first 3 letters, uppercased) for
-- any existing subjects that don't have one yet.
update subjects
set code = upper(left(regexp_replace(name, '[^a-zA-Z]', '', 'g'), 3))
where code = '' or code is null;
