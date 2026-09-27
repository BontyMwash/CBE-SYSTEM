# CBE System – Final Marks & Independent Subjects Fix

This build keeps existing exam/result records intact while allowing subjects to be created independently for Lower Primary, Upper Primary, Junior Secondary and Senior School.

## Included fixes
- Existing Upper Primary subjects, exams and marks are not migrated, deleted or reassigned when a new subject is created.
- Existing exams continue to use their original `subject_id`, so their recorded results remain attached.
- New subjects are scoped to the selected school level/section.
- Marks are loaded from the existing exam IDs on refresh.
- Automatic mark saving remains enabled.
- Temporary browser/network `Failed to fetch` errors during result save are retried up to three times with a short backoff.
- Database/RLS errors are still surfaced instead of being hidden.

## Important
Do not delete existing subjects that already have exams/results. Create new subjects in the appropriate level instead.

## Level/marks repair migration

A new migration has been added:

`sql/032_repair_subject_levels_and_marks.sql`

Run it once in Supabase SQL Editor. It repairs existing exams/results so
Grade 7–9 marks use Junior Secondary subject records, Grade 4–6 marks use
Upper Primary records, Grade 1–3 marks use Lower Primary records, and
Grade 10–12 marks use Senior School records. It creates a level-specific
subject when one is missing and moves exams without changing the recorded
marks. Duplicate sittings are merged student-by-student; conflicting marks
are preserved and reported instead of being deleted.

The script includes a Kiriaini Comprehensive School verification query.
