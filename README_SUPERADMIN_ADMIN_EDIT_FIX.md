# Fix: Super Admin couldn't edit Admin details

There were **two separate bugs** stacked on top of each other. Fixing #1
alone surfaces #2's error message ("Admins may only manage teachers in
their own school") — that's the real, final blocker.

---

## Bug 1 (client-side) — Root cause
`js/auth-views.js` (the "Edit" button handler for Admin rows in the Users
screen) calls:

    Store.updateSuperAdminAdminProfile(existing.id, { name, role: 'admin', sectionScopes })

but `Store` (in `js/data.js`) never defined that method — only `Auth` (in
`js/auth.js`) did. So clicking "Save changes" after editing an Admin threw
`Store.updateSuperAdminAdminProfile is not a function`, which the modal's
catch block silently turned into a generic "Could not save: ..." toast.

Editing a regular teacher ("user") login worked fine because
`Store.updateUserProfile` does exist and wraps `Auth.updateManagedUserProfile`.
The Admin-editing path was simply missing its `Store` wrapper.

## Fix
Added the missing wrapper in `js/data.js`, following the same pattern as
`updateUserProfile`:

    async updateSuperAdminAdminProfile(id, patch) {
      const result = await Auth.updateSuperAdminAdminProfile(id, {
        name: patch.name, role: 'admin', sectionScopes: patch.sectionScopes
      });
      if (!result.ok) throw new Error(result.error || 'Could not update admin profile');
      const users = await this.listUsersForSchool(this.activeSchoolId);
      return users.find(u => u.id === id) || null;
    },

This calls through to the existing, already-correct server-side logic
(`manage-user` Edge Function, `action: 'updateAdminProfile'`), which:
- Requires the caller to be `superadmin`.
- Only allows editing accounts that are already `role: 'admin'`.
- Lets the Super Admin update the admin's name and level access
  (`sectionScopes`), without ever downgrading them to a teacher.

No SQL, RLS, or Edge Function changes were needed — only the missing
client-side wrapper in `js/data.js`.

### File changed
- `js/data.js` — added `Store.updateSuperAdminAdminProfile(id, patch)`.

---

## Bug 2 (database) — Root cause

Once bug 1 is fixed, the client correctly calls the Edge Function's
`updateAdminProfile` action. The Edge Function verifies (in application
code) that the caller is really `superadmin`, then writes the change using
its **service-role** Supabase client (`adminClient`) — that client has no
user session attached, so **`auth.uid()` is `NULL`** during that write.

`sql/033_admin_teacher_level_delegation.sql` installs a trigger,
`admin_teacher_level_update_guard()`, on `public.profiles`, which reads:

    caller_role := app_current_role();   -- `select role from profiles where id = auth.uid()`
    if caller_role = 'superadmin' then return new; end if;
    if caller_role <> 'admin'     then return new; end if;

With `auth.uid()` NULL, `caller_role` is `NULL`. In SQL, `NULL = 'superadmin'`
and `NULL <> 'admin'` **both evaluate to `NULL`**, not `true` — and
`plpgsql`'s `IF` treats `NULL` as "not true". So **both** early-return
checks are skipped, and the NULL caller falls through into the branch
meant only for a genuine `admin` caller. There, `caller_school_id` is also
`NULL` (same reason), so:

    if new.school_id is distinct from caller_school_id ... then
      raise exception 'Admins may only manage teachers in their own school';

fires for any real `school_id` — which is exactly the error you saw, even
though the actual caller was a genuine Super Admin.

### Fix
`sql/034_fix_admin_guard_service_role_null.sql` replaces the trigger
function, changing the one faulty line from:

    if caller_role <> 'admin' then return new; end if;

to the NULL-safe:

    if caller_role is distinct from 'admin' then return new; end if;

This makes a service-role write (NULL caller_role, identity already
verified upstream by the Edge Function) correctly skip the Admin-only
restrictions, exactly as the function's own comments already said it
should ("Other roles are allowed to continue through the existing
application rules"). A genuine logged-in Admin (whose `auth.uid()` does
resolve to `'admin'`) is still fully restricted, unchanged.

### File added
- `sql/034_fix_admin_guard_service_role_null.sql` — run this against your
  database (Supabase SQL editor, or `supabase db push` / migrations) to
  replace the trigger function. No need to drop/recreate the trigger
  itself — it already points at this function by name.

---

## How to verify (after applying BOTH fixes)
1. Apply `js/data.js` (bug 1) and run `sql/034_fix_admin_guard_service_role_null.sql`
   against your database (bug 2).
2. Redeploy/refresh the front-end so the new `data.js` is actually served
   (hard-refresh / clear cache if needed).
3. Log in as a Super Admin, open a school, go to Users.
4. Click "Edit" on any row with role "admin".
5. Change the name and/or level access checkboxes, click "Save changes".
6. Confirm the toast says "Login updated" (not an error) and the table
   reflects the change.
