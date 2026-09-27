# Broadsheet Download PDF Fix

The actual defect was in the one-click **Download PDF** renderer, not the live broadsheet screen.

This revision changes only the PDF capture clone:

- deterministic local Arial/Helvetica font for the broadsheet PDF;
- normal 400 weight for table cells so small digits do not merge visually;
- tabular numerals and geometric text rendering;
- tighter but readable PDF cell padding/font sizing so percentages and totals have room;
- browser foreign-object rendering enabled for the broadsheet PDF capture where supported;
- live/on-screen broadsheet typography remains unchanged.

This targets the squeezed/doubled values visible in the downloaded PDF, including percentages and `marks / total` values.
