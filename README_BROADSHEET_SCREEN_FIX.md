# Broadsheet screen readability fix

Fixed the live broadsheet table where numeric cells (percentages, totals,
admission numbers and positions) appeared visually compressed/overlapped.

Changes:
- Added a sensible minimum table width so the browser does not squeeze all
  subject columns into tiny cells.
- Kept horizontal scrolling available for narrower screens.
- Switched broadsheet numeric cells from the compact monospace face to the
  normal UI font with tabular figures.
- Normalized font weight, letter spacing and line height for numeric cells.
- Gave Total Marks, Mean %, Points and Level slightly more room.
- Kept the print/PDF layout independent of the screen minimum width.
