/* ============================================================
   classes.js — Classes / Streams management. Admins create the
   classes (e.g. "Grade 7") and, optionally, streams within a class
   (e.g. "Grade 7 East", "Grade 7 West"). Every other screen that
   needs a "which class" dropdown (Students, Exams, Results,
   Reports, Broadsheet) sources its options from here.
   ============================================================ */

Views.classes = async function () {
  setTopbarActions(`<button class="btn btn-primary" id="addClassBtn">+ Add class / stream</button>`);
  showLoading();
  const st = await Store.current();
  let sectionFilter = '';

  function sectionBadge(c) {
    const section = gradeSection(c.name);
    if (!section) return '<span class="row-index">—</span>';
    return `<span class="badge badge-${section.key === 'primary' ? 'ME' : section.key === 'junior-secondary' ? 'AE' : 'EE'}">${UI.esc(section.label)}</span>`;
  }

  function renderTable() {
    if (st.classes.length === 0) {
      return `<div class="empty"><div class="empty-title">No classes yet</div><p>Add a class (e.g. "Grade 7"), and optionally split it into streams (e.g. "East", "West").</p></div>`;
    }
    let rows = [...st.classes];
    if (sectionFilter) rows = rows.filter(c => { const s = gradeSection(c.name); return s && s.key === sectionFilter; });
    rows.sort((a, b) => a.label.localeCompare(b.label));
    if (rows.length === 0) {
      return `<div class="empty"><div class="empty-title">No classes in this section</div><p>Try a different section, or add one on the form above.</p></div>`;
    }
    return `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>#</th><th>Class</th><th>Stream</th><th>Section</th><th>Class Teacher</th><th>Students</th><th></th></tr></thead>
            <tbody>
              ${rows.map((c, i) => {
                const studentCount = st.students.filter(s => s.klass === c.label).length;
                return `<tr>
                  <td class="row-index">${i + 1}</td>
                  <td>${UI.esc(c.name)}</td>
                  <td>${UI.esc(c.stream) || '<span class="row-index">—</span>'}</td>
                  <td>${sectionBadge(c)}</td>
                  <td>${UI.esc(c.teacherName) || '<span class="row-index">—</span>'}</td>
                  <td class="num">${studentCount}</td>
                  <td>
                    <button class="btn btn-sm btn-ghost" data-edit="${c.id}">Edit</button>
                    <button class="btn btn-sm btn-danger" data-del="${c.id}">Delete</button>
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
      btn.onclick = () => openForm(st.classes.find(c => c.id === btn.dataset.edit));
    });
    document.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = () => {
        const c = st.classes.find(c => c.id === btn.dataset.del);
        const studentCount = st.students.filter(s => s.klass === c.label).length;
        const warn = studentCount
          ? ` ${studentCount} student${studentCount === 1 ? '' : 's'} currently use "${c.label}" as their class — they will keep that class name, it just won't appear as a dropdown option here anymore.`
          : '';
        UI.confirmAction(`Delete "${c.label}"?${warn}`, async () => {
          await Store.deleteClass(c.id);
          UI.toast('Class deleted');
          Views.classes();
        });
      };
    });
  }

  function openForm(existing) {
    const isEdit = !!existing;
    UI.openModal(`
      <h2>${isEdit ? 'Edit class / stream' : 'Add class / stream'}</h2>
      <div class="form-grid">
        <div class="field">
          <label>Class / Grade name</label>
          <input type="text" id="f_name" value="${isEdit ? UI.esc(existing.name) : ''}" placeholder="e.g. Grade 7">
        </div>
        <div class="field">
          <label>Stream (optional)</label>
          <input type="text" id="f_stream" value="${isEdit ? UI.esc(existing.stream) : ''}" placeholder="e.g. East">
          <p class="field-hint">Leave blank if this class isn't split into streams.</p>
        </div>
        <div class="field full">
          <label>Class Teacher (optional)</label>
          <input type="text" id="f_teacher" value="${isEdit ? UI.esc(existing.teacherName) : ''}" placeholder="e.g. Mrs. Jane Wanjiru">
          <p class="field-hint">Printed automatically at the bottom of every report card for this class/stream.</p>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">${isEdit ? 'Save changes' : 'Add class'}</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const name = root.querySelector('#f_name').value.trim();
        const stream = root.querySelector('#f_stream').value.trim();
        const teacherName = root.querySelector('#f_teacher').value.trim();
        if (!name) { UI.toast('Class name is required'); return; }
        try {
          if (isEdit) { await Store.updateClass(existing.id, { name, stream, teacherName }); UI.toast('Class updated'); }
          else { await Store.addClass({ name, stream, teacherName }); UI.toast('Class added'); }
          UI.closeModal();
          Views.classes();
        } catch (err) {
          UI.toast('Could not save: ' + err.message);
        }
      };
    });
  }

  document.getElementById('content').innerHTML = `
    <p class="field-hint" style="margin-bottom:14px;">
      Classes and streams created here show up as dropdown options when adding students, creating exams, entering results, and printing reports — so class names stay consistent across the school. Section (Primary / Junior Secondary) is worked out automatically from the class name (e.g. "Grade 7", "PP1") — no need to set it separately.
    </p>
    <div class="filter-row" style="margin-bottom:14px;">
      <select id="sectionFilterSel">
        <option value="">All sections</option>
        <option value="primary">Primary (PP1–PP2, Grade 1–6)</option>
        <option value="junior-secondary">Junior Secondary (Grade 7–9)</option>
        <option value="senior-school">Senior School (Grade 10–12)</option>
      </select>
    </div>
    <div id="wrap">${renderTable()}</div>
  `;
  document.getElementById('addClassBtn').onclick = () => openForm(null);
  document.getElementById('sectionFilterSel').onchange = (e) => {
    sectionFilter = e.target.value;
    document.getElementById('wrap').innerHTML = renderTable();
    wireRowActions();
  };
  wireRowActions();
};
