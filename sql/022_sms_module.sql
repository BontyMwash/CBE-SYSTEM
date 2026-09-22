-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 022 — Bulk SMS module (Android SIM SMS gateway).
--
-- Architecture:
--   CBE web app -> Supabase (sms_campaigns / sms_queue)
--                -> Secure Edge Functions (service-role only)
--                -> Android "CBE SMS Gateway" app (polls, sends via
--                   the phone's own SIM, reports back)
--
-- The browser NEVER sends SMS directly and NEVER holds the service
-- role key. The Android app never holds the service role key either
-- — it authenticates with a per-device hashed token issued by the
-- sms-register-device Edge Function (see supabase/functions/).
--
-- This migration reuses the project's EXISTING tables/columns —
-- schools, profiles (role: superadmin/admin/user), students
-- (parent_name/parent_phone already live there; there is no
-- separate "parents" table in this schema, so sms_queue links to
-- students only) and the existing helper functions
-- (is_superadmin, app_current_role, current_school_id,
-- school_active) from sql/schema.sql. It does not touch any
-- existing table.
--
-- Safe to run once on an existing install:
--   Supabase Dashboard -> SQL Editor -> New query -> paste this
--   whole file -> Run.
-- ============================================================

-- ------------------------------------------------------------
-- TABLES
-- ------------------------------------------------------------

-- One row per paired Android phone acting as an SMS gateway for a
-- school. A device starts 'pending' (an admin generated a one-time
-- pair code from the Devices screen but the phone hasn't claimed it
-- yet), becomes 'offline'/'online' once paired (based on heartbeats),
-- or 'disabled' if an admin turns it off.
create table if not exists sms_devices (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid not null references schools(id) on delete cascade,
  device_name           text not null default 'CBE SMS Gateway',
  phone_number          text not null default '',
  -- SHA-256 hex of the device's bearer token. The raw token is shown
  -- to the Android app exactly once, at pairing time, and never
  -- stored anywhere server-side.
  device_token_hash     text,
  pair_code             text,
  pair_code_expires_at  timestamptz,
  status                text not null default 'pending' check (status in ('pending', 'online', 'offline', 'disabled')),
  last_seen             timestamptz,
  created_by            uuid references profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists sms_templates (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  name        text not null,
  body        text not null,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists sms_campaigns (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references schools(id) on delete cascade,
  campaign_name     text not null,
  message           text not null,
  template_id       uuid references sms_templates(id) on delete set null,
  -- What this campaign was triggered from, for the audit trail (18.
  -- Automatic CBE SMS): 'manual', 'results', 'attendance', 'fees'.
  source            text not null default 'manual',
  created_by        uuid references profiles(id) on delete set null,
  status            text not null default 'draft' check (status in ('draft', 'queued', 'sending', 'completed', 'completed_with_errors', 'cancelled')),
  total_recipients  int not null default 0,
  sent_count        int not null default 0,
  failed_count      int not null default 0,
  pending_count     int not null default 0,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  completed_at      timestamptz
);

-- Individual messages. No separate "parents" table exists in this
-- schema — a student's guardian contact lives on students.parent_*
-- — so this links to students only (student_id nullable so custom
-- phone-number recipients with no matching student still work).
create table if not exists sms_queue (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references schools(id) on delete cascade,
  campaign_id    uuid not null references sms_campaigns(id) on delete cascade,
  device_id      uuid references sms_devices(id) on delete set null,
  student_id     uuid references students(id) on delete set null,
  phone_number   text not null,
  message        text not null,
  status         text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts       int not null default 0,
  max_attempts   int not null default 3,
  error_message  text,
  locked_at      timestamptz,
  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists sms_logs (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references schools(id) on delete cascade,
  queue_id       uuid references sms_queue(id) on delete cascade,
  device_id      uuid references sms_devices(id) on delete set null,
  phone_number   text not null,
  status         text not null,
  error_message  text,
  created_at     timestamptz not null default now()
);

-- Single settings row per school (18/19. Automatic CBE SMS toggles +
-- gateway tuning). Created on first visit to SMS Settings.
create table if not exists sms_settings (
  school_id               uuid primary key references schools(id) on delete cascade,
  auto_attendance_sms     boolean not null default false,
  auto_results_sms        boolean not null default false,
  auto_fee_reminder_sms   boolean not null default false,
  max_retry_attempts      int not null default 3 check (max_retry_attempts between 1 and 10),
  batch_size              int not null default 10 check (batch_size between 1 and 50),
  delay_between_ms        int not null default 2000 check (delay_between_ms >= 0),
  require_confirmation    boolean not null default true,
  updated_at              timestamptz not null default now()
);

-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------

create index if not exists idx_sms_devices_school on sms_devices(school_id);
create index if not exists idx_sms_templates_school on sms_templates(school_id);

create index if not exists idx_sms_campaigns_school on sms_campaigns(school_id);
create index if not exists idx_sms_campaigns_created on sms_campaigns(created_at);

create index if not exists idx_sms_queue_school on sms_queue(school_id);
create index if not exists idx_sms_queue_campaign on sms_queue(campaign_id);
create index if not exists idx_sms_queue_device on sms_queue(device_id);
create index if not exists idx_sms_queue_status on sms_queue(status);
create index if not exists idx_sms_queue_created on sms_queue(created_at);
-- The gateway's core query: "my pending messages, oldest first".
create index if not exists idx_sms_queue_device_status on sms_queue(device_id, status, created_at);

create index if not exists idx_sms_logs_school on sms_logs(school_id);
create index if not exists idx_sms_logs_queue on sms_logs(queue_id);
create index if not exists idx_sms_logs_device on sms_logs(device_id);
create index if not exists idx_sms_logs_created on sms_logs(created_at);

-- ------------------------------------------------------------
-- CAMPAIGN COUNTS — kept in sync automatically whenever a queue
-- row's status changes, so the dashboard/progress screens never
-- have to run a COUNT(*) themselves.
-- ------------------------------------------------------------

create or replace function public.sms_recompute_campaign(p_campaign_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total int; v_sent int; v_failed int; v_pending int; v_cancelled int;
  v_status text;
begin
  select
    count(*),
    count(*) filter (where status = 'sent'),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status in ('pending', 'sending')),
    count(*) filter (where status = 'cancelled')
  into v_total, v_sent, v_failed, v_pending, v_cancelled
  from sms_queue where campaign_id = p_campaign_id;

  select status into v_status from sms_campaigns where id = p_campaign_id;

  update sms_campaigns set
    total_recipients = v_total,
    sent_count = v_sent,
    failed_count = v_failed,
    pending_count = v_pending,
    status = case
      when v_status in ('draft', 'cancelled') then v_status
      when v_pending > 0 then (case when v_sent + v_failed + v_cancelled > 0 then 'sending' else 'queued' end)
      when v_failed > 0 then 'completed_with_errors'
      else 'completed'
    end,
    completed_at = case when v_pending = 0 and completed_at is null then now() else completed_at end
  where id = p_campaign_id;
end;
$$;

create or replace function public.trg_sms_queue_after_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.sms_recompute_campaign(coalesce(new.campaign_id, old.campaign_id));
  return null;
end;
$$;

drop trigger if exists sms_queue_status_change on sms_queue;
create trigger sms_queue_status_change
  after insert or update of status or delete on sms_queue
  for each row execute function public.trg_sms_queue_after_change();

-- ------------------------------------------------------------
-- QUEUE LOCKING — called ONLY by Edge Functions using the service
-- role (never from the browser). SKIP LOCKED makes it safe for
-- concurrent gateway polls, and 13. SMS Queue Safety's "recover a
-- message stuck mid-send" is handled by sms_recover_stuck_queue,
-- which the sms-get-queue function calls before every claim.
-- ------------------------------------------------------------

create or replace function public.sms_recover_stuck_queue(p_school_id uuid, p_stuck_minutes int default 10)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update sms_queue
  set status = 'pending', locked_at = null
  where school_id = p_school_id
    and status = 'sending'
    and locked_at < now() - make_interval(mins => p_stuck_minutes);
end;
$$;

create or replace function public.sms_claim_queue_batch(p_device_id uuid, p_limit int default 10)
returns setof sms_queue
language plpgsql security definer set search_path = public as $$
begin
  return query
    update sms_queue
    set status = 'sending', locked_at = now(), attempts = attempts + 1
    where id in (
      select id from sms_queue
      where device_id = p_device_id and status = 'pending'
      order by created_at
      limit greatest(1, least(p_limit, 50))
      for update skip locked
    )
    returning *;
end;
$$;

-- Only the service role calls these (via the Edge Functions below) —
-- never expose them to a browser session even if it somehow had a
-- valid JWT.
revoke execute on function public.sms_claim_queue_batch(uuid, int) from public, anon, authenticated;
revoke execute on function public.sms_recover_stuck_queue(uuid, int) from public, anon, authenticated;

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Mirrors the existing admin-manages / school-scoped pattern already
-- used for classes/subjects/exam_types in sql/schema.sql. Normal
-- teachers (role='user') get no SMS access at all unless a future
-- migration explicitly grants it — matching "normal teachers should
-- NOT automatically receive permission to send bulk SMS".
-- ------------------------------------------------------------

alter table sms_devices    enable row level security;
alter table sms_templates  enable row level security;
alter table sms_campaigns  enable row level security;
alter table sms_queue      enable row level security;
alter table sms_logs       enable row level security;
alter table sms_settings   enable row level security;

-- ===== sms_devices =====
create policy "select devices in own school" on sms_devices
  for select using (is_superadmin() or school_id = current_school_id());
create policy "admin insert devices" on sms_devices
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin update devices" on sms_devices
  for update using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin delete devices" on sms_devices
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- ===== sms_templates =====
create policy "select templates in own school" on sms_templates
  for select using (is_superadmin() or school_id = current_school_id());
create policy "admin insert templates" on sms_templates
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin update templates" on sms_templates
  for update using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin delete templates" on sms_templates
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- ===== sms_campaigns =====
create policy "select campaigns in own school" on sms_campaigns
  for select using (is_superadmin() or school_id = current_school_id());
create policy "admin insert campaigns" on sms_campaigns
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin update campaigns" on sms_campaigns
  for update using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin delete campaigns" on sms_campaigns
  for delete using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));

-- ===== sms_queue =====
-- Admins can view and create queue rows (queueing a campaign) from
-- the browser; only the service-role Edge Functions claim/update
-- them (that path bypasses RLS entirely, so no update/delete policy
-- is needed for the gateway — and none is granted to the browser).
create policy "select queue in own school" on sms_queue
  for select using (is_superadmin() or school_id = current_school_id());
create policy "admin insert queue" on sms_queue
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin cancel queued" on sms_queue
  for update using (
    (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()))
    and status = 'pending'
  )
  with check (status = 'cancelled');

-- ===== sms_logs =====
create policy "select logs in own school" on sms_logs
  for select using (is_superadmin() or school_id = current_school_id());

-- ===== sms_settings =====
create policy "select settings in own school" on sms_settings
  for select using (is_superadmin() or school_id = current_school_id());
create policy "admin upsert settings insert" on sms_settings
  for insert with check (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
create policy "admin upsert settings update" on sms_settings
  for update using (is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active()));
