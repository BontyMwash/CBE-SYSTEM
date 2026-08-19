/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   analysis.js — "Published Results & Analysis": an admin picks a
   sitting (class + exam type + term + year), reviews class/subject
   performance, and publishes it once every teacher has finished
   entering marks. Teachers only ever see sittings that are already
   published — this is what makes publishing feel like "releasing"
   results rather than just another filter.
   ============================================================ */

Views.analysis = async function () {
  setTopbarActions('');
  showLoading();
  const st = await Store.current();
  const user = Auth.currentUser();
  const isAdmin = !!user && (user.role === 'admin' || user.role === 'superadmin');

  if (st.students.length === 0 || st.exams.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">Nothing to analyse yet</div><p>Add students and record at least one exam first.</p></div>`;
    return;
  }

  const classes = classesFromStudents(st.students);
  const examTypeNames = Grading.examTypeNames(st);

  document.getElementById('content').innerHTML = `
    <div id="anPickerWrap"></div>
    <div id="anBody"></div>
  `;

  const findPublished = (klass, type, term, year) =>
    st.published.find(p => p.klass === klass && p.type === type && p.term === term && String(p.year) === String(year)) || null;

  // ---- crunch the numbers for one sitting ----
  function computeSitting(klass, type, term, year) {
    const exams = st.exams.filter(e => e.klass === klass && e.type === type && e.term === term && String(e.year) === String(year));
    const subjectCols = exams
      .map(e => ({ exam: e, subject: st.subjects.find(s => s.id === e.subjectId) }))
      .filter(c => c.subject)
      .sort((a, b) => a.subject.name.localeCompare(b.subject.name));
    const students = st.students.filter(s => s.klass === klass).sort((a, b) => a.name.localeCompare(b.name));

    const studentRows = students.map(stu => {
      const pcts = [];
      subjectCols.forEach(col => {
        const res = st.results.find(r => r.examId === col.exam.id && r.studentId === stu.id);
        if (res) pcts.push(Grading.percent(res.marks, col.exam.totalMarks));
      });
      const avg = Grading.average(pcts);
      const band = avg === null ? null : Grading.levelForMarks(avg, 100, st.settings.gradingBands);
      return { student: stu, avg, band };
    });

    const validAvgs = studentRows.filter(r => r.avg !== null).map(r => r.avg);
    const classMean = Grading.average(validAvgs);
    const classHigh = validAvgs.length ? Math.max(...validAvgs) : null;
    const classLow = validAvgs.length ? Math.min(...validAvgs) : null;
    const passRate = validAvgs.length ? (validAvgs.filter(v => v >= 50).length / validAvgs.length) * 100 : null;

    const expectedEntries = students.length * subjectCols.length;
    const enteredEntries = subjectCols.reduce((sum, col) => sum + st.results.filter(r => r.examId === col.exam.id).length, 0);
    const completion = expectedEntries > 0 ? (enteredEntries / expectedEntries) * 100 : null;

    const subjectStats = subjectCols.map(col => {
      const pcts = st.results.filter(r => r.examId === col.exam.id).map(r => Grading.percent(r.marks, col.exam.totalMarks));
      return {
        subject: col.subject,
        mean: Grading.average(pcts),
        high: pcts.length ? Math.max(...pcts) : null,
        low: pcts.length ? Math.min(...pcts) : null,
        entered: pcts.length,
        expected: students.length
      };
    }).sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1));

    const bandCounts = [...(st.settings.gradingBands || [])].sort((a, b) => b.min - a.min).map(b => ({
      band: b, count: studentRows.filter(r => r.band && r.band.code === b.code).length
    }));

    const ranked = studentRows.filter(r => r.avg !== null).sort((a, b) => b.avg - a.avg);
    const topStudents = ranked.slice(0, 5);
    const supportStudents = [...ranked].sort((a, b) => a.avg - b.avg).slice(0, 5);

    return {
      klass, type, term, year, students, subjectCols,
      classMean, classHigh, classLow, passRate, completion, expectedEntries, enteredEntries,
      subjectStats, bandCounts, topStudents, supportStudents
    };
  }

  const BAR_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

  // ---- render the analysis body for one already-computed sitting ----
  function renderAnalysisBody(data, publishControlsHtml) {
    const { klass, type, term, year } = data;
    const published = findPublished(klass, type, term, year);
    const statusBadge = published
      ? `<span class="badge badge-EE"><i class="fa-solid fa-circle-check"></i> Published</span>`
      : `<span class="badge badge-none">Not published yet</span>`;
    const totalBandCount = data.bandCounts.reduce((s, b) => s + b.count, 0) || 1;

    return `
      <div id="anPrintArea">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:2px;">
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h3 style="margin:0;">${UI.esc(klass)} &middot; ${UI.esc(type)} &middot; ${UI.esc(term)} ${UI.esc(String(year))}</h3>
            ${statusBadge}
          </div>
          <div class="filter-row no-print" style="margin:0;">
            ${publishControlsHtml || ''}
            <button class="btn btn-brass" id="anPrintBtn">Print / Save as PDF</button>
            <button class="btn btn-brass" id="anPdfBtn"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
          </div>
        </div>
        ${published ? `<p class="field-hint" style="margin:0 0 14px 0;">Published ${new Date(published.publishedAt).toLocaleString()}</p>` : `<p class="field-hint no-print" style="margin:0 0 14px 0;">Preview only — teachers won't see this sitting until you publish it.</p>`}

        <div class="grid grid-4 section-block">
          <div class="card stat-card grad-indigo">
            <i class="fa-solid fa-user-graduate stat-icon"></i>
            <p class="stat-label">Students</p>
            <p class="stat-value">${data.students.length}</p>
            <p class="stat-sub">${data.subjectCols.length} subject${data.subjectCols.length === 1 ? '' : 's'} sat</p>
          </div>
          <div class="card stat-card ${data.classMean !== null && data.classMean < 50 ? 'grad-danger' : 'grad-success'}">
            <i class="fa-solid fa-chart-line stat-icon"></i>
            <p class="stat-label">Class mean</p>
            <p class="stat-value">${data.classMean === null ? '—' : data.classMean.toFixed(1) + '%'}</p>
            <p class="stat-sub">${data.classHigh === null ? '\u00a0' : `High ${data.classHigh.toFixed(1)}% &middot; Low ${data.classLow.toFixed(1)}%`}</p>
          </div>
          <div class="card stat-card grad-teal">
            <i class="fa-solid fa-thumbs-up stat-icon"></i>
            <p class="stat-label">Pass rate (&ge;50%)</p>
            <p class="stat-value">${data.passRate === null ? '—' : data.passRate.toFixed(0) + '%'}</p>
            <p class="stat-sub">&nbsp;</p>
          </div>
          <div class="card stat-card plain hoverable">
            <i class="fa-solid fa-list-check stat-icon"></i>
            <p class="stat-label">Marks entered</p>
            <p class="stat-value" style="font-size:20px;">${data.completion === null ? '—' : data.completion.toFixed(0) + '%'}</p>
            <p class="stat-sub">${data.enteredEntries} / ${data.expectedEntries} entries</p>
          </div>
        </div>

        <div class="grid grid-2 section-block">
          <div>
            <div class="section-title">Subject performance</div>
            ${data.subjectStats.length === 0 ? `<div class="empty"><div class="empty-title">No subjects sat</div></div>` : `
            <div class="ledger">
              <div class="ledger-scroll">
                <table class="ledger-table">
                  <thead><tr><th>Subject</th><th>Mean</th><th>High</th><th>Low</th><th>Entries</th></tr></thead>
                  <tbody>
                    ${data.subjectStats.map(s => `<tr>
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
            <div class="section-title">Performance level distribution</div>
            ${data.bandCounts.length === 0 ? `<div class="empty"><div class="empty-title">No grading bands set up</div></div>` : `
            <div class="card" style="display:flex; flex-direction:column; gap:12px;">
              ${data.bandCounts.map((b, i) => `
                <div>
                  <div class="progress-label"><span>${UI.esc(b.band.code)} &middot; ${UI.esc(b.band.label)}</span><span>${b.count} (${((b.count / totalBandCount) * 100).toFixed(0)}%)</span></div>
                  <div class="progress-track"><div class="progress-fill" style="width:${((b.count / totalBandCount) * 100).toFixed(1)}%; background:${BAR_COLORS[i % BAR_COLORS.length]};"></div></div>
                </div>
              `).join('')}
            </div>`}
          </div>
        </div>

        <div class="grid grid-2 section-block">
          <div>
            <div class="section-title">Top performers</div>
            <div class="leaderboard">
              ${data.topStudents.length === 0 ? `<div class="dropdown-empty" style="padding:24px;">No results recorded yet.</div>` : data.topStudents.map((r, i) => `
                <div class="leaderboard-item">
                  <span class="rank-badge ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</span>
                  <span class="avatar">${UI.initials(r.student.name)}</span>
                  <span>
                    <span class="lb-name">${UI.esc(r.student.name)}</span><br>
                    <span class="lb-sub">${UI.esc(r.student.admissionNo) || 'no adm. no.'}</span>
                  </span>
                  <span class="lb-score">
                    <span class="v">${r.avg.toFixed(1)}%</span><br>
                    ${r.band ? UI.badge(r.band) : ''}
                  </span>
                </div>
              `).join('')}
            </div>
          </div>
          <div>
            <div class="section-title">Learners needing support</div>
            <div style="display:flex; flex-direction:column; gap:10px;">
              ${data.supportStudents.length === 0 ? `<div class="card" style="text-align:center; color:var(--ink-soft);">No results recorded yet.</div>` : data.supportStudents.map(r => `
                <div class="intervention-card">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>${UI.esc(r.student.name)}</strong>
                    <span class="badge badge-${r.band ? r.band.code : 'none'}">${r.avg.toFixed(1)}%</span>
                  </div>
                  <div class="lb-sub">${UI.esc(r.student.admissionNo) || '—'}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        ${buildPrintFooterHTML()}
      </div>
    `;
  }

  /* ------------------------------------------------------------
     Admin flow: free picker over every class/type/term/year combo,
     with a live preview and a Publish / Unpublish control.
     ------------------------------------------------------------ */
  if (isAdmin) {
    const picked = { klass: classes[0] || '', type: examTypeNames[0] || '', term: st.settings.term, year: String(st.settings.year) };

    function paint() {
      if (!picked.klass || !picked.type) {
        document.getElementById('anBody').innerHTML = `<div class="empty"><div class="empty-title">Choose a class and exam type</div><p>Pick a sitting above to see its performance analysis and publish it to teachers.</p></div>`;
        return;
      }
      const data = computeSitting(picked.klass, picked.type, picked.term, picked.year);
      const published = findPublished(picked.klass, picked.type, picked.term, picked.year);
      const publishControlsHtml = published
        ? `<button class="btn btn-danger" id="anUnpublishBtn">Unpublish</button>`
        : `<button class="btn btn-primary" id="anPublishBtn">Publish results</button>`;

      document.getElementById('anBody').innerHTML = renderAnalysisBody(data, publishControlsHtml);
      document.getElementById('anPrintBtn').onclick = () => window.print();
      document.getElementById('anPdfBtn').onclick = (e) => {
        const el = document.getElementById('anPrintArea');
        if (!el) { UI.toast('Nothing to download yet.'); return; }
        UI.downloadPDF(el, `analysis-${picked.klass}-${picked.type}-${picked.term}-${picked.year}`.replace(/\s+/g, '_'), e.currentTarget, { orientation: 'landscape' });
      };

      const publishBtn = document.getElementById('anPublishBtn');
      if (publishBtn) publishBtn.onclick = () => {
        const doPublish = async () => {
          try {
            await Store.publishResults(picked.klass, picked.type, picked.term, picked.year);
            UI.toast(`Published — teachers can now see ${picked.klass} ${picked.type}.`);
            Views.analysis();
          } catch (e) { UI.toast('Could not publish: ' + e.message); }
        };
        if (data.completion !== null && data.completion < 100) {
          UI.confirmAction(
            `Only ${data.completion.toFixed(0)}% of marks have been entered for this sitting. Publish anyway?`,
            doPublish,
            { confirmLabel: 'Publish anyway', confirmClass: 'btn-primary' }
          );
        } else {
          doPublish();
        }
      };

      const unpublishBtn = document.getElementById('anUnpublishBtn');
      if (unpublishBtn) unpublishBtn.onclick = () => {
        UI.confirmAction(
          'This hides the analysis for this sitting from teachers again. Unpublish?',
          async () => {
            try {
              await Store.unpublishResults(published.id);
              UI.toast('Unpublished.');
              Views.analysis();
            } catch (e) { UI.toast('Could not unpublish: ' + e.message); }
          },
          { confirmLabel: 'Unpublish', confirmClass: 'btn-danger' }
        );
      };
    }

    document.getElementById('anPickerWrap').innerHTML = `
      <div class="filter-row no-print">
        <select id="anClass">${classes.map(c => `<option value="${UI.esc(c)}" ${c === picked.klass ? 'selected' : ''}>${UI.esc(c)}</option>`).join('')}</select>
        <select id="anType">${examTypeNames.map(t => `<option value="${UI.esc(t)}" ${t === picked.type ? 'selected' : ''}>${UI.esc(t)}</option>`).join('')}</select>
        <select id="anTerm">${['Term 1', 'Term 2', 'Term 3'].map(t => `<option value="${t}" ${t === picked.term ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <input type="number" id="anYear" value="${UI.esc(picked.year)}" style="width:90px;">
      </div>
    `;
    const classSel = document.getElementById('anClass');
    const typeSel = document.getElementById('anType');
    const termSel = document.getElementById('anTerm');
    const yearSel = document.getElementById('anYear');
    classSel.onchange = () => { picked.klass = classSel.value; paint(); };
    typeSel.onchange = () => { picked.type = typeSel.value; paint(); };
    termSel.onchange = () => { picked.term = termSel.value; paint(); };
    yearSel.onchange = () => { picked.year = yearSel.value; paint(); };
    paint();
    return;
  }

  /* ------------------------------------------------------------
     Teacher flow: pick only from sittings the admin has already
     published — nothing shows here until that happens.
     ------------------------------------------------------------ */
  const publishedSorted = [...st.published].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  if (publishedSorted.length === 0) {
    document.getElementById('anPickerWrap').innerHTML = '';
    document.getElementById('anBody').innerHTML = `<div class="empty"><div class="empty-title">No results published yet</div><p>Check back once your admin publishes this term's results.</p></div>`;
    return;
  }

  document.getElementById('anPickerWrap').innerHTML = `
    <div class="filter-row no-print">
      <select id="anSitting">
        ${publishedSorted.map(p => `<option value="${p.id}">${UI.esc(p.klass)} &middot; ${UI.esc(p.type)} &middot; ${UI.esc(p.term)} ${UI.esc(String(p.year))}</option>`).join('')}
      </select>
    </div>
  `;

  function paintTeacher() {
    const sel = document.getElementById('anSitting');
    const chosen = publishedSorted.find(p => p.id === sel.value) || publishedSorted[0];
    const data = computeSitting(chosen.klass, chosen.type, chosen.term, chosen.year);
    document.getElementById('anBody').innerHTML = renderAnalysisBody(data, '');
    document.getElementById('anPrintBtn').onclick = () => window.print();
    document.getElementById('anPdfBtn').onclick = (e) => {
      const el = document.getElementById('anPrintArea');
      if (!el) { UI.toast('Nothing to download yet.'); return; }
      UI.downloadPDF(el, `analysis-${chosen.klass}-${chosen.type}-${chosen.term}-${chosen.year}`.replace(/\s+/g, '_'), e.currentTarget, { orientation: 'landscape' });
    };
  }
  document.getElementById('anSitting').onchange = paintTeacher;
  paintTeacher();
};
