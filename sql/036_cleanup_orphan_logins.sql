-- ============================================================
-- Migration 036 — Remove logins left behind by already-deleted schools
--
-- Before the manage-user "deleteSchool" action existed, deleting a school
-- removed the school's profile rows (foreign-key cascade) but NOT the
-- underlying auth.users logins, so those people were left as orphan
-- accounts. From now on the app deletes them together with the school;
-- this one-off script cleans up the ones already left behind
-- (e.g. Nyakianga).
--
-- STEP 1: run this SELECT first and check the list is what you expect.
--         These are logins with NO profile row (so they belong to no
--         school and no role) — Super Admin accounts have a profile and
--         are never listed.
-- ============================================================

select u.id, u.email, u.created_at
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
order by u.created_at;

-- STEP 2: if the list above is correct, run this to delete them.
-- (Un-comment the block below, then Run.)

-- delete from auth.users
-- where id in (
--   select u.id
--   from auth.users u
--   left join public.profiles p on p.id = u.id
--   where p.id is null
-- );
