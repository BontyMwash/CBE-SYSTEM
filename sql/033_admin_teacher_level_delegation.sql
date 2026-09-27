-- ============================================================
-- Migration 033 — Admin -> Teacher level delegation security
--
-- Rules:
--   1. Super Admin is unrestricted.
--   2. An Admin can only create/edit teacher accounts.
--   3. An Admin can only assign teachers levels that the Admin
--      themselves has been assigned.
--   4. An Admin cannot give a teacher unrestricted access.
--   5. An Admin cannot promote a teacher to Admin/Super Admin.
--   6. An Admin cannot change their own role or level access.
--   7. Protection applies to both INSERT and UPDATE.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Remove the old trigger
-- ------------------------------------------------------------

drop trigger if exists trg_admin_teacher_level_update_guard
on public.profiles;


-- ------------------------------------------------------------
-- 2. Create / replace the security function
-- ------------------------------------------------------------

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
  caller_school_id uuid;
begin

  -- ----------------------------------------------------------
  -- Get the role of the logged-in user
  -- ----------------------------------------------------------

  caller_role := app_current_role();


  -- ----------------------------------------------------------
  -- SUPER ADMIN
  --
  -- Super Admin is unrestricted.
  -- ----------------------------------------------------------

  if caller_role = 'superadmin' then
    return new;
  end if;


  -- ----------------------------------------------------------
  -- Only Admins are restricted by this function.
  --
  -- Other roles are allowed to continue through the existing
  -- application rules.
  -- ----------------------------------------------------------

  if caller_role <> 'admin' then
    return new;
  end if;


  -- ----------------------------------------------------------
  -- Get the Admin's school
  -- ----------------------------------------------------------

  caller_school_id := current_school_id();


  -- ==========================================================
  -- INSERT
  --
  -- This protects creation of a NEW teacher.
  -- ==========================================================

  if tg_op = 'INSERT' then

    -- Admin-created accounts must be normal teacher/user
    -- accounts, never Admin or Super Admin accounts.
    if new.role is distinct from 'user' then
      raise exception
        'Admins may only create teacher accounts';
    end if;


    -- Teacher must belong to the Admin's school.
    if new.school_id is distinct from caller_school_id then
      raise exception
        'Admins may only create teachers in their own school';
    end if;


    -- --------------------------------------------------------
    -- Get Admin's assigned levels.
    --
    -- section_scopes is preferred.
    -- section_scope is retained for compatibility with older
    -- accounts.
    -- --------------------------------------------------------

    caller_scopes := coalesce(
      (
        select nullif(section_scopes, '{}')
        from public.profiles
        where id = auth.uid()
      ),
      case
        when (
          select section_scope
          from public.profiles
          where id = auth.uid()
        ) is null
        then null
        else array[
          (
            select section_scope
            from public.profiles
            where id = auth.uid()
          )
        ]
      end
    );


    -- --------------------------------------------------------
    -- Requested teacher levels.
    -- NULL / empty means unrestricted access.
    -- A section-scoped Admin is NOT allowed to create an
    -- unrestricted teacher.
    -- --------------------------------------------------------

    requested_scopes := coalesce(new.section_scopes, '{}');


    -- --------------------------------------------------------
    -- If the Admin has assigned levels, every teacher level
    -- must be inside those assigned levels.
    -- --------------------------------------------------------

    if coalesce(array_length(caller_scopes, 1), 0) > 0 then

      if coalesce(array_length(requested_scopes, 1), 0) = 0 then
        raise exception
          'Teacher level access must be within the Admin''s assigned levels';
      end if;


      if not (requested_scopes <@ caller_scopes) then
        raise exception
          'Teacher level access must be within the Admin''s assigned levels';
      end if;

    end if;


    return new;

  end if;


  -- ==========================================================
  -- UPDATE
  --
  -- This protects modification of an existing profile.
  -- ==========================================================

  if tg_op = 'UPDATE' then

    -- --------------------------------------------------------
    -- Admin cannot modify accounts outside their school.
    -- --------------------------------------------------------

    if new.school_id is distinct from caller_school_id
       or old.school_id is distinct from caller_school_id then

      raise exception
        'Admins may only manage teachers in their own school';

    end if;


    -- --------------------------------------------------------
    -- Admin is not allowed to change their own role or
    -- level access.
    -- --------------------------------------------------------

    if new.id = auth.uid() then

      if new.role is distinct from old.role
         or new.section_scopes is distinct from old.section_scopes
         or new.section_scope is distinct from old.section_scope then

        raise exception
          'Admins cannot change their own role or level access';

      end if;

      return new;

    end if;


    -- --------------------------------------------------------
    -- Admin may only manage normal teacher/user accounts.
    -- Prevents promotion to Admin or Super Admin.
    -- --------------------------------------------------------

    if old.role <> 'user'
       or new.role <> 'user' then

      raise exception
        'Admins may only manage teacher accounts';

    end if;


    -- --------------------------------------------------------
    -- Get Admin's assigned levels.
    -- --------------------------------------------------------

    caller_scopes := coalesce(
      (
        select nullif(section_scopes, '{}')
        from public.profiles
        where id = auth.uid()
      ),
      case
        when (
          select section_scope
          from public.profiles
          where id = auth.uid()
        ) is null
        then null
        else array[
          (
            select section_scope
            from public.profiles
            where id = auth.uid()
          )
        ]
      end
    );


    -- --------------------------------------------------------
    -- Requested teacher levels.
    -- --------------------------------------------------------

    requested_scopes := coalesce(new.section_scopes, '{}');


    -- --------------------------------------------------------
    -- A scoped Admin cannot:
    --
    --   - remove all teacher level restrictions
    --   - assign a level they do not have
    -- --------------------------------------------------------

    if coalesce(array_length(caller_scopes, 1), 0) > 0 then

      if coalesce(array_length(requested_scopes, 1), 0) = 0 then

        raise exception
          'Teacher level access must be within the Admin''s assigned levels';

      end if;


      if not (requested_scopes <@ caller_scopes) then

        raise exception
          'Teacher level access must be within the Admin''s assigned levels';

      end if;

    end if;


    return new;

  end if;


  return new;

end;
$$;


-- ------------------------------------------------------------
-- 3. Create the trigger
--
-- IMPORTANT:
-- Protect BOTH INSERT and UPDATE.
-- ------------------------------------------------------------

create trigger trg_admin_teacher_level_update_guard
before insert or update on public.profiles
for each row
execute function public.admin_teacher_level_update_guard();


-- ------------------------------------------------------------
-- 4. Documentation
-- ------------------------------------------------------------

comment on function public.admin_teacher_level_update_guard() is
  'Prevents a section-scoped Admin from creating/editing teacher access outside the Admin''s own assigned levels. Super Admin remains unrestricted.';


-- ============================================================
-- END OF MIGRATION 033
-- ============================================================