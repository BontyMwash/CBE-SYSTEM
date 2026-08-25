/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   grading.js — marks -> performance level, and aggregation
   helpers for report cards.
   ============================================================ */

const Grading = {
  // Stand-in "band" for a student who has NO marks entered at all for
  // a sitting (as opposed to one who sat some subjects but not
  // others — that's a real, partial average, not this). Used
  // everywhere a real grading band would normally go — the badge/
  // stamp renders it as a plain amber "M" pill (see .badge-M in
  // style.css) so it reads as "still pending", distinct from both a
  // real grade and the grey "—" used for genuinely not-applicable
  // cells (e.g. a subject that isn't offered).
  MISSING_BAND: { code: 'M', label: 'Marks missing' },

  levelForMarks(marks, totalMarks, bands) {
    if (marks === null || marks === undefined || marks === '') return null;
    const pct = (Number(marks) / Number(totalMarks || 100)) * 100;
    const sorted = [...bands].sort((a, b) => b.min - a.min);
    for (const b of sorted) {
      if (pct >= b.min) return b;
    }
    return sorted[sorted.length - 1] || null;
  },

  percent(marks, totalMarks) {
    if (marks === null || marks === undefined || marks === '') return null;
    return (Number(marks) / Number(totalMarks || 100)) * 100;
  },

  // Points value for a grading band — used alongside the % and the
  // Level (band code) on report cards and the broadsheet, the way a
  // school's own points scale (e.g. a KCSE-style 1-12) works: the
  // best band earns the most points. A school sets its own points
  // per band in Settings -> Grading bands. For a school that hasn't
  // set any yet, falls back to ranking the bands by their minimum
  // score and spacing points evenly (1 = weakest band, N = strongest,
  // for N bands) so a number always shows, even before Settings has
  // been visited.
  pointsForBand(band, bands) {
    if (!band) return null;
    if (band.points !== undefined && band.points !== null && band.points !== '') return Number(band.points);
    const sorted = [...(bands || [])].sort((a, b) => a.min - b.min);
    const idx = sorted.findIndex(b => b.code === band.code);
    return idx === -1 ? null : idx + 1;
  },

  // Reverse of pointsForBand: given a mean POINTS value (e.g. the
  // average of several students'/entries' points — 4.7451, not a raw
  // %), find whichever configured band sits closest to it. Used for
  // the group-level "Grade" column on Performance Summary tables,
  // where the figure being graded is already an averaged points score
  // rather than one student's own percentage.
  bandForPoints(points, bands) {
    if (points === null || points === undefined || !bands || !bands.length) return null;
    let best = null, bestDiff = Infinity;
    bands.forEach(b => {
      const p = this.pointsForBand(b, bands);
      if (p === null || p === undefined) return;
      const diff = Math.abs(p - points);
      if (diff < bestDiff) { bestDiff = diff; best = b; }
    });
    return best;
  },

  // Sort-friendly numeric stand-in for a rank that may be the literal
  // string 'M' (missing marks) instead of a number — always sorts
  // after every real rank, in either sort direction.
  rankSortValue(rank) {
    return rank === 'M' ? Infinity : (rank ?? Infinity);
  },

  average(values) {
    const nums = values.filter(v => typeof v === 'number' && !isNaN(v));
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  },

  // Auto-generated remark for a report card, based purely on the
  // learner's overall percentage (not a specific band code) so it
  // still makes sense however a school has configured its grading
  // bands. `role` is 'teacher' or 'head' — the head's remark reads a
  // little more formal/summary-style than the class teacher's.
  autoComment(pct, role) {
    if (pct === null || pct === undefined || isNaN(pct)) {
      return role === 'head'
        ? 'Results for this sitting are not yet complete.'
        : 'Not enough marks have been recorded yet to comment on performance.';
    }
    if (pct >= 80) {
      return role === 'head'
        ? 'An excellent overall result. Keep up this standard.'
        : 'Excellent work this term — keep up the consistency and hard work.';
    }
    if (pct >= 65) {
      return role === 'head'
        ? 'A very good result. Encourage the learner to keep pushing.'
        : 'A very good performance. A little more effort in weaker areas can push this even higher.';
    }
    if (pct >= 50) {
      return role === 'head'
        ? 'A satisfactory result overall.'
        : 'A fair, solid performance. More consistent revision would help raise this further.';
    }
    if (pct >= 30) {
      return role === 'head'
        ? 'Performance is below expectation — needs closer support.'
        : 'The learner is approaching expectation but needs closer guidance and more practice.';
    }
    return role === 'head'
      ? 'Performance needs urgent attention and support.'
      : 'The learner needs significant extra support and remedial attention to improve.';
  },

  // Ordered list of exam type names for a school — from its own
  // admin-defined exam_types list, falling back to whatever exam type
  // text already shows up on its exams if none have been set up yet.
  examTypeNames(st) {
    if (st.examTypes && st.examTypes.length) return st.examTypes.map(t => t.name);
    return [...new Set(st.exams.map(e => e.type))].sort();
  },

  // For a student, build subject x examType grid of percentages for a given term/year.
  // `st` is the already-fetched school bundle {subjects, exams, results, ...} —
  // pass it in rather than fetching here, since Store.current() is now async.
  // Exam types come from the school's own admin-defined list (st.examTypes)
  // instead of a hard-coded Opener/Midterm/Endterm array, so this grid grows
  // or shrinks with however many sittings the school actually uses.
  buildStudentTermGrid(st, studentId, term, year) {
    const subjects = st.subjects;
    const examTypes = this.examTypeNames(st);
    const grid = subjects.map(subj => {
      const row = { subject: subj, cells: {} , average: null};
      const pcts = [];
      examTypes.forEach(type => {
        const exam = st.exams.find(e => e.subjectId === subj.id && e.type === type && e.term === term && String(e.year) === String(year));
        if (!exam) { row.cells[type] = null; return; }
        const res = st.results.find(r => r.examId === exam.id && r.studentId === studentId);
        const pct = res ? this.percent(res.marks, exam.totalMarks) : null;
        row.cells[type] = pct === null ? null : { pct, marks: res.marks, totalMarks: exam.totalMarks, examId: exam.id };
        if (pct !== null) pcts.push(pct);
      });
      row.average = this.average(pcts);
      return row;
    });
    return grid;
  }
};
