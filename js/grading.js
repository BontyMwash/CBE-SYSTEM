/* ============================================================
   grading.js — marks -> performance level, and aggregation
   helpers for report cards.
   ============================================================ */

const Grading = {
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

  average(values) {
    const nums = values.filter(v => typeof v === 'number' && !isNaN(v));
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  },

  // For a student, build subject x examType grid of percentages for a given term/year.
  // `st` is the already-fetched school bundle {subjects, exams, results, ...} —
  // pass it in rather than fetching here, since Store.current() is now async.
  buildStudentTermGrid(st, studentId, term, year) {
    const subjects = st.subjects;
    const examTypes = ['Opener', 'Midterm', 'Endterm'];
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
