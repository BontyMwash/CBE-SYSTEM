/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

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
    return `<span class="badge badge-${sectionBadgeClass(section.key)}">${UI.esc(section.label)}</span>`;
  }

  function renderTable() {
    if (st.classes.length === 0) {
      return `<div class="empty"><div class="empty-title">No classes yet</div><p>Add a class (e.g. "Grade 7"), and optionally split it into streams (e.g. "East", "West").</p></div>`;
    }
    let rows = [...st.classes].filter(c => levelAllows(c.name));
    if (sectionFilter) rows = rows.filter(c => { const s = gradeSection(c.name); return s && sectionCovers(sectionFilter, s.key); });
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
                    <button class="btn btn-sm btn-ghost" data-moveexams="${c.id}" title="Move this class's old exams to another class (e.g. the class its learners were promoted into)">Move exams</button>
                    <button class="btn btn-sm" data-promote="${c.id}" ${studentCount ? '' : 'disabled title="No students in this class yet"'}>Promote</button>
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
    document.querySelectorAll('[data-moveexams]').forEach(btn => {
      btn.onclick = () => openMoveExamsForm(st.classes.find(c => c.id === btn.dataset.moveexams));
    });
    document.querySelectorAll('[data-promote]').forEach(btn => {
      btn.onclick = () => openPromoteForm(st.classes.find(c => c.id === btn.dataset.promote));
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

  // "Promote" — move every learner currently in class `from` into a
  // different class (typically the next grade up at year-end, but any
  // target works, e.g. moving a repeater back a grade, or merging two
  // streams). Individual learners can still be moved one at a time from
  // the Students page ("Edit" -> change Class) for exceptions.
  function openPromoteForm(from) {
    const roster = st.students.filter(s => s.klass === from.label);
    // Deliberately NOT classOptionLabels() here: that respects the
    // Primary/Junior Secondary/Senior School level switcher, which would
    // hide Grade 7-9 as a target while viewing Primary and make year-end
    // promotion out of Grade 6 impossible. allClassOptionLabels() ignores
    // that filter so every class/stream, in any section, is a valid
    // promotion target.
    const targets = allClassOptionLabels(st).filter(label => label !== from.label);
    UI.openModal(`
      <h2>Promote "${UI.esc(from.label)}"</h2>
      <p class="field-hint">Moves all ${roster.length} learner${roster.length === 1 ? '' : 's'} currently in <strong>${UI.esc(from.label)}</strong> into the class you pick below. Their results are kept: past results and report cards stay on record under the class they were sat in, and can be opened from the Students page (History button) or by picking the old class on Reports, Broadsheet and Analysis.</p>
      <div class="form-grid">
        <div class="field full">
          <label>Promote to</label>
          ${targets.length
            ? `<select id="f_target">${targets.map(t => `<option value="${UI.esc(t)}">${UI.esc(t)}</option>`).join('')}</select>`
            : `<input type="text" id="f_target" placeholder="e.g. Grade 8">`}
          <p class="field-hint">Don't see the class you need? Add it first with "+ Add class / stream" above.</p>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="promoteBtn" ${roster.length ? '' : 'disabled'}>Promote ${roster.length} learner${roster.length === 1 ? '' : 's'}</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#promoteBtn').onclick = async () => {
        const target = root.querySelector('#f_target').value.trim();
        if (!target) { UI.toast('Pick or type a class to promote into'); return; }
        if (target === from.label) { UI.toast('Pick a different class'); return; }
        UI.confirmAction(`Move all ${roster.length} learner${roster.length === 1 ? '' : 's'} from "${from.label}" to "${target}"? Their previous results stay on record and remain viewable under "${from.label}".`, async () => {
          try {
            await Store.promoteStudents(roster.map(s => s.id), target);
            UI.toast(`Promoted ${roster.length} learner${roster.length === 1 ? '' : 's'} to ${target}`);
            UI.closeModal();
            Views.classes();
          } catch (err) {
            UI.toast('Could not promote: ' + err.message);
          }
        });
      };
    });
  }

  // "Move exams" — transfer a class's exam sittings to another class label
  // (typically the class its learners were promoted into). Results are tied
  // to learners, so they come along untouched; only the exam's class changes.
  function openMoveExamsForm(from) {
    const examsOfClass = st.exams.filter(e => e.klass === from.label);
    // group into sittings (type + term + year)
    const groups = new Map();
    examsOfClass.forEach(e => {
      const key = `${e.type}|${e.term}|${e.year}`;
      if (!groups.has(key)) groups.set(key, { type: e.type, term: e.term, year: e.year, exams: [] });
      groups.get(key).exams.push(e);
    });
    const byId = new Map(st.students.map(s => [s.id, s]));
    const sittings = [...groups.values()].map(g => {
      const ids = new Set(g.exams.map(e => e.id));
      const learners = new Set();
      st.results.forEach(r => { if (ids.has(r.examId)) learners.add(r.studentId); });
      const nowIn = {};
      learners.forEach(id => { const s = byId.get(id); const k = s ? s.klass : '(deleted)'; nowIn[k] = (nowIn[k] || 0) + 1; });
      const stayed = nowIn[from.label] || 0;
      const left = learners.size - stayed;
      return { ...g, learners: learners.size, nowIn, archived: learners.size > 0 && left > stayed };
    }).sort((a, b) => (b.year - a.year) || b.term.localeCompare(a.term) || a.type.localeCompare(b.type));

    if (!sittings.length) {
      UI.openModal(`<h2>Move exams from "${UI.esc(from.label)}"</h2><p class="field-hint">This class has no exams to move.</p><div class="modal-actions"><button class="btn btn-primary" id="okBtn">Close</button></div>`,
        root => { root.querySelector('#okBtn').onclick = () => UI.closeModal(); });
      return;
    }
    // Suggest where most of the learners who sat the archived sittings are now.
    const tally = {};
    sittings.filter(s => s.archived).forEach(s => Object.entries(s.nowIn).forEach(([k, n]) => { if (k !== from.label) tally[k] = (tally[k] || 0) + n; }));
    const suggested = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const targets = allClassOptionLabels(st).filter(l => l !== from.label);
    UI.openModal(`
      <h2>Move exams from "${UI.esc(from.label)}"</h2>
      <p class="field-hint">Moves the chosen exam sittings (and their marks, which stay with the learners) to another class. Use this to take last year's exams out of "${UI.esc(from.label)}" so the name is clean for the new learners.</p>
      <div class="form-grid">
        <div class="field full">
          <label>Move to class</label>
          <select id="f_moveTarget">${targets.map(t => `<option value="${UI.esc(t)}" ${t === suggested ? 'selected' : ''}>${UI.esc(t)}</option>`).join('')}</select>
          ${suggested ? `<p class="field-hint">Suggested: <strong>${UI.esc(suggested)}</strong> — that's where most learners from the old sittings are now.</p>` : ''}
        </div>
        <div class="field full">
          <label>Sittings to move</label>
          <div style="max-height:260px; overflow:auto; border:1px solid var(--paper-line); border-radius:8px; padding:6px 10px;">
            ${sittings.map((s, i) => `<label style="display:flex; gap:8px; align-items:flex-start; padding:5px 0;">
              <input type="checkbox" class="mvChk" data-i="${i}" ${s.archived ? 'checked' : ''}>
              <span><strong>${UI.esc(s.type)} · ${UI.esc(s.term)} ${UI.esc(s.year)}</strong> — ${s.exams.length} exam${s.exams.length === 1 ? '' : 's'}, ${s.learners} learner${s.learners === 1 ? '' : 's'} with marks
                <span class="field-hint" style="display:block; margin:0;">Now in: ${Object.entries(s.nowIn).map(([k, n]) => `${UI.esc(k)} (${n})`).join(', ') || '—'}${s.archived ? ' · <em>old sitting — learners have moved on</em>' : ''}</span></span>
            </label>`).join('')}
          </div>
        </div>
      </div>
      <p class="field-hint">Note: report cards and broadsheets for moved sittings will show the new class name, and the section heading (e.g. Junior Secondary) is taken from that class's name.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="mvCancel">Cancel</button>
        <button class="btn btn-primary" id="mvGo">Move selected exams</button>
      </div>
    `, (root) => {
      root.querySelector('#mvCancel').onclick = () => UI.closeModal();
      root.querySelector('#mvGo').onclick = () => {
        const target = root.querySelector('#f_moveTarget').value;
        const chosen = [...root.querySelectorAll('.mvChk')].filter(c => c.checked).map(c => sittings[Number(c.dataset.i)]);
        if (!target) { UI.toast('Pick a class to move the exams to'); return; }
        if (!chosen.length) { UI.toast('Tick at least one sitting'); return; }
        const n = chosen.reduce((sum, s) => sum + s.exams.length, 0);
        UI.confirmAction(`Move ${n} exam${n === 1 ? '' : 's'} (${chosen.length} sitting${chosen.length === 1 ? '' : 's'}) from "${from.label}" to "${target}"? Marks stay with the learners.`, async () => {
          try {
            const moved = await Store.moveExams(from.label, target, chosen);
            UI.toast(`Moved ${moved} exam${moved === 1 ? '' : 's'} to ${target}`);
            UI.closeModal();
            Views.classes();
          } catch (err) {
            UI.toast('Could not move: ' + err.message);
          }
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
      Classes and streams created here show up as dropdown options when adding students, creating exams, entering results, and printing reports — so class names stay consistent across the school. Section (Lower Primary / Upper Primary / Junior Secondary / Senior School) is worked out automatically from the class name (e.g. "Grade 2" → Lower Primary, "Grade 5" → Upper Primary, "Grade 7" → Junior Secondary) — no need to set it separately.
    </p>
    <div class="filter-row" style="margin-bottom:14px;">
      <select id="sectionFilterSel">
        <option value="">All sections</option>
        <option value="primary">Primary (PP1–PP2, Grade 1–6)</option>
        <option value="lower-primary">&nbsp;&nbsp;— Lower Primary (Grade 1–3)</option>
        <option value="upper-primary">&nbsp;&nbsp;— Upper Primary (Grade 4–6)</option>
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
