-- ============================================================
-- Migration: published_results — lets an admin "publish" a
-- sitting (class + exam type + term + year) once every teacher
-- has finished entering marks for it. Teachers can then see the
-- Analysis page for that sitting; before publishing, they can't.
-- Run this once in Supabase SQL Editor. Safe to re-run — every
-- statement is guarded with IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================

create table if not exists published_results (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references schools(id) on delete cascade,
  klass         text not null,
  type          text not null,
  term          text not null check (term in ('Term 1','Term 2','Term 3')),
  year          int  not null,
  published_at  timestamptz not null default now(),
  published_by  uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (school_id, klass, type, term, year)
);

create index if not exists idx_published_results_school on published_results(school_id, klass, type, term, year);

alter table published_results enable row level security;

drop policy if exists "select published results in own school" on published_results;
create policy "select published results in own school" on published_results
  for select using (is_superadmin() or school_id = current_school_id());

drop policy if exists "admin publish results" on published_results;
create policy "admin publish results" on published_results
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

drop policy if exists "admin update published results" on published_results;
create policy "admin update published results" on published_results
  for update using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

drop policy if exists "admin unpublish results" on published_results;
create policy "admin unpublish results" on published_results
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
