-- ============================================================
-- Migration 034 — Fix: Super Admin edits blocked by the
-- admin/teacher level delegation trigger (033)
--
-- BUG
-- ---
-- The manage-user Edge Function writes to public.profiles using
-- the SERVICE ROLE client. That client has no user session, so
-- inside Postgres auth.uid() is NULL during that write — even
-- though the Edge Function has already verified, in application
-- code, that the real caller is a superadmin.
--
-- The trigger installed in 033 (admin_teacher_level_update_guard)
-- read the caller's role like this:
--
--   caller_role := app_current_role();   -- NULL when auth.uid() is NULL
--
--   if caller_role = 'superadmin' then return new; end if;  -- NULL = 'superadmin' -> NULL
--   if caller_role <> 'admin'     then return new; end if;  -- NULL <> 'admin'      -> NULL
--
-- In SQL, comparing anything to NULL with = or <> yields NULL,
-- not true/false, and plpgsql's IF treats NULL as "not true". So
-- BOTH guard checks above were skipped, and a NULL caller_role
-- fell all the way through into the branch meant only for a real
-- 'admin' caller. There, caller_school_id (also derived from
-- auth.uid()) was NULL too, so:
--
--   if new.school_id is distinct from caller_school_id ...
--
-- was true for any real school_id, raising:
--   "Admins may only manage teachers in their own school"
--
-- — even for a genuine Super Admin edit performed via the Edge
-- Function's service-role client. This is exactly the error Super
-- Admins were seeing when editing an Admin's profile.
--
-- FIX
-- ---
-- Use IS DISTINCT FROM instead of <>, which is NULL-safe: a NULL
-- caller_role (unidentifiable / service-role caller) is correctly
-- treated as "not an admin" and the function returns immediately,
-- exactly as the original comment already said it should
-- ("Other roles are allowed to continue through the existing
-- application rules"). Real 'admin' callers (a normal logged-in
-- Admin, whose auth.uid() DOES resolve) are still fully restricted
-- as before — this only stops NULL from being misread as 'admin'.
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
  caller_school_id uuid;
begin

  -- ----------------------------------------------------------
  -- Get the role of the logged-in user (NULL when this write is
  -- done by a service-role client, e.g. the manage-user Edge
  -- Function acting on behalf of an already-verified caller).
  -- ----------------------------------------------------------

  caller_role := app_current_role();


  -- ----------------------------------------------------------
  -- SUPER ADMIN — unrestricted. (No change: NULL still isn't
  -- 'superadmin', so this still correctly does not match.)
  -- ----------------------------------------------------------

  if caller_role = 'superadmin' then
    return new;
  end if;


  -- ----------------------------------------------------------
  -- Only Admins are restricted by this function. A NULL
  -- caller_role (service-role write, identity already verified
  -- by the caller's application code) must ALSO fall through
  -- here, not be treated as an Admin. IS DISTINCT FROM makes
  -- this comparison NULL-safe.
  -- ----------------------------------------------------------

  if caller_role is distinct from 'admin' then
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

comment on function public.admin_teacher_level_update_guard() is
  'Prevents a section-scoped Admin from creating/editing teacher access outside the Admin''s own assigned levels. Super Admin remains unrestricted. Fixed in migration 034: a NULL caller_role (service-role writes, e.g. from the manage-user Edge Function) is now correctly treated as non-admin via IS DISTINCT FROM, instead of silently falling through into the Admin-only branch.';

-- The existing trigger (created in 033) already points at this
-- function by name, so replacing the function body above is
-- sufficient — no need to drop/recreate the trigger itself.

-- ============================================================
-- END OF MIGRATION 034
-- ============================================================
