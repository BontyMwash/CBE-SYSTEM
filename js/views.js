/* ============================================================
   views.js — one render function per route. Each function is now
   ASYNC: it awaits Store.current() (a real network call) before
   rendering, then wires up its own event listeners.

   Two patterns worth knowing:
   - Infrequent actions (add/edit/delete a student, subject, exam...)
     just await the Store call, then re-run the whole view function
     to refresh from the server. Simple and always correct.
   - Marks entry (the hot path — many rapid edits) updates the DOM
     optimistically from the value just typed, and saves in the
     background, rather than re-fetching after every keystroke.
   ============================================================ */

const Views = {};

function setTopbarActions(html) {
  document.getElementById('topbarActions').innerHTML = html || '';
}

function classesFromStudents(students) {
  return [...new Set(students.map(s => s.klass).filter(Boolean))].sort();
}

// Preferred source for "which class" dropdowns everywhere in the app:
// the Classes/Streams page (st.classes). Falls back to whatever class
// names already exist on students, for schools that haven't set up
// Classes yet (or are mid-migration).
function classOptionLabels(st) {
  if (st.classes && st.classes.length) {
    return [...st.classes].sort((a, b) => a.label.localeCompare(b.label)).map(c => c.label);
  }
  return classesFromStudents(st.students);
}

function showLoading() {
  document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">Loading…</div></div>`;
}

/* ------------------------- DASHBOARD ------------------------- */

Views.dashboard = async function () {
  setTopbarActions('');
  showLoading();
  const st = await Store.current();

  const totalStudents = st.students.length;
  const totalExams = st.exams.length;
  const totalSubjects = st.subjects.length;
  const totalResults = st.results.length;
  const classes = classesFromStudents(st.students);

  let classRows = '';
  if (classes.length === 0) {
    classRows = `<tr><td colspan="4" class="row-index">No classes yet — add students to see class performance.</td></tr>`;
  } else {
    classRows = classes.map(klass => {
      const studentsInClass = st.students.filter(s => s.klass === klass);
      const examsForClass = st.exams.filter(e => e.klass === klass);
      const pcts = [];
      examsForClass.forEach(exam => {
        st.results.filter(r => r.examId === exam.id).forEach(r => {
          pcts.push(Grading.percent(r.marks, exam.totalMarks));
        });
      });
      const avg = Grading.average(pcts);
      const band = avg === null ? null : Grading.levelForMarks(avg, 100, st.settings.gradingBands);
      return `<tr>
        <td>${UI.esc(klass)}</td>
        <td class="num">${studentsInClass.length}</td>
        <td class="num">${examsForClass.length}</td>
        <td>${avg === null ? '<span class="row-index">no data</span>' : `<span class="num">${avg.toFixed(1)}%</span> ${UI.badge(band)}`}</td>
      </tr>`;
    }).join('');
  }

  const html = `
    <div class="grid grid-4 section-block">
      <div class="card stat-card">
        <p class="stat-label">Students</p>
        <p class="stat-value">${totalStudents}</p>
        <p class="stat-sub">across ${classes.length} class${classes.length === 1 ? '' : 'es'}</p>
      </div>
      <div class="card stat-card">
        <p class="stat-label">Subjects</p>
        <p class="stat-value">${totalSubjects}</p>
      </div>
      <div class="card stat-card">
        <p class="stat-label">Exams recorded</p>
        <p class="stat-value">${totalExams}</p>
        <p class="stat-sub">${st.settings.term} · ${st.settings.year}</p>
      </div>
      <div class="card stat-card">
        <p class="stat-label">Marks entered</p>
        <p class="stat-value">${totalResults}</p>
      </div>
    </div>

    <div class="section-block">
      <h2 class="section-title">Class performance overview</h2>
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>Class</th><th>Students</th><th>Exams</th><th>Average</th></tr></thead>
            <tbody>${classRows}</tbody>
          </table>
        </div>
      </div>
    </div>

    ${totalStudents === 0 ? `
    <div class="card" style="text-align:center; padding:36px;">
      <p class="section-title" style="margin-bottom:8px;">Get started</p>
      <p class="stat-sub" style="margin-bottom:16px;">Add your students and subjects first, then create your Opener, Midterm or Endterm exams.</p>
      <button class="btn btn-primary" id="goStudents">Add students</button>
    </div>` : ''}
  `;
  document.getElementById('content').innerHTML = html;
  const goBtn = document.getElementById('goStudents');
  if (goBtn) goBtn.onclick = () => App.navigate('students');
};

/* ------------------------- STUDENTS ------------------------- */

Views.students = async function () {
  setTopbarActions(`
    <button class="btn" id="importStudentsBtn">Import from Excel/CSV</button>
    <button class="btn btn-primary" id="addStudentBtn">+ Add student</button>
  `);
  showLoading();
  const st = await Store.current();

  const classes = classesFromStudents(st.students);
  const filterHtml = `
    <div class="filter-row">
      <select id="classFilter">
        <option value="">All classes</option>
        ${classes.map(c => `<option value="${UI.esc(c)}">${UI.esc(c)}</option>`).join('')}
      </select>
      <input type="text" id="searchBox" placeholder="Search by name or admission no." style="min-width:220px;">
    </div>
  `;

  function renderTable(filterClass, search) {
    let rows = st.students;
    if (filterClass) rows = rows.filter(s => s.klass === filterClass);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(s => s.name.toLowerCase().includes(q) || (s.admissionNo || '').toLowerCase().includes(q));
    }
    rows = [...rows].sort((a, b) => a.klass.localeCompare(b.klass) || a.name.localeCompare(b.name));

    if (rows.length === 0) {
      return `<div class="empty"><div class="empty-title">No students found</div><p>Try a different search, or add a new student.</p></div>`;
    }

    return `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>#</th><th>Name</th><th>Admission No.</th><th>Class</th><th></th></tr></thead>
            <tbody>
              ${rows.map((s, i) => `
                <tr>
                  <td class="row-index">${i + 1}</td>
                  <td>${UI.esc(s.name)}</td>
                  <td class="num">${UI.esc(s.admissionNo) || '—'}</td>
                  <td>${UI.esc(s.klass)}</td>
                  <td>
                    <button class="btn btn-sm btn-ghost" data-edit="${s.id}">Edit</button>
                    <button class="btn btn-sm btn-danger" data-del="${s.id}">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function paint() {
    const filterClass = document.getElementById('classFilter')?.value || '';
    const search = document.getElementById('searchBox')?.value || '';
    document.getElementById('studentsTableWrap').innerHTML = renderTable(filterClass, search);
    wireRowActions();
  }

  function wireRowActions() {
    document.querySelectorAll('[data-edit]').forEach(btn => {
      btn.onclick = () => openStudentForm(st.students.find(s => s.id === btn.dataset.edit));
    });
    document.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = () => {
        const s = st.students.find(s => s.id === btn.dataset.del);
        UI.confirmAction(`Delete ${s.name}? This also removes their recorded results.`, async () => {
          await Store.deleteStudent(s.id);
          UI.toast('Student deleted');
          Views.students();
        });
      };
    });
  }

  function openStudentForm(existing) {
    const isEdit = !!existing;
    const classOpts = classOptionLabels(st);
    const classField = classOpts.length
      ? `<select id="f_klass">
           <option value="">Select class</option>
           ${classOpts.map(c => `<option value="${UI.esc(c)}" ${isEdit && existing.klass === c ? 'selected' : ''}>${UI.esc(c)}</option>`).join('')}
         </select>
         <p class="field-hint">Don't see the class you need? Add it on the <a href="#classes">Classes</a> page.</p>`
      : `<input type="text" id="f_klass" value="${isEdit ? UI.esc(existing.klass) : ''}" placeholder="e.g. Grade 7">
         <p class="field-hint">Tip: set up classes/streams on the <a href="#classes">Classes</a> page for a dropdown here instead.</p>`;
    UI.openModal(`
      <h2>${isEdit ? 'Edit student' : 'Add student'}</h2>
      <div class="form-grid">
        <div class="field full">
          <label>Full name</label>
          <input type="text" id="f_name" value="${isEdit ? UI.esc(existing.name) : ''}" placeholder="e.g. Amina Wanjiru">
        </div>
        <div class="field">
          <label>Admission number</label>
          <input type="text" id="f_admno" value="${isEdit ? UI.esc(existing.admissionNo) : ''}" placeholder="e.g. 2025-014">
        </div>
        <div class="field">
          <label>Class / Grade</label>
          ${classField}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">${isEdit ? 'Save changes' : 'Add student'}</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const name = root.querySelector('#f_name').value.trim();
        const admissionNo = root.querySelector('#f_admno').value.trim();
        const klass = root.querySelector('#f_klass').value.trim();
        if (!name || !klass) { UI.toast('Name and class are required'); return; }
        try {
          if (isEdit) {
            await Store.updateStudent(existing.id, { name, admissionNo, klass });
            UI.toast('Student updated');
          } else {
            await Store.addStudent({ name, admissionNo, klass });
            UI.toast('Student added');
          }
          UI.closeModal();
          Views.students();
        } catch (err) {
          UI.toast('Could not save: ' + err.message);
        }
      };
    });
  }

  document.getElementById('content').innerHTML = `
    ${filterHtml}
    <div id="studentsTableWrap">${renderTable('', '')}</div>
  `;
  document.getElementById('addStudentBtn').onclick = () => openStudentForm(null);
  document.getElementById('importStudentsBtn').onclick = () => Importer.openImportModal(() => Views.students());
  document.getElementById('classFilter').onchange = paint;
  document.getElementById('searchBox').oninput = paint;
  wireRowActions();
};

/* ------------------------- SUBJECTS ------------------------- */

Views.subjects = async function () {
  setTopbarActions(`<button class="btn btn-primary" id="addSubjectBtn">+ Add subject</button>`);
  showLoading();
  const st = await Store.current();

  function renderTable() {
    if (st.subjects.length === 0) {
      return `<div class="empty"><div class="empty-title">No subjects yet</div><p>Add subjects like Mathematics, English, Integrated Science.</p></div>`;
    }
    const rows = [...st.subjects].sort((a, b) => a.name.localeCompare(b.name));
    return `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>#</th><th>Subject</th><th>Code</th><th>Exams recorded</th><th></th></tr></thead>
            <tbody>
              ${rows.map((s, i) => {
                const examCount = st.exams.filter(e => e.subjectId === s.id).length;
                return `<tr>
                  <td class="row-index">${i + 1}</td>
                  <td>${UI.esc(s.name)}</td>
                  <td class="num">${UI.esc(s.code) || '—'}</td>
                  <td class="num">${examCount}</td>
                  <td>
                    <button class="btn btn-sm btn-ghost" data-edit="${s.id}">Edit</button>
                    <button class="btn btn-sm btn-danger" data-del="${s.id}">Delete</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function wireRowActions() {
    document.querySelectorAll('[data-edit]').forEach(btn => {
      btn.onclick = () => openForm(st.subjects.find(s => s.id === btn.dataset.edit));
    });
    document.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = () => {
        const s = st.subjects.find(s => s.id === btn.dataset.del);
        UI.confirmAction(`Delete ${s.name}? This also removes exams and results recorded under it.`, async () => {
          await Store.deleteSubject(s.id);
          UI.toast('Subject deleted');
          Views.subjects();
        });
      };
    });
  }

  function suggestCode(name) {
    return name.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase();
  }

  function openForm(existing) {
    const isEdit = !!existing;
    UI.openModal(`
      <h2>${isEdit ? 'Edit subject' : 'Add subject'}</h2>
      <div class="form-grid">
        <div class="field full">
          <label>Subject name</label>
          <input type="text" id="f_name" value="${isEdit ? UI.esc(existing.name) : ''}" placeholder="e.g. Mathematics">
        </div>
        <div class="field">
          <label>Subject code</label>
          <input type="text" id="f_code" maxlength="6" style="text-transform:uppercase;" value="${isEdit ? UI.esc(existing.code) : ''}" placeholder="e.g. MAT">
          <p class="field-hint">Short code used on the broadsheet so more subjects fit the printable page.</p>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">${isEdit ? 'Save changes' : 'Add subject'}</button>
      </div>
    `, (root) => {
      const nameInput = root.querySelector('#f_name');
      const codeInput = root.querySelector('#f_code');
      // Auto-fill the code from the name as the admin types, but stop
      // auto-filling the moment they touch the code field themselves.
      let codeTouched = isEdit && !!existing.code;
      codeInput.addEventListener('input', () => { codeTouched = true; });
      nameInput.addEventListener('input', () => {
        if (!codeTouched) codeInput.value = suggestCode(nameInput.value);
      });
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const name = nameInput.value.trim();
        let code = codeInput.value.trim().toUpperCase();
        if (!name) { UI.toast('Subject name is required'); return; }
        if (!code) code = suggestCode(name);
        try {
          if (isEdit) { await Store.updateSubject(existing.id, { name, code }); UI.toast('Subject updated'); }
          else { await Store.addSubject({ name, code }); UI.toast('Subject added'); }
          UI.closeModal();
          Views.subjects();
        } catch (err) {
          UI.toast('Could not save: ' + err.message);
        }
      };
    });
  }

  document.getElementById('content').innerHTML = `<div id="wrap">${renderTable()}</div>`;
  document.getElementById('addSubjectBtn').onclick = () => openForm(null);
  wireRowActions();
};

/* ------------------------- EXAMS ------------------------- */

Views.exams = async function () {
  showLoading();
  const st = await Store.current();
  setTopbarActions(`
    <button class="btn" id="addExamSingleBtn" ${st.subjects.length === 0 ? 'disabled' : ''}>+ Add single subject</button>
    <button class="btn btn-primary" id="addExamAllBtn" ${st.subjects.length === 0 ? 'disabled' : ''}>+ New exam (all subjects)</button>
  `);

  function subjectName(id) {
    return st.subjects.find(s => s.id === id)?.name || '—';
  }

  function renderTable() {
    if (st.exams.length === 0) {
      return `<div class="empty"><div class="empty-title">No exams yet</div><p>Create an Opener, Midterm or Endterm exam for a class and subject.</p></div>`;
    }
    const rows = [...st.exams].sort((a, b) => (b.year - a.year) || a.term.localeCompare(b.term) || a.klass.localeCompare(b.klass));
    return `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>#</th><th>Type</th><th>Term</th><th>Year</th><th>Class</th><th>Subject</th><th>Total marks</th><th>Entries</th><th></th></tr></thead>
            <tbody>
              ${rows.map((e, i) => {
                const count = st.results.filter(r => r.examId === e.id).length;
                return `<tr>
                  <td class="row-index">${i + 1}</td>
                  <td>${UI.esc(e.type)}</td>
                  <td>${UI.esc(e.term)}</td>
                  <td class="num">${UI.esc(e.year)}</td>
                  <td>${UI.esc(e.klass)}</td>
                  <td>${UI.esc(subjectName(e.subjectId))}</td>
                  <td class="num">${UI.esc(e.totalMarks)}</td>
                  <td class="num">${count}</td>
                  <td>
                    <button class="btn btn-sm btn-ghost" data-enter="${e.id}">Enter marks</button>
                    <button class="btn btn-sm btn-ghost" data-edit="${e.id}">Edit</button>
                    <button class="btn btn-sm btn-danger" data-del="${e.id}">Delete</button>
                  </td>
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
    document.querySelectorAll('[data-edit]').forEach(btn => {
      btn.onclick = () => openForm(st.exams.find(e => e.id === btn.dataset.edit));
    });
    document.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = () => {
        const e = st.exams.find(e => e.id === btn.dataset.del);
        UI.confirmAction(`Delete this ${e.type} exam? Recorded marks for it will also be removed.`, async () => {
          await Store.deleteExam(e.id);
          UI.toast('Exam deleted');
          Views.exams();
        });
      };
    });
  }

  function openForm(existing) {
    const isEdit = !!existing;
    if (st.subjects.length === 0) { UI.toast('Add a subject first'); return; }
    const classOpts = classOptionLabels(st);
    const classField = classOpts.length
      ? `<select id="f_klass">
           <option value="">Select class</option>
           ${classOpts.map(c => `<option value="${UI.esc(c)}" ${isEdit && existing.klass === c ? 'selected' : ''}>${UI.esc(c)}</option>`).join('')}
         </select>`
      : `<input type="text" id="f_klass" value="${isEdit ? UI.esc(existing.klass) : ''}" placeholder="e.g. Grade 7">
         <p class="field-hint">Tip: set up classes on the <a href="#classes">Classes</a> page for a dropdown here.</p>`;
    UI.openModal(`
      <h2>${isEdit ? 'Edit exam' : 'New exam'}</h2>
      <div class="form-grid">
        <div class="field">
          <label>Exam type</label>
          <select id="f_type">
            ${['Opener', 'Midterm', 'Endterm'].map(t => `<option value="${t}" ${isEdit && existing.type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Term</label>
          <select id="f_term">
            ${['Term 1', 'Term 2', 'Term 3'].map(t => `<option value="${t}" ${isEdit ? existing.term === t ? 'selected' : '' : st.settings.term === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Year</label>
          <input type="number" id="f_year" value="${isEdit ? existing.year : st.settings.year}">
        </div>
        <div class="field">
          <label>Class / Grade</label>
          ${classField}
        </div>
        <div class="field">
          <label>Subject</label>
          <select id="f_subject">
            ${st.subjects.map(s => `<option value="${s.id}" ${isEdit && existing.subjectId === s.id ? 'selected' : ''}>${UI.esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Total marks</label>
          <input type="number" id="f_total" value="${isEdit ? existing.totalMarks : 100}">
        </div>
        <div class="field">
          <label>Date (optional)</label>
          <input type="date" id="f_date" value="${isEdit ? existing.date : ''}">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">${isEdit ? 'Save changes' : 'Create exam'}</button>
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
          if (isEdit) { await Store.updateExam(existing.id, payload); UI.toast('Exam updated'); }
          else { await Store.addExam(payload); UI.toast('Exam created'); }
          UI.closeModal();
          Views.exams();
        } catch (err) {
          UI.toast('Could not save: ' + err.message);
        }
      };
    });
  }

  function openAllSubjectsForm() {
    if (st.subjects.length === 0) { UI.toast('Add a subject first'); return; }
    const classOpts = classOptionLabels(st);
    const classField = classOpts.length
      ? `<select id="f_klass">
           <option value="">Select class</option>
           ${classOpts.map(c => `<option value="${UI.esc(c)}">${UI.esc(c)}</option>`).join('')}
         </select>`
      : `<input type="text" id="f_klass" placeholder="e.g. Grade 7">
         <p class="field-hint">Tip: set up classes on the <a href="#classes">Classes</a> page for a dropdown here.</p>`;
    UI.openModal(`
      <h2>New exam — all subjects</h2>
      <p class="field-hint" style="margin-bottom:14px;">
        Creates this exam for every subject at once (defaulting to 100 marks each).
        Each subject teacher can set their own "out of how many" when they go to
        enter marks — no need to know every paper's total right now.
      </p>
      <div class="form-grid">
        <div class="field">
          <label>Exam type</label>
          <select id="f_type">
            ${['Opener', 'Midterm', 'Endterm'].map(t => `<option value="${t}">${t}</option>`).join('')}
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
          ${classField}
        </div>
        <div class="field">
          <label>Date (optional)</label>
          <input type="date" id="f_date">
        </div>
      </div>
      <div class="field-hint" style="margin-top:14px;">Will create exam entries for: ${st.subjects.map(s => UI.esc(s.name)).join(', ')}</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">Create for all ${st.subjects.length} subjects</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const type = root.querySelector('#f_type').value;
        const term = root.querySelector('#f_term').value;
        const year = Number(root.querySelector('#f_year').value);
        const klass = root.querySelector('#f_klass').value.trim();
        const date = root.querySelector('#f_date').value;
        if (!klass) { UI.toast('Class is required'); return; }

        let created = 0, skipped = 0;
        for (const subj of st.subjects) {
          const exists = st.exams.some(e => e.type === type && e.term === term && String(e.year) === String(year) && e.klass === klass && e.subjectId === subj.id);
          if (exists) { skipped++; continue; }
          try {
            await Store.addExam({ type, term, year, klass, subjectId: subj.id, totalMarks: 100, date });
            created++;
          } catch (err) {
            UI.toast(`Could not create exam for ${subj.name}: ${err.message}`);
          }
        }
        UI.closeModal();
        UI.toast(`Created ${created} exam${created === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} that already existed` : ''}`);
        Views.exams();
      };
    });
  }

  document.getElementById('content').innerHTML = `<div id="wrap">${renderTable()}</div>`;
  const addBtn = document.getElementById('addExamSingleBtn');
  if (addBtn) addBtn.onclick = () => openForm(null);
  const addAllBtn = document.getElementById('addExamAllBtn');
  if (addAllBtn) addAllBtn.onclick = () => openAllSubjectsForm();
  wireRowActions();
};

/* ------------------------- RESULTS ENTRY ------------------------- */

Views.results = async function () {
  showLoading();
  setTopbarActions('');
  const st = await Store.current();

  if (st.exams.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">No exams to enter marks for</div><p>Create an exam first from the Exams page.</p></div>`;
    return;
  }

  function subjectName(id) { return st.subjects.find(s => s.id === id)?.name || '—'; }

  // Exams are organized as "folders" — Class -> Exam type -> Term -> Year —
  // and the last picker narrows down to a single subject's exam to enter
  // marks for. This keeps the pickers short even with many exams.
  const startExam = App.state.selectedExamId && st.exams.find(e => e.id === App.state.selectedExamId)
    ? st.exams.find(e => e.id === App.state.selectedExamId)
    : [...st.exams].sort((a, b) => (b.year - a.year) || a.term.localeCompare(b.term))[0];

  let picked = { klass: startExam.klass, type: startExam.type, term: startExam.term, year: String(startExam.year) };
  let selectedId = startExam.id;

  function distinctSorted(arr) { return [...new Set(arr)].sort(); }
  function examsMatching(filter) {
    return st.exams.filter(e =>
      (filter.klass === undefined || e.klass === filter.klass) &&
      (filter.type === undefined || e.type === filter.type) &&
      (filter.term === undefined || e.term === filter.term) &&
      (filter.year === undefined || String(e.year) === filter.year)
    );
  }

  function renderPicker() {
    const klasses = distinctSorted(st.exams.map(e => e.klass));
    const types = distinctSorted(examsMatching({ klass: picked.klass }).map(e => e.type));
    const terms = distinctSorted(examsMatching({ klass: picked.klass, type: picked.type }).map(e => e.term));
    const years = distinctSorted(examsMatching({ klass: picked.klass, type: picked.type, term: picked.term }).map(e => String(e.year)));
    const subjectExams = examsMatching(picked).sort((a, b) => subjectName(a.subjectId).localeCompare(subjectName(b.subjectId)));

    return `
      <div class="filter-row">
        <select id="folderKlass">
          ${klasses.map(k => `<option value="${UI.esc(k)}" ${k === picked.klass ? 'selected' : ''}>${UI.esc(k)}</option>`).join('')}
        </select>
        <select id="folderType">
          ${types.map(t => `<option value="${UI.esc(t)}" ${t === picked.type ? 'selected' : ''}>${UI.esc(t)}</option>`).join('')}
        </select>
        <select id="folderTerm">
          ${terms.map(t => `<option value="${UI.esc(t)}" ${t === picked.term ? 'selected' : ''}>${UI.esc(t)}</option>`).join('')}
        </select>
        <select id="folderYear">
          ${years.map(y => `<option value="${UI.esc(y)}" ${y === picked.year ? 'selected' : ''}>${UI.esc(y)}</option>`).join('')}
        </select>
        <select id="examPicker">
          ${subjectExams.map(e => `<option value="${e.id}" ${e.id === selectedId ? 'selected' : ''}>${UI.esc(subjectName(e.subjectId))}</option>`).join('')}
        </select>
      </div>
      <p class="field-hint" style="margin-bottom:14px;">
        Open the class, exam type, term and year for this sitting, then pick the subject to enter marks for.
      </p>
    `;
  }

  function wirePicker() {
    const klassSel = document.getElementById('folderKlass');
    const typeSel = document.getElementById('folderType');
    const termSel = document.getElementById('folderTerm');
    const yearSel = document.getElementById('folderYear');
    const examSel = document.getElementById('examPicker');

    klassSel.onchange = () => { picked = { klass: klassSel.value, type: undefined, term: undefined, year: undefined }; syncAndRepaint(); };
    typeSel.onchange = () => { picked = { klass: picked.klass, type: typeSel.value, term: undefined, year: undefined }; syncAndRepaint(); };
    termSel.onchange = () => { picked = { klass: picked.klass, type: picked.type, term: termSel.value, year: undefined }; syncAndRepaint(); };
    yearSel.onchange = () => { picked = { klass: picked.klass, type: picked.type, term: picked.term, year: yearSel.value }; syncAndRepaint(); };
    examSel.onchange = () => {
      selectedId = examSel.value;
      App.state.selectedExamId = selectedId;
      paint(selectedId);
    };

    function syncAndRepaint() {
      // Fill in any undefined lower levels with the first available option
      // for the newly narrowed folder, then re-render the whole row.
      const types = distinctSorted(examsMatching({ klass: picked.klass }).map(e => e.type));
      if (picked.type === undefined) picked.type = types[0];
      const terms = distinctSorted(examsMatching({ klass: picked.klass, type: picked.type }).map(e => e.term));
      if (picked.term === undefined) picked.term = terms[0];
      const years = distinctSorted(examsMatching({ klass: picked.klass, type: picked.type, term: picked.term }).map(e => String(e.year)));
      if (picked.year === undefined) picked.year = years[0];
      const subjectExams = examsMatching(picked);
      selectedId = subjectExams[0]?.id;
      App.state.selectedExamId = selectedId;

      const filterRow = document.querySelector('.filter-row');
      const hint = filterRow.nextElementSibling;
      filterRow.outerHTML = renderPicker();
      // renderPicker() also re-adds its own hint paragraph, so drop the
      // now-duplicated old one.
      if (hint && hint.classList.contains('field-hint')) hint.remove();
      wirePicker();
      if (selectedId) paint(selectedId);
    }
  }

  function renderTotalMarksBar(examId) {
    const exam = st.exams.find(e => e.id === examId);
    return `
      <div class="card" style="margin-bottom:16px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
        <div class="field" style="margin:0;">
          <label>Total marks for this subject (out of)</label>
          <input type="number" min="1" id="totalMarksInput" class="mark-input" style="width:100px;" value="${exam.totalMarks}">
        </div>
        <p class="field-hint" style="margin:0; flex:1; min-width:220px;">
          Set this to whatever this paper was marked out of — the system converts every mark
          entered below into a percentage and performance level automatically.
        </p>
      </div>
    `;
  }

  // Looks up locally from the results we already fetched — no network
  // call needed per row, keeps the grid fast to render.
  function findResult(examId, studentId) {
    return st.results.find(r => r.examId === examId && r.studentId === studentId) || null;
  }

  function renderGrid(examId) {
    const exam = st.exams.find(e => e.id === examId);
    const students = st.students.filter(s => s.klass === exam.klass).sort((a, b) => a.name.localeCompare(b.name));
    if (students.length === 0) {
      return `<div class="empty"><div class="empty-title">No students in ${UI.esc(exam.klass)}</div><p>Add students to this class first.</p></div>`;
    }
    return `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>#</th><th>Name</th><th>Admission No.</th><th>Marks (/${exam.totalMarks})</th><th>Level</th></tr></thead>
            <tbody>
              ${students.map((s, i) => {
                const res = findResult(exam.id, s.id);
                const marks = res ? res.marks : '';
                const band = res ? Grading.levelForMarks(res.marks, exam.totalMarks, st.settings.gradingBands) : null;
                return `<tr>
                  <td class="row-index">${i + 1}</td>
                  <td>${UI.esc(s.name)}</td>
                  <td class="num">${UI.esc(s.admissionNo) || '—'}</td>
                  <td><input type="number" class="mark-input" min="0" max="${exam.totalMarks}" data-student="${s.id}" value="${marks}"></td>
                  <td class="levelCell" data-level-for="${s.id}">${UI.badge(band)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function wireGrid(examId) {
    const exam = st.exams.find(e => e.id === examId);
    document.querySelectorAll('.mark-input[data-student]').forEach(input => {
      input.addEventListener('change', () => {
        let v = input.value;
        if (v !== '') {
          v = Math.max(0, Math.min(Number(exam.totalMarks), Number(v)));
          input.value = v;
        }
        const studentId = input.dataset.student;

        // Optimistic UI: show the new badge immediately from the value
        // just typed, and update our local cache — don't wait on the
        // network round-trip, so rapid entry across many rows stays
        // smooth. Errors are reported via toast if the save fails.
        const band = v === '' ? null : Grading.levelForMarks(v, exam.totalMarks, st.settings.gradingBands);
        document.querySelector(`[data-level-for="${studentId}"]`).innerHTML = UI.badge(band);
        const existingIdx = st.results.findIndex(r => r.examId === exam.id && r.studentId === studentId);
        if (v === '') {
          if (existingIdx !== -1) st.results.splice(existingIdx, 1);
        } else if (existingIdx !== -1) {
          st.results[existingIdx].marks = Number(v);
        } else {
          st.results.push({ id: 'pending', examId: exam.id, studentId, marks: Number(v) });
        }

        Store.setResult(exam.id, studentId, v === '' ? '' : v).catch(err => {
          UI.toast('Could not save that mark: ' + err.message);
        });
      });
    });
  }

  function wireTotalMarksBar(examId) {
    const input = document.getElementById('totalMarksInput');
    input.addEventListener('change', async () => {
      const newTotal = Math.max(1, Number(input.value) || 100);
      input.value = newTotal;
      try {
        await Store.updateExam(examId, { totalMarks: newTotal });
        const exam = st.exams.find(e => e.id === examId);
        exam.totalMarks = newTotal; // keep local cache in sync
        UI.toast('Total marks updated — percentages recalculated');
        paint(examId);
      } catch (err) {
        UI.toast('Could not update total marks: ' + err.message);
      }
    });
  }

  function paint(examId) {
    document.getElementById('totalMarksBarWrap').innerHTML = renderTotalMarksBar(examId);
    document.getElementById('gridWrap').innerHTML = renderGrid(examId);
    wireTotalMarksBar(examId);
    wireGrid(examId);
  }

  App.state.selectedExamId = selectedId;
  document.getElementById('content').innerHTML = `
    ${renderPicker()}
    <div id="totalMarksBarWrap">${renderTotalMarksBar(selectedId)}</div>
    <p class="field-hint" style="margin-bottom:14px;">Marks save automatically as you type. Leave blank for a student who did not sit the exam.</p>
    <div id="gridWrap">${renderGrid(selectedId)}</div>
  `;

  wirePicker();
  wireTotalMarksBar(selectedId);
  wireGrid(selectedId);
};

/* ------------------------- REPORTS ------------------------- */

Views.reports = async function (mode) {
  showLoading();
  setTopbarActions('');
  const st = await Store.current();

  if (st.students.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">No students yet</div><p>Add students to generate report cards.</p></div>`;
    return;
  }

  const activeMode = mode === 'exam' ? 'exam' : 'card';

  const tabsHtml = `
    <div class="filter-row no-print" style="margin-bottom:6px;">
      <button class="btn ${activeMode === 'card' ? 'btn-primary' : ''}" id="tabCard">Student report card</button>
      <button class="btn ${activeMode === 'exam' ? 'btn-primary' : ''}" id="tabExam">Single exam report</button>
    </div>
  `;

  document.getElementById('content').innerHTML = `<div id="tabsWrap">${tabsHtml}</div><div id="modeWrap"></div>`;
  document.getElementById('tabCard').onclick = () => Views.reports('card');
  document.getElementById('tabExam').onclick = () => Views.reports('exam');

  if (activeMode === 'exam') { renderSingleExamReport(st); return; }
  renderStudentReportCard(st);
};

/* ---- Mode: merged term report card (Opener + Midterm + Endterm per subject) ---- */
function renderStudentReportCard(st) {
  const classes = classesFromStudents(st.students);

  const html = `
    <div class="filter-row no-print">
      <select id="classSel">
        <option value="">Select class</option>
        ${classes.map(c => `<option value="${UI.esc(c)}">${UI.esc(c)}</option>`).join('')}
      </select>
      <select id="studentSel"><option value="">Select student</option></select>
      <select id="termSel">
        ${['Term 1', 'Term 2', 'Term 3'].map(t => `<option value="${t}" ${st.settings.term === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <input type="number" id="yearSel" value="${st.settings.year}" style="width:90px;">
      <button class="btn" id="printAllBtn" disabled>Merged report — whole class</button>
      <button class="btn btn-brass" id="printBtn">Print / Save as PDF</button>
    </div>
    <div id="reportWrap"></div>
  `;
  document.getElementById('modeWrap').innerHTML = html;

  const classSel = document.getElementById('classSel');
  const studentSel = document.getElementById('studentSel');
  const termSel = document.getElementById('termSel');
  const yearSel = document.getElementById('yearSel');
  const printAllBtn = document.getElementById('printAllBtn');

  classSel.onchange = () => {
    const klass = classSel.value;
    const students = st.students.filter(s => s.klass === klass).sort((a, b) => a.name.localeCompare(b.name));
    studentSel.innerHTML = `<option value="">Select student</option>` + students.map(s => `<option value="${s.id}">${UI.esc(s.name)}</option>`).join('');
    printAllBtn.disabled = !klass;
    document.getElementById('reportWrap').innerHTML = '';
  };

  [studentSel, termSel, yearSel].forEach(el => el.onchange = renderReport);

  function buildReportCardHTML(student, term, year) {
    const grid = Grading.buildStudentTermGrid(st, student.id, term, year);
    const overallAvg = Grading.average(grid.map(r => r.average).filter(v => v !== null));
    const overallBand = overallAvg === null ? null : Grading.levelForMarks(overallAvg, 100, st.settings.gradingBands);

    const rowsHtml = grid.map(row => {
      const cellHtml = (type) => {
        const c = row.cells[type];
        if (!c) return `<td class="num row-index">—</td>`;
        const band = Grading.levelForMarks(c.marks, c.totalMarks, st.settings.gradingBands);
        return `<td class="num">${c.marks}/${c.totalMarks} ${UI.badge(band)}</td>`;
      };
      const avgBand = row.average === null ? null : Grading.levelForMarks(row.average, 100, st.settings.gradingBands);
      return `<tr>
        <td>${UI.esc(row.subject.name)}</td>
        ${cellHtml('Opener')}
        ${cellHtml('Midterm')}
        ${cellHtml('Endterm')}
        <td class="num">${row.average === null ? '—' : row.average.toFixed(1) + '%'} ${UI.badge(avgBand)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="report-card">
        <div class="report-header">
          <div>
            <h2>${UI.esc(st.settings.schoolName)}</h2>
            <p class="stat-sub">${UI.esc(st.settings.motto)}</p>
          </div>
          <div style="text-align:right;">
            <p class="stat-sub" style="margin:0;">Report Card</p>
            <p class="stat-sub" style="margin:0;">${UI.esc(term)} · ${UI.esc(year)}</p>
          </div>
        </div>
        <div class="report-meta-grid">
          <div><span class="k">Name:</span>${UI.esc(student.name)}</div>
          <div><span class="k">Admission No.:</span>${UI.esc(student.admissionNo) || '—'}</div>
          <div><span class="k">Class:</span>${UI.esc(student.klass)}</div>
          <div><span class="k">Term average:</span>${overallAvg === null ? '—' : overallAvg.toFixed(1) + '%'}</div>
        </div>
        <table class="ledger-table" style="width:100%;">
          <thead><tr><th>Subject</th><th>Opener</th><th>Midterm</th><th>Endterm</th><th>Average</th></tr></thead>
          <tbody>${rowsHtml || `<tr><td colspan="5" class="row-index">No subjects added yet.</td></tr>`}</tbody>
        </table>
        <div class="report-footer">
          <div>
            <p class="stat-sub" style="margin:0 0 6px 0;"><strong>Overall performance:</strong> ${overallAvg === null ? 'Not enough data' : `${overallAvg.toFixed(1)}% `}${UI.badge(overallBand)}</p>
          </div>
          <div class="stamp badge-${overallBand ? overallBand.code : 'none'}" style="color:inherit;">${overallBand ? overallBand.code : '—'}</div>
        </div>
        <div class="report-footer">
          <div class="signature-line">Class Teacher</div>
          <div class="signature-line">Head Teacher</div>
        </div>
      </div>
    `;
  }

  function renderReport() {
    const studentId = studentSel.value;
    if (!studentId) { document.getElementById('reportWrap').innerHTML = ''; return; }
    const student = st.students.find(s => s.id === studentId);
    const term = termSel.value;
    const year = yearSel.value;
    document.getElementById('reportWrap').innerHTML = buildReportCardHTML(student, term, year);
  }

  printAllBtn.onclick = () => {
    const klass = classSel.value;
    if (!klass) { UI.toast('Select a class first'); return; }
    const term = termSel.value;
    const year = yearSel.value;
    const students = st.students.filter(s => s.klass === klass).sort((a, b) => a.name.localeCompare(b.name));
    if (students.length === 0) { UI.toast('No students in this class'); return; }
    studentSel.value = '';
    document.getElementById('reportWrap').innerHTML =
      `<p class="field-hint no-print" style="margin-bottom:14px;">${students.length} report cards for ${UI.esc(klass)} — ${UI.esc(term)} ${UI.esc(year)}. Each prints on its own page.</p>` +
      students.map(s => buildReportCardHTML(s, term, year)).join('');
  };

  document.getElementById('printBtn').onclick = () => window.print();
}

/* ---- Mode: single exam report — one specific sitting (class + type +
   term + year + subject), independent of the merged term report card
   above. Shows every student's mark, percentage, level and class
   position for just that one exam. ---- */
function renderSingleExamReport(st) {
  if (st.exams.length === 0) {
    document.getElementById('modeWrap').innerHTML = `<div class="empty"><div class="empty-title">No exams yet</div><p>Create an exam first from the Exams page.</p></div>`;
    return;
  }

  function subjectName(id) { return st.subjects.find(s => s.id === id)?.name || '—'; }
  function distinctSorted(arr) { return [...new Set(arr)].sort(); }
  function examsMatching(filter) {
    return st.exams.filter(e =>
      (filter.klass === undefined || e.klass === filter.klass) &&
      (filter.type === undefined || e.type === filter.type) &&
      (filter.term === undefined || e.term === filter.term) &&
      (filter.year === undefined || String(e.year) === filter.year)
    );
  }

  const startExam = [...st.exams].sort((a, b) => (b.year - a.year) || a.term.localeCompare(b.term))[0];
  let picked = { klass: startExam.klass, type: startExam.type, term: startExam.term, year: String(startExam.year) };
  let selectedId = startExam.id;

  function renderPicker() {
    const klasses = distinctSorted(st.exams.map(e => e.klass));
    const types = distinctSorted(examsMatching({ klass: picked.klass }).map(e => e.type));
    const terms = distinctSorted(examsMatching({ klass: picked.klass, type: picked.type }).map(e => e.term));
    const years = distinctSorted(examsMatching({ klass: picked.klass, type: picked.type, term: picked.term }).map(e => String(e.year)));
    const subjectExams = examsMatching(picked).sort((a, b) => subjectName(a.subjectId).localeCompare(subjectName(b.subjectId)));

    return `
      <div class="filter-row no-print">
        <select id="esKlass">${klasses.map(k => `<option value="${UI.esc(k)}" ${k === picked.klass ? 'selected' : ''}>${UI.esc(k)}</option>`).join('')}</select>
        <select id="esType">${types.map(t => `<option value="${UI.esc(t)}" ${t === picked.type ? 'selected' : ''}>${UI.esc(t)}</option>`).join('')}</select>
        <select id="esTerm">${terms.map(t => `<option value="${UI.esc(t)}" ${t === picked.term ? 'selected' : ''}>${UI.esc(t)}</option>`).join('')}</select>
        <select id="esYear">${years.map(y => `<option value="${UI.esc(y)}" ${y === picked.year ? 'selected' : ''}>${UI.esc(y)}</option>`).join('')}</select>
        <select id="esSubject">${subjectExams.map(e => `<option value="${e.id}" ${e.id === selectedId ? 'selected' : ''}>${UI.esc(subjectName(e.subjectId))}</option>`).join('')}</select>
        <button class="btn btn-brass" id="esPrintBtn">Print / Save as PDF</button>
      </div>
    `;
  }

  function buildExamReportHTML(examId) {
    const exam = st.exams.find(e => e.id === examId);
    if (!exam) return '';
    const students = st.students.filter(s => s.klass === exam.klass).sort((a, b) => a.name.localeCompare(b.name));
    const rows = students.map(s => {
      const res = st.results.find(r => r.examId === exam.id && r.studentId === s.id) || null;
      const pct = res ? Grading.percent(res.marks, exam.totalMarks) : null;
      const band = res ? Grading.levelForMarks(res.marks, exam.totalMarks, st.settings.gradingBands) : null;
      return { student: s, marks: res ? res.marks : null, pct, band };
    });

    // Rank by percentage, ties share a position
    const ranked = [...rows].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
    let rank = 0, lastPct = null, seen = 0;
    const rankMap = new Map();
    ranked.forEach(r => {
      seen++;
      if (r.pct === null) { rankMap.set(r.student.id, '—'); return; }
      if (r.pct !== lastPct) { rank = seen; lastPct = r.pct; }
      rankMap.set(r.student.id, rank);
    });

    const validPcts = rows.map(r => r.pct).filter(v => v !== null);
    const meanPct = Grading.average(validPcts);
    const highPct = validPcts.length ? Math.max(...validPcts) : null;
    const lowPct = validPcts.length ? Math.min(...validPcts) : null;
    const enteredCount = validPcts.length;

    return `
      <div class="report-card" id="esPrintArea">
        <div class="report-header">
          <div>
            <h2>${UI.esc(st.settings.schoolName)}</h2>
            <p class="stat-sub">${UI.esc(st.settings.motto)}</p>
          </div>
          <div style="text-align:right;">
            <p class="stat-sub" style="margin:0;">Single Exam Report</p>
            <p class="stat-sub" style="margin:0;">${UI.esc(exam.type)} · ${UI.esc(exam.term)} ${UI.esc(exam.year)}</p>
          </div>
        </div>
        <div class="report-meta-grid">
          <div><span class="k">Class:</span>${UI.esc(exam.klass)}</div>
          <div><span class="k">Subject:</span>${UI.esc(subjectName(exam.subjectId))}</div>
          <div><span class="k">Out of:</span>${UI.esc(exam.totalMarks)}</div>
          <div><span class="k">Entries:</span>${enteredCount} / ${students.length}</div>
        </div>
        <table class="ledger-table" style="width:100%;">
          <thead><tr><th>Pos.</th><th>Name</th><th>Adm. No.</th><th>Marks</th><th>%</th><th>Level</th></tr></thead>
          <tbody>
            ${ranked.map(r => `<tr>
              <td class="num">${rankMap.get(r.student.id)}</td>
              <td>${UI.esc(r.student.name)}</td>
              <td class="num">${UI.esc(r.student.admissionNo) || '—'}</td>
              <td class="num">${r.marks === null ? '—' : `${r.marks}/${exam.totalMarks}`}</td>
              <td class="num">${r.pct === null ? '—' : r.pct.toFixed(1) + '%'}</td>
              <td>${UI.badge(r.band)}</td>
            </tr>`).join('') || `<tr><td colspan="6" class="row-index">No students in this class.</td></tr>`}
          </tbody>
        </table>
        <div class="report-footer">
          <div>
            <p class="stat-sub" style="margin:0 0 4px 0;"><strong>Subject mean:</strong> ${meanPct === null ? '—' : meanPct.toFixed(1) + '%'}</p>
            <p class="stat-sub" style="margin:0 0 4px 0;"><strong>Highest:</strong> ${highPct === null ? '—' : highPct.toFixed(1) + '%'} &nbsp; <strong>Lowest:</strong> ${lowPct === null ? '—' : lowPct.toFixed(1) + '%'}</p>
          </div>
        </div>
        <div class="report-footer">
          <div class="signature-line">Subject Teacher</div>
          <div class="signature-line">Head Teacher</div>
        </div>
      </div>
    `;
  }

  function paint() {
    document.getElementById('esReportWrap').innerHTML = buildExamReportHTML(selectedId);
  }

  function wirePicker() {
    const klassSel = document.getElementById('esKlass');
    const typeSel = document.getElementById('esType');
    const termSel = document.getElementById('esTerm');
    const yearSel = document.getElementById('esYear');
    const subjectSel = document.getElementById('esSubject');
    document.getElementById('esPrintBtn').onclick = () => window.print();

    function syncAndRepaint() {
      const types = distinctSorted(examsMatching({ klass: picked.klass }).map(e => e.type));
      if (picked.type === undefined) picked.type = types[0];
      const terms = distinctSorted(examsMatching({ klass: picked.klass, type: picked.type }).map(e => e.term));
      if (picked.term === undefined) picked.term = terms[0];
      const years = distinctSorted(examsMatching({ klass: picked.klass, type: picked.type, term: picked.term }).map(e => String(e.year)));
      if (picked.year === undefined) picked.year = years[0];
      selectedId = examsMatching(picked)[0]?.id;

      document.getElementById('esPickerWrap').innerHTML = renderPicker();
      wirePicker();
      if (selectedId) paint();
    }

    klassSel.onchange = () => { picked = { klass: klassSel.value, type: undefined, term: undefined, year: undefined }; syncAndRepaint(); };
    typeSel.onchange = () => { picked = { klass: picked.klass, type: typeSel.value, term: undefined, year: undefined }; syncAndRepaint(); };
    termSel.onchange = () => { picked = { klass: picked.klass, type: picked.type, term: termSel.value, year: undefined }; syncAndRepaint(); };
    yearSel.onchange = () => { picked = { klass: picked.klass, type: picked.type, term: picked.term, year: yearSel.value }; syncAndRepaint(); };
    subjectSel.onchange = () => { selectedId = subjectSel.value; paint(); };
  }

  document.getElementById('modeWrap').innerHTML = `
    <div id="esPickerWrap">${renderPicker()}</div>
    <div id="esReportWrap"></div>
  `;
  wirePicker();
  paint();
}

/* ------------------------- SETTINGS ------------------------- */

Views.settings = async function () {
  showLoading();
  setTopbarActions('');
  const st = await Store.current();
  const user = Auth.currentUser();

  function renderBandsRows(bands) {
    return bands.map((b, i) => `
      <tr>
        <td><input type="text" class="mark-input" style="width:60px;" data-band-code="${i}" value="${UI.esc(b.code)}"></td>
        <td><input type="text" style="width:220px;" data-band-label="${i}" value="${UI.esc(b.label)}"></td>
        <td><input type="number" class="mark-input" data-band-min="${i}" value="${b.min}"></td>
        <td><input type="number" class="mark-input" data-band-max="${i}" value="${b.max}"></td>
      </tr>
    `).join('');
  }

  document.getElementById('content').innerHTML = `
    <div class="section-block">
      <h2 class="section-title">School details</h2>
      <div class="card">
        <div class="form-grid">
          <div class="field full">
            <label>School name</label>
            <input type="text" id="s_name" value="${UI.esc(st.settings.schoolName)}">
          </div>
          <div class="field full">
            <label>Motto (optional)</label>
            <input type="text" id="s_motto" value="${UI.esc(st.settings.motto)}">
          </div>
          <div class="field">
            <label>Current term</label>
            <select id="s_term">
              ${['Term 1', 'Term 2', 'Term 3'].map(t => `<option value="${t}" ${st.settings.term === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Current year</label>
            <input type="number" id="s_year" value="${st.settings.year}">
          </div>
        </div>
        <div class="modal-actions" style="border-top:none; margin-top:16px;">
          <button class="btn btn-primary" id="saveSchool">Save</button>
        </div>
      </div>
    </div>

    <div class="section-block">
      <h2 class="section-title">Grading bands (performance levels)</h2>
      <p class="field-hint" style="margin-bottom:12px;">Percentage ranges used to assign a performance level to each mark. Default follows the CBC 4-level scale — adjust as needed.</p>
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>Code</th><th>Label</th><th>Min %</th><th>Max %</th></tr></thead>
            <tbody id="bandsBody">${renderBandsRows(st.settings.gradingBands)}</tbody>
          </table>
        </div>
      </div>
      <div class="modal-actions" style="border-top:none; margin-top:16px; justify-content:flex-start;">
        <button class="btn btn-primary" id="saveBands">Save grading bands</button>
      </div>
    </div>

    <div class="section-block">
      <h2 class="section-title">My account</h2>
      <div class="card">
        <p class="stat-sub" style="margin-bottom:14px;">Logged in as <strong>${UI.esc(user.name)}</strong> (${UI.esc(user.role)})</p>
        <div class="form-grid">
          <div class="field">
            <label>New password</label>
            <input type="password" id="acc_pw" placeholder="Leave blank to keep current password">
          </div>
        </div>
        <div class="modal-actions" style="border-top:none; margin-top:16px; justify-content:flex-start;">
          <button class="btn btn-primary" id="saveAccount">Update password</button>
        </div>
      </div>
    </div>

    <div class="section-block">
      <h2 class="section-title">Data</h2>
      <div class="card">
        <p class="stat-sub" style="margin-bottom:14px;">
          This school's data lives in the shared database, so it's already backed up server-side.
          Use this to download a personal copy of everything for this school.
        </p>
        <button class="btn" id="exportBtn">Export backup (.json)</button>
      </div>
    </div>
  `;

  document.getElementById('saveAccount').onclick = async () => {
    const pw = document.getElementById('acc_pw').value;
    if (!pw) { UI.toast('Enter a new password first'); return; }
    if (pw.length < 6) { UI.toast('Password must be at least 6 characters'); return; }
    const result = await Auth.updateOwnPassword(pw);
    if (!result.ok) { UI.toast('Could not update password: ' + result.error); return; }
    document.getElementById('acc_pw').value = '';
    UI.toast('Password updated');
  };

  document.getElementById('saveSchool').onclick = async () => {
    try {
      await Store.updateSettings({
        schoolName: document.getElementById('s_name').value.trim() || 'Your School Name',
        motto: document.getElementById('s_motto').value.trim(),
        term: document.getElementById('s_term').value,
        year: Number(document.getElementById('s_year').value)
      });
      UI.toast('School details saved');
      App.renderShell();
    } catch (err) {
      UI.toast('Could not save: ' + err.message);
    }
  };

  document.getElementById('saveBands').onclick = async () => {
    const rows = document.querySelectorAll('#bandsBody tr');
    const bands = Array.from(rows).map((row, i) => ({
      code: row.querySelector(`[data-band-code="${i}"]`).value.trim().toUpperCase(),
      label: row.querySelector(`[data-band-label="${i}"]`).value.trim(),
      min: Number(row.querySelector(`[data-band-min="${i}"]`).value),
      max: Number(row.querySelector(`[data-band-max="${i}"]`).value)
    }));
    try {
      await Store.setGradingBands(bands);
      UI.toast('Grading bands saved');
    } catch (err) {
      UI.toast('Could not save: ' + err.message);
    }
  };

  document.getElementById('exportBtn').onclick = async () => {
    const json = await Store.exportSchoolJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cbe-exam-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
};
