# Broadsheet PDF — Class Performance Level Distribution Fix

The downloaded broadsheet PDF now calculates **Class Performance Level Distribution** from each learner's actual overall Mean % for the selected sitting and maps that mean through the configured grading bands.

This avoids the previous whole-class/stream-union problem where a learner could have valid marks and a valid overall level (for example AE2), but an unavailable subject column from another stream caused the learner to be treated as incomplete and excluded from every real level. That produced 0 counts across all levels in the PDF.

Learners with no marks at all remain unclassified and are not forced into a real performance band.
