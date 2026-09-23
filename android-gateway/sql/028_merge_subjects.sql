-- ============================================================
-- Copyright (c) 2026 B~CBE Analytics. All rights reserved.
-- Migration 028 — merge_subjects(): combine two subject records
-- (e.g. an old, unscoped "Mathematics" and its newer level-specific
-- replacement) into ONE, without ever deleting a recorded mark.
--
-- WHY THIS EXISTS
--
--   Subjects became level-independent (see Views.subjects). That's
--   correct going forward, but it means a school that already had
--   marks recorded under an old, shared subject can end up with two
--   rows named e.g. "Mathematics" — the old one and a new
--   level-specific one — with completely separate exams. Marks
--   entered against one never show up under the other (see the
--   duplicate-exam warning added to the Exams page). This function
--   lets an admin fold the old one into the new one (or vice versa)
--   in a single safe operation.
--
-- WHAT IT DOES, EXACTLY
--
--   merge_subjects(keep_id, remove_id) walks every exam currently
--   under `remove_id`:
--
--   • If there's no matching exam (same class + exam type + term +
--     year) already under `keep_id`, the exam is simply RE-POINTED
--     to `keep_id` — its results move with it automatically, since a
--     result belongs to an exam_id, not a subject_id. Nothing is
--     touched, copied or recalculated.
--
--   • If a matching exam already exists under `keep_id` (the
--     duplicate-sitting case), each result on the old exam is moved
--     onto the matching exam — UNLESS that student already has a
--     mark on the matching exam too (a genuine conflict: someone
--     recorded marks twice, independently). A conflicting mark is
--     NEVER overwritten or deleted — it's left exactly where it is,
--     on the old exam, so an admin can compare both and clear the
--     wrong one via Marks Entry. The old exam itself is only deleted
--     once every one of its results has actually moved across; if
--     even one conflict remains, the old exam (with just that
--     leftover mark) is kept.
--
--   • Teacher subject-class assignments (see 026) move the same
--     way — moved to `keep_id` unless the teacher is already
--     assigned there for that class.
--
--   • `remove_id` itself is only deleted once nothing references it
--     any more. If a conflict was left behind, the old subject
--     record stays (holding just the disputed exam/mark) so no data
--     is silently lost — merging again after the conflict is
--     resolved will finish the job and remove it then.
--
--   Returns a JSON summary (exams moved, exams merged, results
--   moved, results left as unresolved conflicts, whether the old
--   subject record was fully removed) so the UI can show exactly
--   what happened.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query ->
-- paste this whole file -> Run.
-- ============================================================

-- Drop EVERY existing function named merge_subjects in this schema,
-- regardless of its exact signature or return type — belt-and-braces
-- in case an earlier partial run left behind a version Postgres
-- won't let a plain "drop function merge_subjects(uuid, uuid)" catch
-- (e.g. a different parameter list). Safe to run even if none exist.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'merge_subjects'
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

create function public.merge_subjects(p_keep_id uuid, p_remove_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid;
  v_keep_school uuid;
  v_remove_school uuid;
  v_exams_moved int := 0;
  v_exams_merged int := 0;
  v_results_moved int := 0;
  v_results_conflicted int := 0;
  v_exam record;
  v_result record;
  v_match_exam_id uuid;
  v_remove_still_referenced boolean;
begin
  if not is_superadmin() and app_current_role() <> 'admin' then
    raise exception 'Only an admin can merge subjects';
  end if;
  if p_keep_id is null or p_remove_id is null or p_keep_id = p_remove_id then
    raise exception 'Pick two different subjects to merge';
  end if;

  select school_id into v_keep_school from subjects where id = p_keep_id;
  select school_id into v_remove_school from subjects where id = p_remove_id;
  if v_keep_school is null or v_remove_school is null then
    raise exception 'One of those subjects no longer exists';
  end if;
  if v_keep_school <> v_remove_school then
    raise exception 'Those two subjects belong to different schools';
  end if;
  v_school_id := v_keep_school;
  if not is_superadmin() and v_school_id <> current_school_id() then
    raise exception 'Not authorized for this school';
  end if;

  for v_exam in select * from exams where subject_id = p_remove_id loop
    select id into v_match_exam_id from exams
      where subject_id = p_keep_id
      and klass = v_exam.klass and type = v_exam.type
      and term = v_exam.term and year = v_exam.year
      limit 1;

    if v_match_exam_id is null then
      -- No equivalent sitting under the surviving subject yet — just
      -- move the whole exam over. Its results move with it (they key
      -- off exam_id, which doesn't change), so nothing about the
      -- marks themselves is touched.
      update exams set subject_id = p_keep_id where id = v_exam.id;
      v_exams_moved := v_exams_moved + 1;
    else
      -- A duplicate sitting already exists — merge into it one result
      -- at a time so a genuine per-student conflict can be detected
      -- and preserved rather than silently dropped.
      for v_result in select * from results where exam_id = v_exam.id loop
        if exists (select 1 from results where exam_id = v_match_exam_id and student_id = v_result.student_id) then
          v_results_conflicted := v_results_conflicted + 1;
        else
          update results set exam_id = v_match_exam_id where id = v_result.id;
          v_results_moved := v_results_moved + 1;
        end if;
      end loop;
      -- Only remove the now-duplicate exam if EVERY result on it
      -- actually moved across — if a conflict was left behind, keep
      -- the exam (with just that leftover result) rather than lose it.
      if not exists (select 1 from results where exam_id = v_exam.id) then
        delete from exams where id = v_exam.id;
        v_exams_merged := v_exams_merged + 1;
      end if;
    end if;
  end loop;

  -- Teacher subject-class assignments (026) — move the same way,
  -- never duplicating and never silently dropping one.
  update teacher_subject_classes tsc
    set subject_id = p_keep_id
    where subject_id = p_remove_id
    and not exists (
      select 1 from teacher_subject_classes tsc2
      where tsc2.subject_id = p_keep_id and tsc2.teacher_id = tsc.teacher_id and tsc2.class_id = tsc.class_id
    );
  delete from teacher_subject_classes where subject_id = p_remove_id;

  select exists(select 1 from exams where subject_id = p_remove_id) into v_remove_still_referenced;
  if not v_remove_still_referenced then
    delete from subjects where id = p_remove_id;
  end if;

  return jsonb_build_object(
    'examsMoved', v_exams_moved,
    'examsMerged', v_exams_merged,
    'resultsMoved', v_results_moved,
    'resultsConflicted', v_results_conflicted,
    'removedSubjectDeleted', not v_remove_still_referenced
  );
end;
$$;

grant execute on function public.merge_subjects(uuid, uuid) to authenticated;
