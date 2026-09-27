# Admin -> Teacher level security

An Admin created by Super Admin can only create or edit teachers within the levels assigned to that Admin.

Example:

- Admin: Primary + Junior Secondary
- Teacher: Primary + Junior Secondary = allowed
- Teacher: Senior School = blocked
- Teacher: Primary + Senior School = blocked
- Teacher: no level / unrestricted = blocked

The rule is enforced twice:

1. `supabase/functions/manage-user/index.ts` rejects invalid create/update requests.
2. `sql/033_admin_teacher_level_delegation.sql` adds a database trigger so a direct API/browser update cannot bypass the rule.

Deploy the Edge Function and run the SQL migration after updating the project.
