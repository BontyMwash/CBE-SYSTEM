/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   lessonplans.js — Lesson Plans & Schemes of Work.

   Two tabs sharing one class/subject/term/year picker:
   - Scheme of Work: a term-long ledger, one row per week/lesson
     (Strand, Sub-strand, Specific Learning Outcomes, Key Inquiry
     Question, Learning Experiences, Learning Resources, Assessment
     Methods, Reflection). "Generate weeks" fills in blank
     week/lesson rows for the whole term in one go so a teacher
     starts from a skeleton instead of a blank page — it never
     overwrites a row that's already been filled in.
   - Lesson Plans: one full CBC-format lesson document per
     week/lesson. "Generate from scheme" pulls a scheme row's
     strand/sub-strand/outcomes/inquiry question/resources across
     and drafts an Introduction/Lesson Development/Conclusion
     skeleton around them, which the teacher then edits before
     saving — a starting draft, not a finished plan.

   Both tabs also have "Generate with AI", a real call to Claude
   (via the generate-curriculum-content Edge Function) grounded in
   a curriculum design PDF the school uploads per subject+class
   ("Manage curriculum PDFs"). On the Scheme tab it fills a whole
   term's rows in one go, skipping rows already filled by hand; on
   the Lesson Plans tab it drafts one lesson straight into the open
   form for the teacher to review and edit before saving. "Generate
   all with AI" on the Lesson Plans tab does the same thing for
   every scheme row that doesn't have a lesson plan yet, one at a
   time, saving each as it goes (rows that already have a plan are
   left untouched).

   Scoped the same way as Assessments/Gradebook/Competency: a
   subject teacher only sees/edits their own assigned subject(s);
   admins see every subject in the school. Uses teacherScope() and
   classOptionLabels() from views.js.
   ============================================================ */

const CBC_CORE_COMPETENCIES = [
  'Communication and collaboration', 'Critical thinking and problem solving', 'Creativity and imagination',
  'Citizenship', 'Digital literacy', 'Learning to learn', 'Self-efficacy'
];
const CBC_PCIS = [
  'Life skills', 'Values', 'Citizenship', 'Health education', 'Environmental education',
  'Safety and security', 'Financial literacy'
];

function lpTermYearRow(idPrefix, picked) {
  return `
    <select id="${idPrefix}Term">${['Term 1', 'Term 2', 'Term 3'].map(t => `<option value="${t}" ${t === picked.term ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <input type="number" id="${idPrefix}Year" value="${picked.year}" style="width:90px;">
  `;
}

Views.lessonPlans = async function () {
  setTopbarActions('');
  showLoading();
  const st = await Store.current();
  const user = Auth.currentUser();
  const scope = teacherScope(st, user);
  const isTeacher = scope.isTeacher;

  const mySubjects = isTeacher ? st.subjects.filter(s => scope.subjectIds.has(s.id)) : st.subjects;
  const myKlasses = isTeacher && scope.classLabels.size ? [...scope.classLabels].sort() : classOptionLabels(st);

  if (mySubjects.length === 0 || myKlasses.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">Nothing to plan yet</div><p>${isTeacher ? 'Ask your administrator to assign your subject(s) and class(es) from the Users page.' : 'Add a class and a subject first.'}</p></div>`;
    return;
  }

  App.state._lpTab = App.state._lpTab || 'scheme';
  const picked = { klass: myKlasses[0], subjectId: mySubjects[0].id, term: st.settings.term, year: String(st.settings.year) };
  let schemeRows = [];
  let planRows = [];

  async function loadAll() {
    [schemeRows, planRows] = await Promise.all([
      Store.schemesFor(picked.subjectId, picked.klass, picked.term, picked.year),
      Store.lessonPlansFor(picked.subjectId, picked.klass, picked.term, picked.year)
    ]);
  }

  function subjectName() { return (st.subjects.find(s => s.id === picked.subjectId) || {}).name || ''; }

  function renderPicker() {
    return `
      <div class="filter-row no-print">
        <select id="lpKlass">${myKlasses.map(k => `<option value="${UI.esc(k)}" ${k === picked.klass ? 'selected' : ''}>${UI.esc(k)}</option>`).join('')}</select>
        <select id="lpSubject">${mySubjects.map(s => `<option value="${s.id}" ${s.id === picked.subjectId ? 'selected' : ''}>${UI.esc(s.name)}</option>`).join('')}</select>
        ${lpTermYearRow('lp', picked)}
        <button class="btn btn-sm btn-ghost" id="lpDocsBtn"><i class="fa-solid fa-file-pdf"></i> Manage curriculum PDFs</button>
      </div>
      <div class="tabs no-print" style="margin:14px 0;">
        <button class="tab-btn ${App.state._lpTab === 'scheme' ? 'active' : ''}" data-tab="scheme">Scheme of Work</button>
        <button class="tab-btn ${App.state._lpTab === 'plans' ? 'active' : ''}" data-tab="plans">Lesson Plans</button>
      </div>
    `;
  }

  /* ------------------------- CURRICULUM DOCUMENTS (AI grounding) ------------------------- */

  async function openCurriculumDocsModal() {
    let docs = await Store.curriculumDocsFor(picked.subjectId, picked.klass);

    function render() {
      return `
        <h2>Curriculum design PDFs</h2>
        <p class="field-hint">Upload the official KICD curriculum design for ${UI.esc(subjectName())} &middot; ${UI.esc(picked.klass)} here. "Generate with AI" on the Scheme of Work and Lesson Plans tabs reads these to draft content grounded in the actual curriculum, instead of guessing.</p>
        <div id="lpDocsList" style="margin:14px 0;">
          ${docs.length === 0 ? `<p class="muted">No curriculum PDF uploaded yet for this subject and class.</p>` : `
            <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:8px;">
              ${docs.map(d => `
                <li style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 10px; border:1px solid var(--paper-line, #e5e5e5); border-radius:8px;">
                  <span><i class="fa-solid fa-file-pdf"></i> ${UI.esc(d.title || 'Curriculum design')}</span>
                  <button class="btn btn-sm btn-danger" data-del-doc="${d.id}">Delete</button>
                </li>
              `).join('')}
            </ul>
          `}
        </div>
        <div class="form-grid">
          <div class="field full"><label>Title (optional)</label><input type="text" id="docTitle" placeholder="e.g. ${UI.esc(subjectName())} ${UI.esc(picked.klass)} Curriculum Design"></div>
          <div class="field full"><label>PDF file</label><input type="file" id="docFile" accept="application/pdf"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="closeBtn">Close</button>
          <button class="btn btn-primary" id="uploadBtn">Upload</button>
        </div>
      `;
    }

    function wire(root) {
      root.querySelector('#closeBtn').onclick = () => UI.closeModal();
      root.querySelectorAll('[data-del-doc]').forEach(btn => {
        btn.onclick = () => UI.confirmAction('Delete this curriculum design PDF?', async () => {
          try { await Store.deleteCurriculumDoc(btn.dataset.delDoc); docs = await Store.curriculumDocsFor(picked.subjectId, picked.klass); UI.toast('PDF deleted'); rerender(); }
          catch (err) { UI.toast('Could not delete: ' + err.message); }
        });
      });
      root.querySelector('#uploadBtn').onclick = async () => {
        const fileInput = root.querySelector('#docFile');
        const file = fileInput.files && fileInput.files[0];
        if (!file) { UI.toast('Choose a PDF file first'); return; }
        if (file.type && file.type !== 'application/pdf') { UI.toast('Please choose a PDF file'); return; }
        const btn = root.querySelector('#uploadBtn');
        btn.disabled = true; btn.textContent = 'Uploading…';
        try {
          await Store.uploadCurriculumDoc(picked.subjectId, picked.klass, root.querySelector('#docTitle').value, file);
          docs = await Store.curriculumDocsFor(picked.subjectId, picked.klass);
          UI.toast('Curriculum PDF uploaded');
          rerender();
        } catch (err) {
          UI.toast('Could not upload: ' + err.message);
          btn.disabled = false; btn.textContent = 'Upload';
        }
      };
    }

    function rerender() {
      const modal = document.querySelector('.modal');
      if (!modal) return;
      modal.innerHTML = render();
      wire(modal);
    }

    UI.openModal(render(), wire);
  }

  /* ------------------------- SCHEME OF WORK TAB ------------------------- */

  function renderSchemeTab() {
    const rowsHTML = schemeRows.length === 0 ? `
      <div class="empty"><div class="empty-title">No scheme of work yet for ${UI.esc(subjectName())} &middot; ${UI.esc(picked.klass)} &middot; ${UI.esc(picked.term)} ${UI.esc(picked.year)}</div>
      <p>Use "Generate weeks" to lay out an empty skeleton for the term, or add a row by hand.</p></div>
    ` : `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>Wk</th><th>Ls</th><th>Strand</th><th>Sub-strand</th><th>Outcomes</th><th>Key Inquiry Q.</th><th>Resources</th><th></th></tr></thead>
            <tbody>
              ${schemeRows.map(r => `
                <tr>
                  <td class="row-index">${r.week}</td>
                  <td class="row-index">${r.lessonNo}</td>
                  <td>${UI.esc(r.strand) || '<span class="row-index">—</span>'}</td>
                  <td>${UI.esc(r.subStrand) || '<span class="row-index">—</span>'}</td>
                  <td>${UI.esc(truncate(r.outcomes, 60)) || '<span class="row-index">—</span>'}</td>
                  <td>${UI.esc(truncate(r.inquiryQuestion, 40)) || '<span class="row-index">—</span>'}</td>
                  <td>${UI.esc(truncate(r.resources, 30)) || '<span class="row-index">—</span>'}</td>
                  <td style="white-space:nowrap;">
                    <button class="btn btn-sm btn-ghost" data-edit-scheme="${r.id}">Edit</button>
                    <button class="btn btn-sm" data-to-plan="${r.id}">Use for Lesson Plan</button>
                    <button class="btn btn-sm btn-danger" data-del-scheme="${r.id}">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    return `
      <div class="no-print" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
        <button class="btn btn-primary" id="lpAddSchemeBtn">+ Add row</button>
        <button class="btn" id="lpGenSchemeBtn"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate weeks…</button>
        <button class="btn" id="lpAiSchemeBtn"><i class="fa-solid fa-robot"></i> Generate with AI…</button>
        <button class="btn" id="lpSchemeCsvBtn"><i class="fa-solid fa-download"></i> Download CSV</button>
        <button class="btn btn-brass" id="lpSchemePrintBtn">Print / Save as PDF</button>
      </div>
      <div id="lpSchemePrintArea">
        ${buildReportMastheadHTML(st, 'Scheme of Work', subjectName(), picked.term, picked.year)}
        <p class="field-hint" style="margin:6px 0 14px 0;">${UI.esc(picked.klass)}</p>
        ${rowsHTML}
        ${buildPrintFooterHTML()}
      </div>
    `;
  }

  function wireSchemeTab() {
    document.getElementById('lpAddSchemeBtn').onclick = () => openSchemeForm(null);
    document.getElementById('lpGenSchemeBtn').onclick = () => openGenerateForm();
    document.getElementById('lpAiSchemeBtn').onclick = () => openAiSchemeForm();
    document.getElementById('lpSchemePrintBtn').onclick = () => window.print();
    document.getElementById('lpSchemeCsvBtn').onclick = () => {
      if (schemeRows.length === 0) { UI.toast('Nothing to export yet'); return; }
      UI.downloadCSV(`scheme-of-work-${subjectName()}-${picked.klass}`.replace(/\s+/g, '-'),
        ['Week', 'Lesson', 'Strand', 'Sub-strand', 'Specific Learning Outcomes', 'Key Inquiry Question', 'Learning Experiences', 'Learning Resources', 'Assessment Methods', 'Reflection'],
        schemeRows.map(r => [r.week, r.lessonNo, r.strand, r.subStrand, r.outcomes, r.inquiryQuestion, r.experiences, r.resources, r.assessment, r.reflection]));
    };
    document.querySelectorAll('[data-edit-scheme]').forEach(btn => {
      btn.onclick = () => openSchemeForm(schemeRows.find(r => r.id === btn.dataset.editScheme));
    });
    document.querySelectorAll('[data-del-scheme]').forEach(btn => {
      btn.onclick = () => UI.confirmAction('Delete this scheme of work row? This cannot be undone.', async () => {
        try { await Store.deleteSchemeRow(btn.dataset.delScheme); UI.toast('Row deleted'); await loadAll(); paintBody(); }
        catch (err) { UI.toast('Could not delete: ' + err.message); }
      });
    });
    document.querySelectorAll('[data-to-plan]').forEach(btn => {
      btn.onclick = () => {
        const schemeRow = schemeRows.find(r => r.id === btn.dataset.toPlan);
        App.state._lpTab = 'plans';
        openPlanForm(null, schemeRow);
      };
    });
  }

  function openGenerateForm() {
    UI.openModal(`
      <h2>Generate weeks</h2>
      <p class="field-hint">Lays out empty week/lesson rows for the whole term so you're filling in a skeleton instead of a blank page. Rows you've already started stay exactly as they are — this only adds what's missing.</p>
      <div class="form-grid">
        <div class="field"><label>Weeks in the term</label><input type="number" id="genWeeks" value="13" min="1" max="20"></div>
        <div class="field"><label>Lessons per week</label><input type="number" id="genLessons" value="1" min="1" max="10"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="genBtn">Generate</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#genBtn').onclick = async () => {
        const weeks = Number(root.querySelector('#genWeeks').value) || 0;
        const lessons = Number(root.querySelector('#genLessons').value) || 0;
        if (weeks < 1 || lessons < 1) { UI.toast('Enter at least 1 week and 1 lesson'); return; }
        try {
          await Store.generateSchemeSkeleton(picked.subjectId, picked.klass, picked.term, picked.year, weeks, lessons);
          UI.toast('Scheme of work generated');
          UI.closeModal();
          await loadAll();
          paintBody();
        } catch (err) { UI.toast('Could not generate: ' + err.message); }
      };
    });
  }

  function openAiSchemeForm() {
    UI.openModal(`
      <h2>Generate with AI</h2>
      <p class="field-hint">Drafts full scheme-of-work content (strand, sub-strand, outcomes, key inquiry question, learning experiences, resources, assessment) for the whole term, grounded in the curriculum design PDF(s) uploaded via "Manage curriculum PDFs". Rows you've already filled in by hand are left untouched.</p>
      <div class="form-grid">
        <div class="field"><label>Weeks in the term</label><input type="number" id="aiWeeks" value="13" min="1" max="20"></div>
        <div class="field"><label>Lessons per week</label><input type="number" id="aiLessons" value="1" min="1" max="10"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="aiGenBtn"><i class="fa-solid fa-robot"></i> Generate</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#aiGenBtn').onclick = async () => {
        const weeks = Number(root.querySelector('#aiWeeks').value) || 0;
        const lessons = Number(root.querySelector('#aiLessons').value) || 0;
        if (weeks < 1 || lessons < 1) { UI.toast('Enter at least 1 week and 1 lesson'); return; }
        const btn = root.querySelector('#aiGenBtn');
        btn.disabled = true; btn.innerHTML = 'Generating… this can take a minute';
        try {
          const aiRows = await Store.generateSchemeWithAI(picked.subjectId, picked.klass, picked.term, picked.year, weeks, lessons);
          let filled = 0, skipped = 0;
          for (const r of aiRows) {
            const existing = schemeRows.find(row => row.week === r.week && row.lessonNo === r.lessonNo);
            if (existing && (existing.strand || '').trim()) { skipped++; continue; }
            await Store.saveSchemeRow({
              id: existing ? existing.id : null, subjectId: picked.subjectId, klass: picked.klass, term: picked.term, year: picked.year,
              week: r.week, lessonNo: r.lessonNo, strand: r.strand, subStrand: r.subStrand, outcomes: r.outcomes,
              inquiryQuestion: r.inquiryQuestion, experiences: r.experiences, resources: r.resources, assessment: r.assessment
            });
            filled++;
          }
          UI.toast(`AI filled ${filled} row(s)${skipped ? `, left ${skipped} already-filled row(s) untouched` : ''}`);
          UI.closeModal();
          await loadAll();
          paintBody();
        } catch (err) {
          UI.toast('Could not generate: ' + err.message);
          btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-robot"></i> Generate';
        }
      };
    });
  }

  function openSchemeForm(existing) {
    const isEdit = !!existing;
    UI.openModal(`
      <h2>${isEdit ? 'Edit' : 'Add'} scheme of work row</h2>
      <div class="form-grid">
        <div class="field"><label>Week</label><input type="number" id="sWeek" min="1" value="${isEdit ? existing.week : (schemeRows.length ? Math.max(...schemeRows.map(r => r.week)) : 1)}"></div>
        <div class="field"><label>Lesson</label><input type="number" id="sLesson" min="1" value="${isEdit ? existing.lessonNo : 1}"></div>
        <div class="field full"><label>Strand</label><input type="text" id="sStrand" value="${isEdit ? UI.esc(existing.strand) : ''}" placeholder="e.g. Number strand"></div>
        <div class="field full"><label>Sub-strand</label><input type="text" id="sSubStrand" value="${isEdit ? UI.esc(existing.subStrand) : ''}" placeholder="e.g. Whole numbers"></div>
        <div class="field full"><label>Specific Learning Outcomes</label><textarea id="sOutcomes" rows="3" placeholder="By the end of the lesson, the learner should be able to…">${isEdit ? UI.esc(existing.outcomes) : ''}</textarea></div>
        <div class="field full"><label>Key Inquiry Question(s)</label><input type="text" id="sInquiry" value="${isEdit ? UI.esc(existing.inquiryQuestion) : ''}"></div>
        <div class="field full"><label>Learning Experiences</label><textarea id="sExperiences" rows="3">${isEdit ? UI.esc(existing.experiences) : ''}</textarea></div>
        <div class="field"><label>Learning Resources</label><input type="text" id="sResources" value="${isEdit ? UI.esc(existing.resources) : ''}"></div>
        <div class="field"><label>Assessment Methods</label><input type="text" id="sAssessment" value="${isEdit ? UI.esc(existing.assessment) : ''}"></div>
        <div class="field full"><label>Reflection (optional)</label><textarea id="sReflection" rows="2">${isEdit ? UI.esc(existing.reflection) : ''}</textarea></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">${isEdit ? 'Save changes' : 'Add row'}</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const week = Number(root.querySelector('#sWeek').value);
        const lessonNo = Number(root.querySelector('#sLesson').value);
        if (!week || !lessonNo) { UI.toast('Week and Lesson are required'); return; }
        try {
          await Store.saveSchemeRow({
            id: isEdit ? existing.id : null, subjectId: picked.subjectId, klass: picked.klass, term: picked.term, year: picked.year,
            week, lessonNo, strand: root.querySelector('#sStrand').value, subStrand: root.querySelector('#sSubStrand').value,
            outcomes: root.querySelector('#sOutcomes').value, inquiryQuestion: root.querySelector('#sInquiry').value,
            experiences: root.querySelector('#sExperiences').value, resources: root.querySelector('#sResources').value,
            assessment: root.querySelector('#sAssessment').value, reflection: root.querySelector('#sReflection').value
          });
          UI.toast(isEdit ? 'Row updated' : 'Row added');
          UI.closeModal();
          await loadAll();
          paintBody();
        } catch (err) { UI.toast('Could not save: ' + err.message); }
      };
    });
  }

  /* ------------------------- LESSON PLANS TAB ------------------------- */

  function renderPlansTab() {
    const cards = planRows.length === 0 ? `
      <div class="empty"><div class="empty-title">No lesson plans yet for ${UI.esc(subjectName())} &middot; ${UI.esc(picked.klass)} &middot; ${UI.esc(picked.term)} ${UI.esc(picked.year)}</div>
      <p>Create one from scratch, or open the Scheme of Work tab and use "Use for Lesson Plan" on a row to draft one from it.</p></div>
    ` : `<div class="class-card-grid">${planRows.map(p => `
      <div class="card class-card">
        <h3 style="margin:0 0 4px 0;">Week ${p.week} &middot; Lesson ${p.lessonNo}</h3>
        <p class="muted" style="margin:0 0 6px 0;">${UI.esc(p.strand) || 'No strand set'}${p.subStrand ? ' — ' + UI.esc(p.subStrand) : ''}</p>
        <p class="field-hint" style="margin:0 0 14px 0;">${p.date ? UI.esc(p.date) : 'No date set'}</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm" data-view-plan="${p.id}">Print / View</button>
          <button class="btn btn-sm btn-ghost" data-edit-plan="${p.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-del-plan="${p.id}">Delete</button>
        </div>
      </div>`).join('')}</div>`;
    return `
      <div class="no-print" style="margin-bottom:14px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-primary" id="lpAddPlanBtn">+ New lesson plan</button>
        <button class="btn" id="lpBulkAiBtn"><i class="fa-solid fa-robot"></i> Generate all with AI…</button>
      </div>
      <div id="lpPlansListWrap">${cards}</div>
      <div id="lpPlanPrintArea"></div>
    `;
  }

  function wirePlansTab() {
    document.getElementById('lpAddPlanBtn').onclick = () => openPlanForm(null, null);
    document.getElementById('lpBulkAiBtn').onclick = () => openBulkAiForm();
    document.querySelectorAll('[data-edit-plan]').forEach(btn => {
      btn.onclick = () => openPlanForm(planRows.find(p => p.id === btn.dataset.editPlan), null);
    });
    document.querySelectorAll('[data-del-plan]').forEach(btn => {
      btn.onclick = () => UI.confirmAction('Delete this lesson plan? This cannot be undone.', async () => {
        try { await Store.deleteLessonPlan(btn.dataset.delPlan); UI.toast('Lesson plan deleted'); await loadAll(); paintBody(); }
        catch (err) { UI.toast('Could not delete: ' + err.message); }
      });
    });
    document.querySelectorAll('[data-view-plan]').forEach(btn => {
      btn.onclick = () => {
        const plan = planRows.find(p => p.id === btn.dataset.viewPlan);
        document.getElementById('lpPlanPrintArea').innerHTML = buildLessonPlanPrintHTML(st, plan, subjectName(), picked.klass);
        window.print();
      };
    });
  }

  // Drafts an Introduction/Lesson Development/Conclusion skeleton
  // from a scheme row's Strand/Sub-strand/Outcomes/Key Inquiry
  // Question — a starting point the teacher edits, not a finished plan.
  function draftFromScheme(schemeRow) {
    const outcome = (schemeRow.outcomes || '').split(/\r?\n/)[0] || 'the specific learning outcome for this lesson';
    return {
      introduction: `Recap the previous lesson and link it to today's topic. Introduce ${UI.esc(schemeRow.subStrand || schemeRow.strand || 'the sub-strand')} using the key inquiry question: "${schemeRow.inquiryQuestion || ''}" to spark discussion.`,
      development: `In groups/pairs, learners engage in ${schemeRow.experiences || 'the learning experiences below'} guided by the teacher, working towards: ${outcome}. Use ${schemeRow.resources || 'the learning resources'} to support the activity, checking for understanding as learners work.`,
      conclusion: `Learners summarise the key points in their own words. Ask a few learners to share what they learned, then assess understanding using ${schemeRow.assessment || 'a short question-and-answer or written exercise'}.`
    };
  }

  function openBulkAiForm() {
    const targets = [...schemeRows]
      .sort((a, b) => a.week - b.week || a.lessonNo - b.lessonNo)
      .filter(s => !planRows.some(p => p.week === s.week && p.lessonNo === s.lessonNo));

    if (schemeRows.length === 0) { UI.toast('Add or generate a scheme of work first'); return; }
    if (targets.length === 0) { UI.toast('Every scheme of work row already has a lesson plan'); return; }

    let cancelled = false;

    UI.openModal(`
      <h2>Generate all with AI</h2>
      <p class="field-hint">Drafts a full lesson plan for every scheme-of-work row that doesn't have one yet (${targets.length} row${targets.length === 1 ? '' : 's'} — rows that already have a lesson plan are left alone), one at a time, grounded in the curriculum design PDF(s) uploaded via "Manage curriculum PDFs". Each is saved as a draft — review and edit any of them afterwards.</p>
      <div id="bulkAiStatus" class="field-hint" style="margin:14px 0;">Ready to generate ${targets.length} lesson plan${targets.length === 1 ? '' : 's'}.</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">${'Cancel'}</button>
        <button class="btn btn-primary" id="startBtn"><i class="fa-solid fa-robot"></i> Start</button>
      </div>
    `, (root) => {
      const statusEl = root.querySelector('#bulkAiStatus');
      root.querySelector('#cancelBtn').onclick = () => { cancelled = true; UI.closeModal(); };
      root.querySelector('#startBtn').onclick = async () => {
        root.querySelector('#startBtn').style.display = 'none';
        root.querySelector('#cancelBtn').textContent = 'Stop';
        let done = 0, failed = 0;
        for (const row of targets) {
          if (cancelled) break;
          statusEl.textContent = `Generating ${done + failed + 1} of ${targets.length} — Week ${row.week}, Lesson ${row.lessonNo}${row.strand ? ' (' + row.strand + ')' : ''}…`;
          try {
            const plan = await Store.generateLessonWithAI(picked.subjectId, picked.klass, picked.term, picked.year, row.week, row.lessonNo, row);
            await Store.saveLessonPlan({
              subjectId: picked.subjectId, klass: picked.klass, term: picked.term, year: picked.year,
              week: row.week, lessonNo: row.lessonNo, strand: plan.strand || row.strand, subStrand: plan.subStrand || row.subStrand,
              outcomes: plan.outcomes || row.outcomes, inquiryQuestion: plan.inquiryQuestion || row.inquiryQuestion,
              coreCompetencies: plan.coreCompetencies, values: plan.values, pcis: plan.pcis,
              resources: plan.resources || row.resources, introduction: plan.introduction, development: plan.development,
              conclusion: plan.conclusion, extendedActivities: plan.extendedActivities
            });
            done++;
          } catch (err) { failed++; }
        }
        statusEl.textContent = cancelled
          ? `Stopped early — ${done} lesson plan${done === 1 ? '' : 's'} generated before stopping${failed ? `, ${failed} failed` : ''}.`
          : `Done — ${done} lesson plan${done === 1 ? '' : 's'} generated${failed ? `, ${failed} failed` : ''}.`;
        root.querySelector('#cancelBtn').textContent = 'Close';
        root.querySelector('#cancelBtn').onclick = async () => { UI.closeModal(); await loadAll(); paintBody(); };
      };
    });
  }

  function openPlanForm(existing, schemeRow) {
    const isEdit = !!existing;
    const draft = (!isEdit && schemeRow) ? draftFromScheme(schemeRow) : null;
    const base = existing || (schemeRow ? {
      week: schemeRow.week, lessonNo: schemeRow.lessonNo, strand: schemeRow.strand, subStrand: schemeRow.subStrand,
      outcomes: schemeRow.outcomes, inquiryQuestion: schemeRow.inquiryQuestion, resources: schemeRow.resources,
      introduction: draft.introduction, development: draft.development, conclusion: draft.conclusion
    } : {});
    UI.openModal(`
      <h2>${isEdit ? 'Edit' : schemeRow ? 'Lesson plan drafted from scheme' : 'New'} lesson plan</h2>
      ${schemeRow && !isEdit ? `<p class="field-hint">The Introduction, Lesson Development and Conclusion below are a starting draft from your scheme of work row — edit freely before saving.</p>` : ''}
      <div class="no-print" style="margin-bottom:10px;">
        <button class="btn btn-sm" id="pAiBtn" type="button"><i class="fa-solid fa-robot"></i> Generate with AI</button>
        <span class="field-hint">Uses the curriculum design PDF uploaded via "Manage curriculum PDFs" — review and edit before saving.</span>
      </div>
      <div class="form-grid">
        <div class="field"><label>Week</label><input type="number" id="pWeek" min="1" value="${base.week || 1}"></div>
        <div class="field"><label>Lesson</label><input type="number" id="pLesson" min="1" value="${base.lessonNo || 1}"></div>
        <div class="field"><label>Date</label><input type="date" id="pDate" value="${base.date || ''}"></div>
        <div class="field full"><label>Strand</label><input type="text" id="pStrand" value="${UI.esc(base.strand || '')}"></div>
        <div class="field full"><label>Sub-strand</label><input type="text" id="pSubStrand" value="${UI.esc(base.subStrand || '')}"></div>
        <div class="field full"><label>Specific Learning Outcomes</label><textarea id="pOutcomes" rows="3">${UI.esc(base.outcomes || '')}</textarea></div>
        <div class="field full"><label>Key Inquiry Question(s)</label><input type="text" id="pInquiry" value="${UI.esc(base.inquiryQuestion || '')}"></div>
        <div class="field"><label>Core Competencies</label>
          <input type="text" id="pCompetencies" list="pCompList" value="${UI.esc(base.coreCompetencies || '')}" placeholder="e.g. Critical thinking and problem solving">
          <datalist id="pCompList">${CBC_CORE_COMPETENCIES.map(c => `<option value="${UI.esc(c)}">`).join('')}</datalist>
        </div>
        <div class="field"><label>Values</label><input type="text" id="pValues" value="${UI.esc(base.values || '')}" placeholder="e.g. Respect, Responsibility"></div>
        <div class="field full"><label>Pertinent &amp; Contemporary Issues (PCIs)</label>
          <input type="text" id="pPcis" list="pPcisList" value="${UI.esc(base.pcis || '')}">
          <datalist id="pPcisList">${CBC_PCIS.map(c => `<option value="${UI.esc(c)}">`).join('')}</datalist>
        </div>
        <div class="field full"><label>Learning Resources</label><input type="text" id="pResources" value="${UI.esc(base.resources || '')}"></div>
        <div class="field full"><label>Introduction</label><textarea id="pIntro" rows="3">${UI.esc(base.introduction || '')}</textarea></div>
        <div class="field full"><label>Lesson Development</label><textarea id="pDevelopment" rows="4">${UI.esc(base.development || '')}</textarea></div>
        <div class="field full"><label>Conclusion</label><textarea id="pConclusion" rows="3">${UI.esc(base.conclusion || '')}</textarea></div>
        <div class="field full"><label>Extended Activities (optional)</label><textarea id="pExtended" rows="2">${UI.esc(base.extendedActivities || '')}</textarea></div>
        <div class="field full"><label>Reflection (optional, fill in after teaching)</label><textarea id="pReflection" rows="2">${UI.esc(base.reflection || '')}</textarea></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">${isEdit ? 'Save changes' : 'Save lesson plan'}</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#pAiBtn').onclick = async () => {
        const week = Number(root.querySelector('#pWeek').value);
        const lessonNo = Number(root.querySelector('#pLesson').value);
        if (!week || !lessonNo) { UI.toast('Week and Lesson are required first'); return; }
        const ctx = schemeRow || (root.querySelector('#pStrand').value ? {
          strand: root.querySelector('#pStrand').value, subStrand: root.querySelector('#pSubStrand').value,
          outcomes: root.querySelector('#pOutcomes').value, inquiryQuestion: root.querySelector('#pInquiry').value,
          resources: root.querySelector('#pResources').value
        } : null);
        const btn = root.querySelector('#pAiBtn');
        btn.disabled = true; btn.innerHTML = 'Generating…';
        try {
          const plan = await Store.generateLessonWithAI(picked.subjectId, picked.klass, picked.term, picked.year, week, lessonNo, ctx);
          root.querySelector('#pStrand').value = plan.strand || root.querySelector('#pStrand').value;
          root.querySelector('#pSubStrand').value = plan.subStrand || root.querySelector('#pSubStrand').value;
          root.querySelector('#pOutcomes').value = plan.outcomes || root.querySelector('#pOutcomes').value;
          root.querySelector('#pInquiry').value = plan.inquiryQuestion || root.querySelector('#pInquiry').value;
          root.querySelector('#pCompetencies').value = plan.coreCompetencies || root.querySelector('#pCompetencies').value;
          root.querySelector('#pValues').value = plan.values || root.querySelector('#pValues').value;
          root.querySelector('#pPcis').value = plan.pcis || root.querySelector('#pPcis').value;
          root.querySelector('#pResources').value = plan.resources || root.querySelector('#pResources').value;
          root.querySelector('#pIntro').value = plan.introduction || root.querySelector('#pIntro').value;
          root.querySelector('#pDevelopment').value = plan.development || root.querySelector('#pDevelopment').value;
          root.querySelector('#pConclusion').value = plan.conclusion || root.querySelector('#pConclusion').value;
          if (plan.extendedActivities) root.querySelector('#pExtended').value = plan.extendedActivities;
          UI.toast('Drafted by AI — review before saving');
        } catch (err) {
          UI.toast('Could not generate: ' + err.message);
        }
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-robot"></i> Generate with AI';
      };
      root.querySelector('#saveBtn').onclick = async () => {
        const week = Number(root.querySelector('#pWeek').value);
        const lessonNo = Number(root.querySelector('#pLesson').value);
        if (!week || !lessonNo) { UI.toast('Week and Lesson are required'); return; }
        try {
          await Store.saveLessonPlan({
            id: isEdit ? existing.id : null, subjectId: picked.subjectId, klass: picked.klass, term: picked.term, year: picked.year,
            week, lessonNo, date: root.querySelector('#pDate').value, strand: root.querySelector('#pStrand').value,
            subStrand: root.querySelector('#pSubStrand').value, outcomes: root.querySelector('#pOutcomes').value,
            inquiryQuestion: root.querySelector('#pInquiry').value, coreCompetencies: root.querySelector('#pCompetencies').value,
            values: root.querySelector('#pValues').value, pcis: root.querySelector('#pPcis').value,
            resources: root.querySelector('#pResources').value, introduction: root.querySelector('#pIntro').value,
            development: root.querySelector('#pDevelopment').value, conclusion: root.querySelector('#pConclusion').value,
            extendedActivities: root.querySelector('#pExtended').value, reflection: root.querySelector('#pReflection').value
          });
          UI.toast(isEdit ? 'Lesson plan updated' : 'Lesson plan saved');
          App.state._lpTab = 'plans';
          UI.closeModal();
          await loadAll();
          paintBody();
        } catch (err) { UI.toast('Could not save: ' + err.message); }
      };
    });
  }

  /* ------------------------- SHARED PAINT ------------------------- */

  async function paintBody() {
    const wrap = document.getElementById('lpTabWrap');
    if (!wrap) return;
    if (App.state._lpTab === 'scheme') { wrap.innerHTML = renderSchemeTab(); wireSchemeTab(); }
    else { wrap.innerHTML = renderPlansTab(); wirePlansTab(); }
  }

  function wirePicker() {
    document.getElementById('lpKlass').onchange = async (e) => { picked.klass = e.target.value; await loadAll(); paintBody(); };
    document.getElementById('lpSubject').onchange = async (e) => { picked.subjectId = e.target.value; await loadAll(); paintBody(); };
    document.getElementById('lpTerm').onchange = async (e) => { picked.term = e.target.value; await loadAll(); paintBody(); };
    document.getElementById('lpYear').onchange = async (e) => { picked.year = e.target.value; await loadAll(); paintBody(); };
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => { App.state._lpTab = btn.dataset.tab; paint(); };
    });
    document.getElementById('lpDocsBtn').onclick = () => openCurriculumDocsModal();
  }

  async function paint() {
    document.getElementById('content').innerHTML = `${renderPicker()}<div id="lpTabWrap"></div>`;
    wirePicker();
    await loadAll();
    paintBody();
  }

  paint();
};

function truncate(str, len) {
  if (!str) return '';
  const s = String(str).trim();
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

// Full printable CBC-format single lesson plan document — school
// masthead, then every field laid out as a labeled block, matching
// the look of every other printable document in the app.
function buildLessonPlanPrintHTML(st, p, subjectName, klass) {
  const row = (label, value) => `<p style="margin:0 0 10px 0;"><strong>${UI.esc(label)}:</strong> ${UI.esc(value) || '—'}</p>`;
  const block = (label, value) => `<div style="margin:0 0 14px 0;"><strong>${UI.esc(label)}</strong><p style="margin:4px 0 0 0; white-space:pre-wrap;">${UI.esc(value) || '—'}</p></div>`;
  return `
    <div class="report-card">
      ${buildReportMastheadHTML(st, 'Lesson Plan', subjectName, p.term, p.year)}
      <div class="grid grid-2" style="margin:14px 0;">
        <div>${row('Class', klass)}${row('Week / Lesson', `${p.week} / ${p.lessonNo}`)}${row('Date', p.date || '')}</div>
        <div>${row('Strand', p.strand)}${row('Sub-strand', p.subStrand)}</div>
      </div>
      ${block('Specific Learning Outcomes', p.outcomes)}
      ${block('Key Inquiry Question(s)', p.inquiryQuestion)}
      <div class="grid grid-2" style="margin:0 0 14px 0;">
        <div>${row('Core Competencies', p.coreCompetencies)}${row('Values', p.values)}</div>
        <div>${row('PCIs', p.pcis)}${row('Learning Resources', p.resources)}</div>
      </div>
      ${block('Introduction', p.introduction)}
      ${block('Lesson Development', p.development)}
      ${block('Conclusion', p.conclusion)}
      ${p.extendedActivities ? block('Extended Activities', p.extendedActivities) : ''}
      ${p.reflection ? block('Reflection', p.reflection) : ''}
      ${buildPrintFooterHTML()}
    </div>
  `;
}
