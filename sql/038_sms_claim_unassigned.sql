-- ============================================================
-- Migration 038 — SMS: let a paired phone pick up unassigned messages
--
-- Problem: sms_claim_queue_batch only returned rows whose device_id
-- equalled the polling phone. A campaign queued while no phone was
-- paired (device_id NULL), or one assigned to a phone that was never
-- paired / has since been disabled, was therefore never sent by anyone
-- — the campaign just sat at "queued".
--
-- Fix: a phone also claims, for ITS OWN school, any pending message
-- that is unassigned or assigned to a device that can't poll
-- (pending/disabled). Claiming re-assigns it to the phone doing the
-- work. Messages assigned to another healthy paired phone are left
-- alone, so multi-phone splitting still works.
-- Safe to run more than once.
-- ============================================================

create or replace function public.sms_claim_queue_batch(p_device_id uuid, p_limit int default 10)
returns setof sms_queue
language plpgsql security definer set search_path = public as $$
declare
  v_school uuid;
begin
  select school_id into v_school from sms_devices where id = p_device_id;
  if v_school is null then
    return;
  end if;

  return query
    update sms_queue
    set status = 'sending', locked_at = now(), attempts = attempts + 1, device_id = p_device_id
    where id in (
      select q.id from sms_queue q
      where q.status = 'pending'
        and q.school_id = v_school
        and (
          q.device_id = p_device_id
          or q.device_id is null
          or q.device_id in (
            select d.id from sms_devices d
            where d.school_id = v_school and d.status in ('pending', 'disabled')
          )
        )
      order by q.created_at
      limit greatest(1, least(p_limit, 50))
      for update skip locked
    )
    returning *;
end;
$$;

revoke execute on function public.sms_claim_queue_batch(uuid, int) from public, anon, authenticated;
