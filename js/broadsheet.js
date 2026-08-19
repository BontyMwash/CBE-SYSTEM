/* ============================================================
   broadsheet.js — class broadsheet: every student x every
   subject for one exam sitting (type/term/year/class), with
   totals, mean %, rank position, and overall level.
   ============================================================ */

Views.broadsheet = async function () {
  setTopbarActions('');
  showLoading();
  const st = await Store.current();
  const user = Auth.currentUser();
  // Broadsheet exposes every subject for a whole class — only reachable
  // in the nav for class teachers (see auth.js), and even then scoped
  // to just the class(es) they hold, not the whole school.
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
      <button class="btn" id="bsCsvBtn"><i class="fa-solid fa-download"></i> Download CSV</button>
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

  let lastCsv = null; // set inside render(); read by the Download CSV button

  function render() {
    lastCsv = null;
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
      const enteredCells = cells.filter(c => c.marks !== null);
      const validPcts = enteredCells.map(c => c.pct);
      // Total marks = raw marks obtained across subjects sat (out of the raw
      // marks possible for those same subjects) — not a percentage.
      const totalObtained = enteredCells.length ? enteredCells.reduce((a, c) => a + Number(c.marks), 0) : null;
      const totalPossible = enteredCells.length ? enteredCells.reduce((a, c) => a + Number(c.totalMarks), 0) : null;
      const meanPct = Grading.average(validPcts);
      return { student: stu, cells, totalObtained, totalPossible, meanPct };
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

    lastCsv = {
      filename: `broadsheet-${klass}-${type}-${term}-${year}`.replace(/\s+/g, '_'),
      header: ['Pos.', 'Name', 'Adm. No.', ...subjectCols.map(c => c.subject.name), 'Total Marks', 'Mean %', 'Level'],
      rows: ranked.map(r => {
        const band = r.meanPct === null ? null : Grading.levelForMarks(r.meanPct, 100, st.settings.gradingBands);
        return [
          rankMap.get(r.student.id), r.student.name, r.student.admissionNo || '',
          ...r.cells.map(c => c.pct === null ? '' : c.pct.toFixed(1)),
          r.totalObtained === null ? '' : `${r.totalObtained}/${r.totalPossible}`,
          r.meanPct === null ? '' : r.meanPct.toFixed(1),
          band ? band.code : ''
        ];
      })
    };

    // Class-level subject averages (bottom row)
    const subjectAverages = subjectCols.map((col, i) => {
      const pcts = rows.map(r => r.cells[i].pct).filter(v => v !== null);
      return Grading.average(pcts);
    });
    const classMean = Grading.average(rows.map(r => r.meanPct).filter(v => v !== null));

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
      band: b, count: ranked.filter(r => {
        const band = r.meanPct === null ? null : Grading.levelForMarks(r.meanPct, 100, st.settings.gradingBands);
        return band && band.code === b.code;
      }).length
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

    const BAR_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

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
                <th>Total Marks</th>
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
                  <td class="num">${r.totalObtained === null ? '—' : `${r.totalObtained}/${r.totalPossible}`}</td>
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
            <div class="card" style="display:flex; flex-direction:column; gap:12px;">
              ${bandCounts.map((b, i) => `
                <div>
                  <div class="progress-label"><span>${UI.esc(b.band.code)} &middot; ${UI.esc(b.band.label)}</span><span>${b.count} (${((b.count / totalBandCount) * 100).toFixed(0)}%)</span></div>
                  <div class="progress-track"><div class="progress-fill" style="width:${((b.count / totalBandCount) * 100).toFixed(1)}%; background:${BAR_COLORS[i % BAR_COLORS.length]};"></div></div>
                </div>
              `).join('')}
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
    `;
  }

  document.getElementById('bsPrintBtn').onclick = () => window.print();
  document.getElementById('bsCsvBtn').onclick = () => {
    if (!lastCsv) { UI.toast('Choose a class and exam type first'); return; }
    UI.downloadCSV(lastCsv.filename, lastCsv.header, lastCsv.rows);
  };
  render();
};
