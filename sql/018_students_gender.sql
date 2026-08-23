-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 018 — Gender on students.
--
-- Adds an optional `gender` column to `students`: 'M', 'F', or ''
-- (unspecified — existing rows default here, so nothing breaks for
-- schools that don't collect this yet). No RLS changes needed —
-- `gender` is just another student field, covered by the existing
-- select/insert/update/delete policies on `students`.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run. Safe to run more than once.
-- ============================================================

alter table students add column if not exists gender text not null default '';

alter table students drop constraint if exists students_gender_check;
alter table students add constraint students_gender_check check (gender in ('', 'M', 'F'));
