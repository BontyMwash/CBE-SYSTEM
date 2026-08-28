-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 021 — School code.
--
-- Adds a short, admin-editable identifying code for each school
-- (e.g. an official Ministry/NEMIS code, or any internal code the
-- school already uses) — shown in Settings, and alongside the
-- school name in the masthead of every printable report/broadsheet.
--
-- Safe to run on an existing install. Run this once in Supabase:
-- Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
-- ============================================================

alter table schools add column if not exists code text not null default '';
