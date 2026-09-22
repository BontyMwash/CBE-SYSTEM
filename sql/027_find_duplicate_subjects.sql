-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Step 1 — FIND DUPLICATE SUBJECTS (READ-ONLY)
--
-- Purpose: list subjects that look like duplicates of each other
-- (same name, case/space-insensitive, within the same school),
-- and show how much data sits under EACH duplicate row, so you
-- can decide which one to keep before running the merge script.
--
-- This script changes NOTHING. It is 100% safe to run any time.
--
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste
-- this whole file -> Run.
-- ============================================================

-- 1) Group subjects by school + normalized name, show every row
--    in each group side-by-side with its section/band and how
--    much data references it. Only groups with more than one
--    subject are shown (true duplicates).
with normalized as (
  select
    s.id,
    s.school_id,
    sc.name as school_name,
    s.name,
    s.code,
    s.section,
    s.created_at,
    lower(trim(s.name)) as norm_name
  from subjects s
  join schools sc on sc.id = s.school_id
),
dupe_groups as (
  select school_id, norm_name
  from normalized
  group by school_id, norm_name
  having count(*) > 1
)
select
  n.school_name,
  n.name              as subject_name,
  n.id                as subject_id,
  n.code,
  n.section            as band,
  n.created_at,
  (select count(*) from exams e                    where e.subject_id = n.id) as exam_count,
  (select coalesce(sum(r.cnt),0) from (
      select ex.id, count(res.id) as cnt
      from exams ex
      left join results res on res.exam_id = ex.id
      where ex.subject_id = n.id
      group by ex.id
   ) r)                                                                       as marks_recorded,
  (select count(*) from teacher_subjects ts         where ts.subject_id = n.id) as teacher_subject_links,
  (select count(*) from teacher_subject_classes tsc where tsc.subject_id = n.id) as teacher_class_links,
  (select count(*) from competency_assessments ca   where ca.subject_id = n.id) as competency_records
from normalized n
join dupe_groups g on g.school_id = n.school_id and g.norm_name = n.norm_name
order by n.school_name, n.norm_name, n.created_at;

-- 2) Quick summary: for each duplicate group, which subject_id has
--    the MOST marks recorded against it (a reasonable default
--    "keep this one" candidate — but review row 1's output yourself,
--    since a subject scoped to a specific band, e.g. 'lower-primary',
--    may need to stay separate rather than be merged at all).
with normalized as (
  select s.id, s.school_id, s.name, s.section, lower(trim(s.name)) as norm_name
  from subjects s
),
dupe_groups as (
  select school_id, norm_name
  from normalized
  group by school_id, norm_name
  having count(*) > 1
),
marks_per_subject as (
  select n.school_id, n.norm_name, n.id as subject_id, n.name, n.section,
         coalesce((select count(res.id)
                   from exams ex join results res on res.exam_id = ex.id
                   where ex.subject_id = n.id), 0) as marks_recorded
  from normalized n
  join dupe_groups g on g.school_id = n.school_id and g.norm_name = n.norm_name
)
select school_id, norm_name as subject_name, subject_id, section as band, marks_recorded,
       rank() over (partition by school_id, norm_name order by marks_recorded desc, subject_id) as rnk
from marks_per_subject
order by school_id, norm_name, rnk;
