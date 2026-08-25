/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   broadsheet.js — class broadsheet: every student x every
   subject for one exam sitting (type/term/year/class), with
   totals, mean %, rank position, and overall level.

   Table supports: live search (name/adm. no.), achievement-level
   filter, click-to-sort columns, sticky header + frozen Pos./Name
   columns for long class lists, CSV / Excel / PDF export, AND
   inline spreadsheet-style mark entry ("Edit marks") across every
   subject a teacher is authorized for, with per-row live totals,
   validation, an unsaved-changes indicator, and a batch Save/
   Cancel workflow. A published (locked) sitting can't be edited
   here — unpublish it from Analysis first, same rule as the
   single-subject Marks Entry screen.
   ============================================================ */

Views.broadsheet = async function () {
  setTopbarActions('');
  showLoading();
  let st = await Store.current();
  const user = Auth.currentUser();
  // Broadsheet exposes every subject for a whole class — only reachable
  // in the nav for class teachers (see auth.js), and even then scoped
  // to just the class(es) they hold, not the whole school. Editing marks
  // here is further scoped per-subject (scope.subjectIds), same rule as
  // the single-subject Marks Entry screen.
  const scope = teacherScope(st, user);

  if (st.students.length === 0 || st.exams.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">Nothing to show yet</div><p>Add students and record at least one exam first.</p></div>`;
    return;
  }
  if (scope.isTeacher && scope.classLabels.size === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">No classes assigned to you yet</div><p>Ask your administrator to assign your class(es) from the Users page.</p></div>`;
    return;
  }

  const classes = scope.isTeacher ? [...scope.classLabels].sort() : classesFromStudents(st.students);

  document.getElementById('content').innerHTML = `
    <div class="filter-row no-print">
      <select id="bsClass"><option value="">Select class</option>${classes.map(c => `<option value="${UI.esc(c)}">${UI.esc(c)}</option>`).join('')}</select>
      <select id="bsType">
        <option value="">Select exam type</option>
        ${st.examTypes.map(t => `<option value="${UI.esc(t.name)}">${UI.esc(t.name)}</option>`).join('')}
      </select>
      <select id="bsTerm">
        ${['Term 1', 'Term 2', 'Term 3'].map(t => `<option value="${t}" ${st.settings.term === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <input type="number" id="bsYear" value="${st.settings.year}" style="width:90px;">
      <button class="btn" id="bsCsvBtn"><i class="fa-solid fa-download"></i> CSV</button>
      <button class="btn" id="bsExcelBtn"><i class="fa-solid fa-file-excel"></i> Excel</button>
      <button class="btn btn-brass" id="bsPrintBtn">Print / Save as PDF</button>
      <button class="btn btn-brass" id="bsPdfBtn"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
    </div>
    <p class="field-hint no-print" style="margin-bottom:14px;">Tip: choose "Landscape" in the print dialog for a wide class list.</p>
    <div id="bsWrap"></div>
  `;

  const classSel = document.getElementById('bsClass');
  const typeSel = document.getElementById('bsType');
  const termSel = document.getElementById('bsTerm');
  const yearSel = document.getElementById('bsYear');

  let lastCsv = null; // set inside render(); read by the CSV/Excel buttons
  // Table-only state — re-applied without recomputing the whole
  // sitting (search/sort/level filter never change the underlying data,
  // only which rows show and in what order).
  const tableState = { search: '', level: 'all', sortKey: 'rank', sortDir: 'asc' };
  let editMode = false;
  const pending = new Map(); // `${examId}::${studentId}` -> {examId, studentId, marks}

  // Guards against silently discarding unsaved marks when the sitting
  // (class/type/term/year) is changed mid-edit or the tab is closed.
  function guardedChange(selectEl) {
    selectEl.addEventListener('mousedown', () => { selectEl.dataset.prev = selectEl.value; });
    selectEl.onchange = () => {
      const prevValue = selectEl.dataset.prev ?? selectEl.value;
      if (pending.size > 0) {
        const newValue = selectEl.value;
        selectEl.value = prevValue; // revert now; only apply if the user confirms below
        UI.confirmAction(
          `You have ${pending.size} unsaved change${pending.size === 1 ? '' : 's'}. Discard them and switch?`,
          () => { pending.clear(); editMode = false; window.onbeforeunload = null; selectEl.value = newValue; render(); },
          { confirmLabel: 'Discard and switch', confirmClass: 'btn-danger' }
        );
      } else {
        render();
      }
    };
  }
  [classSel, typeSel, termSel, yearSel].forEach(guardedChange);

  function render() {
    lastCsv = null;
    editMode = false;
    pending.clear();
    window.onbeforeunload = null;
    const klass = classSel.value;
    const type = typeSel.value;
    const term = termSel.value;
    const year = yearSel.value;
    const wrap = document.getElementById('bsWrap');
    tableState.search = ''; tableState.level = 'all'; tableState.sortKey = 'rank'; tableState.sortDir = 'asc';

    if (!klass || !type) {
      wrap.innerHTML = `<div class="empty"><div class="empty-title">Choose a class and exam type</div><p>The broadsheet will list every student against every subject sat for that exam.</p></div>`;
      return;
    }

    // Subjects that actually have an exam matching this class/type/term/year
    const matchingExams = st.exams.filter(e =>
      e.klass === klass && e.type === type && e.term === term && String(e.year) === String(year)
    );
    if (matchingExams.length === 0) {
      wrap.innerHTML = `<div class="empty"><div class="empty-title">No ${UI.esc(type)} exams found</div><p>for ${UI.esc(klass)} in ${UI.esc(term)} ${UI.esc(year)}. Create exams for this sitting first.</p></div>`;
      return;
    }
    const subjectCols = matchingExams
      .map(e => ({ exam: e, subject: st.subjects.find(s => s.id === e.subjectId) }))
      .filter(c => c.subject)
      .sort((a, b) => a.subject.name.localeCompare(b.subject.name));

    const students = st.students.filter(s => s.klass === klass).sort((a, b) => a.name.localeCompare(b.name));

    // A published sitting is locked everywhere marks can be entered
    // (this table included) — unpublish it from Analysis first.
    const locked = (st.published || []).some(p => p.klass === klass && p.type === type && p.term === term && String(p.year) === String(year));
    const canEditCol = (col) => !scope.isTeacher || scope.subjectIds.has(col.subject.id);
    const canEditAny = !locked && subjectCols.some(canEditCol);

    // Build per-student rows
    const rows = students.map(stu => {
      const cells = subjectCols.map(col => {
        const res = st.results.find(r => r.examId === col.exam.id && r.studentId === stu.id) || null;
        if (!res) return { marks: null, pct: null, totalMarks: col.exam.totalMarks };
        return { marks: res.marks, pct: Grading.percent(res.marks, col.exam.totalMarks), totalMarks: col.exam.totalMarks };
      });
      const enteredCells = cells.filter(c => c.marks !== null);
      const validPcts = enteredCells.map(c => c.pct);
      // Total marks = raw marks obtained across subjects sat (out of the raw
      // marks possible for those same subjects) — not a percentage.
      const totalObtained = enteredCells.length ? enteredCells.reduce((a, c) => a + Number(c.marks), 0) : null;
      const totalPossible = enteredCells.length ? enteredCells.reduce((a, c) => a + Number(c.totalMarks), 0) : null;
      const meanPct = Grading.average(validPcts);
      // Complete = a mark entered for every subject on this sitting. A
      // student missing even one subject still gets a real (partial)
      // Mean/Total above — those are left alone — but the Level badge
      // below is awarded Z rather than a grade band computed off an
      // incomplete record.
      const complete = subjectCols.length > 0 && enteredCells.length === subjectCols.length;
      return { student: stu, cells, totalObtained, totalPossible, meanPct, complete };
    });

    // Rank by mean % (descending), ties share a rank. A student
    // missing ANY subject's mark for this sitting — not just one with
    // zero marks entered at all — isn't ranked off a partial average:
    // they sort below every student with a complete record and get
    // 'Z' instead of a number, so an incomplete sitting can't outrank
    // a classmate who actually finished, no matter how high the
    // partial score looks.
    const ranked = [...rows].sort((a, b) => {
      if (!a.complete && !b.complete) return 0;
      if (!a.complete) return 1;
      if (!b.complete) return -1;
      return (b.meanPct ?? -1) - (a.meanPct ?? -1);
    });
    let rank = 0, lastMean = null, seen = 0;
    const rankMap = new Map();
    ranked.forEach(r => {
      seen++;
      if (!r.complete) { rankMap.set(r.student.id, 'Z'); return; }
      if (r.meanPct !== lastMean) { rank = seen; lastMean = r.meanPct; }
      rankMap.set(r.student.id, rank);
    });

    // Attach rank/band/points once so filtering/sorting never recomputes them.
    // Level is Z for anyone missing at least one subject's mark — not
    // just students with zero marks at all — since a band computed
    // off a partial record isn't a real grade yet.
    const rowsExtra = ranked.map(r => {
      const band = !r.complete ? Grading.MISSING_BAND : Grading.levelForMarks(r.meanPct, 100, st.settings.gradingBands);
      const points = !r.complete ? null : Grading.pointsForBand(band, st.settings.gradingBands);
      return { ...r, rank: rankMap.get(r.student.id), band, points };
    });

    lastCsv = {
      filename: `broadsheet-${klass}-${type}-${term}-${year}`.replace(/\s+/g, '_'),
      header: ['Pos.', 'Name', 'Adm. No.', ...subjectCols.map(c => c.subject.name), 'Total Marks', 'Mean %', 'Points', 'Level'],
      rows: rowsExtra.map(r => [
        r.rank, r.student.name, r.student.admissionNo || '',
        ...r.cells.map(c => c.pct === null ? '' : c.pct.toFixed(1)),
        r.totalObtained === null ? '' : `${r.totalObtained}/${r.totalPossible}`,
        r.meanPct === null ? 'Z' : r.meanPct.toFixed(1),
        r.points === null ? '' : r.points,
        r.band ? r.band.code : ''
      ])
    };

    // Class-level subject averages (bottom row)
    const subjectAverages = subjectCols.map((col, i) => {
      const pcts = rows.map(r => r.cells[i].pct).filter(v => v !== null);
      return Grading.average(pcts);
    });
    const classMean = Grading.average(rows.map(r => r.meanPct).filter(v => v !== null));
    const classMeanPoints = Grading.average(rowsExtra.map(r => r.points).filter(v => v !== null));

    /* ---- Subject performance: mean/high/low/entries for each
       subject sat, so a teacher/admin can see which subjects are
       dragging the class down without leaving the broadsheet. ---- */
    const subjectStats = subjectCols.map((col, i) => {
      const pcts = rows.map(r => r.cells[i].pct).filter(v => v !== null);
      return {
        subject: col.subject,
        mean: Grading.average(pcts),
        high: pcts.length ? Math.max(...pcts) : null,
        low: pcts.length ? Math.min(...pcts) : null,
        entered: pcts.length,
        expected: students.length
      };
    }).sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1));

    /* ---- Class performance: headline stats for this one class/
       stream at this sitting. ---- */
    const validMeans = rows.map(r => r.meanPct).filter(v => v !== null);
    const classHigh = validMeans.length ? Math.max(...validMeans) : null;
    const classLow = validMeans.length ? Math.min(...validMeans) : null;
    const passRate = validMeans.length ? (validMeans.filter(v => v >= 50).length / validMeans.length) * 100 : null;
    const expectedEntries = students.length * subjectCols.length;
    const enteredEntries = subjectCols.reduce((sum, col) => sum + st.results.filter(r => r.examId === col.exam.id).length, 0);
    const completion = expectedEntries > 0 ? (enteredEntries / expectedEntries) * 100 : null;
    const bandCounts = [...(st.settings.gradingBands || [])].sort((a, b) => b.min - a.min).map(b => ({
      band: b, count: rowsExtra.filter(r => r.band && r.band.code === b.code).length
    }));
    const totalBandCount = bandCounts.reduce((s, b) => s + b.count, 0) || 1;

    /* ---- Stream performance: how this class's streams compare to
       each other for the SAME exam type/term/year — e.g. "Grade 7
       East" vs "Grade 7 West". Only shown when the class actually
       has more than one stream to compare against. ---- */
    const classEntry = st.classes.find(c => c.label === klass);
    const gradeName = classEntry ? classEntry.name : klass;
    const streamLabels = st.classes && st.classes.length
      ? st.classes.filter(c => c.name === gradeName).map(c => c.label)
      : [klass];

    const streamStats = streamLabels.map(label => {
      const streamExams = st.exams.filter(e => e.klass === label && e.type === type && e.term === term && String(e.year) === String(year));
      const streamCols = streamExams.map(e => ({ exam: e, subject: st.subjects.find(s => s.id === e.subjectId) })).filter(c => c.subject);
      const streamStudents = st.students.filter(s => s.klass === label);
      const means = streamStudents.map(stu => {
        const pcts = streamCols.map(col => {
          const res = st.results.find(r => r.examId === col.exam.id && r.studentId === stu.id);
          return res ? Grading.percent(res.marks, col.exam.totalMarks) : null;
        }).filter(v => v !== null);
        return Grading.average(pcts);
      }).filter(v => v !== null);
      return { label, studentsCount: streamStudents.length, mean: Grading.average(means) };
    }).sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1));
    const showStreamSection = streamStats.length > 1;

    /* ---- Performance Summary: the classic paper-broadsheet view —
       Stream / Gender / Subject breakdowns of achievement-band counts
       across the WHOLE grade (every stream sharing this class's grade
       name, same sitting), each with an Entry count, a count per
       achievement band, a points-based Mean, and a Grade for the
       group. Spans the whole grade rather than just the selected
       stream since that's what the paper version compares.

       Z is this system's stand-in for "no marks entered at all"
       (Grading.MISSING_BAND — same badge used everywhere else in the
       app). It's counted in each row's Entry and shown as its own Z
       column, but deliberately left OUT of the group's points-based
       Mean — a learner with nothing recorded yet isn't a genuine
       bottom score, so including them would understate the group's
       real performance rather than reflect it. ---- */
    const gradeBands = st.settings.gradingBands || [];
    const orderedBandCodes = [...gradeBands].sort((a, b) => b.min - a.min).map(b => b.code);
    const pointsOf = (band) => Grading.pointsForBand(band, gradeBands);

    // Every learner across the whole grade, each with their own overall
    // band for this sitting (computed from THEIR OWN class's matching
    // exams, since streams can carry different subjects) — MISSING_BAND
    // (Z) stands in for no marks entered at all for the sitting.
    const gradeStudents = st.students.filter(s => streamLabels.includes(s.klass));
    const studentBand = new Map();
    gradeStudents.forEach(stu => {
      const classExams = st.exams.filter(e => e.klass === stu.klass && e.type === type && e.term === term && String(e.year) === String(year));
      const pcts = classExams.map(e => {
        const res = st.results.find(r => r.examId === e.id && r.studentId === stu.id);
        return res ? Grading.percent(res.marks, e.totalMarks) : null;
      }).filter(v => v !== null);
      const avg = Grading.average(pcts);
      studentBand.set(stu.id, avg === null ? Grading.MISSING_BAND : Grading.levelForMarks(avg, 100, gradeBands));
    });

    function summarizeStudents(studentIds) {
      const bandCounts = {};
      gradeBands.forEach(b => { bandCounts[b.code] = 0; });
      let missing = 0;
      const pointsList = [];
      studentIds.forEach(id => {
        const band = studentBand.get(id);
        if (!band || band.code === Grading.MISSING_BAND.code) {
          // No marks entered at all — flagged with Z and counted in
          // Entry, but left OUT of the points list entirely: a
          // learner with nothing recorded isn't a genuine bottom
          // score, and folding them in at 0 would drag the group's
          // Mean down for a reason that has nothing to do with
          // performance.
          missing++;
          return;
        }
        bandCounts[band.code] = (bandCounts[band.code] || 0) + 1;
        const pts = pointsOf(band);
        if (pts !== null && pts !== undefined) pointsList.push(pts);
      });
      const mean = Grading.average(pointsList);
      return { entry: studentIds.length, bandCounts, z: missing, mean, grade: mean === null ? null : Grading.bandForPoints(mean, gradeBands) };
    }

    const streamSummary = streamLabels.map(label => {
      const cls = st.classes.find(c => c.label === label);
      const ids = gradeStudents.filter(s => s.klass === label).map(s => s.id);
      return { label, teacherName: cls ? cls.teacherName : '', ...summarizeStudents(ids) };
    });

    const genderBuckets = [
      { label: 'BOYS', ids: gradeStudents.filter(s => s.gender === 'M').map(s => s.id) },
      { label: 'GIRLS', ids: gradeStudents.filter(s => s.gender === 'F').map(s => s.id) },
    ];
    const unspecified = gradeStudents.filter(s => s.gender !== 'M' && s.gender !== 'F').map(s => s.id);
    if (unspecified.length) genderBuckets.push({ label: 'NOT SPECIFIED', ids: unspecified });
    const genderSummary = genderBuckets.map(g => ({ label: g.label, teacherName: '', ...summarizeStudents(g.ids) }));

    // Subject rows: union of every subject sat anywhere in the grade for
    // this sitting — counted from actual entered marks (not headcount),
    // so Entry here is "how many sat/were marked", same as the paper
    // version's subject table.
    const gradeExams = st.exams.filter(e => streamLabels.includes(e.klass) && e.type === type && e.term === term && String(e.year) === String(year));
    const subjectIds = [...new Set(gradeExams.map(e => e.subjectId))];
    const subjectSummary = subjectIds.map(sid => {
      const subject = st.subjects.find(s => s.id === sid);
      if (!subject) return null;
      const bandCounts = {};
      gradeBands.forEach(b => { bandCounts[b.code] = 0; });
      const pointsList = [];
      let entry = 0;
      gradeExams.filter(e => e.subjectId === sid).forEach(e => {
        st.results.filter(r => r.examId === e.id).forEach(r => {
          entry++;
          const pct = Grading.percent(r.marks, e.totalMarks);
          const band = Grading.levelForMarks(pct, 100, gradeBands);
          if (!band) return;
          bandCounts[band.code] = (bandCounts[band.code] || 0) + 1;
          const pts = pointsOf(band);
          if (pts !== null && pts !== undefined) pointsList.push(pts);
        });
      });
      const mean = Grading.average(pointsList);
      return { label: subject.name, teacherName: '', entry, bandCounts, z: 0, mean, grade: mean === null ? null : Grading.bandForPoints(mean, gradeBands) };
    }).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label));

    const overallSummary = { label: 'OVERALL', teacherName: '', ...summarizeStudents(gradeStudents.map(s => s.id)) };
    const showSummary = gradeBands.length > 0 && gradeStudents.length > 0;

    function summaryRowHtml(r, showTeacher) {
      return `<tr ${r.label === 'OVERALL' ? 'style="font-weight:600;"' : ''}>
        <td>${UI.esc(r.label)}</td>
        <td class="num">${r.entry}</td>
        ${orderedBandCodes.map(code => `<td class="num">${r.bandCounts[code] || 0}</td>`).join('')}
        <td class="num">${r.z}</td>
        <td class="num">${r.mean === null ? '—' : r.mean.toFixed(4)}</td>
        <td>${UI.badge(r.grade)}</td>
        ${showTeacher ? `<td>${UI.esc(r.teacherName) || '—'}</td>` : ''}
      </tr>`;
    }

    function summaryTableHtml(groupHeader, rows, opts = {}) {
      const showTeacher = !!opts.showTeacher;
      return `
        <div class="ledger" style="margin-bottom:18px;">
          <div class="ledger-scroll">
            <table class="ledger-table">
              <thead><tr>
                <th>${UI.esc(groupHeader)}</th>
                <th>Entry</th>
                ${orderedBandCodes.map(code => `<th>${UI.esc(code)}</th>`).join('')}
                <th title="Learners with no marks entered at all for this sitting — counted in Entry and Z, excluded from Mean">Z</th>
                <th>Mean</th>
                <th>Grade</th>
                ${showTeacher ? '<th>Class Teacher</th>' : ''}
              </tr></thead>
              <tbody>${rows.map(r => summaryRowHtml(r, showTeacher)).join('')}</tbody>
            </table>
          </div>
        </div>
      `;
    }

    // ---- filter + sort the display rows (search box / level select /
    // sortable column headers) without touching the underlying stats
    // above, which always reflect the whole class regardless of filter ----
    function visibleRows() {
      let list = rowsExtra;
      if (tableState.level !== 'all') {
        list = list.filter(r => r.band && r.band.code === tableState.level);
      }
      if (tableState.search.trim()) {
        const q = tableState.search.trim().toLowerCase();
        list = list.filter(r => r.student.name.toLowerCase().includes(q) || (r.student.admissionNo || '').toLowerCase().includes(q));
      }
      const dir = tableState.sortDir === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        if (tableState.sortKey === 'name') return dir * a.student.name.localeCompare(b.student.name);
        // Rows missing at least one subject's mark ('Z') always sort
        // to the bottom, in either column and either sort direction —
        // reversing direction shouldn't put an incomplete record
        // ahead of a real, if low, complete score.
        if (tableState.sortKey === 'mean') {
          if (!a.complete && !b.complete) return 0;
          if (!a.complete) return 1;
          if (!b.complete) return -1;
          return dir * (a.meanPct - b.meanPct);
        }
        if (a.rank === 'Z' && b.rank === 'Z') return 0;
        if (a.rank === 'Z') return 1;
        if (b.rank === 'Z') return -1;
        return dir * (a.rank - b.rank);
      });
      return list;
    }

    // One editable subject cell: an input if this column is editable and
    // we're in edit mode, else the usual read-only percentage.
    function subjectCellHtml(row, col) {
      const idx = subjectCols.indexOf(col);
      const c = row.cells[idx];
      const editable = editMode && canEditCol(col);
      if (!editable) {
        return `<td class="num subj-cell" data-max="${col.exam.totalMarks}" data-marks="${c.marks === null ? '' : c.marks}" ${c.marks !== null ? `title="${c.marks}/${c.totalMarks} raw"` : ''}>${c.pct === null ? '<span class="row-index">—</span>' : c.pct.toFixed(1) + '%'}</td>`;
      }
      const key = `${col.exam.id}::${row.student.id}`;
      const overridden = pending.get(key);
      const val = overridden ? overridden.marks : (c.marks === null ? '' : c.marks);
      return `<td class="subj-cell" data-max="${col.exam.totalMarks}" data-marks="${val === '' ? '' : val}">
        <input type="number" class="mark-input-compact ${overridden ? 'dirty' : ''}" min="0" max="${col.exam.totalMarks}"
          data-exam="${col.exam.id}" data-student="${row.student.id}" data-max="${col.exam.totalMarks}" value="${val}">
      </td>`;
    }

    function rowsHtml(list) {
      if (list.length === 0) {
        return `<tr><td colspan="${5 + subjectCols.length}" style="text-align:center; color:var(--ink-soft); padding:24px;">No students match the current search / filter.</td></tr>`;
      }
      return list.map(r => `<tr>
        <td class="num freeze-1">${r.rank === 'Z' ? UI.badge(Grading.MISSING_BAND) : r.rank}</td>
        <td class="freeze-2">${UI.esc(r.student.name)}</td>
        <td class="num">${UI.esc(r.student.admissionNo) || '—'}</td>
        ${subjectCols.map(col => subjectCellHtml(r, col)).join('')}
        <td class="num" data-total-cell>${r.totalObtained === null ? '—' : `${r.totalObtained}/${r.totalPossible}`}</td>
        <td class="num" data-mean-cell>${r.meanPct === null ? UI.badge(Grading.MISSING_BAND) : r.meanPct.toFixed(1) + '%'}</td>
        <td class="num" data-points-cell>${r.points === null ? '—' : r.points}</td>
        <td data-level-cell>${UI.badge(r.band)}</td>
      </tr>`).join('');
    }

    function sortArrow(key) {
      if (tableState.sortKey !== key) return '';
      return `<i class="fa-solid fa-arrow-${tableState.sortDir === 'asc' ? 'up' : 'down'} sort-arrow"></i>`;
    }

    wrap.innerHTML = `
      <div class="filter-row no-print" style="margin-bottom:12px;">
        <input type="text" id="bsSearch" placeholder="Search learner name or adm. no…" style="min-width:220px;">
        <select id="bsLevel">
          <option value="all">All achievement levels</option>
          ${(st.settings.gradingBands || []).map(b => `<option value="${UI.esc(b.code)}">${UI.esc(b.code)} — ${UI.esc(b.label)}</option>`).join('')}
          <option value="Z">Z — Marks missing</option>
        </select>
        <button class="btn" id="bsResetBtn"><i class="fa-solid fa-rotate-left"></i> Reset filters</button>
        ${canEditAny ? `
          <button class="btn" id="bsEditBtn"><i class="fa-solid fa-pen"></i> Edit marks</button>
          <button class="btn btn-primary" id="bsSaveBtn" style="display:none;" disabled><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
          <button class="btn btn-danger" id="bsCancelBtn" style="display:none;">Cancel Changes</button>
          <span class="unsaved-pill" id="bsUnsavedPill" style="display:none;"><i class="fa-solid fa-circle-exclamation"></i> 0 unsaved changes</span>
        ` : locked ? `<span class="field-hint"><i class="fa-solid fa-lock"></i> Marks are locked — this sitting is published. Unpublish it from Analysis to edit.</span>` : ''}
        <span id="bsCount" class="field-hint" style="margin-left:auto;"></span>
      </div>
      <div class="ledger" id="bsPrintArea">
        <div style="padding:16px 16px 0 16px;">${buildReportMastheadHTML(st, `Broadsheet — ${klass}`, `${type} Results`, term, year)}</div>
        <div class="ledger-scroll ledger-scroll-y">
          <table class="ledger-table">
            <thead>
              <tr>
                <th class="sortable freeze-1" data-sort="rank" data-label="Pos.">Pos. ${sortArrow('rank')}</th>
                <th class="sortable freeze-2" data-sort="name" data-label="Name">Name ${sortArrow('name')}</th>
                <th>Adm. No.</th>
                ${subjectCols.map(c => `<th title="${UI.esc(c.subject.name)}">${UI.esc(c.subject.code || c.subject.name)}${editMode && !canEditCol(c) ? ' <i class="fa-solid fa-lock" title="Not your subject to edit" style="font-size:10px; opacity:0.6;"></i>' : ''}</th>`).join('')}
                <th>Total Marks</th>
                <th class="sortable" data-sort="mean" data-label="Mean %">Mean % ${sortArrow('mean')}</th>
                <th>Points</th>
                <th>Level</th>
              </tr>
            </thead>
            <tbody id="bsTbody">
              ${rowsHtml(visibleRows())}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" style="font-weight:600;">Subject mean</td>
                ${subjectAverages.map(a => {
                  const band = a === null ? null : Grading.levelForMarks(a, 100, st.settings.gradingBands);
                  return `<td class="num" style="font-weight:600;">${a === null ? '—' : a.toFixed(1)}${a === null ? '' : `<br>${UI.badge(band)}`}</td>`;
                }).join('')}
                <td></td>
                <td class="num" style="font-weight:600;">${classMean === null ? '—' : classMean.toFixed(1)}</td>
                <td class="num" style="font-weight:600;">${classMeanPoints === null ? '—' : classMeanPoints.toFixed(1)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        ${buildPrintFooterHTML()}
      </div>
      <p class="field-hint no-print" style="margin-top:10px;">
        ${UI.esc(klass)} &middot; ${UI.esc(type)} &middot; ${UI.esc(term)} ${UI.esc(year)} &middot;
        ${students.length} student${students.length === 1 ? '' : 's'} &middot; ${subjectCols.length} subject${subjectCols.length === 1 ? '' : 's'}
        ${editMode ? ' &middot; Editing — totals below update as you type; positions refresh after you save.' : ''}
      </p>

      <div id="bsAnalysisArea" style="margin-top:28px;">
        <div class="section-title">Performance analysis</div>

        <div class="grid grid-4 section-block">
          <div class="card stat-card grad-indigo">
            <i class="fa-solid fa-user-graduate stat-icon"></i>
            <p class="stat-label">Students</p>
            <p class="stat-value">${students.length}</p>
            <p class="stat-sub">${subjectCols.length} subject${subjectCols.length === 1 ? '' : 's'} sat</p>
          </div>
          <div class="card stat-card ${classMean !== null && classMean < 50 ? 'grad-danger' : 'grad-success'}">
            <i class="fa-solid fa-chart-line stat-icon"></i>
            <p class="stat-label">Class mean</p>
            <p class="stat-value">${classMean === null ? '—' : classMean.toFixed(1) + '%'}</p>
            <p class="stat-sub">${classHigh === null ? '\u00a0' : `High ${classHigh.toFixed(1)}% &middot; Low ${classLow.toFixed(1)}%`}</p>
          </div>
          <div class="card stat-card grad-teal">
            <i class="fa-solid fa-thumbs-up stat-icon"></i>
            <p class="stat-label">Pass rate (&ge;50%)</p>
            <p class="stat-value">${passRate === null ? '—' : passRate.toFixed(0) + '%'}</p>
            <p class="stat-sub">&nbsp;</p>
          </div>
          <div class="card stat-card plain hoverable">
            <i class="fa-solid fa-list-check stat-icon"></i>
            <p class="stat-label">Marks entered</p>
            <p class="stat-value" style="font-size:20px;">${completion === null ? '—' : completion.toFixed(0) + '%'}</p>
            <p class="stat-sub">${enteredEntries} / ${expectedEntries} entries</p>
          </div>
        </div>

        <div class="grid grid-2 section-block">
          <div>
            <div class="section-title">Subject performance</div>
            ${subjectStats.length === 0 ? `<div class="empty"><div class="empty-title">No subjects sat</div></div>` : `
            <div class="ledger">
              <div class="ledger-scroll">
                <table class="ledger-table">
                  <thead><tr><th>Subject</th><th>Mean</th><th>High</th><th>Low</th><th>Entries</th></tr></thead>
                  <tbody>
                    ${subjectStats.map(s => `<tr>
                      <td>${UI.esc(s.subject.name)}</td>
                      <td class="num">${s.mean === null ? '—' : s.mean.toFixed(1) + '%'}</td>
                      <td class="num">${s.high === null ? '—' : s.high.toFixed(1) + '%'}</td>
                      <td class="num">${s.low === null ? '—' : s.low.toFixed(1) + '%'}</td>
                      <td class="num">${s.entered}/${s.expected}</td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>`}
          </div>

          <div>
            <div class="section-title">Class performance level distribution</div>
            ${bandCounts.length === 0 ? `<div class="empty"><div class="empty-title">No grading bands set up</div></div>` : `
            <div class="ledger">
              <div class="ledger-scroll">
                <table class="ledger-table">
                  <thead><tr><th>Level</th><th>Description</th><th>Students</th><th>% of class</th></tr></thead>
                  <tbody>
                    ${bandCounts.map(b => `<tr>
                      <td>${UI.badge(b.band)}</td>
                      <td>${UI.esc(b.band.label)}</td>
                      <td class="num">${b.count}</td>
                      <td class="num">${((b.count / totalBandCount) * 100).toFixed(0)}%</td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>`}
          </div>
        </div>

        <div class="section-block">
          <div class="section-title">Stream performance</div>
          ${!showStreamSection
            ? `<p class="field-hint" style="margin:0;">This class hasn't been split into streams — set up streams on the <a href="#classes">Classes</a> page to compare them here.</p>`
            : `
            <div class="ledger">
              <div class="ledger-scroll">
                <table class="ledger-table">
                  <thead><tr><th>Rank</th><th>Class / Stream</th><th>Students</th><th>Mean %</th></tr></thead>
                  <tbody>
                    ${streamStats.map((s, i) => `<tr ${s.label === klass ? 'style="font-weight:600; background:var(--paper-highlight, rgba(0,0,0,0.03));"' : ''}>
                      <td class="num">${s.mean === null ? '—' : i + 1}</td>
                      <td>${UI.esc(s.label)}${s.label === klass ? ' <span class="badge badge-none">this class</span>' : ''}</td>
                      <td class="num">${s.studentsCount}</td>
                      <td class="num">${s.mean === null ? '—' : s.mean.toFixed(1) + '%'}</td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>`}
        </div>
      </div>

      <div id="bsSummaryArea" style="margin-top:28px;">
        ${!showSummary ? '' : `
          <div style="padding:0 0 12px 0;">${buildReportMastheadHTML(st, `${gradeName} Performance Summary`, `${type} Results`, term, year)}</div>
          <div class="section-title">Stream</div>
          ${summaryTableHtml('Stream', streamSummary, { showTeacher: true })}
          <div class="section-title">Gender</div>
          ${summaryTableHtml('Gender', genderSummary)}
          <div class="section-title">Subject</div>
          ${summaryTableHtml('Subject', [...subjectSummary, overallSummary])}
          <p class="field-hint no-print" style="margin:0;">Z is this system's "no marks entered" count for the sitting — counted in Entry, but excluded from each group's points-based Mean.</p>
        `}
      </div>
    `;

    // Recomputes ONE row's Total Marks / Mean % / Points / Level from
    // whatever's currently in its subject cells (inputs where editable,
    // the original marks otherwise) — instant feedback per row without
    // waiting on Save. Class-wide stats (mean, rank, distribution) only
    // refresh after Save, since ties/positions depend on every row.
    function recomputeRowLive(tr) {
      const cells = [...tr.querySelectorAll('td.subj-cell')];
      let obtained = 0, possible = 0;
      const pcts = [];
      let entered = 0;
      cells.forEach(td => {
        const max = Number(td.dataset.max);
        const raw = td.dataset.marks;
        if (raw !== '' && raw !== undefined) {
          const marksVal = Number(raw);
          obtained += marksVal; possible += max;
          pcts.push(Grading.percent(marksVal, max));
          entered++;
        }
      });
      const meanPct = Grading.average(pcts);
      // Same rule as the initial render: Level is Z unless every
      // subject cell has a mark, even if a partial Mean/Total is
      // already showing above it.
      const complete = cells.length > 0 && entered === cells.length;
      const band = !complete ? Grading.MISSING_BAND : Grading.levelForMarks(meanPct, 100, st.settings.gradingBands);
      const points = !complete ? null : Grading.pointsForBand(band, st.settings.gradingBands);
      tr.querySelector('[data-total-cell]').textContent = pcts.length ? `${obtained}/${possible}` : '—';
      tr.querySelector('[data-mean-cell]').innerHTML = meanPct === null ? UI.badge(Grading.MISSING_BAND) : `${meanPct.toFixed(1)}%`;
      tr.querySelector('[data-points-cell]').textContent = points === null ? '—' : points;
      tr.querySelector('[data-level-cell]').innerHTML = UI.badge(band);
    }

    function syncSaveState() {
      const pill = document.getElementById('bsUnsavedPill');
      const saveBtn = document.getElementById('bsSaveBtn');
      if (pill) {
        pill.style.display = pending.size ? 'inline-flex' : 'none';
        pill.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${pending.size} unsaved change${pending.size === 1 ? '' : 's'}`;
      }
      if (saveBtn) saveBtn.disabled = pending.size === 0;
      window.onbeforeunload = pending.size ? () => true : null;
    }

    function handleCellChange(input) {
      const examId = input.dataset.exam;
      const studentId = input.dataset.student;
      const max = Number(input.dataset.max);
      const raw = input.value.trim();
      const td = input.closest('td');
      const tr = input.closest('tr');
      const key = `${examId}::${studentId}`;
      const originalRes = st.results.find(r => r.examId === examId && r.studentId === studentId);
      const original = originalRes ? originalRes.marks : null;

      const revert = () => { input.value = original === null ? '' : original; };

      if (raw === '') {
        if (original === null) pending.delete(key);
        else pending.set(key, { examId, studentId, marks: '' });
        input.classList.remove('invalid');
        input.classList.toggle('dirty', pending.has(key));
        td.dataset.marks = '';
        recomputeRowLive(tr);
        syncSaveState();
        return;
      }
      if (!/^\d+(\.\d+)?$/.test(raw)) {
        UI.toast('Please enter a valid number.');
        input.classList.add('invalid'); revert(); syncSaveState(); return;
      }
      const num = Number(raw);
      if (num < 0) {
        UI.toast('Score cannot be negative.');
        input.classList.add('invalid'); revert(); syncSaveState(); return;
      }
      if (num > max) {
        UI.toast(`Score cannot exceed the maximum mark of ${max}.`);
        input.classList.add('invalid'); revert(); syncSaveState(); return;
      }

      input.classList.remove('invalid');
      if (original !== null && num === original) {
        pending.delete(key);
        input.classList.remove('dirty');
      } else {
        pending.set(key, { examId, studentId, marks: num });
        input.classList.add('dirty');
      }
      td.dataset.marks = num;
      recomputeRowLive(tr);
      syncSaveState();
    }

    function wireEditableInputs() {
      const tbody = document.getElementById('bsTbody');
      if (!tbody) return;
      tbody.querySelectorAll('input.mark-input-compact').forEach((input) => {
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const tr = input.closest('tr');
          const colIdx = [...tr.querySelectorAll('input.mark-input-compact')].indexOf(input);
          const nextTr = tr.nextElementSibling;
          if (nextTr) {
            const nextInputs = nextTr.querySelectorAll('input.mark-input-compact');
            if (nextInputs[colIdx]) nextInputs[colIdx].focus();
          }
        });
        input.addEventListener('change', () => handleCellChange(input));
      });
    }

    function refreshTable() {
      const list = visibleRows();
      document.getElementById('bsTbody').innerHTML = rowsHtml(list);
      const countEl = document.getElementById('bsCount');
      if (countEl) countEl.textContent = `Showing ${list.length} of ${rowsExtra.length} student${rowsExtra.length === 1 ? '' : 's'}`;
      wrap.querySelectorAll('th.sortable').forEach(th => {
        const key = th.dataset.sort;
        th.innerHTML = `${th.dataset.label} ${tableState.sortKey === key ? sortArrow(key) : ''}`;
      });
      if (editMode) { wireEditableInputs(); syncSaveState(); }
    }

    document.getElementById('bsSearch').oninput = (e) => { tableState.search = e.target.value; refreshTable(); };
    document.getElementById('bsLevel').onchange = (e) => { tableState.level = e.target.value; refreshTable(); };
    document.getElementById('bsResetBtn').onclick = () => {
      tableState.search = ''; tableState.level = 'all'; tableState.sortKey = 'rank'; tableState.sortDir = 'asc';
      document.getElementById('bsSearch').value = '';
      document.getElementById('bsLevel').value = 'all';
      render();
    };
    wrap.querySelectorAll('th.sortable').forEach(th => {
      th.onclick = () => {
        const key = th.dataset.sort;
        if (tableState.sortKey === key) tableState.sortDir = tableState.sortDir === 'asc' ? 'desc' : 'asc';
        else { tableState.sortKey = key; tableState.sortDir = key === 'name' ? 'asc' : 'desc'; }
        refreshTable();
      };
    });
    const countEl0 = document.getElementById('bsCount');
    if (countEl0) countEl0.textContent = `Showing ${rowsExtra.length} of ${rowsExtra.length} student${rowsExtra.length === 1 ? '' : 's'}`;

    const editBtn = document.getElementById('bsEditBtn');
    const saveBtn = document.getElementById('bsSaveBtn');
    const cancelBtn = document.getElementById('bsCancelBtn');

    if (editBtn) editBtn.onclick = () => {
      editMode = true;
      editBtn.style.display = 'none';
      if (saveBtn) saveBtn.style.display = '';
      if (cancelBtn) cancelBtn.style.display = '';
      refreshTable();
      UI.toast('Editing marks — click a cell to change it, Enter moves to the next student, Save Changes when done.');
    };

    if (cancelBtn) cancelBtn.onclick = () => {
      const doCancel = () => { pending.clear(); editMode = false; window.onbeforeunload = null; render(); };
      if (pending.size > 0) {
        UI.confirmAction(`Discard ${pending.size} unsaved change${pending.size === 1 ? '' : 's'}?`, doCancel, { confirmLabel: 'Discard changes', confirmClass: 'btn-danger' });
      } else {
        doCancel();
      }
    };

    if (saveBtn) saveBtn.onclick = async () => {
      if (pending.size === 0) return;
      saveBtn.disabled = true;
      const prevLabel = saveBtn.innerHTML;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
      const entries = [...pending.entries()];
      const results = await Promise.allSettled(entries.map(([, p]) => Store.setResult(p.examId, p.studentId, p.marks)));
      const failed = [];
      results.forEach((res, i) => { if (res.status === 'rejected') failed.push(entries[i]); });
      if (failed.length === 0) {
        UI.toast('Broadsheet marks saved successfully.');
        pending.clear();
        editMode = false;
        window.onbeforeunload = null;
        st = await Store.current();
        render();
      } else {
        UI.toast(`Unable to save ${failed.length} mark${failed.length === 1 ? '' : 's'}. Please try again.`);
        failed.forEach(([key, p]) => pending.set(key, p));
        saveBtn.disabled = false;
        saveBtn.innerHTML = prevLabel;
        syncSaveState();
      }
    };
  }

  document.getElementById('bsPrintBtn').onclick = () => window.print();
  document.getElementById('bsPdfBtn').onclick = (e) => {
    const el = document.getElementById('bsPrintArea');
    if (!el) { UI.toast('Choose a class and exam type first.'); return; }
    // Bundle the ledger table together with the Performance analysis
    // section (Subject performance, Class performance level
    // distribution, Stream performance) that renders right below it —
    // same two "pages" the Print button already shows, now included
    // in the direct PDF download too.
    const analysisEl = document.getElementById('bsAnalysisArea');
    const summaryEl = document.getElementById('bsSummaryArea');
    const targets = [el, analysisEl, summaryEl].filter(Boolean);
    UI.downloadPDF(targets, (lastCsv ? lastCsv.filename : 'broadsheet'), e.currentTarget, { orientation: 'landscape' });
  };
  document.getElementById('bsCsvBtn').onclick = () => {
    if (!lastCsv) { UI.toast('Choose a class and exam type first'); return; }
    UI.downloadCSV(lastCsv.filename, lastCsv.header, lastCsv.rows);
  };
  document.getElementById('bsExcelBtn').onclick = () => {
    if (!lastCsv) { UI.toast('Choose a class and exam type first'); return; }
    UI.downloadExcel(lastCsv.filename, lastCsv.header, lastCsv.rows, 'Broadsheet');
  };
  render();
};
