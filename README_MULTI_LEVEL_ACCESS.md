# Multi-level access checkboxes

Admins and Teachers can now be assigned one or more access levels from **Users → Edit name/role**:

- Primary
- Junior Secondary
- Senior School

Super Admin can assign levels to Admins and Teachers. Admin can assign levels to Teachers.

Leave all three unchecked for unrestricted access.

The selected levels are stored in `profiles.section_scopes` and enforced by the application and the database helper functions. Existing single `profiles.section_scope` values are migrated automatically by `sql/032_multi_level_access.sql`.

Run `sql/032_multi_level_access.sql` once in Supabase SQL Editor before testing the new access controls.
