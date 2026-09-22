-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 017 — Remove Lesson Plans & Schemes of Work.
--
-- Reverses migrations 015 and 016: the "Lesson Plans" screen
-- (Schemes of Work, Lesson Plans, and the AI-generation feature
-- grounded in uploaded curriculum design PDFs) has been removed
-- from the app. This drops the tables, storage policies, and the
-- storage bucket itself.
--
-- WARNING: this permanently deletes any scheme-of-work rows,
-- lesson plans, and uploaded curriculum PDFs a school has saved.
-- Export/back up first if that data is worth keeping.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run.
-- ============================================================

-- ------------------------------------------------------------
-- STORAGE: remove the curriculum-designs bucket's policies,
-- objects, and the bucket itself
-- ------------------------------------------------------------

drop policy if exists "select curriculum pdfs in own school" on storage.objects;
drop policy if exists "admin or user upload curriculum pdfs" on storage.objects;
drop policy if exists "admin or user delete curriculum pdfs" on storage.objects;

delete from storage.objects where bucket_id = 'curriculum-designs';
delete from storage.buckets where id = 'curriculum-designs';

-- ------------------------------------------------------------
-- TABLES (dropping cascades their policies and indexes)
-- ------------------------------------------------------------

drop table if exists curriculum_documents;
drop table if exists lesson_plans;
drop table if exists schemes_of_work;
