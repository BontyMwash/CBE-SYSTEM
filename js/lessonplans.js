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
      </div>
      <div class="tabs no-print" style="margin:14px 0;">
        <button class="tab-btn ${App.state._lpTab === 'scheme' ? 'active' : ''}" data-tab="scheme">Scheme of Work</button>
        <button class="tab-btn ${App.state._lpTab === 'plans' ? 'active' : ''}" data-tab="plans">Lesson Plans</button>
      </div>
    `;
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
      <div class="no-print" style="margin-bottom:14px;">
        <button class="btn btn-primary" id="lpAddPlanBtn">+ New lesson plan</button>
      </div>
      <div id="lpPlansListWrap">${cards}</div>
      <div id="lpPlanPrintArea"></div>
    `;
  }

  function wirePlansTab() {
    document.getElementById('lpAddPlanBtn').onclick = () => openPlanForm(null, null);
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
