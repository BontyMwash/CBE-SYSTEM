-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 019 — Section-scoped subjects.
--
-- Adds subjects.section: '' (default), 'primary', 'junior-secondary',
-- or 'senior-school'. '' means "shared across every level" — the
-- behaviour every existing subject keeps after this migration, so
-- nothing disappears from any class until an admin deliberately
-- scopes a subject to one section (e.g. Chemistry -> senior-school
-- only, so it never shows up as an option for a Grade 3 class).
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run. Safe to run more than once.
-- ============================================================

alter table subjects add column if not exists section text not null default '';

alter table subjects drop constraint if exists subjects_section_check;
alter table subjects add constraint subjects_section_check
  check (section in ('', 'primary', 'junior-secondary', 'senior-school'));
