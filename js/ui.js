/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   ui.js — small reusable UI helpers: modal, toast, badge, escape.
   ============================================================ */

const UI = {
  esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  toast(msg) {
    const root = document.getElementById('toastRoot');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  },

  openModal(html, onMount) {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `<div class="modal-overlay" id="modalOverlay"><div class="modal">${html}</div></div>`;
    const overlay = document.getElementById('modalOverlay');
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) UI.closeModal();
    });
    document.addEventListener('keydown', UI._escHandler);
    if (onMount) onMount(root);
  },

  _escHandler(e) {
    if (e.key === 'Escape') UI.closeModal();
  },

  closeModal() {
    document.getElementById('modalRoot').innerHTML = '';
    document.removeEventListener('keydown', UI._escHandler);
  },

  // Terms & Conditions / Copyright — reachable from the dashboard
  // footer, the login screen, and the homepage alike (all three share
  // the same #modalRoot, so this works whether or not anyone's
  // logged in yet). Kept as a modal rather than a real route so it
  // never has to fight Auth.allowedRoutes().
  showTerms() {
    const year = new Date().getFullYear();
    UI.openModal(`
      <h2>Terms &amp; Conditions / Copyright</h2>
      <div style="max-height:60vh; overflow-y:auto; font-size:13.5px; line-height:1.7; color:var(--ink-soft); padding-right:4px;">
        <p><strong>&copy; ${year} B~CBE Analytics. All rights reserved.</strong></p>
        <p>B~CBE Analytics (the "System") — including its source code, interface design, report and broadsheet layouts, and documentation — is the property of its developer and is protected by applicable copyright law. Unauthorized copying, redistribution, reverse engineering, or resale of the System, in whole or in part, is prohibited without prior written permission.</p>
        <p><strong>Use of the System</strong> is limited to the school(s) it has been licensed or provided to. Each school is responsible for the accuracy of data it enters (student records, marks, results) and for controlling access to its own logins.</p>
        <p><strong>Student data</strong> entered into the System (names, marks, results, contact details) belongs to the school. The System is a tool for recording and reporting that data — schools remain responsible for complying with any data-protection obligations that apply to them.</p>
        <p><strong>Published results.</strong> Once a sitting's results are published, the School acknowledges that they may be shared with parents/guardians, and that marks for that sitting are locked from further editing until an administrator unpublishes it — this is by design, to protect the integrity of results already communicated.</p>
        <p><strong>No warranty.</strong> The System is provided "as is". While built with care, no guarantee is made that it is error-free or uninterrupted; schools should keep their own backups of critical records where possible.</p>
        <p>Questions about these terms or about licensing can be directed to your system administrator or the developer of B~CBE Analytics.</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="termsCloseBtn">Close</button>
      </div>
    `, (root) => {
      root.querySelector('#termsCloseBtn').onclick = () => UI.closeModal();
    });
  },

  badge(band) {
    if (!band) return `<span class="badge badge-none">—</span>`;
    return `<span class="badge badge-${band.code}">${band.code}</span>`;
  },

  // Two-letter initials for avatars, e.g. "Jane Doe" -> "JD".
  initials(name) {
    if (!name) return '?';
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  },

  // Ripple effect for .btn clicks — delegated listener attached once
  // in app.js init(), so every current and future button gets it for
  // free without any other file needing to call this directly.
  attachRipple(btn, evt) {
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.width = span.style.height = size + 'px';
    span.style.left = (evt.clientX - rect.left - size / 2) + 'px';
    span.style.top = (evt.clientY - rect.top - size / 2) + 'px';
    btn.appendChild(span);
    span.addEventListener('animationend', () => span.remove());
  },

  // Animates a number counting upward inside `el`. Purely cosmetic —
  // the final value it settles on is always `target`, so nothing that
  // reads the DOM value afterward is affected.
  animateCount(el, target, opts) {
    if (!el) return;
    const decimals = (opts && opts.decimals) || 0;
    const suffix = (opts && opts.suffix) || '';
    const duration = (opts && opts.duration) || 900;
    const start = 0;
    const startTime = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = start + (target - start) * eased;
      el.textContent = val.toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    if (target === null || target === undefined || isNaN(target)) { el.textContent = '—'; return; }
    requestAnimationFrame(tick);
  },

  // Builds a CSV file from a header row + array-of-arrays body and
  // triggers a browser download. Values are stringified and quoted
  // whenever they contain a comma, quote, or newline. Shared by every
  // "Download CSV" button across Reports / Broadsheet / class lists.
  downloadCSV(filename, header, rows) {
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header, ...rows].map(r => r.map(esc).join(','));
    const csv = '\uFEFF' + lines.join('\r\n'); // BOM so Excel opens UTF-8 cleanly
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // One-click "Download PDF": renders a printable element (or several,
  // e.g. a whole class of report cards) straight to a downloadable PDF
  // file client-side, using html2pdf.js (loaded in index.html). This is
  // the direct-download counterpart to the "Print / Save as PDF" buttons,
  // which go through the browser's print dialog instead.
  //
  // `target` — a single element, or a NodeList/array of elements. Each
  // element is treated as its own page in the output PDF (matching how
  // @media print already page-breaks between .report-card elements).
  async downloadPDF(target, filename, btn, opts) {
    if (typeof html2pdf === 'undefined') {
      UI.toast('PDF library did not load — check your internet connection and try again.');
      return;
    }
    const els = target instanceof Element ? [target] : Array.from(target || []);
    if (els.length === 0) { UI.toast('Nothing to download yet.'); return; }
    const orientation = (opts && opts.orientation) || 'portrait';

    // Wrap every source element's *content* in a plain, unstyled
    // container for the PDF render, so app chrome (theme colors, dark
    // mode, sidebar, etc.) never leaks into the exported file and every
    // page is a clean white portrait sheet regardless of on-screen theme.
    const wrap = document.createElement('div');
    els.forEach((el, i) => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('.no-print').forEach(n => n.remove());
      clone.style.pageBreakAfter = i < els.length - 1 ? 'always' : 'auto';
      clone.style.background = '#fff';
      wrap.appendChild(clone);
    });
    wrap.style.background = '#fff';

    const originalLabel = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = 'Preparing PDF…'; }
    try {
      await html2pdf().set({
        margin: 8,
        filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation },
        pagebreak: { mode: ['css', 'legacy'] }
      }).from(wrap).save();
    } catch (e) {
      UI.toast('Could not generate PDF: ' + e.message);
    }
    if (btn) { btn.disabled = false; btn.innerHTML = originalLabel; }
  },

  // Same as downloadPDF, but returns the PDF as a Blob instead of
  // triggering a download — used where the file needs to be shared
  // (Web Share API) or attached rather than saved straight to disk.
  async pdfBlob(target, opts) {
    if (typeof html2pdf === 'undefined') return null;
    const els = target instanceof Element ? [target] : Array.from(target || []);
    if (els.length === 0) return null;
    const wrap = document.createElement('div');
    els.forEach((el, i) => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('.no-print').forEach(n => n.remove());
      clone.style.pageBreakAfter = i < els.length - 1 ? 'always' : 'auto';
      clone.style.background = '#fff';
      wrap.appendChild(clone);
    });
    wrap.style.background = '#fff';
    const orientation = (opts && opts.orientation) || 'portrait';
    return html2pdf().set({
      margin: 8,
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation },
      pagebreak: { mode: ['css', 'legacy'] }
    }).from(wrap).outputPdf('blob');
  },

  confirmAction(message, onConfirm, opts) {
    const confirmLabel = (opts && opts.confirmLabel) || 'Delete';
    const confirmClass = (opts && opts.confirmClass) || 'btn-danger';
    UI.openModal(`
      <h2>Are you sure?</h2>
      <p>${UI.esc(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn ${confirmClass}" id="confirmBtn">${UI.esc(confirmLabel)}</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#confirmBtn').onclick = () => {
        onConfirm();
        UI.closeModal();
      };
    });
  }
};
