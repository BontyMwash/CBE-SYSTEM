-- ============================================================
-- Migration 033 — Admin -> Teacher level delegation security
--
-- A Super Admin may assign any Primary / Junior Secondary / Senior
-- School combination to an Admin. That Admin may then create/edit
-- teachers ONLY within the levels assigned to the Admin.
--
-- This is enforced in the database as a defense-in-depth layer in
-- addition to the manage-user Edge Function. Direct browser/API
-- updates to profiles cannot be used to bypass the rule.
-- ============================================================

create or replace function public.admin_teacher_level_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_scopes text[];
  requested_scopes text[];
begin
  caller_role := app_current_role();

  -- Super Admin is unrestricted.
  if caller_role = 'superadmin' then
    return new;
  end if;

  if caller_role <> 'admin' then
    return new;
  end if;

  -- An Admin may not use the profiles table to promote/demote another
  -- account or edit another Admin. Admin-created accounts are teachers.
  if new.id <> auth.uid() then
    if old.role <> 'user' or new.role <> 'user' then
      raise exception 'Admins may only manage teacher accounts';
    end if;
    if new.school_id <> current_school_id() or old.school_id <> current_school_id() then
      raise exception 'Admins may only manage teachers in their own school';
    end if;

    caller_scopes := coalesce(
      (select nullif(section_scopes, '{}') from profiles where id = auth.uid()),
      case when (select section_scope from profiles where id = auth.uid()) is null
           then null
           else array[(select section_scope from profiles where id = auth.uid())]
      end
    );

    -- A scoped Admin cannot assign NULL/empty (unrestricted) to a teacher.
    -- Every requested level must be one of the Admin's own levels.
    requested_scopes := coalesce(new.section_scopes, '{}');
    if coalesce(array_length(caller_scopes, 1), 0) > 0 then
      if coalesce(array_length(requested_scopes, 1), 0) = 0
         or not (requested_scopes <@ caller_scopes) then
        raise exception 'Teacher level access must be within the Admin''s assigned levels';
      end if;
    end if;
  else
    -- Admins may not change their own role or level access through the
    -- profiles table. Super Admin controls Admin permissions.
    if new.role is distinct from old.role
       or new.section_scopes is distinct from old.section_scopes
       or new.section_scope is distinct from old.section_scope then
      raise exception 'Admins cannot change their own role or level access';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_admin_teacher_level_update_guard on profiles;
create trigger trg_admin_teacher_level_update_guard
before update on profiles
for each row execute function public.admin_teacher_level_update_guard();

comment on function public.admin_teacher_level_update_guard() is
  'Prevents a section-scoped Admin from creating/editing teacher access outside the Admin\'s own assigned levels. Super Admin remains unrestricted.';
