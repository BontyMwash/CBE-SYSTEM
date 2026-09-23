-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- 030 — Actually merges the duplicate subjects that
-- 029_preview_duplicate_subjects.sql showed you. Run 029 FIRST and
-- read its output before running this.
--
-- This does nothing new or risky under the hood — every merge is
-- done through the same merge_subjects() function the app's own
-- "Merge duplicates" button uses (see 028_merge_subjects.sql), which
-- never deletes or overwrites a recorded mark: an exam with no
-- matching sitting on the surviving subject is simply re-pointed
-- (its results move with it); a genuine duplicate sitting has its
-- results merged one student at a time, and if the same student
-- somehow has a mark on BOTH sides, neither is touched — that
-- subject is left in place (not deleted) so you can compare and
-- clear the wrong one from Marks Entry yourself.
--
-- This script just does that automatically, once per duplicate group,
-- instead of you clicking through "Merge duplicates" by hand for
-- each pair. It requires no admin session — it runs as whichever
-- Postgres role your SQL Editor connection uses, bypassing the
-- "only an admin can merge subjects" check inside merge_subjects()
-- (that check is for the app's own logged-in-user path; running SQL
-- directly in Supabase already means you have full database access).
--
-- Safe to run more than once — a school with nothing left to merge
-- just does nothing.
-- ============================================================

create temporary table if not exists _subject_merge_log (
  school_code text,
  subject_name text,
  keep_id uuid,
  removed_id uuid,
  removed_level text,
  result jsonb,
  error text
);
truncate _subject_merge_log;

do $$
declare
  grp record;
  remove_id uuid;
  remove_section text;
  i int;
  v_result jsonb;
begin
  for grp in
    with subj_counts as (
      select
        s.id, s.school_id, s.name, s.section, s.created_at,
        (select count(*) from exams e where e.subject_id = s.id) as exam_count
      from subjects s
    )
    select
      school_id,
      names[1] as keep_name,
      ids[1] as keep_id,
      ids as ids,
      sections as sections
    from (
      select
        school_id,
        lower(trim(name)) as name_key,
        array_agg(id order by exam_count desc, created_at asc) as ids,
        array_agg(name order by exam_count desc, created_at asc) as names,
        array_agg(section order by exam_count desc, created_at asc) as sections,
        count(*) as n
      from subj_counts
      group by school_id, lower(trim(name))
      having count(*) > 1
    ) g
  loop
    for i in 2..array_length(grp.ids, 1) loop
      remove_id := grp.ids[i];
      remove_section := grp.sections[i];
      begin
        select public.merge_subjects(grp.keep_id, remove_id) into v_result;
        insert into _subject_merge_log (school_code, subject_name, keep_id, removed_id, removed_level, result)
        select code, grp.keep_name, grp.keep_id, remove_id, remove_section, v_result
        from schools where id = grp.school_id;
      exception when others then
        insert into _subject_merge_log (school_code, subject_name, keep_id, removed_id, removed_level, error)
        select code, grp.keep_name, grp.keep_id, remove_id, remove_section, sqlerrm
        from schools where id = grp.school_id;
      end;
    end loop;
  end loop;
end $$;

-- Read this: one row per duplicate that was folded in. `result` shows
-- exactly what moved (examsMoved / examsMerged / resultsMoved /
-- resultsConflicted / removedSubjectDeleted) for that pair — the same
-- summary the app's toast shows after a manual merge. Any row with a
-- non-null `error` wasn't merged — read the message and handle that
-- one by hand from the Subjects page.
select * from _subject_merge_log order by school_code, subject_name;
