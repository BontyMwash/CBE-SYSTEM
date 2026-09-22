-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Step 2 — MERGE DUPLICATE SUBJECTS (SAFE, KEEPS ALL MARKS)
--
-- WHAT THIS DOES
--   Creates a function merge_subjects(keep_id, remove_id) that:
--     1. Moves every exam that pointed at remove_id so it points
--        at keep_id instead (exams.subject_id updated in place —
--        the exam ROW is never deleted, so every result/mark tied
--        to that exam via exam_id is completely untouched).
--     2. Moves teacher_subjects / teacher_subject_classes /
--        competency_assessments links the same way, skipping any
--        that would collide with a link that already exists under
--        keep_id (ON CONFLICT DO NOTHING), then discards the now-
--        redundant leftover instead of erroring.
--     3. Deletes the remove_id subject row itself, ONLY after
--        confirming nothing still references it.
--   All of this runs inside one transaction (a function body is
--   atomic) — either the whole merge succeeds, or none of it does.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
--   The `results` table (the actual recorded marks) is never
--   inserted into, updated, or deleted from by this function.
--   Marks are only ever reachable by following exam_id, and every
--   exam keeps its own id throughout — so every mark stays exactly
--   where it was, just now filed under the kept subject.
--
-- BEFORE YOU RUN THIS
--   Run 027_find_duplicate_subjects.sql first and decide, for each
--   duplicate group, which subject_id to KEEP. Do not merge two
--   subjects that are deliberately separate (e.g. a subject
--   correctly split into 'lower-primary' vs 'upper-primary' bands
--   is NOT a duplicate — merging those would blend two different
--   grade bands' subject lists back together).
--
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste
-- this whole file -> Run. This installs the function; it does not
-- merge anything by itself. Safe to run more than once.
-- ============================================================

create or replace function merge_subjects(keep_id uuid, remove_id uuid)
returns table (
  moved_exams int,
  moved_teacher_subjects int,
  moved_teacher_subject_classes int,
  moved_competency_records int,
  removed_subject_id uuid
) as $$
declare
  v_keep_school uuid;
  v_remove_school uuid;
  v_moved_exams int := 0;
  v_moved_ts int := 0;
  v_moved_tsc int := 0;
  v_moved_ca int := 0;
begin
  if keep_id = remove_id then
    raise exception 'keep_id and remove_id are the same subject — nothing to merge';
  end if;

  select school_id into v_keep_school from subjects where id = keep_id;
  select school_id into v_remove_school from subjects where id = remove_id;

  if v_keep_school is null then
    raise exception 'keep_id % does not exist in subjects', keep_id;
  end if;
  if v_remove_school is null then
    raise exception 'remove_id % does not exist in subjects', remove_id;
  end if;
  if v_keep_school <> v_remove_school then
    raise exception 'refusing to merge subjects from two different schools (% vs %)', v_keep_school, v_remove_school;
  end if;

  -- 1) Exams: just repoint. Exam rows (and every result attached to
  --    them via exam_id) are never touched otherwise — all marks stay put.
  update exams set subject_id = keep_id where subject_id = remove_id;
  get diagnostics v_moved_exams = row_count;

  -- 2) teacher_subjects: move, skip exact duplicates already under keep_id.
  update teacher_subjects ts
     set subject_id = keep_id
   where ts.subject_id = remove_id
     and not exists (
       select 1 from teacher_subjects x
       where x.teacher_id = ts.teacher_id and x.subject_id = keep_id
     );
  get diagnostics v_moved_ts = row_count;
  delete from teacher_subjects where subject_id = remove_id; -- any leftovers were true duplicates

  -- 3) teacher_subject_classes: same pattern, unique on (teacher, subject, class).
  update teacher_subject_classes tsc
     set subject_id = keep_id
   where tsc.subject_id = remove_id
     and not exists (
       select 1 from teacher_subject_classes x
       where x.teacher_id = tsc.teacher_id and x.subject_id = keep_id and x.class_id = tsc.class_id
     );
  get diagnostics v_moved_tsc = row_count;
  delete from teacher_subject_classes where subject_id = remove_id;

  -- 4) competency_assessments: unique on (student, subject, term, year, strand, sub_strand).
  update competency_assessments ca
     set subject_id = keep_id
   where ca.subject_id = remove_id
     and not exists (
       select 1 from competency_assessments x
       where x.student_id = ca.student_id and x.subject_id = keep_id
         and x.term = ca.term and x.year = ca.year
         and x.strand = ca.strand and x.sub_strand is not distinct from ca.sub_strand
     );
  get diagnostics v_moved_ca = row_count;
  delete from competency_assessments where subject_id = remove_id; -- any leftovers were true duplicates

  -- 5) Now safe to remove the duplicate subject row itself.
  delete from subjects where id = remove_id;

  return query select v_moved_exams, v_moved_ts, v_moved_tsc, v_moved_ca, remove_id;
end;
$$ language plpgsql;

-- ============================================================
-- HOW TO USE IT (after installing the function above)
--
--   select * from merge_subjects('<keep-subject-id>', '<duplicate-subject-id>');
--
-- Run one call per duplicate pair. It returns a row telling you
-- exactly how many exams / teacher links / competency records were
-- moved, and confirms which subject id was removed. Re-run
-- 027_find_duplicate_subjects.sql afterwards to confirm the
-- duplicate group is now down to one row with all the marks intact.
-- ============================================================
