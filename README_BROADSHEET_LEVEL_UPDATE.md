# Broadsheet layout + CBC level subject repair update

## Broadsheet
- Removed the extra PDF top header that was stamped above the broadsheet title.
- The first page starts with the normal school/broadsheet title, followed immediately by the learner table whose subject columns use the subject codes (AGR, ENG, KIS, MAT, PRE, SCI, etc.).
- The subject-code column header is the table `<thead>` and is configured to repeat on every printed page, so page 2 and later pages remain easy to read.
- The learner list remains independent from the Performance Analysis section; analysis starts on a new printed page.
- Subject Performance Summary remains at the bottom of the broadsheet and includes Subject, Class, Stream, Gender, Entries, Mean %, High %, Low %, and Performance/Level.
- Subject performance is percentage-based and ordered from highest mean percentage to lowest.
- The PDF footer no longer carries a second top/header information strip.

## Existing marks / subject levels
Run `sql/032_repair_subject_levels_and_marks.sql` once in Supabase SQL Editor.

It repairs existing exams/results so they point to the subject record for the learner's CBC level. Existing marks remain attached to their exams. If a duplicate sitting exists, non-conflicting marks are merged into the level-specific exam and conflicting marks are preserved for review.
