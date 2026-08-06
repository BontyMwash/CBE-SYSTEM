-- ============================================================
-- Migration: teacher names on report cards.
--
--   * schools.head_name   — the Head of Institution's name (one per
--     school), set on the Settings page.
--   * classes.teacher_name — the Class Teacher's name for that
--     class/stream, set on the Classes/Streams page.
--
-- Both are plain columns on tables that already have RLS policies
-- covering updates ("admin can update own school" / "admin update
-- classes"), so no new policies are needed here — just the columns.
-- Run this once in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table schools  add column if not exists head_name     text not null default '';
alter table classes  add column if not exists teacher_name  text not null default '';
