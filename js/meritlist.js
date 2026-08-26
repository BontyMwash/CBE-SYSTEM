/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   meritlist.js — Merit List: ranks students by their overall mean %
   for one exam sitting (type/term/year), across an entire grade
   (every stream) or the whole school at once — unlike the
   Broadsheet, which ranks within a single class/stream only.
   Each student's mean is computed from THEIR OWN class's matching
   exams (streams can carry different subjects), the same approach
   Broadsheet's Stream/Grade summary already uses, so a "Grade 7"
   merit list fairly compares "Grade 7 North" against "Grade 7
   South" students side by side.
   ============================================================ */

Views.meritList = async function () {
  setTopbarActions('');
  showLoading();
  const st = await Store.current();
  const user = Auth.currentUser();
  const scope = teacherScope(st, user);

  if (st.students.length === 0 || st.exams.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">Nothing to show yet</div><p>Add students and record at least one exam first.</p></div>`;
    return;
  }
  if (scope.isTeacher && scope.classLabels.size === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">No classes assigned to you yet</div><p>Ask your administrator to assign your class(es) from the Users page.</p></div>`;
    return;
  }

  // Grade names (e.g. "Grade 7") a person is allowed to pick from —
  // a class teacher only sees the grade(s) of classes they actually
  // hold; everyone else sees every grade in the school (respecting
  // the Primary/Junior/Senior level switcher, same as Classes).
  const gradeNames = scope.isTeacher
    ? [...new Set(scope.classes.map(c => c.name))].sort()
    : [...new Set((st.classes || []).filter(c => levelAllows(c.name)).map(c => c.name))].sort();

  document.getElementById('content').innerHTML = `
    <div class="filter-row no-print">
      <select id="mlScope"><option value="">Whole school</option>${gradeNames.map(g => `<option value="${UI.esc(g)}">${UI.esc(g)}</option>`).join('')}</select>
      <select id="mlType">
        <option value="">Select exam type</option>
        ${st.examTypes.map(t => `<option value="${UI.esc(t.name)}">${UI.esc(t.name)}</option>`).join('')}
      </select>
      <select id="mlTerm">
        ${['Term 1', 'Term 2', 'Term 3'].map(t => `<option value="${t}" ${st.settings.term === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <input type="number" id="mlYear" value="${st.settings.year}" style="width:90px;">
      <select id="mlTopN">
        <option value="10">Top 10</option>
        <option value="20">Top 20</option>
        <option value="50">Top 50</option>
        <option value="all" selected>All ranked</option>
      </select>
      <input type="text" id="mlSearch" placeholder="Search learner name or adm. no…" style="min-width:200px;">
      <button class="btn" id="mlCsvBtn"><i class="fa-solid fa-download"></i> CSV</button>
      <button class="btn" id="mlExcelBtn"><i class="fa-solid fa-file-excel"></i> Excel</button>
      <button class="btn btn-brass" id="mlPrintBtn">Print / Save as PDF</button>
      <button class="btn btn-brass" id="mlPdfBtn"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
    </div>
    <div id="mlWrap"></div>
  `;

  const scopeSel = document.getElementById('mlScope');
  const typeSel = document.getElementById('mlType');
  const termSel = document.getElementById('mlTerm');
  const yearInput = document.getElementById('mlYear');
  const topNSel = document.getElementById('mlTopN');
  const searchInput = document.getElementById('mlSearch');
  const wrap = document.getElementById('mlWrap');

  // A class teacher with just one grade doesn't need to pick — lock
  // it in and hide the (single-option, pointless) dropdown.
  if (scope.isTeacher && gradeNames.length === 1) {
    scopeSel.value = gradeNames[0];
    scopeSel.style.display = 'none';
  }

  let lastCsv = null;
  let search = '';

  // ---- crunch the numbers for one sitting, across every class in scope ----
  function computeMeritList(gradeName, type, term, year) {
    let classLabels;
    if (scope.isTeacher) {
      classLabels = [...scope.classLabels].filter(label => {
        const entry = st.classes.find(c => c.label === label);
        return !gradeName || (entry && entry.name === gradeName);
      });
    } else if (gradeName) {
      classLabels = st.classes.filter(c => c.name === gradeName).map(c => c.label);
    } else {
      classLabels = classOptionLabels(st);
    }

    const candidates = st.students.filter(s => classLabels.includes(s.klass));

    const rows = candidates.map(stu => {
      const exams = st.exams.filter(e => e.klass === stu.klass && e.type === type && e.term === term && String(e.year) === String(year));
      const pcts = exams.map(e => {
        const res = st.results.find(r => r.examId === e.id && r.studentId === stu.id);
        return res ? Grading.percent(res.marks, e.totalMarks) : null;
      }).filter(v => v !== null);
      const avg = Grading.average(pcts);
      const band = avg === null ? Grading.MISSING_BAND : Grading.levelForMarks(avg, 100, st.settings.gradingBands);
      const points = avg === null ? null : Grading.pointsForBand(band, st.settings.gradingBands);
      return { student: stu, avg, band, points, subjectsExpected: exams.length };
    // A class that was never sat for this exact type/term/year (no
    // matching exams at all) contributes no rows — nothing to rank,
    // not a wall of "Z"s for a sitting that simply doesn't apply.
    }).filter(r => r.subjectsExpected > 0);

    const ranked = [...rows].sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
    let rnk = 0, lastAvg = null, seen = 0;
    const rankMap = new Map();
    ranked.forEach(r => {
      seen++;
      if (r.avg === null) { rankMap.set(r.student.id, 'Z'); return; }
      if (r.avg !== lastAvg) { rnk = seen; lastAvg = r.avg; }
      rankMap.set(r.student.id, rnk);
    });
    rows.forEach(r => { r.rank = rankMap.get(r.student.id); });

    return rows.sort((a, b) => Grading.rankSortValue(a.rank) - Grading.rankSortValue(b.rank));
  }

  function rowHtml(r, i) {
    return `
      <tr>
        <td class="freeze-1 num">${r.rank === 'Z' ? UI.badge(Grading.MISSING_BAND) : r.rank}</td>
        <td class="freeze-2">${UI.esc(r.student.name)}</td>
        <td>${UI.esc(r.student.klass)}</td>
        <td>${UI.esc(r.student.admissionNo) || '<span class="row-index">—</span>'}</td>
        <td class="num">${r.avg === null ? '—' : r.avg.toFixed(1) + '%'}</td>
        <td class="num">${r.points === null ? '—' : r.points.toFixed(1)}</td>
        <td>${UI.badge(r.band)}</td>
      </tr>
    `;
  }

  function render() {
    const gradeName = scopeSel.value;
    const type = typeSel.value;
    const term = termSel.value;
    const year = yearInput.value;

    if (!type) {
      wrap.innerHTML = `<div class="empty"><div class="empty-title">Choose an exam type</div><p>Pick a scope, exam type, term and year to build the merit list.</p></div>`;
      lastCsv = null;
      return;
    }

    let all = computeMeritList(gradeName, type, term, year);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      all = all.filter(r => r.student.name.toLowerCase().includes(q) || (r.student.admissionNo || '').toLowerCase().includes(q));
    }

    if (all.length === 0) {
      wrap.innerHTML = `<div class="empty"><div class="empty-title">No results for this sitting</div><p>No matching exams have been recorded for ${UI.esc(gradeName || 'the whole school')} yet.</p></div>`;
      lastCsv = null;
      return;
    }

    const topN = topNSel.value === 'all' ? all.length : parseInt(topNSel.value, 10);
    const shown = all.slice(0, topN);

    const scopeLabel = gradeName || 'Whole school';
    wrap.innerHTML = `
      <div class="ledger" id="mlPrintArea">
        <div style="padding:16px 16px 0 16px;">${buildReportMastheadHTML(st, `Merit List — ${scopeLabel}`, `${type} Results`, term, year)}</div>
        <div class="ledger-scroll ledger-scroll-y">
          <table class="ledger-table">
            <thead>
              <tr>
                <th class="freeze-1">Rank</th>
                <th class="freeze-2">Name</th>
                <th>Class</th>
                <th>Adm. No.</th>
                <th>Mean %</th>
                <th>Points</th>
                <th>Level</th>
              </tr>
            </thead>
            <tbody>${shown.map(rowHtml).join('')}</tbody>
          </table>
        </div>
        ${buildPrintFooterHTML()}
      </div>
      <p class="field-hint no-print" style="margin-top:10px;">
        ${UI.esc(scopeLabel)} &middot; ${UI.esc(type)} &middot; ${UI.esc(term)} ${UI.esc(String(year))} &middot;
        Showing ${shown.length} of ${all.length} ranked learner${all.length === 1 ? '' : 's'}
      </p>
    `;

    lastCsv = {
      filename: `merit-list-${scopeLabel}-${type}-${term}-${year}`.replace(/\s+/g, '_'),
      header: ['Rank', 'Name', 'Class', 'Adm. No.', 'Mean %', 'Points', 'Level'],
      rows: shown.map(r => [
        r.rank === 'Z' ? 'Z' : r.rank,
        r.student.name,
        r.student.klass,
        r.student.admissionNo || '',
        r.avg === null ? '' : r.avg.toFixed(1),
        r.points === null ? '' : r.points.toFixed(1),
        r.band ? r.band.code : ''
      ])
    };
  }

  scopeSel.onchange = render;
  typeSel.onchange = render;
  termSel.onchange = render;
  yearInput.onchange = render;
  topNSel.onchange = render;
  searchInput.oninput = (e) => { search = e.target.value; render(); };

  document.getElementById('mlPrintBtn').onclick = () => window.print();
  document.getElementById('mlPdfBtn').onclick = (e) => {
    const el = document.getElementById('mlPrintArea');
    if (!el) { UI.toast('Choose an exam type first.'); return; }
    UI.downloadPDF(el, (lastCsv ? lastCsv.filename : 'merit-list'), e.currentTarget);
  };
  document.getElementById('mlCsvBtn').onclick = () => {
    if (!lastCsv) { UI.toast('Choose an exam type first.'); return; }
    UI.downloadCSV(lastCsv.filename, lastCsv.header, lastCsv.rows);
  };
  document.getElementById('mlExcelBtn').onclick = () => {
    if (!lastCsv) { UI.toast('Choose an exam type first.'); return; }
    UI.downloadExcel(lastCsv.filename, lastCsv.header, lastCsv.rows, 'Merit List');
  };

  render();
};
