-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Bootstrapping the FIRST superadmin account
--
-- Every other login in this app is created by an admin/superadmin
-- from inside the app (via the create-user Edge Function). But the
-- very first superadmin can't create themselves that way — do this
-- once, manually, after running schema.sql:
-- ============================================================

-- STEP 1 — In the Supabase Dashboard:
--   Authentication → Users → "Add user"
--   Email:    (your real email, e.g. you@yourschool.org)
--   Password: (choose a strong password)
--   Leave "Auto Confirm User" checked, then click "Create user".
--   Copy the new user's UUID (shown in the users list).

-- STEP 2 — Back in SQL Editor, insert their profile row.
-- Replace the UUID and name below with the real values:

insert into public.profiles (id, school_id, role, name)
values (
  '05f995eb-e365-4eb1-b1bb-c34e632fc5fb',
  null,               -- superadmins aren't tied to one school
  'superadmin',
  'MWANGI'
);

-- That's it — you can now log in to the app with that email/password
-- as superadmin, and create schools + admin logins from the Schools page.
