# Broadsheet Class + Subject Header + Existing Marks Fix

This version includes three broadsheet corrections:

1. **Class identification on every printed/PDF page**
   - The broadsheet table repeats a compact `CLASS / SUBJECTS / EXAM / TERM / YEAR` header through the table header.
   - The downloadable PDF also stamps the same class/subject information at the top of every PDF page.

2. **Existing Upper Primary marks are preserved/displayed**
   - Broadsheet subject columns are resolved by subject name within the selected sitting, rather than by subject database ID alone.
   - This handles older subject records and newer independently-created Upper Primary subject records that share the same name.
   - If duplicate exam records exist for the same subject, stream, exam type, term and year, the display uses the exam containing the most saved results. No exam, subject or result is deleted or moved by this display logic.

3. **Existing marks remain attached to their original exam records**
   - Agriculture, English, Science and other subjects with previously entered marks can therefore appear in the JEMSA/JESMA sitting even when an additional duplicate subject record exists.

The rest of the previous marks-save, subject-separation and class/stream broadsheet fixes are retained.
