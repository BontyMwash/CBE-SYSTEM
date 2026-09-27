# Broadsheet PDF page/header fix

Updated the downloadable Broadsheet PDF so that:

- The PDF footer no longer stamps `CLASS: ... · SUBJECTS: ... · Term ...` across the top of every page.
- The previously added bottom performance-summary block is not inserted into the downloadable student ledger.
- The student ledger is split into real PDF table pages before html2pdf captures it.
- Page 1 keeps the masthead and first student block.
- Page 2 and every following student page repeats the same compact table heading: POS., NAME, ADM. NO., subject columns, TOTAL MARKS, MEAN %, POINTS, LEVEL.
- The final student page keeps the Subject mean footer row.

This specifically addresses the requested PDF pagination/data presentation; it does not change the underlying student marks.
