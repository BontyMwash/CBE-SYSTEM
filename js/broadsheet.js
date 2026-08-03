/* ============================================================
   broadsheet.js — class broadsheet: every student x every
   subject for one exam sitting (type/term/year/class), with
   totals, mean %, rank position, and overall level.
   ============================================================ */

Views.broadsheet = async function () {
  setTopbarActions('');
  showLoading();
  const st = await Store.current();

  if (st.students.length === 0 || st.exams.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">Nothing to show yet</div><p>Add students and record at least one exam first.</p></div>`;
    return;
  }

  const classes = classesFromStudents(st.students);

  document.getElementById('content').innerHTML = `
    <div class="filter-row no-print">
      <select id="bsClass"><option value="">Select class</option>${classes.map(c => `<option value="${UI.esc(c)}">${UI.esc(c)}</option>`).join('')}</select>
      <select id="bsType">
        <option value="">Select exam type</option>
        ${['Opener', 'Midterm', 'Endterm'].map(t => `<option value="${t}">${t}</option>`).join('')}
      </select>
      <select id="bsTerm">
        ${['Term 1', 'Term 2', 'Term 3'].map(t => `<option value="${t}" ${st.settings.term === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <input type="number" id="bsYear" value="${st.settings.year}" style="width:90px;">
      <button class="btn btn-brass" id="bsPrintBtn">Print / Save as PDF</button>
    </div>
    <p class="field-hint no-print" style="margin-bottom:14px;">Tip: choose "Landscape" in the print dialog for a wide class list.</p>
    <div id="bsWrap"></div>
  `;

  const classSel = document.getElementById('bsClass');
  const typeSel = document.getElementById('bsType');
  const termSel = document.getElementById('bsTerm');
  const yearSel = document.getElementById('bsYear');

  [classSel, typeSel, termSel, yearSel].forEach(el => el.onchange = render);

  function render() {
    const klass = classSel.value;
    const type = typeSel.value;
    const term = termSel.value;
    const year = yearSel.value;
    const wrap = document.getElementById('bsWrap');

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

    // Build per-student rows
    const rows = students.map(stu => {
      const cells = subjectCols.map(col => {
        const res = st.results.find(r => r.examId === col.exam.id && r.studentId === stu.id) || null;
        if (!res) return { marks: null, pct: null, totalMarks: col.exam.totalMarks };
        return { marks: res.marks, pct: Grading.percent(res.marks, col.exam.totalMarks), totalMarks: col.exam.totalMarks };
      });
      const validPcts = cells.filter(c => c.pct !== null).map(c => c.pct);
      const totalPct = validPcts.length ? validPcts.reduce((a, b) => a + b, 0) : null;
      const meanPct = Grading.average(validPcts);
      return { student: stu, cells, totalPct, meanPct };
    });

    // Rank by mean % (descending), ties share a rank
    const ranked = [...rows].sort((a, b) => (b.meanPct ?? -1) - (a.meanPct ?? -1));
    let rank = 0, lastMean = null, seen = 0;
    const rankMap = new Map();
    ranked.forEach(r => {
      seen++;
      if (r.meanPct === null) { rankMap.set(r.student.id, '—'); return; }
      if (r.meanPct !== lastMean) { rank = seen; lastMean = r.meanPct; }
      rankMap.set(r.student.id, rank);
    });

    // Class-level subject averages (bottom row)
    const subjectAverages = subjectCols.map((col, i) => {
      const pcts = rows.map(r => r.cells[i].pct).filter(v => v !== null);
      return Grading.average(pcts);
    });
    const classMean = Grading.average(rows.map(r => r.meanPct).filter(v => v !== null));

    wrap.innerHTML = `
      <div class="ledger" id="bsPrintArea">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead>
              <tr>
                <th>Pos.</th>
                <th>Name</th>
                <th>Adm. No.</th>
                ${subjectCols.map(c => `<th title="${UI.esc(c.subject.name)}">${UI.esc(c.subject.code || c.subject.name)}</th>`).join('')}
                <th>Total %</th>
                <th>Mean %</th>
                <th>Level</th>
              </tr>
            </thead>
            <tbody>
              ${ranked.map(r => {
                const band = r.meanPct === null ? null : Grading.levelForMarks(r.meanPct, 100, st.settings.gradingBands);
                return `<tr>
                  <td class="num">${rankMap.get(r.student.id)}</td>
                  <td>${UI.esc(r.student.name)}</td>
                  <td class="num">${UI.esc(r.student.admissionNo) || '—'}</td>
                  ${r.cells.map(c => `<td class="num" ${c.marks !== null ? `title="${c.marks}/${c.totalMarks} raw"` : ''}>${c.pct === null ? '<span class="row-index">—</span>' : c.pct.toFixed(1) + '%'}</td>`).join('')}
                  <td class="num">${r.totalPct === null ? '—' : r.totalPct.toFixed(1) + '%'}</td>
                  <td class="num">${r.meanPct === null ? '—' : r.meanPct.toFixed(1) + '%'}</td>
                  <td>${UI.badge(band)}</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" style="font-weight:600;">Subject mean</td>
                ${subjectAverages.map(a => `<td class="num" style="font-weight:600;">${a === null ? '—' : a.toFixed(1)}</td>`).join('')}
                <td></td>
                <td class="num" style="font-weight:600;">${classMean === null ? '—' : classMean.toFixed(1)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <p class="field-hint no-print" style="margin-top:10px;">
        ${UI.esc(klass)} &middot; ${UI.esc(type)} &middot; ${UI.esc(term)} ${UI.esc(year)} &middot;
        ${students.length} student${students.length === 1 ? '' : 's'} &middot; ${subjectCols.length} subject${subjectCols.length === 1 ? '' : 's'}
      </p>
    `;
  }

  document.getElementById('bsPrintBtn').onclick = () => window.print();
  render();
};
