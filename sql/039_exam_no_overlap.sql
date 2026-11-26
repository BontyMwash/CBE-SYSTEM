-- ============================================================
-- Migration 039 — One exam per class + subject + type + term + year
--
-- An exam is identified by (school, class, subject, exam type, term, year).
-- Two rows with the same five values are two sets of marks for the same
-- paper, which makes results overlap. The app now refuses to create them
-- (js/data.js); this adds the same rule in the database as a backstop.
--
-- STEP 1 — run this SELECT first. It lists any exams that ALREADY overlap.
--          If it returns rows, resolve them first (Subjects page ->
--          "Merge duplicate subjects", or delete the extra exam).
-- ============================================================

select school_id, klass, subject_id, type, term, year, count(*) as copies,
       array_agg(id order by created_at) as exam_ids
from exams
group by school_id, klass, subject_id, type, term, year
having count(*) > 1;

-- STEP 2 — run this once STEP 1 returns no rows. It stops with a clear
--          message instead of failing half-way if duplicates remain.
do $$
begin
  if exists (
    select 1 from exams
    group by school_id, klass, subject_id, type, term, year
    having count(*) > 1
  ) then
    raise exception 'Overlapping exams still exist - run STEP 1, fix them, then run this again.';
  end if;

  create unique index if not exists exams_no_overlap_idx
    on exams (school_id, klass, subject_id, type, term, year);
end $$;

-- Helps the "newest first" ordering on the Exams page.
create index if not exists exams_school_created_idx on exams (school_id, created_at desc);
