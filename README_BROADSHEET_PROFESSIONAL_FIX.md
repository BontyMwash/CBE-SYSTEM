# CBE SYSTEM — Professional Broadsheet Fix

This build fixes the broadsheet PDF/export layout and improves the printed presentation.

## Fixed
- Correct PDF column sizing: the export now measures the real subject/marks header row instead of the class-information row.
- Restores learner names, admission numbers, subject marks, totals, mean %, points and level columns in PDF exports.
- Prevents the broadsheet exporter from treating every learner row as a page-sized block.
- Removes the literal `&middot;` text appearing in the repeated class/subject header.
- Keeps the report in A4 landscape with a compact professional table layout.
- Preserves the existing Grade 6/duplicate-exam result-resolution logic from the previous build.
- Does not delete or migrate subjects, exams, learners, or results.

## Test
Open Broadsheet → choose the exam → Whole Class → Download PDF.
Confirm that each page contains the learner table columns and that multiple learners appear per page.

### Export polish update
- The downloaded PDF now uses a deterministic local sans-serif font for numeric cells during html2canvas capture, avoiding doubled/overlapping digits when the remote IBM Plex Mono web font is still loading.
- Student pages are balanced across the minimum number of landscape A4 pages, avoiding mostly blank pages such as a 14 + 3 + 17 + 3 learner split.

