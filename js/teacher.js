/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   teacher.js — the teacher-section screens that sit on top of data
   the rest of the app already manages: My Classes, Learners,
   Assessments, Gradebook, and the Reports hub. (Marks Entry lives in
   views.js as Views.results, Marks Analysis is Views.analysis,
   Report Cards is Views.reports, Attendance/Competency Assessment
   are in attendance.js — all wired together via teacherScope() in
   views.js.)
   ============================================================ */

/* ------------------------- MY CLASSES ------------------------- */

Views.myClasses = async function () {
  setTopbarActions('');
  showLoading();
  const st = await Store.current();
  const user = Auth.currentUser();
  const scope = teacherScope(st, user);
  const myClasses = scope.isTeacher ? scope.classes : st.classes;

  if (myClasses.length === 0) {
    document.getElementById('content').innerHTML = `
      <div class="empty">
        <div class="empty-title">No classes assigned to you yet</div>
        <p>Ask your administrator to assign your class(es) from the Users page ("Manage classes"), or your subject(s) ("Manage subjects") so classes can be worked out from what you teach.</p>
      </div>`;
    return;
  }

  function subjectsTaughtIn(klassLabel) {
    const subjIds = new Set(st.exams.filter(e => e.klass === klassLabel && (!scope.isTeacher || scope.subjectIds.has(e.subjectId))).map(e => e.subjectId));
    return [...subjIds].map(id => st.subjects.find(s => s.id === id)).filter(Boolean).map(s => s.name);
  }

  const cards = myClasses.map(c => {
    const studentCount = st.students.filter(s => s.klass === c.label).length;
    const subjectNames = subjectsTaughtIn(c.label);
    return `
      <div class="card class-card">
        <h3 style="margin:0 0 4px 0;">${UI.esc(c.label)}</h3>
        <p class="muted" style="margin:0 0 10px 0;">${studentCount} learner${studentCount === 1 ? '' : 's'}${c.teacherName ? ` &middot; Class teacher: ${UI.esc(c.teacherName)}` : ''}</p>
        <p class="field-hint" style="margin:0 0 14px 0;">${subjectNames.length ? 'Subjects: ' + subjectNames.map(UI.esc).join(', ') : 'No assessments recorded for this class yet.'}</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm" data-learners="${UI.esc(c.label)}">Learners</button>
          <button class="btn btn-sm" data-marks="${UI.esc(c.label)}">Marks Entry</button>
          <button class="btn btn-sm" data-attendance="${UI.esc(c.label)}">Attendance</button>
        </div>
      </div>`;
  }).join('');

  document.getElementById('content').innerHTML = `
    <p class="field-hint" style="margin-bottom:14px;">The classes assigned to you. Jump straight into a class's roster, marks entry, or attendance register from here.</p>
    <div class="class-card-grid">${cards}</div>
  `;

  document.querySelectorAll('[data-learners]').forEach(btn => {
    btn.onclick = () => { App.state._teacherKlassFilter = btn.dataset.learners; App.navigate('learners'); };
  });
  document.querySelectorAll('[data-marks]').forEach(btn => {
    btn.onclick = () => App.navigate('results');
  });
  document.querySelectorAll('[data-attendance]').forEach(btn => {
    btn.onclick = () => { App.state._teacherKlassFilter = btn.dataset.attendance; App.navigate('attendance'); };
  });
};

/* ------------------------- LEARNERS ------------------------- */

Views.learners = async function () {
  const st = await Store.current();
  const user = Auth.currentUser();
  const scope = teacherScope(st, user);

  // Only an actual CLASS teacher (assigned a class via the Users page,
  // not just a subject) may add a learner here, and only into the
  // class(es) they hold — a subject-only teacher still can't.
  const canAddLearner = !!user && user.role === 'user' && !!user.isClassTeacher;
  setTopbarActions(canAddLearner ? `<button class="btn btn-primary" id="addLearnerBtn">+ Add learner</button>` : '');
  showLoading();

  const classLabels = scope.isTeacher ? scope.classLabels : new Set(classOptionLabels(st));
  let students = st.students.filter(s => classLabels.has(s.klass));

  if (scope.isTeacher && scope.classes.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">No classes assigned to you yet</div><p>Ask your administrator to assign your class(es) or subject(s) from the Users page.</p></div>`;
    return;
  }

  function openAddLearnerForm() {
    const classOpts = [...scope.classLabels].sort();
    UI.openModal(`
      <h2>Add learner</h2>
      <div class="form-grid">
        <div class="field full">
          <label>Full name</label>
          <input type="text" id="f_name" placeholder="e.g. Amina Wanjiru">
        </div>
        <div class="field">
          <label>Admission number</label>
          <input type="text" id="f_admno" placeholder="e.g. 2025-014">
        </div>
        <div class="field">
          <label>Class / Grade</label>
          <select id="f_klass">
            ${classOpts.length ? classOpts.map(c => `<option value="${UI.esc(c)}">${UI.esc(c)}</option>`).join('') : `<option value="">No class assigned to you</option>`}
          </select>
          <p class="field-hint">Only class(es) you're the class teacher for are listed.</p>
        </div>
        <div class="field full" style="margin-top:4px; border-top:1px solid var(--paper-line); padding-top:14px;">
          <label style="font-weight:600;">Parent / guardian contact <span class="field-hint" style="font-weight:400;">(optional — used to send results)</span></label>
        </div>
        <div class="field">
          <label>Parent / guardian name</label>
          <input type="text" id="f_parentname" placeholder="e.g. Mary Wanjiru">
        </div>
        <div class="field">
          <label>Parent phone (WhatsApp/SMS)</label>
          <input type="text" id="f_parentphone" placeholder="e.g. +254712345678">
        </div>
        <div class="field">
          <label>Parent email</label>
          <input type="email" id="f_parentemail" placeholder="e.g. parent@example.com">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">Add learner</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const name = root.querySelector('#f_name').value.trim();
        const admissionNo = root.querySelector('#f_admno').value.trim();
        const klass = root.querySelector('#f_klass').value.trim();
        const parentName = root.querySelector('#f_parentname').value.trim();
        const parentPhone = root.querySelector('#f_parentphone').value.trim();
        const parentEmail = root.querySelector('#f_parentemail').value.trim();
        if (!name || !klass) { UI.toast('Name and class are required'); return; }
        try {
          await Store.addStudent({ name, admissionNo, klass, parentName, parentPhone, parentEmail });
          UI.toast('Learner added');
          UI.closeModal();
          Views.learners();
        } catch (err) {
          UI.toast('Could not save: ' + err.message);
        }
      };
    });
  }

  let klassFilter = App.state._teacherKlassFilter && classLabels.has(App.state._teacherKlassFilter) ? App.state._teacherKlassFilter : '';
  App.state._teacherKlassFilter = null; // one-shot, from a My Classes card click
  let search = '';

  function overallAverage(studentId) {
    const pcts = [];
    st.results.filter(r => r.studentId === studentId).forEach(r => {
      const exam = st.exams.find(e => e.id === r.examId);
      if (exam && (!scope.isTeacher || scope.subjectIds.has(exam.subjectId))) pcts.push(Grading.percent(r.marks, exam.totalMarks));
    });
    return Grading.average(pcts);
  }

  function renderTable() {
    const klasses = [...classLabels].sort();
    let rows = students.filter(s => !klassFilter || s.klass === klassFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(s => s.name.toLowerCase().includes(q) || (s.admissionNo || '').toLowerCase().includes(q));
    }
    rows = [...rows].sort((a, b) => a.klass.localeCompare(b.klass) || a.name.localeCompare(b.name));

    const tableHtml = rows.length === 0
      ? `<div class="empty"><div class="empty-title">No learners found</div><p>Try a different class or search term.</p></div>`
      : `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>#</th><th>Name</th><th>ADM NO.</th><th>Class</th><th>Average</th><th>Guardian contact</th></tr></thead>
            <tbody>
              ${rows.map((s, i) => {
                const avg = overallAverage(s.id);
                const band = avg === null ? Grading.MISSING_BAND : Grading.levelForMarks(avg, 100, st.settings.gradingBands);
                const contact = [s.parentName, s.parentPhone].filter(Boolean).map(UI.esc).join(' &middot; ') || '<span class="row-index">—</span>';
                return `<tr>
                  <td class="row-index">${i + 1}</td>
                  <td>${UI.esc(s.name)}</td>
                  <td class="num">${UI.esc(s.admissionNo) || '—'}</td>
                  <td>${UI.esc(s.klass)}</td>
                  <td>${avg === null ? UI.badge(Grading.MISSING_BAND) : `${avg.toFixed(1)}% ${UI.badge(band)}`}</td>
                  <td>${contact}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    return `
      <div class="filter-row" style="margin-bottom:14px;">
        <select id="klassFilterSel">
          <option value="">All my classes</option>
          ${klasses.map(k => `<option value="${UI.esc(k)}" ${k === klassFilter ? 'selected' : ''}>${UI.esc(k)}</option>`).join('')}
        </select>
        <input type="text" id="searchInput" placeholder="Search by name or admission no." value="${UI.esc(search)}" style="flex:1; min-width:200px;">
        <button class="btn" id="learnersCsvBtn"><i class="fa-solid fa-download"></i> Download CSV</button>
      </div>
      ${tableHtml}
      <p class="field-hint" style="margin-top:10px;">Average is calculated only from subject(s) assigned to you. Editing a learner's details is done by your administrator on the Students page.</p>
    `;
  }

  function currentRows() {
    let rows = students.filter(s => !klassFilter || s.klass === klassFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(s => s.name.toLowerCase().includes(q) || (s.admissionNo || '').toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => a.klass.localeCompare(b.klass) || a.name.localeCompare(b.name));
  }

  function paint() {
    document.getElementById('content').innerHTML = renderTable();
    if (canAddLearner) document.getElementById('addLearnerBtn').onclick = openAddLearnerForm;
    document.getElementById('klassFilterSel').onchange = (e) => { klassFilter = e.target.value; paint(); };
    const search_input = document.getElementById('searchInput');
    search_input.oninput = (e) => { search = e.target.value; paint(); };
    search_input.focus();
    search_input.value = search;
    search_input.setSelectionRange(search.length, search.length);
    document.getElementById('learnersCsvBtn').onclick = () => {
      const rows = currentRows();
      if (rows.length === 0) { UI.toast('No learners to download'); return; }
      const header = ['Name', 'Admission No.', 'Class', 'Average %', 'Level', 'Guardian name', 'Guardian phone'];
      const csvRows = rows.map(s => {
        const avg = overallAverage(s.id);
        const band = avg === null ? Grading.MISSING_BAND : Grading.levelForMarks(avg, 100, st.settings.gradingBands);
        return [s.name, s.admissionNo || '', s.klass, avg === null ? 'Z' : avg.toFixed(1), band.code, s.parentName || '', s.parentPhone || ''];
      });
      UI.downloadCSV(`class-list-${klassFilter || 'all-my-classes'}`.replace(/\s+/g, '_'), header, csvRows);
    };
  }

  paint();
};

/* ------------------------- ASSESSMENTS ------------------------- */
// A teacher's own view of exams/sittings — scoped to subjects
// assigned to them, and (since migration 009) able to create a new
// one for their own subject, not just edit an admin-created one.

Views.assessments = async function () {
  showLoading();
  const st = await Store.current();
  const user = Auth.currentUser();
  const scope = teacherScope(st, user);
  const isTeacher = scope.isTeacher;

  const mySubjects = isTeacher ? st.subjects.filter(s => scope.subjectIds.has(s.id)) : st.subjects;
  const myExams = isTeacher ? st.exams.filter(e => scope.subjectIds.has(e.subjectId)) : st.exams;

  setTopbarActions(`<button class="btn btn-primary" id="addAssessmentBtn" ${mySubjects.length === 0 ? 'disabled' : ''}>+ New assessment</button>`);

  if (isTeacher && mySubjects.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">No subjects assigned to you yet</div><p>Ask your administrator to assign your subject(s) from the Users page.</p></div>`;
    return;
  }

  function subjectName(id) { return st.subjects.find(s => s.id === id)?.name || '—'; }

  function renderTable() {
    if (myExams.length === 0) {
      return `<div class="empty"><div class="empty-title">No assessments yet</div><p>Create one for a class and your subject — this becomes an entry on Marks Entry once created.</p></div>`;
    }
    const rows = [...myExams].sort((a, b) => (b.year - a.year) || a.term.localeCompare(b.term) || a.klass.localeCompare(b.klass));
    return `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>#</th><th>Type</th><th>Term</th><th>Year</th><th>Class</th><th>Subject</th><th>Total marks</th><th>Entries</th><th></th></tr></thead>
            <tbody>
              ${rows.map((e, i) => {
                const count = st.results.filter(r => r.examId === e.id).length;
                const classSize = st.students.filter(s => s.klass === e.klass).length;
                return `<tr>
                  <td class="row-index">${i + 1}</td>
                  <td>${UI.esc(e.type)}</td>
                  <td>${UI.esc(e.term)}</td>
                  <td class="num">${UI.esc(e.year)}</td>
                  <td>${UI.esc(e.klass)}</td>
                  <td>${UI.esc(subjectName(e.subjectId))}</td>
                  <td class="num">${UI.esc(e.totalMarks)}</td>
                  <td class="num">${count} / ${classSize}</td>
                  <td><button class="btn btn-sm btn-primary" data-enter="${e.id}">Enter marks</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function wireRowActions() {
    document.querySelectorAll('[data-enter]').forEach(btn => {
      btn.onclick = () => { App.state.selectedExamId = btn.dataset.enter; App.navigate('results'); };
    });
  }

  function openForm() {
    if (mySubjects.length === 0) { UI.toast('No subjects assigned to you'); return; }
    if (st.examTypes.length === 0) { UI.toast('Ask your administrator to add an exam type first, from Settings -> Exam types'); return; }
    const classOpts = isTeacher && scope.classLabels.size ? [...scope.classLabels].sort() : classOptionLabels(st);
    UI.openModal(`
      <h2>New assessment</h2>
      <div class="form-grid">
        <div class="field">
          <label>Exam type</label>
          <select id="f_type">
            ${st.examTypes.map(t => `<option value="${UI.esc(t.name)}">${UI.esc(t.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Term</label>
          <select id="f_term">
            ${['Term 1', 'Term 2', 'Term 3'].map(t => `<option value="${t}" ${st.settings.term === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Year</label>
          <input type="number" id="f_year" value="${st.settings.year}">
        </div>
        <div class="field">
          <label>Class / Grade</label>
          ${classOpts.length
            ? `<select id="f_klass"><option value="">Select class</option>${classOpts.map(c => `<option value="${UI.esc(c)}">${UI.esc(c)}</option>`).join('')}</select>`
            : `<input type="text" id="f_klass" placeholder="e.g. Grade 7">`}
        </div>
        <div class="field">
          <label>Subject</label>
          <select id="f_subject">
            ${mySubjects.map(s => `<option value="${s.id}">${UI.esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Total marks</label>
          <input type="number" id="f_total" value="100">
        </div>
        <div class="field">
          <label>Date (optional)</label>
          <input type="date" id="f_date">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">Create assessment</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const payload = {
          type: root.querySelector('#f_type').value,
          term: root.querySelector('#f_term').value,
          year: Number(root.querySelector('#f_year').value),
          klass: root.querySelector('#f_klass').value.trim(),
          subjectId: root.querySelector('#f_subject').value,
          totalMarks: Number(root.querySelector('#f_total').value) || 100,
          date: root.querySelector('#f_date').value
        };
        if (!payload.klass) { UI.toast('Class is required'); return; }
        try {
          await Store.addExam(payload);
          UI.toast('Assessment created');
          UI.closeModal();
          Views.assessments();
        } catch (err) {
          UI.toast('Could not save: ' + err.message);
        }
      };
    });
  }

  document.getElementById('content').innerHTML = `<div id="wrap">${renderTable()}</div>`;
  const addBtn = document.getElementById('addAssessmentBtn');
  if (addBtn) addBtn.onclick = openForm;
  wireRowActions();
};

/* ------------------------- GRADEBOOK ------------------------- */
// A per-subject mark book: one class, one (own) subject, every
// sitting recorded this term/year side by side, with a running
// average — the "gradebook" a subject teacher actually flips through,
// as distinct from Broadsheet (whole class x every subject) or
// Marks Analysis (published, school-wide).

Views.gradebook = async function () {
  setTopbarActions('');
  showLoading();
  const st = await Store.current();
  const user = Auth.currentUser();
  const scope = teacherScope(st, user);
  const isTeacher = scope.isTeacher;

  const mySubjects = isTeacher ? st.subjects.filter(s => scope.subjectIds.has(s.id)) : st.subjects;
  const myKlasses = isTeacher && scope.classLabels.size ? [...scope.classLabels].sort() : classOptionLabels(st);

  if (mySubjects.length === 0 || myKlasses.length === 0 || st.students.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">Nothing to show yet</div><p>The Gradebook needs at least one class, one of your subjects, and some recorded marks.</p></div>`;
    return;
  }

  let picked = { klass: myKlasses[0], subjectId: mySubjects[0].id, term: st.settings.term, year: String(st.settings.year) };

  function examTypesFor(subjectId, klass, term, year) {
    return st.exams
      .filter(e => e.subjectId === subjectId && e.klass === klass && e.term === term && String(e.year) === year)
      .sort((a, b) => (st.examTypes.findIndex(t => t.name === a.type)) - (st.examTypes.findIndex(t => t.name === b.type)));
  }

  function renderPicker() {
    return `
      <div class="filter-row">
        <select id="gbKlass">${myKlasses.map(k => `<option value="${UI.esc(k)}" ${k === picked.klass ? 'selected' : ''}>${UI.esc(k)}</option>`).join('')}</select>
        <select id="gbSubject">${mySubjects.map(s => `<option value="${s.id}" ${s.id === picked.subjectId ? 'selected' : ''}>${UI.esc(s.name)}</option>`).join('')}</select>
        <select id="gbTerm">${['Term 1', 'Term 2', 'Term 3'].map(t => `<option value="${t}" ${t === picked.term ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <input type="number" id="gbYear" value="${picked.year}" style="width:90px;">
      </div>
    `;
  }

  function renderGrid() {
    const exams = examTypesFor(picked.subjectId, picked.klass, picked.term, picked.year);
    const students = st.students.filter(s => s.klass === picked.klass).sort(UI.byAdmissionDesc);
    if (students.length === 0) {
      return `<div class="empty"><div class="empty-title">No learners in ${UI.esc(picked.klass)}</div></div>`;
    }
    if (exams.length === 0) {
      return `<div class="empty"><div class="empty-title">No assessments recorded yet</div><p>Create one from Assessments for ${UI.esc(picked.klass)} &middot; ${UI.esc(st.subjects.find(s => s.id === picked.subjectId)?.name || '')} in ${UI.esc(picked.term)} ${UI.esc(picked.year)}.</p></div>`;
    }
    return `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr>
              <th>#</th><th>Name</th><th>ADM NO.</th>
              ${exams.map(e => `<th>${UI.esc(e.type)} (/${e.totalMarks})</th>`).join('')}
              <th>Average</th><th>Level</th>
            </tr></thead>
            <tbody>
              ${students.map((s, i) => {
                const pcts = [];
                const cells = exams.map(e => {
                  const res = st.results.find(r => r.examId === e.id && r.studentId === s.id);
                  if (!res) return `<td class="num">—</td>`;
                  pcts.push(Grading.percent(res.marks, e.totalMarks));
                  return `<td class="num">${res.marks}</td>`;
                }).join('');
                const avg = Grading.average(pcts);
                const band = avg === null ? Grading.MISSING_BAND : Grading.levelForMarks(avg, 100, st.settings.gradingBands);
                return `<tr>
                  <td class="row-index">${i + 1}</td>
                  <td>${UI.esc(s.name)}</td>
                  <td class="num">${UI.esc(s.admissionNo) || '—'}</td>
                  ${cells}
                  <td class="num">${avg === null ? UI.badge(Grading.MISSING_BAND) : avg.toFixed(1) + '%'}</td>
                  <td>${UI.badge(band)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function wirePicker() {
    document.getElementById('gbKlass').onchange = (e) => { picked.klass = e.target.value; paint(); };
    document.getElementById('gbSubject').onchange = (e) => { picked.subjectId = e.target.value; paint(); };
    document.getElementById('gbTerm').onchange = (e) => { picked.term = e.target.value; paint(); };
    document.getElementById('gbYear').onchange = (e) => { picked.year = String(Number(e.target.value) || st.settings.year); paint(); };
  }

  function paint() {
    document.getElementById('content').innerHTML = `
      ${renderPicker()}
      <p class="field-hint" style="margin:10px 0 14px 0;">Every recorded sitting for this class/subject/term, side by side, with a running average.</p>
      <div id="gbGridWrap">${renderGrid()}</div>
    `;
    wirePicker();
  }

  paint();
};

/* Reports hub removed — "Report Cards" (Views.reports) was a second,
   near-duplicate "Reports" sidebar entry. It's the one kept, since
   it's the actual printable report; the hub's other links (Broadsheet,
   Analysis, Attendance, Competency, Send to Parents) already have
   their own direct sidebar entries, so nothing but the duplicate
   itself was lost. */
