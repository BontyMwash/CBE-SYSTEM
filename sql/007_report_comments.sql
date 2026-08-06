-- ============================================================
-- Migration: report_comments — lets a Class Teacher and the Head
-- of Institution type their own remark ONCE per (class, term,
-- year), which then fills in automatically at the bottom of every
-- student's report card for that class/term/year (instead of the
-- old auto-generated text). Anyone who can already open Reports
-- (admin or user/teacher) can save these for their own school.
-- Run this once in Supabase SQL Editor. Safe to re-run — every
-- statement is guarded with IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================

create table if not exists report_comments (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid not null references schools(id) on delete cascade,
  klass                 text not null,
  term                  text not null check (term in ('Term 1','Term 2','Term 3')),
  year                  int  not null,
  class_teacher_comment text not null default '',
  head_comment          text not null default '',
  updated_at            timestamptz not null default now(),
  updated_by            uuid references profiles(id) on delete set null,
  unique (school_id, klass, term, year)
);

create index if not exists idx_report_comments_school on report_comments(school_id, klass, term, year);

alter table report_comments enable row level security;

drop policy if exists "select report comments in own school" on report_comments;
create policy "select report comments in own school" on report_comments
  for select using (is_superadmin() or school_id = current_school_id());

drop policy if exists "admin or user insert report comments" on report_comments;
create policy "admin or user insert report comments" on report_comments
  for insert with check (
    is_superadmin()
    or (app_current_role() in ('admin','user') and school_id = current_school_id() and school_active())
  );

drop policy if exists "admin or user update report comments" on report_comments;
create policy "admin or user update report comments" on report_comments
  for update using (
    is_superadmin()
    or (app_current_role() in ('admin','user') and school_id = current_school_id() and school_active())
  );

drop policy if exists "admin delete report comments" on report_comments;
create policy "admin delete report comments" on report_comments
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
