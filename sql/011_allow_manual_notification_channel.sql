-- ============================================================
-- Migration 011 — Allow a 'manual' notification channel.
--
-- The bulk "Mark all as sent (no message)" action on the Send Results
-- to Parents screen (for a class teacher who already shared results
-- another way — printed slips, a phone call, etc.) logs a
-- result_notifications row with channel = 'manual', purely so the
-- "already contacted" count and status column stay accurate. The
-- original check constraint only allowed 'whatsapp' / 'sms' / 'email',
-- so that insert would fail without this migration.
--
-- Safe to run on an existing install. Run this once in Supabase:
-- Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
-- ============================================================

-- Drop whatever the existing channel check constraint is named (handles
-- both a fresh install's auto-generated name and any custom name) before
-- adding the widened one.
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
  check (channel in ('whatsapp','sms','email','manual'));
