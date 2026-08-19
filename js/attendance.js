/* ============================================================
   attendance.js — Attendance register and CBC Competency
   Assessment. Both are scoped the same way the rest of the teacher
   section is: a teacher only sees/marks classes assigned to them
   (Attendance) or subjects assigned to them (Competency), via
   teacherScope() in views.js. Admins see everything.
   ============================================================ */

const STATUS_META = {
  present: { label: 'Present', cls: 'ME' },
  late: { label: 'Late', cls: 'AE' },
  absent: { label: 'Absent', cls: 'BE' },
  excused: { label: 'Excused', cls: 'none' }
};

function todayISO() { return new Date().toISOString().slice(0, 10); }

/* ------------------------- ATTENDANCE ------------------------- */

Views.attendance = async function () {
  setTopbarActions('');
  showLoading();
  const st = await Store.current();
  const user = Auth.currentUser();
  const scope = teacherScope(st, user);
  const isTeacher = scope.isTeacher;

  const myKlasses = isTeacher && scope.classLabels.size ? [...scope.classLabels].sort() : classOptionLabels(st);

  if (myKlasses.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">No classes to mark attendance for</div><p>${isTeacher ? 'Ask your administrator to assign your class(es) from the Users page.' : 'Add a class first from the Classes page.'}</p></div>`;
    return;
  }

  let klass = App.state._teacherKlassFilter && myKlasses.includes(App.state._teacherKlassFilter) ? App.state._teacherKlassFilter : myKlasses[0];
  App.state._teacherKlassFilter = null;
  let date = todayISO();
  let rows = []; // [{studentId, status, remarks}]
  let mode = 'register'; // 'register' | 'report'

  document.getElementById('content').innerHTML = `
    <div class="filter-row no-print" style="margin-bottom:10px;">
      <button class="btn btn-sm ${mode === 'register' ? 'btn-primary' : ''}" id="attModeRegisterBtn">Register</button>
      <button class="btn btn-sm ${mode === 'report' ? 'btn-primary' : ''}" id="attModeReportBtn">Attendance Report</button>
    </div>
    <div id="attModeWrap"></div>
  `;
  document.getElementById('attModeRegisterBtn').onclick = () => { mode = 'register'; paintMode(); };
  document.getElementById('attModeReportBtn').onclick = () => { mode = 'report'; paintMode(); };

  function paintMode() {
    document.getElementById('attModeRegisterBtn').className = `btn btn-sm ${mode === 'register' ? 'btn-primary' : ''}`;
    document.getElementById('attModeReportBtn').className = `btn btn-sm ${mode === 'report' ? 'btn-primary' : ''}`;
    if (mode === 'register') renderRegisterMode(); else renderReportMode(st, myKlasses, klass);
  }

  async function loadRegister() {
    const students = st.students.filter(s => s.klass === klass).sort((a, b) => a.name.localeCompare(b.name));
    const existing = await Store.attendanceFor(klass, date);
    rows = students.map(s => {
      const rec = existing.find(a => a.studentId === s.id);
      return { student: s, status: rec ? rec.status : 'present', remarks: rec ? rec.remarks : '' };
    });
  }

  function renderControls() {
    return `
      <div class="filter-row">
        <select id="attKlass">${myKlasses.map(k => `<option value="${UI.esc(k)}" ${k === klass ? 'selected' : ''}>${UI.esc(k)}</option>`).join('')}</select>
        <input type="date" id="attDate" value="${date}" max="${todayISO()}">
        <button class="btn btn-sm" id="markAllPresentBtn">Mark all present</button>
      </div>
    `;
  }

  function renderRegister() {
    if (rows.length === 0) {
      return `<div class="empty"><div class="empty-title">No learners in ${UI.esc(klass)}</div></div>`;
    }
    const presentCount = rows.filter(r => r.status === 'present').length;
    return `
      <p class="field-hint" style="margin:10px 0 14px 0;">${presentCount} / ${rows.length} present so far for ${UI.esc(date)}. Saves when you click "Save register".</p>
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>#</th><th>Name</th><th>ADM NO.</th><th>Status</th><th>Remarks</th></tr></thead>
            <tbody>
              ${rows.map((r, i) => `
                <tr>
                  <td class="row-index">${i + 1}</td>
                  <td>${UI.esc(r.student.name)}</td>
                  <td class="num">${UI.esc(r.student.admissionNo) || '—'}</td>
                  <td>
                    <select data-status="${r.student.id}">
                      ${Object.entries(STATUS_META).map(([k, m]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${m.label}</option>`).join('')}
                    </select>
                  </td>
                  <td><input type="text" data-remarks="${r.student.id}" value="${UI.esc(r.remarks)}" placeholder="optional"></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="modal-actions" style="justify-content:flex-start; margin-top:16px;">
        <button class="btn btn-primary" id="saveRegisterBtn">Save register</button>
      </div>
    `;
  }

  function wireRegister() {
    document.querySelectorAll('[data-status]').forEach(sel => {
      sel.onchange = () => {
        const row = rows.find(r => r.student.id === sel.dataset.status);
        row.status = sel.value;
        document.getElementById('gridWrap').querySelector('.field-hint').textContent =
          `${rows.filter(r => r.status === 'present').length} / ${rows.length} present so far for ${date}. Saves when you click "Save register".`;
      };
    });
    document.querySelectorAll('[data-remarks]').forEach(inp => {
      inp.oninput = () => { rows.find(r => r.student.id === inp.dataset.remarks).remarks = inp.value; };
    });
    document.getElementById('saveRegisterBtn').onclick = async () => {
      const btn = document.getElementById('saveRegisterBtn');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await Store.saveAttendanceBulk(klass, date, rows.map(r => ({ studentId: r.student.id, status: r.status, remarks: r.remarks })));
        UI.toast('Attendance saved');
      } catch (err) {
        // A permission-denied error here almost always means this class
        // isn't explicitly assigned to the teacher yet (Users -> "Manage
        // classes") — ask your administrator to do that if this keeps
        // happening, even after running sql/010_fix_attendance_access.sql.
        const isPermissionError = /row-level security|permission denied|RLS/i.test(err.message || '');
        UI.toast(isPermissionError
          ? 'Could not save: you may not be assigned to this class yet — ask your administrator to add it under Users -> "Manage classes".'
          : 'Could not save attendance: ' + err.message);
      }
      btn.disabled = false; btn.textContent = 'Save register';
    };
  }

  async function paint() {
    document.getElementById('gridWrap').innerHTML = `<div class="empty"><div class="empty-title">Loading…</div></div>`;
    await loadRegister();
    document.getElementById('gridWrap').innerHTML = renderRegister();
    wireRegister();
  }

  async function renderRegisterMode() {
    document.getElementById('attModeWrap').innerHTML = `
      ${renderControls()}
      <div id="gridWrap"></div>
    `;
    document.getElementById('attKlass').onchange = (e) => { klass = e.target.value; paint(); };
    document.getElementById('attDate').onchange = (e) => { date = e.target.value || todayISO(); paint(); };
    document.getElementById('markAllPresentBtn').onclick = () => {
      rows.forEach(r => r.status = 'present');
      document.getElementById('gridWrap').innerHTML = renderRegister();
      wireRegister();
    };
    await paint();
  }

  await paintMode();
};

/* ------------------------- ATTENDANCE REPORT (daily / weekly / termly) ------------------------- */

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function sundayOf(dateStr) {
  const d = new Date(mondayOf(dateStr) + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}
function firstOfMonth(dateStr) { return dateStr.slice(0, 8) + '01'; }

// Attendance Report: daily / weekly / termly summaries for a class —
// present/late/absent/excused counts and an attendance rate per
// student, over whichever date range the period picks. "Termly" has no
// stored calendar dates in this app (a term is just a label, not a
// date range), so it's a plain from/to date range the admin sets to
// match their term — everything else derives the range automatically.
function renderReportMode(st, myKlasses, initialKlass) {
  const wrap = document.getElementById('attModeWrap');
  const today = todayISO();
  let picked = { klass: initialKlass, period: 'daily', date: today, from: firstOfMonth(today), to: today };

  function rangeFor() {
    if (picked.period === 'daily') return { from: picked.date, to: picked.date, label: `Daily &middot; ${picked.date}` };
    if (picked.period === 'weekly') {
      const from = mondayOf(picked.date), to = sundayOf(picked.date);
      return { from, to, label: `Weekly &middot; ${from} to ${to}` };
    }
    return { from: picked.from, to: picked.to, label: `Termly &middot; ${picked.from} to ${picked.to}` };
  }

  function renderControls() {
    return `
      <div class="filter-row no-print">
        <select id="arKlass">${myKlasses.map(k => `<option value="${UI.esc(k)}" ${k === picked.klass ? 'selected' : ''}>${UI.esc(k)}</option>`).join('')}</select>
        <select id="arPeriod">
          <option value="daily" ${picked.period === 'daily' ? 'selected' : ''}>Daily</option>
          <option value="weekly" ${picked.period === 'weekly' ? 'selected' : ''}>Weekly</option>
          <option value="termly" ${picked.period === 'termly' ? 'selected' : ''}>Termly (custom range)</option>
        </select>
        ${picked.period === 'termly'
          ? `<input type="date" id="arFrom" value="${picked.from}" max="${today}"> <span class="field-hint">to</span> <input type="date" id="arTo" value="${picked.to}" max="${today}">`
          : `<input type="date" id="arDate" value="${picked.date}" max="${today}">`}
        <button class="btn btn-brass" id="arPrintBtn">Print / Save as PDF</button>
        <button class="btn btn-brass" id="arPdfBtn"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
      </div>
    `;
  }

  async function buildReport() {
    const range = rangeFor();
    const students = st.students.filter(s => s.klass === picked.klass).sort((a, b) => a.name.localeCompare(b.name));
    let records = [];
    try { records = await Store.attendanceRange(picked.klass, range.from, range.to); }
    catch (e) { UI.toast('Could not load attendance: ' + e.message); }
    const daysMarked = new Set(records.map(r => r.date)).size;
    const rows = students.map(stu => {
      const recs = records.filter(r => r.studentId === stu.id);
      const counts = { present: 0, late: 0, absent: 0, excused: 0 };
      recs.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
      const marked = recs.length;
      const rate = marked > 0 ? ((counts.present + counts.late) / marked) * 100 : null;
      return { student: stu, counts, marked, rate };
    });
    const ratedRows = rows.filter(r => r.rate !== null);
    const classRate = ratedRows.length ? ratedRows.reduce((s, r) => s + r.rate, 0) / ratedRows.length : null;
    return { range, rows, daysMarked, classRate };
  }

  async function renderReport() {
    const { range, rows, daysMarked, classRate } = await buildReport();
    const totalsRowHtml = `
      <tr style="font-weight:700; background:var(--paper-highlight, rgba(0,0,0,0.03));">
        <td colspan="2">Class average</td>
        <td class="num">${rows.reduce((s, r) => s + r.counts.present, 0)}</td>
        <td class="num">${rows.reduce((s, r) => s + r.counts.late, 0)}</td>
        <td class="num">${rows.reduce((s, r) => s + r.counts.absent, 0)}</td>
        <td class="num">${rows.reduce((s, r) => s + r.counts.excused, 0)}</td>
        <td class="num">—</td>
        <td class="num">${classRate === null ? '—' : classRate.toFixed(1) + '%'}</td>
      </tr>`;
    document.getElementById('arWrap').innerHTML = `
      <div id="arPrintArea">
        ${buildReportMastheadHTML(st, `${picked.period[0].toUpperCase()}${picked.period.slice(1)} Attendance Report`, picked.klass, range.from, range.to === range.from ? '' : `– ${range.to}`)}
        <p class="field-hint" style="margin:0 0 14px 0;">${UI.esc(picked.klass)} &middot; ${range.label} &middot; ${daysMarked} day${daysMarked === 1 ? '' : 's'} with attendance marked.</p>
        ${rows.length === 0 ? `<div class="empty"><div class="empty-title">No learners in ${UI.esc(picked.klass)}</div></div>` : `
        <div class="ledger">
          <div class="ledger-scroll">
            <table class="ledger-table">
              <thead><tr><th>#</th><th>Name</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th>Days marked</th><th>Attendance %</th></tr></thead>
              <tbody>
                ${rows.map((r, i) => `<tr>
                  <td class="row-index">${i + 1}</td>
                  <td>${UI.esc(r.student.name)}</td>
                  <td class="num">${r.counts.present}</td>
                  <td class="num">${r.counts.late}</td>
                  <td class="num">${r.counts.absent}</td>
                  <td class="num">${r.counts.excused}</td>
                  <td class="num">${r.marked}</td>
                  <td class="num">${r.rate === null ? '—' : r.rate.toFixed(1) + '%'}</td>
                </tr>`).join('')}
                ${totalsRowHtml}
              </tbody>
            </table>
          </div>
        </div>`}
      </div>
    `;
    document.getElementById('arPrintBtn').onclick = () => window.print();
    document.getElementById('arPdfBtn').onclick = (e) => {
      const el = document.getElementById('arPrintArea');
      if (!el) { UI.toast('Nothing to download yet.'); return; }
      UI.downloadPDF(el, `attendance-${picked.period}-${picked.klass}-${range.from}_to_${range.to}`.replace(/\s+/g, '_'), e.currentTarget);
    };
  }

  function wireControls() {
    document.getElementById('arKlass').onchange = (e) => { picked.klass = e.target.value; renderReport(); };
    document.getElementById('arPeriod').onchange = (e) => { picked.period = e.target.value; paint(); };
    const dateInput = document.getElementById('arDate');
    if (dateInput) dateInput.onchange = (e) => { picked.date = e.target.value || today; renderReport(); };
    const fromInput = document.getElementById('arFrom');
    const toInput = document.getElementById('arTo');
    if (fromInput) fromInput.onchange = (e) => { picked.from = e.target.value || picked.from; renderReport(); };
    if (toInput) toInput.onchange = (e) => { picked.to = e.target.value || picked.to; renderReport(); };
  }

  function paint() {
    wrap.innerHTML = `${renderControls()}<div id="arWrap"></div>`;
    wireControls();
    renderReport();
  }

  paint();
}

/* ------------------------- COMPETENCY ASSESSMENT ------------------------- */

Views.competency = async function () {
  setTopbarActions('');
  showLoading();
  const st = await Store.current();
  const user = Auth.currentUser();
  const scope = teacherScope(st, user);
  const isTeacher = scope.isTeacher;

  const mySubjects = isTeacher ? st.subjects.filter(s => scope.subjectIds.has(s.id)) : st.subjects;
  const myKlasses = isTeacher && scope.classLabels.size ? [...scope.classLabels].sort() : classOptionLabels(st);

  if (mySubjects.length === 0 || myKlasses.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">Nothing to assess yet</div><p>${isTeacher ? 'Ask your administrator to assign your subject(s) and class(es) from the Users page.' : 'Add a class and a subject first.'}</p></div>`;
    return;
  }

  let picked = { klass: myKlasses[0], subjectId: mySubjects[0].id, term: st.settings.term, year: String(st.settings.year), strand: '', subStrand: '' };
  let existingForSubject = [];
  let rows = [];

  function bandCode(rating) { return { code: rating, label: rating }; }

  async function loadExisting() {
    existingForSubject = await Store.competenciesFor(picked.subjectId, picked.term, picked.year);
  }

  function knownStrands() {
    return [...new Set(existingForSubject.map(c => c.strand))].sort();
  }

  function buildRows() {
    const students = st.students.filter(s => s.klass === picked.klass).sort((a, b) => a.name.localeCompare(b.name));
    rows = students.map(s => {
      const rec = existingForSubject.find(c => c.studentId === s.id && c.strand === picked.strand.trim() && (c.subStrand || '') === picked.subStrand.trim());
      return { student: s, id: rec ? rec.id : null, rating: rec ? rec.rating : '', remarks: rec ? rec.remarks : '' };
    });
  }

  function renderPicker() {
    return `
      <div class="filter-row">
        <select id="cpKlass">${myKlasses.map(k => `<option value="${UI.esc(k)}" ${k === picked.klass ? 'selected' : ''}>${UI.esc(k)}</option>`).join('')}</select>
        <select id="cpSubject">${mySubjects.map(s => `<option value="${s.id}" ${s.id === picked.subjectId ? 'selected' : ''}>${UI.esc(s.name)}</option>`).join('')}</select>
        <select id="cpTerm">${['Term 1', 'Term 2', 'Term 3'].map(t => `<option value="${t}" ${t === picked.term ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <input type="number" id="cpYear" value="${picked.year}" style="width:90px;">
      </div>
      <div class="form-grid" style="margin-top:10px;">
        <div class="field">
          <label>Strand</label>
          <input type="text" id="cpStrand" list="cpStrandList" value="${UI.esc(picked.strand)}" placeholder="e.g. Number strand">
          <datalist id="cpStrandList">${knownStrands().map(s => `<option value="${UI.esc(s)}">`).join('')}</datalist>
        </div>
        <div class="field">
          <label>Sub-strand (optional)</label>
          <input type="text" id="cpSubStrand" value="${UI.esc(picked.subStrand)}" placeholder="e.g. Whole numbers">
        </div>
      </div>
      <p class="field-hint" style="margin:10px 0 14px 0;">Rate each learner on this strand using the school's four performance levels. Existing strand names appear as suggestions above so wording stays consistent across the term.</p>
    `;
  }

  function renderGrid() {
    if (!picked.strand.trim()) {
      return `<div class="empty"><div class="empty-title">Enter a strand to begin</div><p>Type the competency strand you're assessing (e.g. "Listening and speaking") above.</p></div>`;
    }
    if (rows.length === 0) {
      return `<div class="empty"><div class="empty-title">No learners in ${UI.esc(picked.klass)}</div></div>`;
    }
    return `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>#</th><th>Name</th><th>Rating</th><th>Remarks</th></tr></thead>
            <tbody>
              ${rows.map((r, i) => `
                <tr>
                  <td class="row-index">${i + 1}</td>
                  <td>${UI.esc(r.student.name)}</td>
                  <td>
                    <select data-rating="${r.student.id}">
                      <option value="">—</option>
                      ${['EE', 'ME', 'AE', 'BE'].map(code => `<option value="${code}" ${r.rating === code ? 'selected' : ''}>${code}</option>`).join('')}
                    </select>
                  </td>
                  <td><input type="text" data-cremarks="${r.student.id}" value="${UI.esc(r.remarks)}" placeholder="optional"></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="modal-actions" style="justify-content:flex-start; margin-top:16px;">
        <button class="btn btn-primary" id="saveCompetencyBtn">Save ratings</button>
      </div>
    `;
  }

  function renderHistory() {
    const strands = knownStrands();
    if (strands.length === 0) return '';
    const rowsByStrand = strands.map(strandName => {
      const recs = existingForSubject.filter(c => c.strand === strandName);
      const counts = { EE: 0, ME: 0, AE: 0, BE: 0 };
      recs.forEach(c => { if (counts[c.rating] !== undefined) counts[c.rating]++; });
      return `<tr>
        <td>${UI.esc(strandName)}</td>
        <td class="num">${recs.length}</td>
        <td>${Object.entries(counts).map(([k, v]) => `<span class="badge badge-${k}" style="margin-right:4px;">${k} ${v}</span>`).join('')}</td>
        <td><button class="btn btn-sm btn-ghost" data-open-strand="${UI.esc(strandName)}">Open</button></td>
      </tr>`;
    }).join('');
    return `
      <h3 style="margin:28px 0 10px 0;">Strands assessed this term — ${UI.esc(st.subjects.find(s => s.id === picked.subjectId)?.name || '')}</h3>
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>Strand</th><th>Learners rated</th><th>Breakdown</th><th></th></tr></thead>
            <tbody>${rowsByStrand}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function wireGrid() {
    document.querySelectorAll('[data-rating]').forEach(sel => {
      sel.onchange = () => { rows.find(r => r.student.id === sel.dataset.rating).rating = sel.value; };
    });
    document.querySelectorAll('[data-cremarks]').forEach(inp => {
      inp.oninput = () => { rows.find(r => r.student.id === inp.dataset.cremarks).remarks = inp.value; };
    });
    const saveBtn = document.getElementById('saveCompetencyBtn');
    if (saveBtn) saveBtn.onclick = async () => {
      const toSave = rows.filter(r => r.rating);
      if (toSave.length === 0) { UI.toast('Pick a rating for at least one learner'); return; }
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        await Promise.all(toSave.map(r => Store.saveCompetency({
          studentId: r.student.id, subjectId: picked.subjectId, term: picked.term, year: picked.year,
          strand: picked.strand, subStrand: picked.subStrand, rating: r.rating, remarks: r.remarks
        })));
        UI.toast('Ratings saved');
        await loadExisting();
        paintBody();
      } catch (err) {
        UI.toast('Could not save: ' + err.message);
      }
      saveBtn.disabled = false; saveBtn.textContent = 'Save ratings';
    };
    document.querySelectorAll('[data-open-strand]').forEach(btn => {
      btn.onclick = () => { picked.strand = btn.dataset.openStrand; picked.subStrand = ''; refreshPicker(); paintBody(); };
    });
  }

  function paintBody() {
    buildRows();
    document.getElementById('cpGridWrap').innerHTML = renderGrid() + renderHistory();
    wireGrid();
  }

  function refreshPicker() {
    document.getElementById('cpPickerWrap').innerHTML = renderPicker();
    wirePicker();
  }

  function wirePicker() {
    document.getElementById('cpKlass').onchange = (e) => { picked.klass = e.target.value; paintBody(); };
    document.getElementById('cpSubject').onchange = async (e) => { picked.subjectId = e.target.value; await loadExisting(); refreshPicker(); paintBody(); };
    document.getElementById('cpTerm').onchange = async (e) => { picked.term = e.target.value; await loadExisting(); refreshPicker(); paintBody(); };
    document.getElementById('cpYear').onchange = async (e) => { picked.year = String(Number(e.target.value) || st.settings.year); await loadExisting(); refreshPicker(); paintBody(); };
    document.getElementById('cpStrand').onchange = (e) => { picked.strand = e.target.value; paintBody(); };
    document.getElementById('cpSubStrand').onchange = (e) => { picked.subStrand = e.target.value; paintBody(); };
  }

  document.getElementById('content').innerHTML = `
    <div id="cpPickerWrap"></div>
    <div id="cpGridWrap"></div>
  `;
  await loadExisting();
  refreshPicker();
  paintBody();
};
