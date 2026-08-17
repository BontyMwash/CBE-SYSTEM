/* ============================================================
   notify.js — "Send Results to Parents": pick a sitting that has
   already been published (same gating as the Analysis page — an
   admin releases it once every teacher is done entering marks),
   then message each student's parent/guardian their result summary
   via WhatsApp, SMS, or email.

   There's no paid SMS/email gateway wired in here (that needs a
   provider account + API keys the app doesn't have), so sending
   opens the parent's own WhatsApp/Messages/Mail app pre-filled with
   the message — one tap to actually send it. Anthropic/this app
   just builds the message and logs that it was sent, in
   result_notifications, so the screen can show who's been
   contacted and who hasn't.
   ============================================================ */

Views.notify = async function () {
  setTopbarActions('');
  showLoading();
  const st = await Store.current();

  if (st.students.length === 0 || st.exams.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">Nothing to send yet</div><p>Add students and record at least one exam first.</p></div>`;
    return;
  }

  const publishedSorted = [...st.published].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  if (publishedSorted.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">No published results yet</div><p>Results can only be sent to parents once a sitting has been published on the <a href="#analysis">Analysis</a> page.</p></div>`;
    return;
  }

  const DEFAULT_TEMPLATE =
    `Dear parent/guardian, here are {name}'s {sitting} results from {school}. ` +
    `Class: {class}. Average: {average}% ({level}). Position: {position}. Thank you.`;
  let template = DEFAULT_TEMPLATE;
  let onlyUncontacted = false;
  let search = '';

  document.getElementById('content').innerHTML = `
    <div class="filter-row no-print">
      <select id="ntSitting">
        ${publishedSorted.map(p => `<option value="${p.id}">${UI.esc(p.klass)} &middot; ${UI.esc(p.type)} &middot; ${UI.esc(p.term)} ${UI.esc(String(p.year))}</option>`).join('')}
      </select>
      <input type="text" id="ntSearch" placeholder="Search by name or admission no." style="min-width:200px;">
      <label style="display:flex; align-items:center; gap:6px; font-size:13.5px; color:var(--ink-soft);">
        <input type="checkbox" id="ntOnlyUncontacted"> Not yet contacted only
      </label>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <label style="font-weight:600;">Message template</label>
      <p class="field-hint" style="margin-top:2px;">Placeholders: {name} {class} {sitting} {average} {level} {position} {school}</p>
      <textarea id="ntTemplate" rows="2" style="width:100%; font-family:inherit; font-size:13.5px; padding:8px; border-radius:8px; border:1px solid var(--paper-line); resize:vertical;">${UI.esc(template)}</textarea>
      <div style="margin-top:8px;">
        <button class="btn btn-sm btn-ghost" id="ntResetTemplate">Reset to default</button>
      </div>
    </div>
    <div id="ntBody"></div>
  `;

  const sittingSel = document.getElementById('ntSitting');
  const searchInput = document.getElementById('ntSearch');
  const uncontactedChk = document.getElementById('ntOnlyUncontacted');
  const templateBox = document.getElementById('ntTemplate');

  function digitsOnly(phone) { return (phone || '').replace(/[^\d+]/g, '').replace(/^\+/, ''); }
  function fillTemplate(str, vars) {
    return str.replace(/\{(\w+)\}/g, (m, key) => (vars[key] !== undefined ? vars[key] : m));
  }
  function ordinal(n) {
    if (n === null) return '—';
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // Same shape of computation as the Analysis page's computeSitting,
  // scoped to just the one class this sitting is for.
  function computeSittingResults(klass, type, term, year) {
    const exams = st.exams.filter(e => e.klass === klass && e.type === type && e.term === term && String(e.year) === String(year));
    const subjectCols = exams.map(e => ({ exam: e, subject: st.subjects.find(s => s.id === e.subjectId) })).filter(c => c.subject);
    const students = st.students.filter(s => s.klass === klass).sort((a, b) => a.name.localeCompare(b.name));

    const rows = students.map(stu => {
      const pcts = [];
      subjectCols.forEach(col => {
        const res = st.results.find(r => r.examId === col.exam.id && r.studentId === stu.id);
        if (res) pcts.push(Grading.percent(res.marks, col.exam.totalMarks));
      });
      const avg = Grading.average(pcts);
      const band = avg === null ? null : Grading.levelForMarks(avg, 100, st.settings.gradingBands);
      return { student: stu, avg, band };
    });

    const ranked = [...rows].filter(r => r.avg !== null).sort((a, b) => b.avg - a.avg);
    const outOf = ranked.length;
    let rank = 0, lastAvg = null, seen = 0;
    const rankMap = new Map();
    ranked.forEach(r => {
      seen++;
      if (r.avg !== lastAvg) { rank = seen; lastAvg = r.avg; }
      rankMap.set(r.student.id, rank);
    });

    return rows.map(r => ({ ...r, position: rankMap.get(r.student.id) ?? null, outOf }));
  }

  async function paint() {
    const chosen = publishedSorted.find(p => p.id === sittingSel.value) || publishedSorted[0];
    const results = computeSittingResults(chosen.klass, chosen.type, chosen.term, chosen.year);
    const sittingLabel = `${chosen.type} ${chosen.term} ${chosen.year}`;

    let sent = [];
    try { sent = await Store.notificationsFor(chosen.klass, chosen.type, chosen.term, chosen.year); } catch (e) { /* non-fatal — screen still works without history */ }
    const sentMap = new Map(); // studentId -> latest notification
    sent.forEach(n => {
      const existing = sentMap.get(n.studentId);
      if (!existing || new Date(n.sentAt) > new Date(existing.sentAt)) sentMap.set(n.studentId, n);
    });

    let rows = results;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r => r.student.name.toLowerCase().includes(q) || (r.student.admissionNo || '').toLowerCase().includes(q));
    }
    if (onlyUncontacted) rows = rows.filter(r => !sentMap.has(r.student.id));

    const contactedCount = results.filter(r => sentMap.has(r.student.id)).length;

    const bodyHtml = `
      <p class="field-hint" style="margin:0 0 14px 0;">
        ${UI.esc(chosen.klass)} &middot; ${UI.esc(sittingLabel)} &middot;
        ${contactedCount} / ${results.length} parent${results.length === 1 ? '' : 's'} contacted so far.
      </p>
      ${rows.length === 0 ? `<div class="empty"><div class="empty-title">No students match</div></div>` : `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead>
              <tr>
                <th>Name</th><th>ADM NO.</th><th>Average</th><th>Level</th><th>Position</th>
                <th>Parent contact</th><th>Status</th><th>Send</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => {
                const stu = r.student;
                const notif = sentMap.get(stu.id);
                const vars = {
                  name: stu.name, class: stu.klass, sitting: sittingLabel,
                  average: r.avg === null ? '—' : r.avg.toFixed(1),
                  level: r.band ? r.band.label : 'not yet graded',
                  position: r.position === null ? 'not yet ranked' : `${ordinal(r.position)} out of ${r.outOf}`,
                  school: st.settings.schoolName || 'the school'
                };
                const previewMsg = fillTemplate(templateBox.value || DEFAULT_TEMPLATE, vars);
                const hasPhone = !!stu.parentPhone;
                const hasEmail = !!stu.parentEmail;
                const statusHtml = notif
                  ? `<span class="badge badge-EE"><i class="fa-solid fa-circle-check"></i> Sent</span><br><span class="lb-sub">${new Date(notif.sentAt).toLocaleString()} &middot; ${UI.esc(notif.channel)}</span>`
                  : `<span class="badge badge-none">Not sent</span>`;
                const contactHtml = hasPhone || hasEmail
                  ? `${stu.parentPhone ? UI.esc(stu.parentPhone) + '<br>' : ''}${stu.parentEmail ? UI.esc(stu.parentEmail) : ''}`
                  : `<span class="lb-sub">No contact on file</span>`;
                return `<tr>
                  <td>${UI.esc(stu.name)}</td>
                  <td class="num">${UI.esc(stu.admissionNo) || '—'}</td>
                  <td class="num">${r.avg === null ? '—' : r.avg.toFixed(1) + '%'}</td>
                  <td>${UI.badge(r.band)}</td>
                  <td class="num">${r.position === null ? '—' : ordinal(r.position)}</td>
                  <td>${contactHtml}</td>
                  <td>${statusHtml}</td>
                  <td>
                    <div style="display:flex; flex-direction:column; gap:4px; min-width:110px;">
                      <button class="btn btn-sm" data-send="whatsapp" data-student="${stu.id}" ${hasPhone ? '' : 'disabled'} title="${hasPhone ? '' : 'No parent phone on file'}">WhatsApp</button>
                      <button class="btn btn-sm" data-send="sms" data-student="${stu.id}" ${hasPhone ? '' : 'disabled'} title="${hasPhone ? '' : 'No parent phone on file'}">SMS</button>
                      <button class="btn btn-sm" data-send="email" data-student="${stu.id}" ${hasEmail ? '' : 'disabled'} title="${hasEmail ? '' : 'No parent email on file'}">Email</button>
                      <button class="btn btn-sm btn-ghost" data-copy="${stu.id}" title="${UI.esc(previewMsg)}">Copy text</button>
                      ${notif ? `<button class="btn btn-sm btn-ghost" data-unsend="${notif.id}">Undo sent</button>` : ''}
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`}
    `;
    document.getElementById('ntBody').innerHTML = bodyHtml;

    document.querySelectorAll('[data-send]').forEach(btn => {
      btn.onclick = async () => {
        const stu = results.find(r => r.student.id === btn.dataset.student)?.student;
        if (!stu) return;
        const r = results.find(x => x.student.id === stu.id);
        const vars = {
          name: stu.name, class: stu.klass, sitting: sittingLabel,
          average: r.avg === null ? '—' : r.avg.toFixed(1),
          level: r.band ? r.band.label : 'not yet graded',
          position: r.position === null ? 'not yet ranked' : `${ordinal(r.position)} out of ${r.outOf}`,
          school: st.settings.schoolName || 'the school'
        };
        const message = fillTemplate(templateBox.value || DEFAULT_TEMPLATE, vars);
        const channel = btn.dataset.send;
        let url = '';
        if (channel === 'whatsapp') url = `https://wa.me/${digitsOnly(stu.parentPhone)}?text=${encodeURIComponent(message)}`;
        else if (channel === 'sms') url = `sms:${stu.parentPhone}?&body=${encodeURIComponent(message)}`;
        else if (channel === 'email') url = `mailto:${stu.parentEmail}?subject=${encodeURIComponent(`${vars.school} — ${vars.sitting} results for ${stu.name}`)}&body=${encodeURIComponent(message)}`;
        if (!url) return;

        if (channel === 'whatsapp') window.open(url, '_blank');
        else window.location.href = url;

        try {
          await Store.logNotification({ studentId: stu.id, klass: chosen.klass, type: chosen.type, term: chosen.term, year: chosen.year, channel });
          UI.toast(`Marked as sent to ${stu.name}'s parent via ${channel}.`);
          paint();
        } catch (e) { UI.toast('Opened message, but could not save the "sent" record: ' + e.message); }
      };
    });

    document.querySelectorAll('[data-copy]').forEach(btn => {
      btn.onclick = async () => {
        const stu = results.find(r => r.student.id === btn.dataset.copy)?.student;
        if (!stu) return;
        const r = results.find(x => x.student.id === stu.id);
        const vars = {
          name: stu.name, class: stu.klass, sitting: sittingLabel,
          average: r.avg === null ? '—' : r.avg.toFixed(1),
          level: r.band ? r.band.label : 'not yet graded',
          position: r.position === null ? 'not yet ranked' : `${ordinal(r.position)} out of ${r.outOf}`,
          school: st.settings.schoolName || 'the school'
        };
        const message = fillTemplate(templateBox.value || DEFAULT_TEMPLATE, vars);
        try {
          await navigator.clipboard.writeText(message);
          UI.toast('Message copied to clipboard.');
        } catch (e) { UI.toast('Could not copy — select and copy manually.'); }
      };
    });

    document.querySelectorAll('[data-unsend]').forEach(btn => {
      btn.onclick = async () => {
        try {
          await Store.clearNotification(btn.dataset.unsend);
          UI.toast('Marked as not sent.');
          paint();
        } catch (e) { UI.toast('Could not undo: ' + e.message); }
      };
    });
  }

  sittingSel.onchange = paint;
  searchInput.oninput = () => { search = searchInput.value.trim(); paint(); };
  uncontactedChk.onchange = () => { onlyUncontacted = uncontactedChk.checked; paint(); };
  document.getElementById('ntResetTemplate').onclick = () => { templateBox.value = DEFAULT_TEMPLATE; paint(); };
  templateBox.addEventListener('change', paint);

  paint();
};
