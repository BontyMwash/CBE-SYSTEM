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
