-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- 029 — PREVIEW ONLY. Shows which subjects look like duplicates of
-- each other (same name, same school, different record) and which
-- one would be kept if you ran 030_merge_duplicate_subjects.sql.
--
-- This file only SELECTs — it changes nothing. Run it first, read
-- the "would_remove" column for every school, and only run 030 once
-- you're happy with what it's proposing to keep.
--
-- HOW "KEEP" IS CHOSEN, for each group of same-named subjects in the
-- same school: whichever one has the most exams recorded against it
-- survives (the one actually in use); ties go to whichever was
-- created first. This is just a sensible default — if you'd rather
-- keep a different one for a particular subject, don't run 030 for
-- that school; use the app's own "Merge duplicates" button on the
-- Subjects page instead, where you pick Keep/Old yourself.
-- ============================================================

with subj_counts as (
  select
    s.id, s.school_id, s.name, s.section, s.created_at,
    (select count(*) from exams e where e.subject_id = s.id) as exam_count
  from subjects s
),
grouped as (
  select
    school_id,
    lower(trim(name)) as name_key,
    array_agg(id order by exam_count desc, created_at asc) as ids,
    array_agg(name order by exam_count desc, created_at asc) as names,
    array_agg(section order by exam_count desc, created_at asc) as sections,
    array_agg(exam_count order by exam_count desc, created_at asc) as exam_counts,
    count(*) as n
  from subj_counts
  group by school_id, lower(trim(name))
  having count(*) > 1
)
select
  (select code from schools sc where sc.id = g.school_id) as school_code,
  names[1] as subject_name,
  ids[1] as keep_subject_id,
  sections[1] as keep_level,
  exam_counts[1] as keep_exam_count,
  (
    select string_agg(
      sections[i] || ' (' || exam_counts[i] || ' exam' || (case when exam_counts[i] = 1 then '' else 's' end) || ', id ' || ids[i] || ')',
      '; ' order by i
    )
    from generate_subscripts(ids, 1) i
    where i > 1
  ) as would_remove
from grouped g
order by school_code, subject_name;
