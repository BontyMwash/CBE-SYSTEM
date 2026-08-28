/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   notify.js — "Send Results to Parents": pick a sitting that has
   already been published (same gating as the Analysis page — an
   admin releases it once every teacher is done entering marks),
   then message each student's parent/guardian their result summary
   via WhatsApp, SMS, or email.

   WhatsApp/Email always go through the sender's own device (opens
   WhatsApp/Mail pre-filled, one tap to send) — there's no gateway
   for those. SMS has TWO options: "SMS (my phone)" opens the
   sender's own Messages app like before; "SMS (system)" sends
   straight from the school's own SMS gateway via the send-sms Edge
   Function (see supabase/functions/send-sms/index.ts) — needs an
   Africa's Talking account + API key configured once by an admin,
   see that file's setup notes. Either way, every send gets logged
   in result_notifications, so the screen can show who's been
   contacted and who hasn't.
   ============================================================ */

Views.notify = async function () {
  setTopbarActions('');
  showLoading();
  const st = await Store.current();
  const user = Auth.currentUser();
  // Send to Parents is only in a teacher's nav when they're a class
  // teacher (see auth.js) — and even then, scoped to just their own
  // class(es), never the whole school's sittings.
  const scope = teacherScope(st, user);

  if (st.students.length === 0 || st.exams.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">Nothing to send yet</div><p>Add students and record at least one exam first.</p></div>`;
    return;
  }

  let publishedSorted = [...st.published].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  if (scope.isTeacher) publishedSorted = publishedSorted.filter(p => scope.classLabels.has(p.klass));
  if (publishedSorted.length === 0) {
    document.getElementById('content').innerHTML = `<div class="empty"><div class="empty-title">No published results yet</div><p>Results can only be sent to parents once a sitting has been published on the <a href="#analysis">Analysis</a> page${scope.isTeacher ? ', for one of your classes' : ''}.</p></div>`;
    return;
  }

  const DEFAULT_TEMPLATE =
    `Dear Parent/Guardian, {name}'s {sitting} results for {term}, {academic_year} are available. ` +
    `Average: {average}% ({level}). Position: {position}/{class_size}. ` +
    `Subject performance: {subjects}. ` +
    `Strengths: {strengths}. Improvement areas: {improvement_areas}. Thank you.`;
  let template = DEFAULT_TEMPLATE;
  let onlyUncontacted = false;
  let search = '';
  let selected = new Set(); // student ids checked for bulk actions — reset whenever the visible row set changes

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
      <p class="field-hint" style="margin-top:2px;">Placeholders: {name} {sitting} {term} {academic_year} {average} {level} {position} {class_size} {subjects} {strengths} {improvement_areas} {class} {school}</p>
      <textarea id="ntTemplate" rows="3" style="width:100%; font-family:inherit; font-size:13.5px; padding:8px; border-radius:8px; border:1px solid var(--paper-line); resize:vertical;">${UI.esc(template)}</textarea>
      <div style="margin-top:8px;">
        <button class="btn btn-sm btn-ghost" id="ntResetTemplate">Reset to default</button>
      </div>
      <p class="field-hint" style="margin-top:8px;">{subjects} lists every subject sat this sitting with its % and level, e.g. "Mathematics: 78% (ME); English: 65% (ME)" — so the parent sees the full breakdown right in the message, without needing to open anything else. Want to send the actual report card too? Use the <strong>Report PDF</strong> button on each row to download it, or share it straight into WhatsApp/SMS/Email via the device's share sheet.</p>
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
  // scoped to just the one class this sitting is for. Also keeps each
  // student's per-subject percentages (subjectPcts) so we can pick out
  // their strongest and weakest subjects for the message template.
  function computeSittingResults(klass, type, term, year) {
    const exams = st.exams.filter(e => e.klass === klass && e.type === type && e.term === term && String(e.year) === String(year));
    const subjectCols = exams.map(e => ({ exam: e, subject: st.subjects.find(s => s.id === e.subjectId) })).filter(c => c.subject);
    const students = st.students.filter(s => s.klass === klass).sort((a, b) => a.name.localeCompare(b.name));

    const rows = students.map(stu => {
      const pcts = [];
      const subjectPcts = [];
      subjectCols.forEach(col => {
        const res = st.results.find(r => r.examId === col.exam.id && r.studentId === stu.id);
        if (res) {
          const pct = Grading.percent(res.marks, col.exam.totalMarks);
          pcts.push(pct);
          subjectPcts.push({ name: col.subject.name, pct });
        }
      });
      const avg = Grading.average(pcts);
      const band = avg === null ? Grading.MISSING_BAND : Grading.levelForMarks(avg, 100, st.settings.gradingBands);
      return { student: stu, avg, band, subjectPcts };
    });

    // Ranking only ever runs over students who have marks — a student
    // with none isn't part of the competitive field, but they're still
    // flagged (not blank) below: position 'Z' rather than '—'.
    const ranked = [...rows].filter(r => r.avg !== null).sort((a, b) => b.avg - a.avg);
    const outOf = ranked.length;
    let rank = 0, lastAvg = null, seen = 0;
    const rankMap = new Map();
    ranked.forEach(r => {
      seen++;
      if (r.avg !== lastAvg) { rank = seen; lastAvg = r.avg; }
      rankMap.set(r.student.id, rank);
    });

    return rows.map(r => ({ ...r, position: r.avg === null ? 'Z' : (rankMap.get(r.student.id) ?? null), outOf }));
  }

  // Picks out a student's strongest / weakest subjects from their
  // per-subject percentages, formatted the way a printed report card
  // would list them — "Subject (score%)".
  function strengthsAndImprovements(subjectPcts) {
    const sorted = [...subjectPcts].sort((a, b) => b.pct - a.pct);
    const fmt = (s) => `${s.name} (${s.pct.toFixed(0)}%)`;
    if (sorted.length === 0) return { strengths: 'not yet graded', improvement_areas: 'not yet graded' };
    if (sorted.length === 1) return { strengths: fmt(sorted[0]), improvement_areas: 'not enough subjects to compare' };
    const takeStrengths = sorted.length >= 4 ? 2 : 1;
    const strengths = sorted.slice(0, takeStrengths).map(fmt).join(', ');
    const improvements = sorted.slice(-takeStrengths).reverse().map(fmt).join(', ');
    return { strengths, improvement_areas: improvements };
  }

  // "Report PDF" generation: builds this student's report card for the
  // chosen sitting (the same portrait layout used on the Reports page —
  // school masthead, subjects and marks table, position/level) into a
  // PDF, cached per student/sitting. Used only by the explicit "Report
  // PDF" button below (download, or hand to the device's share sheet to
  // attach the actual file into WhatsApp/SMS/Email) — the text message
  // itself no longer references this, since a local blob link doesn't
  // resolve on a parent's own phone. The message instead carries the
  // full per-subject breakdown inline via {subjects}.
  const reportBlobCache = new Map(); // `${sittingId}|${studentId}` -> { url, blob }
  async function getStudentReport(stu, chosen) {
    const key = `${chosen.id}|${stu.id}`;
    if (reportBlobCache.has(key)) return reportBlobCache.get(key);
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed; left:-9999px; top:0; width:800px;';
    holder.innerHTML = buildReportCardHTML(st, stu, chosen.term, chosen.year, chosen.type);
    document.body.appendChild(holder);
    let entry = { url: '', blob: null };
    try {
      const blob = await UI.pdfBlob(holder.querySelector('.report-card') || holder);
      if (blob) entry = { url: URL.createObjectURL(blob), blob };
    } catch (e) { /* leave entry empty — caller falls back gracefully */ }
    document.body.removeChild(holder);
    reportBlobCache.set(key, entry);
    return entry;
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

    // Every subject sat this sitting, with its % and level — e.g.
    // "Mathematics: 78% (ME); English: 65% (ME)" — for the {subjects}
    // placeholder, so the full breakdown travels in the message text
    // itself rather than depending on a link the parent can't open.
    function subjectBreakdown(subjectPcts) {
      if (!subjectPcts.length) return 'not yet graded';
      return subjectPcts.map(sp => {
        const band = Grading.levelForMarks(sp.pct, 100, st.settings.gradingBands);
        return `${sp.name}: ${sp.pct.toFixed(0)}%${band ? ` (${band.code})` : ''}`;
      }).join('; ');
    }

    function buildVars(stu, r) {
      const si = strengthsAndImprovements(r.subjectPcts);
      return {
        name: stu.name, class: stu.klass, sitting: chosen.type, term: chosen.term, academic_year: chosen.year,
        // Parent-facing text stays in plain words rather than the 'Z'
        // flag used in the admin table/CSV below — a parent reading
        // "Level: Marks missing" shouldn't have to decode a code.
        average: r.avg === null ? 'not yet available' : r.avg.toFixed(1),
        level: r.avg === null ? 'not yet graded' : r.band.label,
        position: r.position === null || r.position === 'Z' ? '—' : r.position,
        class_size: r.outOf,
        subjects: subjectBreakdown(r.subjectPcts),
        strengths: si.strengths,
        improvement_areas: si.improvement_areas,
        school: st.settings.schoolName || 'the school'
      };
    }
    function messageFor(stu, r) { return fillTemplate(templateBox.value || DEFAULT_TEMPLATE, buildVars(stu, r)); }
    function urlFor(channel, stu, message) {
      if (channel === 'whatsapp') return `https://wa.me/${digitsOnly(stu.parentPhone)}?text=${encodeURIComponent(message)}`;
      if (channel === 'sms') return `sms:${stu.parentPhone}?&body=${encodeURIComponent(message)}`;
      if (channel === 'email') return `mailto:${stu.parentEmail}?subject=${encodeURIComponent(`${st.settings.schoolName || 'the school'} — ${sittingLabel} results for ${stu.name}`)}&body=${encodeURIComponent(message)}`;
      return '';
    }

    // Bulk actions only make sense for students who are actually
    // reachable and not already sent — that's the pool "Select all" picks.
    const bulkEligible = rows.filter(r => (r.student.parentPhone || r.student.parentEmail) && !sentMap.has(r.student.id));
    const visibleIds = new Set(rows.map(r => r.student.id));
    [...selected].forEach(id => { if (!visibleIds.has(id)) selected.delete(id); }); // drop stale selections when filters change
    const selectedCount = selected.size;

    const bodyHtml = `
      <p class="field-hint" style="margin:0 0 14px 0;">
        ${UI.esc(chosen.klass)} &middot; ${UI.esc(sittingLabel)} &middot;
        ${contactedCount} / ${results.length} parent${results.length === 1 ? '' : 's'} contacted so far.
      </p>
      <div class="filter-row no-print" style="margin-bottom:10px; align-items:center;">
        <button class="btn btn-sm" id="ntSelectAllBtn" ${bulkEligible.length === 0 ? 'disabled' : ''}>Select all not-yet-sent (${bulkEligible.length})</button>
        <button class="btn btn-sm btn-ghost" id="ntClearSelBtn" ${selectedCount === 0 ? 'disabled' : ''}>Clear selection</button>
        <button class="btn btn-sm" id="ntCsvBtn"><i class="fa-solid fa-download"></i> Download CSV</button>
        <span class="field-hint" style="margin-left:auto;">${selectedCount} selected</span>
      </div>
      <div class="card no-print" id="ntBulkBar" style="margin-bottom:14px; display:${selectedCount ? 'flex' : 'none'}; gap:8px; flex-wrap:wrap; align-items:center;">
        <strong style="font-size:13.5px;">Bulk send to ${selectedCount} parent${selectedCount === 1 ? '' : 's'}:</strong>
        <button class="btn btn-sm btn-brass" id="ntBulkSmsSystem"><i class="fa-solid fa-server"></i> SMS — send to all at once</button>
        <button class="btn btn-sm btn-primary" id="ntBulkWhatsApp"><i class="fa-brands fa-whatsapp"></i> WhatsApp</button>
        <button class="btn btn-sm btn-primary" id="ntBulkSms"><i class="fa-solid fa-comment-sms"></i> SMS — one at a time (my phone)</button>
        <button class="btn btn-sm btn-primary" id="ntBulkEmail"><i class="fa-solid fa-envelope"></i> Email</button>
        <button class="btn btn-sm btn-ghost" id="ntBulkMarkSent">Mark all as sent (no message)</button>
        <p class="field-hint" style="margin:4px 0 0 0; width:100%;"><strong>SMS — send to all at once</strong> fires straight from the school's own SMS gateway in a single batch — nothing to tap through. WhatsApp, Email, and the "one at a time" SMS option instead open your phone's own app once per parent (a browser/OS limit on outgoing messages, not something this app can batch) — confirm each and it moves to the next automatically.</p>
      </div>
      ${rows.length === 0 ? `<div class="empty"><div class="empty-title">No students match</div></div>` : `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead>
              <tr>
                <th class="no-print"><input type="checkbox" id="ntSelectAllChk" ${bulkEligible.length > 0 && bulkEligible.every(r => selected.has(r.student.id)) ? 'checked' : ''}></th>
                <th>Name</th><th>ADM NO.</th><th>Average</th><th>Level</th><th>Position</th>
                <th>Parent contact</th><th>Status</th><th>Send</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => {
                const stu = r.student;
                const notif = sentMap.get(stu.id);
                const previewMsg = messageFor(stu, r);
                const hasPhone = !!stu.parentPhone;
                const hasEmail = !!stu.parentEmail;
                const canBulk = (hasPhone || hasEmail) && !notif;
                const statusHtml = notif
                  ? `<span class="badge badge-EE"><i class="fa-solid fa-circle-check"></i> Sent</span><br><span class="lb-sub">${new Date(notif.sentAt).toLocaleString()} &middot; ${UI.esc(notif.channel)}</span>`
                  : `<span class="badge badge-none">Not sent</span>`;
                const contactHtml = hasPhone || hasEmail
                  ? `${stu.parentPhone ? UI.esc(stu.parentPhone) + '<br>' : ''}${stu.parentEmail ? UI.esc(stu.parentEmail) : ''}`
                  : `<span class="lb-sub">No contact on file</span>`;
                return `<tr>
                  <td class="no-print"><input type="checkbox" data-select="${stu.id}" ${selected.has(stu.id) ? 'checked' : ''} ${canBulk ? '' : 'disabled'}></td>
                  <td>${UI.esc(stu.name)}</td>
                  <td class="num">${UI.esc(stu.admissionNo) || '—'}</td>
                  <td class="num">${r.avg === null ? UI.badge(Grading.MISSING_BAND) : r.avg.toFixed(1) + '%'}</td>
                  <td>${UI.badge(r.band)}</td>
                  <td class="num">${r.position === 'Z' ? UI.badge(Grading.MISSING_BAND) : r.position === null ? '—' : ordinal(r.position)}</td>
                  <td>${contactHtml}</td>
                  <td>${statusHtml}</td>
                  <td>
                    <div style="display:flex; flex-direction:column; gap:4px; min-width:110px;">
                      <button class="btn btn-sm" data-send="whatsapp" data-student="${stu.id}" ${hasPhone ? '' : 'disabled'} title="${hasPhone ? '' : 'No parent phone on file'}">WhatsApp</button>
                      <button class="btn btn-sm" data-send="sms" data-student="${stu.id}" ${hasPhone ? '' : 'disabled'} title="${hasPhone ? '' : 'No parent phone on file'}">SMS (my phone)</button>
                      <button class="btn btn-sm" data-sendsys="sms" data-student="${stu.id}" ${hasPhone ? '' : 'disabled'} title="${hasPhone ? 'Send from the school\'s SMS gateway, no phone needed' : 'No parent phone on file'}"><i class="fa-solid fa-server"></i> SMS (system)</button>
                      <button class="btn btn-sm" data-send="email" data-student="${stu.id}" ${hasEmail ? '' : 'disabled'} title="${hasEmail ? '' : 'No parent email on file'}">Email</button>
                      <button class="btn btn-sm btn-ghost" data-copy="${stu.id}" title="${UI.esc(previewMsg)}">Copy text</button>
                      <button class="btn btn-sm btn-ghost" data-report="${stu.id}"><i class="fa-solid fa-file-pdf"></i> Report PDF</button>
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

    // ---- Selection checkboxes ----
    document.querySelectorAll('[data-select]').forEach(chk => {
      chk.onchange = () => {
        if (chk.checked) selected.add(chk.dataset.select); else selected.delete(chk.dataset.select);
        paint();
      };
    });
    const selectAllChk = document.getElementById('ntSelectAllChk');
    if (selectAllChk) selectAllChk.onchange = () => {
      if (selectAllChk.checked) bulkEligible.forEach(r => selected.add(r.student.id));
      else bulkEligible.forEach(r => selected.delete(r.student.id));
      paint();
    };
    document.getElementById('ntSelectAllBtn').onclick = () => { bulkEligible.forEach(r => selected.add(r.student.id)); paint(); };
    document.getElementById('ntClearSelBtn').onclick = () => { selected.clear(); paint(); };

    // ---- Download CSV of the currently filtered rows (with a ready-to-use
    // message column) — for pasting into a bulk SMS/WhatsApp broadcast tool
    // that isn't wired into the app directly. ----
    document.getElementById('ntCsvBtn').onclick = () => {
      if (rows.length === 0) { UI.toast('No students to download'); return; }
      const header = ['Name', 'Admission No.', 'Average %', 'Level', 'Position', 'Class size', 'Strengths', 'Improvement areas', 'Parent name', 'Parent phone', 'Parent email', 'Status', 'Message'];
      const csvRows = rows.map(r => {
        const stu = r.student;
        const notif = sentMap.get(stu.id);
        const si = strengthsAndImprovements(r.subjectPcts);
        return [
          stu.name, stu.admissionNo || '', r.avg === null ? 'Z' : r.avg.toFixed(1), r.band.code,
          r.position === null ? '' : r.position, r.outOf,
          si.strengths, si.improvement_areas,
          stu.parentName || '', stu.parentPhone || '', stu.parentEmail || '',
          notif ? `Sent (${notif.channel})` : 'Not sent', messageFor(stu, r)
        ];
      });
      UI.downloadCSV(`results-notifications-${chosen.klass}-${chosen.type}-${chosen.term}-${chosen.year}`.replace(/\s+/g, '_'), header, csvRows);
    };

    // ---- Bulk send: walks the selection one parent at a time, in a
    // stepper modal. Each "Open ..." click is its own user gesture, so
    // the pop-up never gets blocked, and logs a sent record + advances
    // as soon as it's opened. ----
    function runBulkSend(channel) {
      const queue = rows.filter(r => selected.has(r.student.id) && (channel === 'email' ? r.student.parentEmail : r.student.parentPhone));
      if (queue.length === 0) { UI.toast('None of the selected parents have a contact for that channel'); return; }
      let i = 0;
      function renderStep() {
        const r = queue[i];
        const stu = r.student;
        const message = messageFor(stu, r);
        UI.openModal(`
          <h2>Bulk send &middot; ${channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'Email'}</h2>
          <p class="field-hint">Sending ${i + 1} of ${queue.length} &middot; ${UI.esc(stu.name)}</p>
          <textarea rows="4" readonly style="width:100%; font-family:inherit; font-size:13.5px; padding:8px; border-radius:8px; border:1px solid var(--paper-line); resize:vertical;">${UI.esc(message)}</textarea>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="bulkSkipBtn">Skip</button>
            <button class="btn btn-ghost" id="bulkStopBtn">Stop here</button>
            <button class="btn btn-primary" id="bulkOpenBtn">Open ${channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'Messages' : 'Mail'} & mark sent</button>
          </div>
        `, (root) => {
          root.querySelector('#bulkStopBtn').onclick = () => { UI.closeModal(); paint(); };
          root.querySelector('#bulkSkipBtn').onclick = () => { advance(); };
          root.querySelector('#bulkOpenBtn').onclick = async () => {
            const url = urlFor(channel, stu, message);
            if (channel === 'whatsapp') window.open(url, '_blank'); else window.location.href = url;
            try {
              await Store.logNotification({ studentId: stu.id, klass: chosen.klass, type: chosen.type, term: chosen.term, year: chosen.year, channel });
            } catch (e) { UI.toast(`Opened for ${stu.name}, but could not save the "sent" record: ` + e.message); }
            advance();
          };
        });
      }
      function advance() {
        selected.delete(queue[i].student.id);
        i++;
        if (i >= queue.length) { UI.closeModal(); UI.toast('Bulk send finished'); paint(); return; }
        renderStep();
      }
      renderStep();
    }
    const bulkWhatsApp = document.getElementById('ntBulkWhatsApp');
    if (bulkWhatsApp) bulkWhatsApp.onclick = () => runBulkSend('whatsapp');
    const bulkSms = document.getElementById('ntBulkSms');
    if (bulkSms) bulkSms.onclick = () => runBulkSend('sms');
    const bulkEmail = document.getElementById('ntBulkEmail');
    if (bulkEmail) bulkEmail.onclick = () => runBulkSend('email');

    // ---- Bulk "SMS (system)": one batch call to the send-sms Edge
    // Function, straight from the school's own SMS gateway — no phone,
    // no pop-ups, nothing for the sender to tap through per student. ----
    const bulkSmsSystem = document.getElementById('ntBulkSmsSystem');
    if (bulkSmsSystem) bulkSmsSystem.onclick = async () => {
      const queue = rows.filter(r => selected.has(r.student.id) && r.student.parentPhone);
      if (queue.length === 0) { UI.toast('None of the selected parents have a phone number on file'); return; }
      const originalLabel = bulkSmsSystem.innerHTML;
      bulkSmsSystem.disabled = true;
      bulkSmsSystem.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending ${queue.length}…`;
      const recipients = queue.map(r => ({ phone: r.student.parentPhone, message: messageFor(r.student, r) }));
      const res = await Auth.callEdgeFunction('send-sms', { recipients });
      bulkSmsSystem.disabled = false;
      bulkSmsSystem.innerHTML = originalLabel;
      if (!res.ok) { UI.toast(res.error || 'Could not reach the SMS gateway.'); return; }
      const successes = (res.results || []).filter(r => r.ok);
      const failures = (res.results || []).filter(r => !r.ok);
      await Promise.allSettled(successes.map((r) => {
        const row = queue.find(q => q.student.parentPhone === r.phone);
        if (!row) return Promise.resolve();
        return Store.logNotification({ studentId: row.student.id, klass: chosen.klass, type: chosen.type, term: chosen.term, year: chosen.year, channel: 'sms-system' });
      }));
      selected.clear();
      UI.toast(failures.length === 0
        ? `Sent ${successes.length} SMS via the system.`
        : `Sent ${successes.length}, ${failures.length} failed — check phone numbers and try those again.`);
      paint();
    };
    const bulkMarkSent = document.getElementById('ntBulkMarkSent');
    if (bulkMarkSent) bulkMarkSent.onclick = () => {
      const ids = [...selected];
      UI.confirmAction(`Mark ${ids.length} parent(s) as sent, without opening any message? Use this only if you already shared results another way.`, async () => {
        try {
          await Promise.all(ids.map(id => Store.logNotification({ studentId: id, klass: chosen.klass, type: chosen.type, term: chosen.term, year: chosen.year, channel: 'manual' })));
          selected.clear();
          UI.toast('Marked as sent');
          paint();
        } catch (e) { UI.toast('Could not save: ' + e.message); }
      }, { confirmLabel: 'Mark as sent', confirmClass: 'btn-primary' });
    };

    document.querySelectorAll('[data-send]').forEach(btn => {
      btn.onclick = async () => {
        const stu = results.find(r => r.student.id === btn.dataset.student)?.student;
        if (!stu) return;
        const r = results.find(x => x.student.id === stu.id);
        const channel = btn.dataset.send;
        const vars = buildVars(stu, r);
        const message = fillTemplate(templateBox.value || DEFAULT_TEMPLATE, vars);
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

    // ---- Per-student "SMS (system)": sends straight from the school's
    // SMS gateway via the send-sms Edge Function, instead of opening
    // the sender's own Messages app. ----
    document.querySelectorAll('[data-sendsys="sms"]').forEach(btn => {
      btn.onclick = async () => {
        const stu = results.find(r => r.student.id === btn.dataset.student)?.student;
        if (!stu || !stu.parentPhone) return;
        const r = results.find(x => x.student.id === stu.id);
        const message = messageFor(stu, r);
        const originalLabel = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';
        const res = await Auth.callEdgeFunction('send-sms', { recipients: [{ phone: stu.parentPhone, message }] });
        btn.disabled = false; btn.innerHTML = originalLabel;
        if (!res.ok) { UI.toast(res.error || 'Could not reach the SMS gateway.'); return; }
        const result = (res.results || [])[0];
        if (!result || !result.ok) { UI.toast(`Could not send to ${stu.name}'s parent: ${result?.error || 'unknown error'}`); return; }
        try {
          await Store.logNotification({ studentId: stu.id, klass: chosen.klass, type: chosen.type, term: chosen.term, year: chosen.year, channel: 'sms-system' });
          UI.toast(`SMS sent to ${stu.name}'s parent via the system.`);
          paint();
        } catch (e) { UI.toast('Sent, but could not save the "sent" record: ' + e.message); }
      };
    });

    document.querySelectorAll('[data-copy]').forEach(btn => {
      btn.onclick = async () => {
        const stu = results.find(r => r.student.id === btn.dataset.copy)?.student;
        if (!stu) return;
        const r = results.find(x => x.student.id === stu.id);
        const message = messageFor(stu, r);
        try {
          await navigator.clipboard.writeText(message);
          UI.toast('Message copied to clipboard.');
        } catch (e) { UI.toast('Could not copy — select and copy manually.'); }
      };
    });

    // ---- Report PDF: generates (or reuses) this student's portrait
    // report card for the sitting, then either hands it to the device's
    // share sheet — so it can be attached straight into WhatsApp/SMS/
    // Email alongside the message — or, where sharing files isn't
    // supported, just downloads the PDF for manual attaching. ----
    document.querySelectorAll('[data-report]').forEach(btn => {
      btn.onclick = async () => {
        const stu = results.find(r => r.student.id === btn.dataset.report)?.student;
        if (!stu) return;
        const r = results.find(x => x.student.id === stu.id);
        const originalLabel = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = 'Generating…';
        const report = await getStudentReport(stu, chosen);
        btn.disabled = false; btn.innerHTML = originalLabel;
        if (!report.blob) { UI.toast('Could not generate the report PDF.'); return; }
        const filename = `report-${stu.name}-${chosen.type}-${chosen.term}-${chosen.year}`.replace(/\s+/g, '_') + '.pdf';
        const file = new File([report.blob], filename, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], text: messageFor(stu, r), title: `${stu.name} — ${chosen.type} report` });
            return;
          } catch (e) { /* user cancelled the share sheet, or it's unsupported here — fall through to a plain download */ }
        }
        // Mobile browsers — Safari on iOS especially, and most in-app
        // browsers (WhatsApp/Messenger/Instagram webviews) — silently
        // ignore the `download` attribute on a blob: URL for PDFs: the
        // click does nothing visible at all, which combined with the
        // list re-rendering right after used to make the whole button
        // just "generate and disappear" with no result. Opening the
        // blob URL in a new tab instead is what actually works
        // everywhere: desktop browsers download or preview it as
        // normal, and mobile browsers show the PDF with their own
        // native Share/Save button for the person to attach it from.
        const opened = window.open(report.url, '_blank');
        if (!opened) {
          // Pop-up blocked — fall back to the plain anchor download,
          // which at least works on desktop browsers.
          const a = document.createElement('a');
          a.href = report.url; a.download = filename;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }
        UI.toast('Report ready — use Share/Save from the PDF to attach it.');
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
