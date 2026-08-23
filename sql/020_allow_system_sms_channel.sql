-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 020 — Allow a 'sms-system' notification channel.
--
-- "Send Results to Parents" now has an "SMS (system)" option that
-- sends straight from the school's own SMS gateway (Africa's
-- Talking, via the send-sms Edge Function) instead of opening the
-- sender's own Messages app. Those sends log a result_notifications
-- row with channel = 'sms-system', so the "already contacted" count
-- and status column stay accurate. The existing check constraint
-- only allowed 'whatsapp' / 'sms' / 'email' / 'manual', so that
-- insert would fail without this migration.
--
-- Safe to run on an existing install. Run this once in Supabase:
-- Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
-- ============================================================

do $$
declare
  con_name text;
begin
  select con.conname into con_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'result_notifications'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%channel%';
  if con_name is not null then
    execute format('alter table result_notifications drop constraint %I', con_name);
  end if;
end $$;

alter table result_notifications add constraint result_notifications_channel_check
  check (channel in ('whatsapp','sms','email','manual','sms-system'));
