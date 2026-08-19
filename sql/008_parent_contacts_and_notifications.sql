-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration: parent/guardian contact fields on students, plus a
-- results_notifications log for the new "Send Results to Parents"
-- screen.
--
-- Run this once in Supabase SQL Editor on an EXISTING project.
-- Brand-new projects don't need this — schema.sql already includes
-- these changes.
-- ============================================================

alter table students
  add column if not exists parent_name  text not null default '',
  add column if not exists parent_phone text not null default '',
  add column if not exists parent_email text not null default '';

-- One row per "we told this student's parent about this sitting's
-- results" event. Sending itself happens on-device (a WhatsApp, SMS
-- or email link pre-filled with the result summary) — this table
-- just records that it happened, so the screen can show who's
-- already been contacted and who hasn't.
create table if not exists result_notifications (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  student_id  uuid not null references students(id) on delete cascade,
  klass       text not null,
  type        text not null,
  term        text not null check (term in ('Term 1','Term 2','Term 3')),
  year        int  not null,
  channel     text not null check (channel in ('whatsapp','sms','email')),
  sent_at     timestamptz not null default now(),
  sent_by     uuid references profiles(id) on delete set null
);

create index if not exists idx_result_notifications_lookup
  on result_notifications(school_id, klass, type, term, year);
create index if not exists idx_result_notifications_student
  on result_notifications(student_id);

alter table result_notifications enable row level security;

-- Admins and teachers in the school can both see and log sends —
-- either role may be the one that actually messages a parent.
create policy "select notifications in own school" on result_notifications
  for select using (is_superadmin() or school_id = current_school_id());

create policy "admin or user log notifications" on result_notifications
  for insert with check (
    is_superadmin() or (
      school_id = current_school_id() and school_active()
      and app_current_role() in ('admin','user')
    )
  );

create policy "admin or user clear notifications" on result_notifications
  for delete using (
    is_superadmin() or (
      school_id = current_school_id() and school_active()
      and app_current_role() in ('admin','user')
    )
  );
