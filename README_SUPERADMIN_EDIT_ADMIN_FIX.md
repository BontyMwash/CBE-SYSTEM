# Super Admin – Edit Admin Fix

This version adds a dedicated `updateAdminProfile` action to the `manage-user` Edge Function.

## What changed
- Super Admin sees the **Edit** button for Admin accounts.
- The Edit form updates Admin name and CBC level allocation together.
- The browser now sends Super Admin Admin-edits through `updateAdminProfile`.
- The Edge Function explicitly requires the caller to be `superadmin` and the target to be an existing `admin`.
- This action does NOT use the Admin -> teacher management restriction.

## IMPORTANT: deploy the Edge Function
After replacing the project files, run from the project root:

```powershell
supabase functions deploy manage-user
```

Then refresh the website with **Ctrl + F5**.

If your SQL migration `033_admin_teacher_level_delegation.sql` is already applied, no new SQL is required for this fix. It already allows Super Admin updates before applying Admin-only restrictions.
