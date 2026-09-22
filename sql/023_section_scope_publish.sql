-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 023 — Section-scoped admins can only publish/unpublish
-- results for their OWN section.
--
-- BACKGROUND
--   013_admin_section_scope.sql let a superadmin restrict an admin
--   login to Primary, Junior Secondary, or Senior School — that
--   migration gated writes to classes, students, exams and results.
--   It did NOT touch published_results (006_published_results.sql),
--   which was added earlier and never revisited. In practice that
--   meant a Primary-scoped admin could still publish (or unpublish)
--   a Junior Secondary or Senior School sitting via the Analysis
--   page or a direct API call, even though they couldn't otherwise
--   touch that section's data — the one place the three sections
--   weren't actually independent.
--
-- WHAT THIS CHANGES
--   Re-defines the insert/update/delete policies on
--   published_results to add the same admin_class_allowed(klass)
--   gate 013 already uses everywhere else. A section-scoped admin
--   can now only publish/unpublish sittings for classes in their
--   own section; an unrestricted admin or superadmin is unaffected.
--   SELECT is unchanged — every login in the school can still see
--   which sittings are published, same as before.
--
-- REQUIRES
--   013_admin_section_scope.sql must already be applied (this
--   migration uses admin_class_allowed(), which it defines).
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run. Safe on an existing install —
-- it only re-defines three policies, it doesn't touch data.
-- ============================================================

drop policy if exists "admin publish results" on published_results;
create policy "admin publish results" on published_results
  for insert with check (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(klass))
  );

drop policy if exists "admin update published results" on published_results;
create policy "admin update published results" on published_results
  for update using (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(klass))
  ) with check (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(klass))
  );

drop policy if exists "admin unpublish results" on published_results;
create policy "admin unpublish results" on published_results
  for delete using (
    is_superadmin() or (app_current_role() = 'admin' and school_id = current_school_id() and school_active() and admin_class_allowed(klass))
  );
