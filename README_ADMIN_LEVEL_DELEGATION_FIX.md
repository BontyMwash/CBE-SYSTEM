# Admin level delegation security fix

Admins assigned by Super Admin can only create or edit teachers whose level access is a subset of the Admin's own assigned levels. A scoped Admin cannot create an unrestricted teacher or add an outside level.

Security is enforced server-side in `supabase/functions/manage-user/index.ts`; the UI also only shows the Admin's permitted level checkboxes. Profile edits now go through the same Edge Function so the restriction cannot be bypassed by direct browser requests.

Deploy after applying the project update:

```bash
supabase functions deploy manage-user
```
