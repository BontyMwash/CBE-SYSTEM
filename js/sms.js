/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   sms.js — Bulk SMS module. Admins compose campaigns and queue
   individual messages into sms_queue; an Android phone ("CBE SMS
   Gateway" app, paired from the Devices tab) polls the
   sms-get-queue Edge Function, sends each message on its own SIM,
   and reports back via sms-update-result. The browser never sends
   SMS directly and never touches the service role key — see
   sql/022_sms_module.sql and the supabase/functions/sms-... Edge
   Functions for the server side, and SMS_GATEWAY_SETUP.md for how
   to pair a phone.
   ============================================================ */

const SmsUtil = {
  // Accepts 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, 2541XXXXXXXX,
  // +2547XXXXXXXX, +2541XXXXXXXX. Returns null (never guesses) for
  // anything else, so invalid numbers get reported, not silently
  // mangled.
  normalizeKenyanPhone(raw) {
    let s = (raw || '').replace(/[^\d+]/g, '').trim();
    if (!s) return null;
    if (s.startsWith('+')) s = s.slice(1);
    if (/^254[17]\d{8}$/.test(s)) return '+' + s;
    if (/^0[17]\d{8}$/.test(s)) return '+254' + s.slice(1);
    if (/^[17]\d{8}$/.test(s)) return '+254' + s;
    return null;
  },

  // GSM-7 vs UCS-2 detection (approximate but covers the practical
  // Kenyan-school case: plain English text with occasional accents).
  // Single-SMS and concatenated-part limits differ by encoding.
  GSM7: /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\\[~\]|€]*$/,
  segments(text) {
    const t = text || '';
    const isGsm7 = SmsUtil.GSM7.test(t);
    const singleLimit = isGsm7 ? 160 : 70;
    const multiLimit = isGsm7 ? 153 : 67;
    const len = t.length;
    const parts = len === 0 ? 0 : (len <= singleLimit ? 1 : Math.ceil(len / multiLimit));
    return { length: len, parts, encoding: isGsm7 ? 'GSM-7' : 'Unicode', limit: len <= singleLimit ? singleLimit : multiLimit };
  },

  // Direct download link for the "CBE SMS Gateway" Android APK, shown
  // to admins on the Gateway Devices screen so they can install it on
  // a phone themselves instead of you sending the file by hand.
  // Point this at wherever you're hosting the built APK (Google Drive
  // share link, GitHub Releases asset, your own server, Supabase
  // Storage public bucket, etc.) — leave it blank to hide the button.
  GATEWAY_APK_URL: 'https://drive.google.com/file/d/10sATtITPD05ysjOmBfpdj_AcgJ7612qc/view?usp=sharing',

  PLACEHOLDERS: ['student_name', 'parent_name', 'class', 'school_name', 'average', 'position', 'level'],

  // Same placeholders the "Send Results to Parents" screen (notify.js)
  // supports, available here too once a results sitting is picked in
  // the composer — see resultsCtxFor() below. {name}/{school} are
  // aliases for {student_name}/{school_name} so a template copied
  // from either screen works unmodified in both.
  RESULT_PLACEHOLDERS: ['name', 'sitting', 'term', 'academic_year', 'class_size', 'subjects', 'strengths', 'improvement_areas', 'school'],

  render(template, ctx) {
    return (template || '').replace(/\{(\w+)\}/g, (m, key) => (ctx[key] !== undefined && ctx[key] !== null && ctx[key] !== '') ? String(ctx[key]) : m);
  },

  timeAgo(iso) {
    if (!iso) return 'never';
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  },

  // A device counts as truly online only if it says so AND its last
  // heartbeat/poll was recent — a device that vanished without a
  // clean disconnect (dead battery, force-closed app) stops looking
  // "online" within 90s instead of forever.
  isOnline(device) {
    if (device.status !== 'online' || !device.last_seen) return false;
    return (Date.now() - new Date(device.last_seen).getTime()) < 90 * 1000;
  }
};

const SmsStore = {
  _mapDevice: (r) => r,
  _mapTemplate: (r) => r,
  _mapCampaign: (r) => r,
  _mapQueueRow: (r) => r,

  async devices(schoolId) {
    const { data, error } = await supabase.from('sms_devices').select('*').eq('school_id', schoolId).order('created_at', { ascending: false });
    Store._throwIfError('devices', error);
    return data || [];
  },
  async createDevice(schoolId, name) {
    const pairCode = SmsStore._genPairCode();
    const { data, error } = await supabase.from('sms_devices').insert({
      school_id: schoolId,
      device_name: name || 'CBE SMS Gateway',
      status: 'pending',
      pair_code: pairCode,
      pair_code_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      created_by: Auth.currentUser().id
    }).select().single();
    Store._throwIfError('createDevice', error);
    return data;
  },
  _genPairCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  },
  async regeneratePairCode(id) {
    const pairCode = SmsStore._genPairCode();
    const { data, error } = await supabase.from('sms_devices').update({
      status: 'pending', pair_code: pairCode, pair_code_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      device_token_hash: null, updated_at: new Date().toISOString()
    }).eq('id', id).select().single();
    Store._throwIfError('regeneratePairCode', error);
    return data;
  },
  async renameDevice(id, name) {
    const { error } = await supabase.from('sms_devices').update({ device_name: name, updated_at: new Date().toISOString() }).eq('id', id);
    Store._throwIfError('renameDevice', error);
  },
  async setDeviceStatus(id, status) {
    const { error } = await supabase.from('sms_devices').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    Store._throwIfError('setDeviceStatus', error);
  },
  async removeDevice(id) {
    const { error } = await supabase.from('sms_devices').delete().eq('id', id);
    Store._throwIfError('removeDevice', error);
  },

  async templates(schoolId) {
    const { data, error } = await supabase.from('sms_templates').select('*').eq('school_id', schoolId).order('name');
    Store._throwIfError('templates', error);
    return data || [];
  },
  async saveTemplate(schoolId, tpl) {
    if (tpl.id) {
      const { error } = await supabase.from('sms_templates').update({ name: tpl.name, body: tpl.body, updated_at: new Date().toISOString() }).eq('id', tpl.id);
      Store._throwIfError('saveTemplate', error);
    } else {
      const { error } = await supabase.from('sms_templates').insert({ school_id: schoolId, name: tpl.name, body: tpl.body, created_by: Auth.currentUser().id });
      Store._throwIfError('saveTemplate', error);
    }
  },
  async deleteTemplate(id) {
    const { error } = await supabase.from('sms_templates').delete().eq('id', id);
    Store._throwIfError('deleteTemplate', error);
  },

  async settings(schoolId) {
    const { data, error } = await supabase.from('sms_settings').select('*').eq('school_id', schoolId).maybeSingle();
    Store._throwIfError('settings', error);
    return data || {
      school_id: schoolId, auto_attendance_sms: false, auto_results_sms: false, auto_fee_reminder_sms: false,
      max_retry_attempts: 3, batch_size: 10, delay_between_ms: 2000, require_confirmation: true
    };
  },
  async saveSettings(schoolId, patch) {
    const { error } = await supabase.from('sms_settings').upsert({ school_id: schoolId, ...patch, updated_at: new Date().toISOString() });
    Store._throwIfError('saveSettings', error);
  },

  async campaigns(schoolId, limit) {
    const { data, error } = await supabase.from('sms_campaigns').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }).limit(limit || 50);
    Store._throwIfError('campaigns', error);
    return data || [];
  },
  async queueForCampaign(campaignId) {
    const { data, error } = await supabase.from('sms_queue').select('*').eq('campaign_id', campaignId).order('created_at');
    Store._throwIfError('queueForCampaign', error);
    return data || [];
  },

  // Creates the campaign row, then bulk-inserts one sms_queue row per
  // valid recipient, spread round-robin across the given online
  // device ids (or unassigned if none available — 21. Offline
  // Gateway Handling: still queues, just waits for a phone to come
  // online). Chunks the insert since a whole-school campaign can be
  // several hundred rows.
  async createCampaign(schoolId, { campaignName, message, source, recipients, deviceIds }) {
    const { data: campaign, error: cErr } = await supabase.from('sms_campaigns').insert({
      school_id: schoolId, campaign_name: campaignName, message, source: source || 'manual',
      created_by: Auth.currentUser().id, status: 'queued', started_at: new Date().toISOString()
    }).select().single();
    Store._throwIfError('createCampaign', cErr);

    const rows = recipients.map((r, i) => ({
      school_id: schoolId,
      campaign_id: campaign.id,
      device_id: (deviceIds && deviceIds.length) ? deviceIds[i % deviceIds.length] : null,
      student_id: r.studentId || null,
      phone_number: r.phone,
      message: r.message
    }));

    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase.from('sms_queue').insert(rows.slice(i, i + CHUNK));
      Store._throwIfError('createCampaign:queue', error);
    }
    return campaign;
  },

  async cancelCampaign(id) {
    await supabase.from('sms_queue').update({ status: 'cancelled' }).eq('campaign_id', id).eq('status', 'pending');
    const { error } = await supabase.from('sms_campaigns').update({ status: 'cancelled' }).eq('id', id);
    Store._throwIfError('cancelCampaign', error);
  },

  // Resets terminally-failed rows back to pending with a fresh
  // attempt budget, so they're picked up by the gateway again — 16.
  async retryFailed(campaignId) {
    const { error } = await supabase.from('sms_queue')
      .update({ status: 'pending', attempts: 0, error_message: null })
      .eq('campaign_id', campaignId).eq('status', 'failed');
    Store._throwIfError('retryFailed', error);
  },

  async dashboardStats(schoolId) {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const [today, pending, failed, sent] = await Promise.all([
      supabase.from('sms_queue').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).gte('created_at', startOfDay.toISOString()),
      supabase.from('sms_queue').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).in('status', ['pending', 'sending']),
      supabase.from('sms_queue').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'failed'),
      supabase.from('sms_queue').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'sent')
    ]);
    return {
      today: today.count || 0,
      pending: pending.count || 0,
      failed: failed.count || 0,
      sent: sent.count || 0
    };
  }
};

// ---- module state (which sub-tab is showing; not persisted) ----
const SmsUI = { tab: 'dashboard' };

Views.sms = async function () {
  setTopbarActions('');
  showLoading();
  const schoolId = Store.activeSchoolId;
  const st = await Store.current();

  const TABS = [
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high' },
    { id: 'compose', label: 'Bulk SMS', icon: 'fa-paper-plane' },
    { id: 'history', label: 'History', icon: 'fa-clock-rotate-left' },
    { id: 'templates', label: 'Templates', icon: 'fa-file-lines' },
    { id: 'devices', label: 'Gateway Devices', icon: 'fa-mobile-screen-button' },
    { id: 'settings', label: 'Settings', icon: 'fa-gear' }
  ];

  function shell(bodyHtml) {
    document.getElementById('content').innerHTML = `
      <div class="sms-tabs">
        ${TABS.map(t => `<button class="sms-tab-btn ${SmsUI.tab === t.id ? 'active' : ''}" data-tab="${t.id}"><i class="fa-solid ${t.icon}"></i> ${t.label}</button>`).join('')}
      </div>
      <div id="smsBody">${bodyHtml}</div>
    `;
    document.querySelectorAll('.sms-tab-btn').forEach(btn => {
      btn.onclick = () => { SmsUI.tab = btn.dataset.tab; Views.sms(); };
    });
  }

  shell(`<div class="empty"><div class="empty-title">Loading…</div></div>`);

  try {
    if (SmsUI.tab === 'compose') await renderCompose();
    else if (SmsUI.tab === 'history') await renderHistory();
    else if (SmsUI.tab === 'templates') await renderTemplates();
    else if (SmsUI.tab === 'devices') await renderDevices();
    else if (SmsUI.tab === 'settings') await renderSettings();
    else await renderDashboard();
  } catch (e) {
    document.getElementById('smsBody').innerHTML = `<div class="empty"><div class="empty-title">Couldn't load this</div><p>${UI.esc(e.message || String(e))}</p></div>`;
  }

  // ---------------- Dashboard ----------------
  async function renderDashboard() {
    const [devices, stats, campaigns] = await Promise.all([
      SmsStore.devices(schoolId), SmsStore.dashboardStats(schoolId), SmsStore.campaigns(schoolId, 5)
    ]);
    const online = devices.filter(SmsUtil.isOnline);
    const primary = devices[0];

    document.getElementById('smsBody').innerHTML = `
      <div class="grid grid-4 section-block">
        <div class="card stat-card grad-indigo">
          <i class="fa-solid fa-calendar-day stat-icon"></i>
          <p class="stat-label">Today's SMS</p>
          <p class="stat-value">${stats.today}</p>
          <p class="stat-sub">&nbsp;</p>
        </div>
        <div class="card stat-card grad-teal">
          <i class="fa-solid fa-paper-plane stat-icon"></i>
          <p class="stat-label">Sent (all time)</p>
          <p class="stat-value">${stats.sent}</p>
          <p class="stat-sub">&nbsp;</p>
        </div>
        <div class="card stat-card grad-slate">
          <i class="fa-solid fa-hourglass-half stat-icon"></i>
          <p class="stat-label">Pending</p>
          <p class="stat-value">${stats.pending}</p>
          <p class="stat-sub">&nbsp;</p>
        </div>
        <div class="card stat-card ${stats.failed > 0 ? 'grad-danger' : 'grad-success'}">
          <i class="fa-solid fa-triangle-exclamation stat-icon"></i>
          <p class="stat-label">Failed</p>
          <p class="stat-value">${stats.failed}</p>
          <p class="stat-sub">&nbsp;</p>
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <h3 style="margin-top:0;">SMS Gateway</h3>
        ${devices.length === 0 ? `
          <div class="empty"><div class="empty-title">No gateway device paired yet</div><p>Go to Gateway Devices to pair an Android phone before sending SMS.</p></div>
        ` : devices.map(d => `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--paper-line);">
            <div>
              <span class="sms-dot ${SmsUtil.isOnline(d) ? 'online' : d.status}"></span>
              <strong>${UI.esc(d.device_name)}</strong>
              <span class="field-hint" style="display:inline; margin-left:8px;">${d.phone_number ? UI.esc(d.phone_number) : 'no SIM number reported yet'}</span>
            </div>
            <div class="field-hint" style="margin:0;">${SmsUtil.isOnline(d) ? 'Online' : (d.status === 'pending' ? 'Awaiting pairing' : d.status === 'disabled' ? 'Disabled' : 'Offline')} · last seen ${SmsUtil.timeAgo(d.last_seen)}</div>
          </div>
        `).join('')}
      </div>

      <div class="card" style="margin-top:16px;">
        <h3 style="margin-top:0;">Recent campaigns</h3>
        ${campaigns.length === 0 ? `<div class="empty"><div class="empty-title">No campaigns yet</div><p>Send your first bulk SMS from the Bulk SMS tab.</p></div>` : `
          <div class="ledger"><div class="ledger-scroll"><table class="ledger-table">
            <thead><tr><th>Campaign</th><th>Status</th><th>Sent</th><th>Failed</th><th>Pending</th><th>Created</th></tr></thead>
            <tbody>${campaigns.map(c => campaignRow(c)).join('')}</tbody>
          </table></div></div>
        `}
      </div>
    `;
  }

  function statusPillClass(status) {
    if (status === 'completed') return 'status-complete';
    if (status === 'completed_with_errors' || status === 'sending' || status === 'queued') return 'status-progress';
    return 'status-none';
  }
  function statusLabel(status) {
    return { draft: 'Draft', queued: 'Queued', sending: 'Sending', completed: 'Completed', completed_with_errors: 'Completed (errors)', cancelled: 'Cancelled' }[status] || status;
  }
  function campaignRow(c) {
    return `<tr>
      <td>${UI.esc(c.campaign_name)}</td>
      <td><span class="status-pill ${statusPillClass(c.status)}">${statusLabel(c.status)}</span></td>
      <td>${c.sent_count}</td>
      <td>${c.failed_count}</td>
      <td>${c.pending_count}</td>
      <td class="field-hint">${new Date(c.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
    </tr>`;
  }

  // ---------------- Compose ----------------
  async function renderCompose() {
    const [templates, devices, settings] = await Promise.all([SmsStore.templates(schoolId), SmsStore.devices(schoolId), SmsStore.settings(schoolId)]);
    const classLabels = classOptionLabels(st);
    const onlineDevices = devices.filter(d => d.status !== 'disabled');
    // Published sittings, newest first — same source "Send Results to
    // Parents" (notify.js) uses, so a template built there drops in
    // here unchanged once the matching sitting is selected below.
    const publishedSorted = [...st.published].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    document.getElementById('smsBody').innerHTML = `
      <div class="card">
        <div class="form-grid">
          <div class="field full">
            <label>Campaign name</label>
            <input type="text" id="smsCampaignName" placeholder="e.g. Term 2 Results">
          </div>

          <div class="field full">
            <label>Recipients</label>
            <select id="smsRecipientType">
              <option value="all">All parents (with a phone number on file)</option>
              <option value="class">Specific class</option>
              <option value="students">Selected students</option>
              <option value="custom">Custom phone numbers</option>
            </select>
          </div>
          <div class="field full" id="smsClassWrap" style="display:none;">
            <label>Class / stream</label>
            <select id="smsClassSel">${classLabels.map(l => `<option value="${UI.esc(l)}">${UI.esc(l)}</option>`).join('')}</select>
          </div>
          <div class="field full" id="smsStudentsWrap" style="display:none;">
            <label>Students</label>
            <input type="text" id="smsStudentSearch" placeholder="Search students…">
            <div class="sms-recipient-grid" id="smsStudentList" style="max-height:220px; overflow:auto; margin-top:8px;"></div>
          </div>
          <div class="field full" id="smsCustomWrap" style="display:none;">
            <label>Phone numbers (one per line — "Name, Phone" or just the phone)</label>
            <textarea id="smsCustomNumbers" rows="5" placeholder="Jane Doe, 0712345678&#10;0798765432"></textarea>
          </div>

          <div class="field full">
            <label>Template (optional)</label>
            <select id="smsTemplateSel">
              <option value="">— write your own —</option>
              ${templates.map(t => `<option value="${t.id}">${UI.esc(t.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field full">
            <label>Results sitting (optional — fills in result placeholders)</label>
            <select id="smsSittingSel">
              <option value="">— none — (only the placeholders below will work)</option>
              ${publishedSorted.map(p => `<option value="${p.id}">${UI.esc(p.klass)} · ${UI.esc(p.type)} · ${UI.esc(p.term)} ${UI.esc(String(p.year))}</option>`).join('')}
            </select>
            <p class="field-hint" style="margin-top:2px;">Pick a published sitting to use {sitting}, {term}, {academic_year}, {position}, {class_size}, {subjects}, {strengths} and {improvement_areas} — a recipient outside that sitting's class will get those left blank in their message.</p>
          </div>
          <div class="field full">
            <label>Message</label>
            <div style="margin-bottom:6px;">${SmsUtil.PLACEHOLDERS.map(p => `<button type="button" class="sms-placeholder-btn" data-ph="${p}">{${p}}</button>`).join('')}${SmsUtil.RESULT_PLACEHOLDERS.map(p => `<button type="button" class="sms-placeholder-btn" data-ph="${p}">{${p}}</button>`).join('')}</div>
            <textarea id="smsMessage" rows="5" placeholder="Dear {parent_name}, ..."></textarea>
            <div class="sms-char-counter" id="smsCharCounter">0 characters · 0 SMS parts</div>
          </div>

          ${onlineDevices.length > 1 ? `
          <div class="field full">
            <label>Send through</label>
            <select id="smsDeviceSel">
              <option value="">Spread across all active devices</option>
              ${onlineDevices.map(d => `<option value="${d.id}">${UI.esc(d.device_name)} ${SmsUtil.isOnline(d) ? '(online)' : '(offline)'}</option>`).join('')}
            </select>
          </div>` : ''}

          <div class="field full">
            <p class="field-hint">Recipients matched: <strong id="smsRecipientCount">0</strong></p>
            <div class="sms-preview-box" id="smsPreview">Preview will appear here.</div>
          </div>
        </div>
        <div class="modal-actions" style="justify-content:flex-start;">
          <button class="btn btn-primary" id="smsSendBtn"><i class="fa-solid fa-paper-plane"></i> Send Bulk SMS</button>
        </div>
        ${onlineDevices.filter(SmsUtil.isOnline).length === 0 ? `<p class="field-hint" style="color:var(--ledger-red);"><i class="fa-solid fa-triangle-exclamation"></i> No SMS gateway is currently online — messages will still be queued and sent once a paired phone comes back online.</p>` : ''}
      </div>
    `;

    const recipientTypeSel = document.getElementById('smsRecipientType');
    const classWrap = document.getElementById('smsClassWrap');
    const studentsWrap = document.getElementById('smsStudentsWrap');
    const customWrap = document.getElementById('smsCustomWrap');
    const studentListEl = document.getElementById('smsStudentList');
    const selectedStudentIds = new Set();

    function studentsWithPhone() { return st.students.filter(s => s.parentPhone && s.parentPhone.trim()); }

    function renderStudentList(filter) {
      const q = (filter || '').toLowerCase();
      const list = studentsWithPhone().filter(s => !q || s.name.toLowerCase().includes(q) || s.klass.toLowerCase().includes(q));
      studentListEl.innerHTML = list.slice(0, 200).map(s => `
        <label style="display:flex; gap:6px; align-items:center; font-size:13px;">
          <input type="checkbox" data-sid="${s.id}" ${selectedStudentIds.has(s.id) ? 'checked' : ''}> ${UI.esc(s.name)} <span class="field-hint" style="margin:0;">(${UI.esc(s.klass)})</span>
        </label>
      `).join('') || '<p class="field-hint">No matching students with a parent phone on file.</p>';
      studentListEl.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.onchange = () => { if (cb.checked) selectedStudentIds.add(cb.dataset.sid); else selectedStudentIds.delete(cb.dataset.sid); refreshPreview(); };
      });
    }

    recipientTypeSel.onchange = () => {
      const v = recipientTypeSel.value;
      classWrap.style.display = v === 'class' ? '' : 'none';
      studentsWrap.style.display = v === 'students' ? '' : 'none';
      customWrap.style.display = v === 'custom' ? '' : 'none';
      if (v === 'students') renderStudentList('');
      refreshPreview();
    };
    document.getElementById('smsStudentSearch').oninput = (e) => renderStudentList(e.target.value);
    document.getElementById('smsClassSel').onchange = refreshPreview;
    document.getElementById('smsCustomNumbers').oninput = refreshPreview;

    document.getElementById('smsTemplateSel').onchange = (e) => {
      const t = templates.find(x => x.id === e.target.value);
      document.getElementById('smsMessage').value = t ? t.body : '';
      refreshPreview();
    };
    document.querySelectorAll('.sms-placeholder-btn').forEach(btn => {
      btn.onclick = () => {
        const ta = document.getElementById('smsMessage');
        const pos = ta.selectionStart || ta.value.length;
        const ins = `{${btn.dataset.ph}}`;
        ta.value = ta.value.slice(0, pos) + ins + ta.value.slice(pos);
        ta.focus();
        refreshPreview();
      };
    });
    document.getElementById('smsMessage').oninput = refreshPreview;

    function studentAverage(studentId) {
      const examsById = new Map(st.exams.map(e => [e.id, e]));
      const marks = st.results.filter(r => r.studentId === studentId).map(r => {
        const e = examsById.get(r.examId);
        return e ? (r.marks / e.totalMarks) * 100 : null;
      }).filter(v => v !== null);
      if (!marks.length) return null;
      return (marks.reduce((a, b) => a + b, 0) / marks.length).toFixed(1);
    }

    // ---- Results-sitting support: same computation "Send Results to
    // Parents" (notify.js) uses, so {sitting} {term} {academic_year}
    // {position} {class_size} {subjects} {strengths} {improvement_areas}
    // resolve here too once a sitting is picked above. ----
    function computeSittingResults(klass, type, term, year) {
      const exams = st.exams.filter(e => e.klass === klass && e.type === type && e.term === term && String(e.year) === String(year));
      const subjectCols = exams.map(e => ({ exam: e, subject: st.subjects.find(s => s.id === e.subjectId) })).filter(c => c.subject);
      const students = st.students.filter(s => s.klass === klass);
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

    function strengthsAndImprovements(subjectPcts) {
      const sorted = [...subjectPcts].sort((a, b) => b.pct - a.pct);
      const fmt = (s) => `${s.name} (${s.pct.toFixed(0)}%)`;
      if (sorted.length === 0) return { strengths: 'not yet graded', improvement_areas: 'not yet graded' };
      if (sorted.length === 1) return { strengths: fmt(sorted[0]), improvement_areas: 'not enough subjects to compare' };
      const takeStrengths = sorted.length >= 4 ? 2 : 1;
      return {
        strengths: sorted.slice(0, takeStrengths).map(fmt).join(', '),
        improvement_areas: sorted.slice(-takeStrengths).reverse().map(fmt).join(', ')
      };
    }

    function subjectBreakdown(subjectPcts) {
      if (!subjectPcts.length) return 'not yet graded';
      return subjectPcts.map(sp => {
        const band = Grading.levelForMarks(sp.pct, 100, st.settings.gradingBands);
        return `${sp.name}: ${sp.pct.toFixed(0)}%${band ? ` (${band.code})` : ''}`;
      }).join('; ');
    }

    // studentId -> result placeholder values for the currently-picked
    // sitting; empty when no sitting is selected (or a recipient isn't
    // in that sitting's class), in which case those placeholders are
    // simply left as literal {tags} in the preview so it's obvious
    // they weren't filled in.
    let resultsMap = new Map();
    function recomputeResultsMap() {
      resultsMap = new Map();
      const sittingId = document.getElementById('smsSittingSel').value;
      if (!sittingId) return;
      const chosen = publishedSorted.find(p => p.id === sittingId);
      if (!chosen) return;
      const rows = computeSittingResults(chosen.klass, chosen.type, chosen.term, chosen.year);
      rows.forEach(r => {
        const si = strengthsAndImprovements(r.subjectPcts);
        resultsMap.set(r.student.id, {
          sitting: chosen.type, term: chosen.term, academic_year: chosen.year,
          average: r.avg === null ? 'not yet available' : r.avg.toFixed(1),
          level: r.avg === null ? 'not yet graded' : r.band.label,
          position: r.position === null || r.position === 'Z' ? '—' : r.position,
          class_size: r.outOf,
          subjects: subjectBreakdown(r.subjectPcts),
          strengths: si.strengths,
          improvement_areas: si.improvement_areas
        });
      });
    }
    recomputeResultsMap();
    document.getElementById('smsSittingSel').onchange = () => { recomputeResultsMap(); refreshPreview(); };

    function placeholderCtx(student, studentId) {
      const base = {
        student_name: student ? student.name : '',
        name: student ? student.name : '',
        parent_name: student && student.parentName ? student.parentName : 'Parent',
        class: student ? student.klass : '',
        school_name: st.settings.schoolName || '',
        school: st.settings.schoolName || '',
        average: student ? studentAverage(student.id) : '',
        position: '', level: ''
      };
      const sittingVars = studentId ? resultsMap.get(studentId) : null;
      return sittingVars ? { ...base, ...sittingVars } : base;
    }

    function currentRecipients() {
      const v = recipientTypeSel.value;
      const msgTemplate = document.getElementById('smsMessage').value;
      let list = [];
      if (v === 'all') {
        list = studentsWithPhone().map(s => ({ studentId: s.id, student: s, phone: s.parentPhone }));
      } else if (v === 'class') {
        const label = document.getElementById('smsClassSel').value;
        list = studentsWithPhone().filter(s => s.klass === label).map(s => ({ studentId: s.id, student: s, phone: s.parentPhone }));
      } else if (v === 'students') {
        list = st.students.filter(s => selectedStudentIds.has(s.id) && s.parentPhone).map(s => ({ studentId: s.id, student: s, phone: s.parentPhone }));
      } else if (v === 'custom') {
        const lines = document.getElementById('smsCustomNumbers').value.split('\n').map(l => l.trim()).filter(Boolean);
        list = lines.map(line => {
          const parts = line.split(',');
          const phone = parts.length > 1 ? parts[1].trim() : parts[0].trim();
          const name = parts.length > 1 ? parts[0].trim() : '';
          return { studentId: null, student: name ? { name, parentName: '', klass: '' } : null, phone };
        });
      }
      return list.map(r => {
        const normalized = SmsUtil.normalizeKenyanPhone(r.phone);
        return { ...r, normalizedPhone: normalized, message: SmsUtil.render(msgTemplate, placeholderCtx(r.student, r.studentId)) };
      });
    }

    function refreshPreview() {
      const recipients = currentRecipients();
      const valid = recipients.filter(r => r.normalizedPhone);
      const invalid = recipients.length - valid.length;
      document.getElementById('smsRecipientCount').textContent = `${valid.length}${invalid ? ` (${invalid} invalid number${invalid === 1 ? '' : 's'} will be skipped)` : ''}`;

      const msgTemplate = document.getElementById('smsMessage').value;
      const seg = SmsUtil.segments(msgTemplate);
      const counter = document.getElementById('smsCharCounter');
      counter.textContent = `${seg.length} characters (${seg.encoding}) · SMS Parts: ${seg.parts || 0}`;
      counter.classList.toggle('warn', seg.parts > 1);

      const previewSample = valid[0];
      document.getElementById('smsPreview').textContent = previewSample ? previewSample.message : (msgTemplate || 'Preview will appear here.');
    }
    refreshPreview();

    document.getElementById('smsSendBtn').onclick = async () => {
      const campaignName = document.getElementById('smsCampaignName').value.trim();
      const msgTemplate = document.getElementById('smsMessage').value.trim();
      if (!campaignName) { UI.toast('Give this campaign a name'); return; }
      if (!msgTemplate) { UI.toast('Write a message first'); return; }

      const recipients = currentRecipients();
      const valid = recipients.filter(r => r.normalizedPhone);
      if (valid.length === 0) { UI.toast('No valid recipient phone numbers found'); return; }

      const deviceSel = document.getElementById('smsDeviceSel');
      const chosenDevice = deviceSel && deviceSel.value ? [deviceSel.value] : onlineDevices.map(d => d.id);

      const doSend = async () => {
        try {
          await SmsStore.createCampaign(schoolId, {
            campaignName, message: msgTemplate, source: 'manual',
            recipients: valid.map(r => ({ studentId: r.studentId, phone: r.normalizedPhone, message: r.message })),
            deviceIds: chosenDevice
          });
          UI.toast(`Queued ${valid.length} message${valid.length === 1 ? '' : 's'}`);
          SmsUI.tab = 'history';
          Views.sms();
        } catch (e) {
          UI.toast('Could not queue campaign: ' + (e.message || e));
        }
      };

      if (settings.require_confirmation) {
        UI.confirmAction(`Queue "${campaignName}" for ${valid.length} recipient${valid.length === 1 ? '' : 's'}?`, doSend, { confirmLabel: 'Send Bulk SMS', confirmClass: 'btn-primary' });
      } else {
        doSend();
      }
    };
  }

  // ---------------- History ----------------
  async function renderHistory() {
    const campaigns = await SmsStore.campaigns(schoolId, 100);
    document.getElementById('smsBody').innerHTML = `
      <div class="card">
        ${campaigns.length === 0 ? `<div class="empty"><div class="empty-title">No campaigns yet</div><p>Sent and queued campaigns will show up here.</p></div>` : `
          <div class="ledger"><div class="ledger-scroll"><table class="ledger-table">
            <thead><tr><th>Campaign</th><th>Status</th><th>Total</th><th>Sent</th><th>Failed</th><th>Pending</th><th>Created</th><th></th></tr></thead>
            <tbody>
              ${campaigns.map(c => `<tr>
                <td>${UI.esc(c.campaign_name)}</td>
                <td><span class="status-pill ${statusPillClass(c.status)}">${statusLabel(c.status)}</span></td>
                <td>${c.total_recipients}</td>
                <td>${c.sent_count}</td>
                <td>${c.failed_count}</td>
                <td>${c.pending_count}</td>
                <td class="field-hint">${new Date(c.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                <td>
                  <button class="btn btn-sm btn-ghost" data-view="${c.id}">View</button>
                  ${c.failed_count > 0 ? `<button class="btn btn-sm btn-ghost" data-retry="${c.id}">Retry failed</button>` : ''}
                  ${c.pending_count > 0 && c.status !== 'cancelled' ? `<button class="btn btn-sm btn-danger" data-cancel="${c.id}">Cancel</button>` : ''}
                </td>
              </tr>`).join('')}
            </tbody>
          </table></div></div>
        `}
      </div>
    `;
    document.querySelectorAll('[data-view]').forEach(btn => btn.onclick = () => openCampaignDetail(btn.dataset.view, campaigns.find(c => c.id === btn.dataset.view)));
    document.querySelectorAll('[data-retry]').forEach(btn => btn.onclick = () => UI.confirmAction('Retry every failed message in this campaign?', async () => {
      await SmsStore.retryFailed(btn.dataset.retry); UI.toast('Failed messages requeued'); Views.sms();
    }, { confirmLabel: 'Retry', confirmClass: 'btn-primary' }));
    document.querySelectorAll('[data-cancel]').forEach(btn => btn.onclick = () => UI.confirmAction('Cancel all pending messages in this campaign? Already-sent messages are unaffected.', async () => {
      await SmsStore.cancelCampaign(btn.dataset.cancel); UI.toast('Campaign cancelled'); Views.sms();
    }));
  }

  async function openCampaignDetail(id, campaign) {
    const rows = await SmsStore.queueForCampaign(id);
    const pct = campaign.total_recipients ? Math.round(((campaign.sent_count + campaign.failed_count) / campaign.total_recipients) * 100) : 0;
    UI.openModal(`
      <h2>${UI.esc(campaign.campaign_name)}</h2>
      <p class="field-hint">Template used: ${UI.esc(campaign.message)}</p>
      <div class="sms-progress" style="margin:10px 0;"><div class="sms-progress-fill" style="width:${pct}%;"></div></div>
      <p class="field-hint">${pct}% processed · ${campaign.sent_count} sent · ${campaign.failed_count} failed · ${campaign.pending_count} pending</p>
      <div class="ledger" style="max-height:320px; overflow:auto;"><div class="ledger-scroll"><table class="ledger-table">
        <thead><tr><th>Phone</th><th>Message actually sent</th><th>Status</th><th>Attempts</th><th>Error</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td>${UI.esc(r.phone_number)}</td>
          <td class="field-hint" style="max-width:320px; white-space:normal;">${UI.esc(r.message || '')}</td>
          <td><span class="status-pill ${r.status === 'sent' ? 'status-complete' : r.status === 'failed' ? 'status-none' : 'status-progress'}">${r.status}</span></td>
          <td>${r.attempts}</td>
          <td class="field-hint">${UI.esc(r.error_message || '')}</td>
        </tr>`).join('')}</tbody>
      </table></div></div>
      <div class="modal-actions"><button class="btn btn-ghost" id="closeBtn">Close</button></div>
    `, (root) => { root.querySelector('#closeBtn').onclick = () => UI.closeModal(); });
  }

  // ---------------- Templates ----------------
  async function renderTemplates() {
    const templates = await SmsStore.templates(schoolId);
    const DEFAULTS = [
      { name: 'Results (basic)', body: "Dear {parent_name}, {student_name}'s results are available. Average: {average}%. Log in to the CBE portal for details." },
      {
        name: 'Results (full breakdown)',
        body: "Dear Parent/Guardian, {name}'s {sitting} results for {term}, {academic_year} are available. " +
          "Average: {average}% ({level}). Position: {position}/{class_size}. " +
          "Subject performance: {subjects}. Strengths: {strengths}. Improvement areas: {improvement_areas}. Thank you."
      },
      { name: 'Attendance', body: 'Dear {parent_name}, {student_name} was marked absent today. Please contact the school if necessary.' },
      { name: 'Fee Reminder', body: 'Dear {parent_name}, this is a reminder concerning outstanding school fees for {student_name}. Please contact the school office.' },
      { name: 'Announcement', body: 'Dear Parent, {school_name} would like to inform you: ' }
    ];
    document.getElementById('smsBody').innerHTML = `
      <div class="card">
        <div class="modal-actions" style="justify-content:flex-start; margin-bottom:12px;">
          <button class="btn btn-primary" id="newTplBtn">+ New template</button>
        </div>
        <p class="field-hint">Using {sitting} {term} {academic_year} {position} {class_size} {subjects} {strengths} or {improvement_areas} in a template? Pick a "Results sitting" on the Bulk SMS tab when you send it — those placeholders only fill in for students in that sitting.</p>
        ${templates.length === 0 ? `
          <p class="field-hint">No saved templates yet. Quick-start with one of these:</p>
          <div class="sms-recipient-grid">${DEFAULTS.map(d => `<button class="btn btn-sm btn-ghost" data-seed="${UI.esc(d.name)}">+ ${UI.esc(d.name)}</button>`).join('')}</div>
        ` : `
          <div class="ledger"><div class="ledger-scroll"><table class="ledger-table">
            <thead><tr><th>Name</th><th>Message</th><th></th></tr></thead>
            <tbody>${templates.map(t => `<tr>
              <td>${UI.esc(t.name)}</td>
              <td class="field-hint">${UI.esc(t.body)}</td>
              <td><button class="btn btn-sm btn-ghost" data-edit="${t.id}">Edit</button> <button class="btn btn-sm btn-danger" data-del="${t.id}">Delete</button></td>
            </tr>`).join('')}</tbody>
          </table></div></div>
        `}
      </div>
    `;
    document.getElementById('newTplBtn').onclick = () => openTemplateEditor(null);
    document.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openTemplateEditor(templates.find(t => t.id === btn.dataset.edit)));
    document.querySelectorAll('[data-del]').forEach(btn => btn.onclick = () => UI.confirmAction('Delete this template?', async () => {
      await SmsStore.deleteTemplate(btn.dataset.del); UI.toast('Template deleted'); Views.sms();
    }));
    document.querySelectorAll('[data-seed]').forEach(btn => btn.onclick = () => {
      const d = DEFAULTS.find(x => x.name === btn.dataset.seed);
      openTemplateEditor(null, d);
    });

    function openTemplateEditor(existing, seed) {
      UI.openModal(`
        <h2>${existing ? 'Edit template' : 'New template'}</h2>
        <div class="form-grid">
          <div class="field full"><label>Name</label><input type="text" id="tplName" value="${UI.esc(existing ? existing.name : (seed ? seed.name : ''))}"></div>
          <div class="field full"><label>Message</label><textarea id="tplBody" rows="5">${UI.esc(existing ? existing.body : (seed ? seed.body : ''))}</textarea></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
          <button class="btn btn-primary" id="saveBtn">Save</button>
        </div>
      `, (root) => {
        root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
        root.querySelector('#saveBtn').onclick = async () => {
          const name = root.querySelector('#tplName').value.trim();
          const body = root.querySelector('#tplBody').value.trim();
          if (!name || !body) { UI.toast('Name and message are both required'); return; }
          try {
            await SmsStore.saveTemplate(schoolId, { id: existing ? existing.id : null, name, body });
            UI.closeModal(); UI.toast('Template saved'); Views.sms();
          } catch (e) { UI.toast('Could not save: ' + (e.message || e)); }
        };
      });
    }
  }

  // ---------------- Devices ----------------
  async function renderDevices() {
    const devices = await SmsStore.devices(schoolId);
    document.getElementById('smsBody').innerHTML = `
      <div class="card">
        <div class="modal-actions" style="justify-content:flex-start; margin-bottom:12px;">
          <button class="btn btn-primary" id="addDeviceBtn">+ Pair a phone</button>
          ${SmsUtil.GATEWAY_APK_URL ? `<a class="btn btn-ghost" href="${UI.esc(SmsUtil.GATEWAY_APK_URL)}" target="_blank" rel="noopener"><i class="fa-solid fa-download"></i> Download Gateway App (.apk)</a>` : ''}
        </div>
        ${devices.length === 0 ? `<div class="empty"><div class="empty-title">No gateway devices yet</div><p>Pair an Android phone with the "CBE SMS Gateway" app to start sending SMS.</p></div>` : `
          <div class="ledger"><div class="ledger-scroll"><table class="ledger-table">
            <thead><tr><th>Device</th><th>SIM number</th><th>Status</th><th>Last seen</th><th></th></tr></thead>
            <tbody>${devices.map(d => `<tr>
              <td>${UI.esc(d.device_name)}</td>
              <td>${UI.esc(d.phone_number || '—')}</td>
              <td><span class="sms-dot ${SmsUtil.isOnline(d) ? 'online' : d.status}"></span>${SmsUtil.isOnline(d) ? 'Online' : (d.status === 'pending' ? 'Awaiting pairing' : d.status === 'disabled' ? 'Disabled' : 'Offline')}</td>
              <td class="field-hint">${SmsUtil.timeAgo(d.last_seen)}</td>
              <td>
                <button class="btn btn-sm btn-ghost" data-rename="${d.id}">Rename</button>
                ${d.status === 'pending' ? `<button class="btn btn-sm btn-ghost" data-showcode="${d.id}">Show pair code</button>` : `<button class="btn btn-sm btn-ghost" data-repair="${d.id}">Re-pair</button>`}
                ${d.status === 'disabled' ? `<button class="btn btn-sm btn-ghost" data-enable="${d.id}">Enable</button>` : `<button class="btn btn-sm btn-ghost" data-disable="${d.id}">Disable</button>`}
                <button class="btn btn-sm btn-danger" data-remove="${d.id}">Remove</button>
              </td>
            </tr>`).join('')}</tbody>
          </table></div></div>
        `}
        <p class="field-hint" style="margin-top:12px;">Full setup steps (installing the Android app, permissions, pairing) are in <code>SMS_GATEWAY_SETUP.md</code>.</p>
      </div>
    `;
    document.getElementById('addDeviceBtn').onclick = async () => {
      const device = await SmsStore.createDevice(schoolId, 'CBE SMS Gateway');
      showPairCode(device);
    };
    document.querySelectorAll('[data-showcode]').forEach(btn => btn.onclick = () => showPairCode(devices.find(d => d.id === btn.dataset.showcode)));
    document.querySelectorAll('[data-repair]').forEach(btn => btn.onclick = () => UI.confirmAction('Generate a new pairing code? The phone currently paired will need to re-pair and its old token will stop working.', async () => {
      const device = await SmsStore.regeneratePairCode(btn.dataset.repair); showPairCode(device);
    }, { confirmLabel: 'Generate code', confirmClass: 'btn-primary' }));
    document.querySelectorAll('[data-rename]').forEach(btn => btn.onclick = () => {
      const d = devices.find(x => x.id === btn.dataset.rename);
      UI.openModal(`
        <h2>Rename device</h2>
        <div class="form-grid"><div class="field full"><label>Device name</label><input type="text" id="renameInput" value="${UI.esc(d.device_name)}"></div></div>
        <div class="modal-actions"><button class="btn btn-ghost" id="cancelBtn">Cancel</button><button class="btn btn-primary" id="saveBtn">Save</button></div>
      `, (root) => {
        root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
        root.querySelector('#saveBtn').onclick = async () => {
          await SmsStore.renameDevice(d.id, root.querySelector('#renameInput').value.trim() || d.device_name);
          UI.closeModal(); Views.sms();
        };
      });
    });
    document.querySelectorAll('[data-disable]').forEach(btn => btn.onclick = () => UI.confirmAction('Disable this device? It will stop receiving new messages until re-enabled.', async () => {
      await SmsStore.setDeviceStatus(btn.dataset.disable, 'disabled'); Views.sms();
    }));
    document.querySelectorAll('[data-enable]').forEach(btn => btn.onclick = async () => { await SmsStore.setDeviceStatus(btn.dataset.enable, 'offline'); Views.sms(); });
    document.querySelectorAll('[data-remove]').forEach(btn => btn.onclick = () => UI.confirmAction('Remove this device? Its pairing will stop working and it will need to be paired again from scratch.', async () => {
      await SmsStore.removeDevice(btn.dataset.remove); UI.toast('Device removed'); Views.sms();
    }));

    function showPairCode(device) {
      UI.openModal(`
        <h2>Pair "${UI.esc(device.device_name)}"</h2>
        ${SmsUtil.GATEWAY_APK_URL ? `<p class="field-hint">Don't have the app on that phone yet? <a href="${UI.esc(SmsUtil.GATEWAY_APK_URL)}" target="_blank" rel="noopener">Download the CBE SMS Gateway app</a> first.</p>` : ''}
        <p>On the Android phone, open the <strong>CBE SMS Gateway</strong> app and enter this code:</p>
        <p style="font-size:32px; font-weight:800; letter-spacing:4px; text-align:center; margin:18px 0;">${UI.esc(device.pair_code)}</p>
        <p class="field-hint">Expires in 15 minutes. The phone needs its own internet connection (Wi-Fi or mobile data) and a Kenyan SIM inserted for sending SMS.</p>
        <div class="modal-actions"><button class="btn btn-primary" id="closeBtn">Done</button></div>
      `, (root) => { root.querySelector('#closeBtn').onclick = () => { UI.closeModal(); Views.sms(); }; });
    }
  }

  // ---------------- Settings ----------------
  async function renderSettings() {
    const settings = await SmsStore.settings(schoolId);
    document.getElementById('smsBody').innerHTML = `
      <div class="card">
        <div class="form-grid">
          <div class="field full">
            <label><input type="checkbox" id="setAutoResults" ${settings.auto_results_sms ? 'checked' : ''}> Automatic results SMS after publishing</label>
          </div>
          <div class="field full">
            <label><input type="checkbox" id="setAutoAttendance" ${settings.auto_attendance_sms ? 'checked' : ''}> Automatic SMS when a learner is marked absent</label>
          </div>
          <div class="field full">
            <label><input type="checkbox" id="setAutoFee" ${settings.auto_fee_reminder_sms ? 'checked' : ''}> Automatic fee reminder SMS</label>
          </div>
          <div class="field full">
            <label><input type="checkbox" id="setConfirm" ${settings.require_confirmation ? 'checked' : ''}> Require confirmation before every bulk send</label>
          </div>
          <div class="field"><label>Maximum retry attempts</label><input type="number" id="setMaxRetry" min="1" max="10" value="${settings.max_retry_attempts}"></div>
          <div class="field"><label>Batch size (per gateway poll)</label><input type="number" id="setBatch" min="1" max="50" value="${settings.batch_size}"></div>
          <div class="field"><label>Delay between messages (ms, on the phone)</label><input type="number" id="setDelay" min="0" step="500" value="${settings.delay_between_ms}"></div>
        </div>
        <div class="modal-actions" style="justify-content:flex-start;">
          <button class="btn btn-primary" id="saveSettingsBtn">Save settings</button>
        </div>
        <p class="field-hint">The three "Automatic" toggles above are switches for other modules to check before auto-queueing SMS (e.g. Results, Attendance) — wire each one up from its own screen when you're ready to turn it on there.</p>
      </div>
    `;
    document.getElementById('saveSettingsBtn').onclick = async () => {
      try {
        await SmsStore.saveSettings(schoolId, {
          auto_results_sms: document.getElementById('setAutoResults').checked,
          auto_attendance_sms: document.getElementById('setAutoAttendance').checked,
          auto_fee_reminder_sms: document.getElementById('setAutoFee').checked,
          require_confirmation: document.getElementById('setConfirm').checked,
          max_retry_attempts: Number(document.getElementById('setMaxRetry').value) || 3,
          batch_size: Number(document.getElementById('setBatch').value) || 10,
          delay_between_ms: Number(document.getElementById('setDelay').value) || 2000
        });
        UI.toast('Settings saved');
      } catch (e) { UI.toast('Could not save: ' + (e.message || e)); }
    };
  }
};
