-- ============================================================
-- 032 — Repair subject/level links without losing marks
--
-- PURPOSE
--   Schools that started using independent CBC subjects by level can
--   still have older exams/results pointing at a shared/legacy subject
--   row (section = '' / primary). This makes those marks appear under
--   the wrong level or disappear from a Junior Secondary subject list.
--
--   This migration repairs the DATABASE links, not just the broadsheet:
--     • Grade 1–3  -> lower-primary
--     • Grade 4–6  -> upper-primary
--     • Grade 7–9  -> junior-secondary
--     • Grade 10–12 -> senior-school
--
--   For every existing exam in a recognised grade, the script finds or
--   creates the same subject for that exact level, then moves the exam
--   to that level-specific subject. Results are attached to exam_id, so
--   moving an exam does NOT alter the marks themselves.
--
--   If an equivalent exam already exists under the level-specific subject,
--   results are moved one student at a time. A genuine conflict (the same
--   student has a mark on BOTH exams) is never overwritten or deleted;
--   it is left in the old exam and recorded in _subject_level_repair_log.
--
--   Teacher subject assignments are copied to the repaired level-specific
--   subject where the required tables exist.
--
--   The migration is school-wide, so Kiriaini Comprehensive School is
--   repaired together with any other school using the same database.
--   It is safe to run more than once: already-correct exams are skipped.
--
-- RUN:
--   Supabase Dashboard -> SQL Editor -> paste this file -> Run.
--   Review the final SELECT, especially any rows with conflicts.
-- ============================================================

create temporary table if not exists _subject_level_repair_log (
  school_id uuid,
  school_name text,
  klass text,
  section text,
  subject_name text,
  source_subject_id uuid,
  target_subject_id uuid,
  exam_id uuid,
  target_exam_id uuid,
  action text,
  results_moved int default 0,
  conflicts int default 0,
  note text
);
truncate _subject_level_repair_log;

do $$
declare
  e record;
  source_subject record;
  target_subject_id uuid;
  target_exam_id uuid;
  r record;
  moved_count int;
  conflict_count int;
  remaining_count int;
  target_exists boolean;
begin
  for e in
    select
      ex.id as exam_id,
      ex.school_id,
      ex.klass,
      ex.type,
      ex.term,
      ex.year,
      ex.subject_id,
      s.name as subject_name,
      s.code as subject_code,
      s.section as source_section,
      class_section(ex.klass) as target_section,
      coalesce(sc.name, '') as school_name
    from exams ex
    join subjects s on s.id = ex.subject_id
    left join schools sc on sc.id = ex.school_id
    where class_section(ex.klass) is not null
    order by ex.school_id, ex.klass, ex.subject_id, ex.created_at, ex.id
  loop
    -- Already correctly scoped: nothing to repair.
    if coalesce(e.source_section, '') = e.target_section then
      continue;
    end if;

    -- Find the existing level-specific subject. Prefer an exact name
    -- match; code is a compatibility fallback for older records whose
    -- displayed name was changed but whose code stayed stable.
    select s2.id
      into target_subject_id
    from subjects s2
    where s2.school_id = e.school_id
      and s2.section = e.target_section
      and (
        lower(trim(s2.name)) = lower(trim(e.subject_name))
        or (
          nullif(trim(s2.code), '') is not null
          and nullif(trim(e.subject_code), '') is not null
          and upper(trim(s2.code)) = upper(trim(e.subject_code))
        )
      )
    order by
      case when lower(trim(s2.name)) = lower(trim(e.subject_name)) then 0 else 1 end,
      s2.created_at asc,
      s2.id
    limit 1;

    -- If the level-specific subject does not exist, create it by copying
    -- the legacy/shared subject's name and code. No mark is created or
    -- changed by this INSERT; the exam is repointed below.
    if target_subject_id is null then
      insert into subjects (school_id, name, code, section)
      values (
        e.school_id,
        e.subject_name,
        coalesce(e.subject_code, ''),
        e.target_section
      )
      returning id into target_subject_id;
    end if;

    if target_subject_id = e.subject_id then
      continue;
    end if;

    -- Copy legacy teacher assignments before the exam is moved.
    insert into teacher_subjects (school_id, teacher_id, subject_id)
    select ts.school_id, ts.teacher_id, target_subject_id
    from teacher_subjects ts
    where ts.school_id = e.school_id
      and ts.subject_id = e.subject_id
    on conflict (teacher_id, subject_id) do nothing;

    -- Copy precise teacher + subject + class assignments when the table
    -- exists (it is created by migration 026 in the current system).
    if to_regclass('public.teacher_subject_classes') is not null then
      insert into teacher_subject_classes (school_id, teacher_id, subject_id, class_id)
      select tsc.school_id, tsc.teacher_id, target_subject_id, tsc.class_id
      from teacher_subject_classes tsc
      join classes c on c.id = tsc.class_id
      where tsc.school_id = e.school_id
        and tsc.subject_id = e.subject_id
        and (case when c.stream <> '' then c.name || ' ' || c.stream else c.name end) = e.klass
      on conflict (teacher_id, subject_id, class_id) do nothing;
    end if;

    -- If a target exam already exists for the same sitting, merge the
    -- source results into it without overwriting a student's existing mark.
    select ex2.id
      into target_exam_id
    from exams ex2
    where ex2.school_id = e.school_id
      and ex2.klass = e.klass
      and ex2.type = e.type
      and ex2.term = e.term
      and ex2.year = e.year
      and ex2.subject_id = target_subject_id
    order by ex2.created_at asc, ex2.id
    limit 1;

    if target_exam_id is null then
      update exams
      set subject_id = target_subject_id
      where id = e.exam_id;

      insert into _subject_level_repair_log
        (school_id, school_name, klass, section, subject_name, source_subject_id,
         target_subject_id, exam_id, action, note)
      values
        (e.school_id, e.school_name, e.klass, e.target_section, e.subject_name,
         e.subject_id, target_subject_id, e.exam_id,
         'REPOINTED_EXAM',
         'Exam moved to the level-specific subject; results stayed attached to the same exam.');
    else
      moved_count := 0;
      conflict_count := 0;

      for r in select * from results where exam_id = e.exam_id order by id loop
        if exists (
          select 1 from results
          where exam_id = target_exam_id
            and student_id = r.student_id
        ) then
          conflict_count := conflict_count + 1;
        else
          update results
          set exam_id = target_exam_id
          where id = r.id;
          moved_count := moved_count + 1;
        end if;
      end loop;

      select count(*) into remaining_count from results where exam_id = e.exam_id;

      -- If every source result moved, the duplicate source exam can be
      -- safely removed. If conflicts remain, preserve the source exam so
      -- no recorded mark is silently lost.
      if remaining_count = 0 then
        delete from exams where id = e.exam_id;
      end if;

      insert into _subject_level_repair_log
        (school_id, school_name, klass, section, subject_name, source_subject_id,
         target_subject_id, exam_id, target_exam_id, action, results_moved, conflicts, note)
      values
        (e.school_id, e.school_name, e.klass, e.target_section, e.subject_name,
         e.subject_id, target_subject_id, e.exam_id, target_exam_id,
         case when remaining_count = 0 then 'MERGED_EXAM' else 'MERGED_WITH_CONFLICTS' end,
         moved_count, conflict_count,
         case
           when remaining_count = 0 then 'All source results were moved to the level-specific exam.'
           else 'Conflicting student marks were preserved on the source exam for manual review.'
         end);
    end if;
  end loop;
end $$;

-- Kiriaini-focused verification: this shows all Junior Secondary exams
-- still pointing at a non-Junior subject after the repair. A correctly
-- repaired school should return zero rows here (apart from deliberately
-- preserved conflict exams, which will also appear in the repair log).
select
  sc.name as school,
  ex.klass,
  s.name as subject,
  s.code,
  s.section,
  ex.type,
  ex.term,
  ex.year,
  count(r.id) as marks
from exams ex
join schools sc on sc.id = ex.school_id
join subjects s on s.id = ex.subject_id
left join results r on r.exam_id = ex.id
where lower(sc.name) like '%kiriaini comprehensive school%'
  and class_section(ex.klass) = 'junior-secondary'
  and coalesce(s.section, '') <> 'junior-secondary'
group by sc.name, ex.klass, s.name, s.code, s.section, ex.type, ex.term, ex.year
order by ex.klass, s.name, ex.type, ex.term, ex.year;

-- Full repair log for every school.
select *
from _subject_level_repair_log
order by school_name, klass, subject_name, action;
