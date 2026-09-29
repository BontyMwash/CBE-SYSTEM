-- ============================================================
-- Migration 035 — Split Primary into Lower/Upper Primary for
-- Admin/Teacher level-access allocation
--
-- BACKGROUND
--   024_primary_bands.sql already let a SUBJECT be scoped to
--   'lower-primary' or 'upper-primary' individually. It deliberately
--   left profiles.section_scope(s) — the field used to allocate an
--   Admin or Teacher LOGIN to a level — untouched, because nothing
--   had asked for it yet.
--
--   025_teacher_section_scope.sql and 032_multi_level_access.sql
--   already did most of the underlying work for this: 'lower-primary'
--   and 'upper-primary' are valid for the single-value
--   profiles.section_scope column, and every access-checking function
--   (section_scope_covers, profile_has_section, teacher_has_subject,
--   teacher_has_class, admin_class_allowed, ...) already treats
--   'primary' as the PARENT of both bands — a login scoped to
--   'primary' already covers Lower and Upper Primary, and a login
--   scoped to just 'lower-primary' is already only matched against
--   Lower Primary classes/subjects.
--
--   The one piece never widened was the CHECK constraint on the
--   MULTI-value profiles.section_scopes array (added in 032), which
--   still only accepted 'primary' — not the two leaf bands. That is
--   what actually stopped a Super Admin from allocating an Admin (or
--   an Admin from allocating a Teacher) to just Lower Primary or just
--   Upper Primary from the Users page.
--
-- WHAT THIS CHANGES
--   1. Widens profiles_section_scopes_check to also accept
--      'lower-primary' and 'upper-primary' — matching what
--      025_teacher_section_scope.sql already did for the singular
--      profiles.section_scope column.
--   2. Re-defines admin_teacher_level_update_guard() (033, fixed for
--      NULL callers in 034) so the "requested levels must be within
--      the admin's own levels" check is hierarchy-aware: an Admin who
--      still holds the legacy combined 'primary' scope can assign
--      EITHER 'lower-primary' or 'upper-primary' to a teacher, not
--      just an exact 'primary' match. Without this, an existing
--      'primary'-scoped Admin would suddenly be unable to allocate
--      teachers to the newly-selectable leaf bands.
--
--   No existing data is rewritten. An account already saved with
--   section_scope(s) = 'primary' is untouched and keeps covering both
--   bands, exactly as before — this migration only ADDS two new
--   values as selectable options going forward.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run. Safe to run more than once.
-- ============================================================

-- ---- 1. Widen the section_scopes array constraint ----

alter table profiles drop constraint if exists profiles_section_scopes_check;
alter table profiles add constraint profiles_section_scopes_check
  check (
    section_scopes is null
    or section_scopes <@ array['primary','lower-primary','upper-primary','junior-secondary','senior-school']::text[]
  );

comment on column profiles.section_scopes is
  'Level access assigned to an Admin/Teacher. NULL or empty = unrestricted. Values: primary (legacy, covers both primary bands), lower-primary, upper-primary, junior-secondary, senior-school.';


-- ---- 2. Hierarchy-aware delegation guard ----

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
  -- SUPER ADMIN — unrestricted.
  -- ----------------------------------------------------------

  if caller_role = 'superadmin' then
    return new;
  end if;


  -- ----------------------------------------------------------
  -- Only Admins are restricted by this function. A NULL
  -- caller_role (service-role write, identity already verified
  -- by the caller's application code) must ALSO fall through
  -- here, not be treated as an Admin. IS DISTINCT FROM makes
  -- this comparison NULL-safe (fixed in migration 034).
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
    -- must be within those assigned levels. Hierarchy-aware:
    -- an Admin still holding the legacy combined 'primary'
    -- scope covers 'lower-primary' and 'upper-primary' too, so
    -- expand 'primary' in the Admin's own scopes before the
    -- containment check (mirrors scopesCoverAll() in
    -- supabase/functions/manage-user/index.ts).
    -- --------------------------------------------------------

    if coalesce(array_length(caller_scopes, 1), 0) > 0 then

      if coalesce(array_length(requested_scopes, 1), 0) = 0 then
        raise exception
          'Teacher level access must be within the Admin''s assigned levels';
      end if;


      if not (
        requested_scopes <@ (
          caller_scopes
          || case when 'primary' = any(caller_scopes)
               then array['lower-primary','upper-primary']
               else array[]::text[]
             end
        )
      ) then
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
    --   - assign a level they do not have (hierarchy-aware, see
    --     the INSERT branch above for why)
    -- --------------------------------------------------------

    if coalesce(array_length(caller_scopes, 1), 0) > 0 then

      if coalesce(array_length(requested_scopes, 1), 0) = 0 then

        raise exception
          'Teacher level access must be within the Admin''s assigned levels';

      end if;


      if not (
        requested_scopes <@ (
          caller_scopes
          || case when 'primary' = any(caller_scopes)
               then array['lower-primary','upper-primary']
               else array[]::text[]
             end
        )
      ) then

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
  'Prevents a section-scoped Admin from creating/editing teacher access outside the Admin''s own assigned levels. Super Admin remains unrestricted. Fixed in 034: a NULL caller_role (service-role writes) is treated as non-admin. Fixed in 035: the containment check is hierarchy-aware, so an Admin still holding the legacy combined ''primary'' scope can assign either ''lower-primary'' or ''upper-primary'' to a teacher, matching lower/upper primary becoming separately selectable.';

-- The existing trigger (created in 033) already points at this
-- function by name, so replacing the function body above is
-- sufficient — no need to drop/recreate the trigger itself.

-- ============================================================
-- END OF MIGRATION 035
-- ============================================================
