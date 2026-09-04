/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   ui.js — small reusable UI helpers: modal, toast, badge, escape.
   ============================================================ */

const UI = {
  // Sorts admission numbers highest -> lowest. Admission numbers are
  // free-text (e.g. "2025-014"), so this uses a "numeric" locale
  // compare — it orders embedded numbers by value rather than
  // character-by-character (2 before 10) — and falls back to name so
  // students without an admission number still land in a stable spot.
  byAdmissionDesc(a, b) {
    const admA = a.admissionNo || '', admB = b.admissionNo || '';
    if (!admA && !admB) return (a.name || '').localeCompare(b.name || '');
    if (!admA) return 1;
    if (!admB) return -1;
    return admB.localeCompare(admA, undefined, { numeric: true, sensitivity: 'base' });
  },

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
    // Removing the anchor AND revoking the object URL immediately both
    // race the browser's own (async) handling of the click-triggered
    // download — on several browsers/webviews (notably Safari/iOS and
    // installed-PWA webviews) this was winning the race, cancelling the
    // in-flight download or detaching its data source, and producing a
    // download with the right filename but 0 bytes of content. Deferring
    // BOTH the removal and the revoke lets the download actually start
    // and finish reading the blob first.
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  },

  // Same header + array-of-arrays shape as downloadCSV, but produces a
  // real .xlsx workbook (via SheetJS, loaded in index.html) instead of
  // plain text — proper column widths, and numbers stay numbers rather
  // than becoming text-that-looks-like-a-number in Excel.
  downloadExcel(filename, header, rows, sheetName) {
    if (typeof XLSX === 'undefined') { this.toast('Excel export is unavailable right now.'); return; }
    const toCell = (v) => {
      if (v === null || v === undefined || v === '') return '';
      const n = Number(v);
      return (v !== '' && !isNaN(n) && /^-?\d+(\.\d+)?%?$/.test(String(v).trim())) ? n : v;
    };
    const aoa = [header, ...rows.map(r => r.map(toCell))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = header.map((h, i) => ({
      wch: Math.max(String(h).length, ...rows.map(r => String(r[i] ?? '').length)) + 2
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Sheet1').slice(0, 31));
    XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
  },

  // Shared builder behind downloadPDF/pdfBlob. Clones the source
  // element(s) into an off-screen container that is actually attached
  // to the document (html2canvas needs real layout to measure
  // against — a detached clone collapses to the wrong size), sized to
  // match the PDF's actual printable width, then unclipped/flattened
  // the same way @media print already does (html2canvas doesn't
  // evaluate print media styles on its own).
  // Shared PDF page settings — kept in one place so _buildPdfWrap can
  // lay out content at exactly the pixel width html2pdf will actually
  // capture (see below), instead of guessing.
  _PDF_MARGIN_MM: 8,
  // Extra room reserved at the very bottom of every page, on top of
  // _PDF_MARGIN_MM, so the repeating copyright footer (stamped in
  // afterward via the raw jsPDF API — see downloadPDF below) always
  // lands in clear space below the last row of content instead of
  // overlapping it. html2pdf.js is told about this via an asymmetric
  // margin array ([top, left, bottom, right]), which is what actually
  // shrinks the per-page content height it paginates against.
  _PDF_FOOTER_RESERVE_MM: 10,
  _PDF_FORMAT_MM: { a4: { w: 210, h: 297 } },

  // [top, left, bottom, right] margin array handed to html2pdf.js —
  // bottom gets the extra footer allowance, the other three stay at
  // the base margin.
  _pdfMarginArray() {
    const m = UI._PDF_MARGIN_MM;
    return [m, m, m + UI._PDF_FOOTER_RESERVE_MM, m];
  },

  // html2pdf.js renders/captures the source element at a CSS pixel
  // width equal to the PDF page's content width (page width minus
  // left/right margins, converted at 96dpi) — it does this internally
  // to slice one continuous capture into pages by height, and it does
  // this REGARDLESS of any windowWidth/width override passed to
  // html2canvas. If the element we hand it is laid out wider than
  // that (which the old fixed 1500/1050px trick did), the capture
  // simply crops off whatever falls outside that centered window —
  // that's what was cutting off the right-hand columns of wide
  // tables. Laying out at this exact width instead means what you
  // see is what gets captured, edge to edge, with nothing clipped.
  _pdfPageContentWidthPx(orientation, format) {
    const mm = UI._PDF_FORMAT_MM[format] || UI._PDF_FORMAT_MM.a4;
    const pageWidthMm = orientation === 'landscape' ? mm.h : mm.w;
    const contentWidthMm = pageWidthMm - (UI._PDF_MARGIN_MM * 2);
    return Math.round((contentWidthMm / 25.4) * 96);
  },

  // Page content HEIGHT in px at the same 96dpi convention as the
  // width helper above, using the FULL bottom-margin allowance (base
  // margin + footer reserve). html2pdf paginates a tall capture by
  // slicing it into chunks this tall; if a table row's rendered
  // height straddles one of those slice boundaries it gets sliced
  // physically in half — the "cut content" artefact. We can't stop
  // html2pdf slicing mid-row from px math alone, so _buildPdfWrap
  // additionally marks every row page-break-avoid (see below); this
  // height is used there just to warn/avoid pathological single rows
  // taller than a whole page.
  _pdfPageContentHeightPx(orientation, format) {
    const mm = UI._PDF_FORMAT_MM[format] || UI._PDF_FORMAT_MM.a4;
    const pageHeightMm = orientation === 'landscape' ? mm.w : mm.h;
    const contentHeightMm = pageHeightMm - UI._PDF_MARGIN_MM - (UI._PDF_MARGIN_MM + UI._PDF_FOOTER_RESERVE_MM);
    return Math.round((contentHeightMm / 25.4) * 96);
  },

  // Builds the off-screen container itself: ledger scroll boxes are
  // forced open so the FULL table is captured instead of just
  // whatever fit in the on-screen scroll window, and sticky/frozen
  // columns are unstuck so they don't double up in the flattened
  // image.
  _buildPdfWrap(els, orientation, format) {
    const vw = UI._pdfPageContentWidthPx(orientation, format || 'a4');
    const wrap = document.createElement('div');
    // IMPORTANT: keep this element in normal document flow (no
    // position:fixed / position:absolute). html2canvas's internal
    // clone-and-measure pass cannot reliably compute the height of an
    // out-of-flow element — it comes back as 0, which is what was
    // producing completely blank PDFs. To hide it from view without
    // taking it out of flow, we nest it inside a 1x1px, overflow:hidden
    // "peephole" container instead — clipping is a paint-time effect
    // and doesn't affect the child's own measured layout geometry.
    wrap.style.background = '#fff';
    wrap.style.width = vw + 'px';
    // Printed/downloaded reports must always render in the LIGHT
    // palette, regardless of whether the app itself is currently in
    // dark mode (html[data-theme="dark"] — see :root overrides at the
    // top of this file). CSS custom properties are just inherited
    // values, so without this, a clone captured while dark mode is on
    // would still resolve --ink/--paper-raised/--chalkboard etc. to
    // their light-on-dark values from that cascade, even though we
    // separately force the OUTER canvas background to white above —
    // producing exactly the "washed out, barely readable" mismatch
    // (light text sized for a dark card, landing on a white page)
    // reported when someone downloads a PDF while dark mode is on.
    // Re-declaring the same tokens :root defines for light mode here,
    // directly on the wrap, overrides that inherited cascade for
    // everything inside it, independent of the live page's theme.
    const LIGHT_THEME_VARS = {
      '--paper': '#F8FAFC', '--paper-raised': '#FFFFFF',
      '--ink': '#1E293B', '--ink-soft': '#5B6478', '--ink-faint': '#8A91A8',
      '--chalkboard': '#171B3A', '--chalkboard-light': '#232963', '--chalkboard-lighter': '#4F46E5',
      '--paper-line': '#E2E8F0', '--paper-line-soft': '#EEF2F8',
      '--danger-bg': '#FDECEB', '--ok-bg': '#E9F7EF',
      '--shadow-card': '0 1px 2px rgba(30,41,59,0.04), 0 8px 24px rgba(30,41,59,0.06)',
      '--shadow-card-hover': '0 4px 10px rgba(30,41,59,0.06), 0 16px 40px rgba(79,70,229,0.14)',
      '--shadow-pop': '0 24px 64px rgba(30,41,59,0.22)',
      '--glass-bg': 'rgba(255,255,255,0.7)', '--glass-border': 'rgba(255,255,255,0.4)',
    };
    Object.entries(LIGHT_THEME_VARS).forEach(([k, v]) => wrap.style.setProperty(k, v));

    const hideBox = document.createElement('div');
    hideBox.style.position = 'fixed';
    hideBox.style.top = '0';
    hideBox.style.left = '0';
    hideBox.style.width = '1px';
    hideBox.style.height = '1px';
    hideBox.style.overflow = 'hidden';
    hideBox.style.zIndex = '-9999';

    els.forEach((el, i) => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('.no-print').forEach(n => n.remove());

      // Give the export the SAME column proportions the browser
      // already chose on screen (its normal, content-aware
      // table-layout:auto pass) instead of guessing fresh widths for
      // table-layout:fixed. We measure each header cell's rendered
      // width on the live, still-on-screen table, then bake those
      // proportions into an explicit <colgroup> on the clone before
      // switching it to fixed layout below — so the exported columns
      // end up exactly as wide, relative to each other, as what was
      // on screen a moment ago. This is what actually keeps the PDF
      // matching the browser view, rather than an independent (and
      // sometimes too-narrow) guess at what each column needs.
      const sourceTables = el.querySelectorAll('table.ledger-table');
      const cloneTables = clone.querySelectorAll('table.ledger-table');
      sourceTables.forEach((srcT, ti) => {
        const cloneT = cloneTables[ti];
        const headerRow = srcT.querySelector('thead tr');
        if (!cloneT || !headerRow) return;
        const ths = Array.from(headerRow.children);
        const widths = ths.map(th => th.getBoundingClientRect().width);
        const total = widths.reduce((a, b) => a + b, 0);
        if (!ths.length || !total) return;
        const oldColgroup = cloneT.querySelector('colgroup');
        if (oldColgroup) oldColgroup.remove();
        const colgroup = document.createElement('colgroup');
        widths.forEach(w => {
          const col = document.createElement('col');
          col.style.width = (w / total * 100) + '%';
          colgroup.appendChild(col);
        });
        cloneT.insertBefore(colgroup, cloneT.firstChild);
      });

      // Un-clip any horizontally-scrolling ledger/table boxes so the
      // whole width is captured, not just the visible scroll window.
      clone.querySelectorAll('.ledger-scroll, .ledger-scroll-y').forEach(sc => {
        sc.style.overflow = 'visible';
        sc.style.maxHeight = 'none';
        sc.style.width = '100%';
      });
      // Sticky header + frozen Pos./Name columns only make sense with
      // real scrolling — flatten them for a static image capture.
      clone.querySelectorAll('thead th').forEach(th => { th.style.position = 'static'; });
      clone.querySelectorAll('.freeze-1, .freeze-2').forEach(c => {
        c.style.position = 'static';
        c.style.boxShadow = 'none';
      });
      clone.querySelectorAll('table.ledger-table').forEach(t => {
        t.style.width = '100%';
        // table-layout:auto (the default) lets a table grow WIDER
        // than its 100% container if the content needs the room —
        // it treats width:100% as a minimum, not a cap. With enough
        // columns that overflow silently ran past the page edge and
        // got cropped out of the capture entirely. table-layout:fixed
        // makes 100% an actual cap: columns share the page width and
        // long cell content wraps instead of pushing the table wider
        // than the page can show.
        t.style.tableLayout = 'fixed';
      });
      // html2pdf's 'css' pagebreak mode looks for CSS break-inside
      // rules directly on the DOM it's about to capture — it does NOT
      // know about the app's @media print stylesheet (html2canvas
      // renders using normal screen styles), so without this every
      // row was a candidate to get physically sliced in half wherever
      // it happened to straddle a page boundary. Setting it inline,
      // here, on the actual offscreen clone is what makes html2pdf
      // push a row that would be cut onto the next page whole instead.
      clone.querySelectorAll('table.ledger-table tr').forEach(tr => {
        tr.style.pageBreakInside = 'avoid';
        tr.style.breakInside = 'avoid';
      });
      // Keep the header glued to whichever page its table starts on
      // (harmless — it's already always at the top of its own table).
      clone.querySelectorAll('table.ledger-table thead').forEach(th => {
        th.style.pageBreakAfter = 'avoid';
        th.style.breakAfter = 'avoid';
      });
      // Give a wide table (many subject columns) more room to work
      // with by trimming the on-screen padding/font-size, matching
      // what the print stylesheet already does for @media print.
      clone.querySelectorAll('table.ledger-table').forEach(t => {
        // Every table now carries a measured <colgroup> (see above),
        // so every column has a real, guaranteed share of the page
        // width — numeric cells can safely stay on one line rather
        // than wrapping, matching how they render on screen.
        t.querySelectorAll('th, td').forEach(c => {
          c.style.padding = '5px 12px';
          c.style.fontSize = '10px';
          c.style.overflowWrap = 'break-word';
          c.style.whiteSpace = c.classList.contains('num') ? 'nowrap' : 'normal';
        });
      });
      // Decorative absolutely-positioned stat-card icons/corners can
      // land in the wrong place once flattened out of their on-screen
      // container — drop them, same as print does.
      clone.querySelectorAll('.stat-icon').forEach(ic => { ic.style.display = 'none'; });

      clone.style.pageBreakAfter = i < els.length - 1 ? 'always' : 'auto';
      clone.style.background = '#fff';
      clone.style.width = '100%';
      wrap.appendChild(clone);
    });
    hideBox.appendChild(wrap);
    document.body.appendChild(hideBox);
    wrap._pdfHideBox = hideBox;
    return wrap;
  },

  // Removes a wrap element created by _buildPdfWrap, including its
  // hidden positioning container.
  _removePdfWrap(wrap) {
    if (wrap && wrap._pdfHideBox) { wrap._pdfHideBox.remove(); }
    else if (wrap) { wrap.remove(); }
  },

  // html2canvas rasterizes text straight onto a <canvas> the moment
  // it's called — it does NOT wait for web fonts to finish loading
  // first. IBM Plex Mono (used for every mark/percentage/total in
  // the ledger tables) is loaded from Google Fonts with
  // `display=swap`, so if capture fires before it's actually
  // downloaded and rasterized, html2canvas draws that text using a
  // fallback font's metrics while the real font is still swapping
  // in — the result is exactly the "digits/slashes overlapping or
  // garbled" look, and because it depends on network timing it's
  // intermittent rather than something a layout fix alone can cure.
  // document.fonts.load() explicitly requests + awaits the specific
  // faces/sizes actually used in the tables (rather than relying on
  // document.fonts.ready, which only resolves for faces some element
  // has already triggered a request for) before we let html2canvas
  // anywhere near the DOM.
  async _waitForPdfFonts() {
    try {
      if (!(document.fonts && document.fonts.load)) return;
      await Promise.all([
        document.fonts.load('400 10px "IBM Plex Mono"'),
        document.fonts.load('500 10px "IBM Plex Mono"'),
        document.fonts.load('600 10px "IBM Plex Mono"'),
        document.fonts.load('400 10px "Inter"'),
        document.fonts.load('600 10px "Inter"'),
        document.fonts.load('700 10px "Inter"'),
      ]);
      if (document.fonts.ready) await document.fonts.ready;
    } catch (e) { /* best-effort — proceed with capture regardless */ }
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
    const format = (opts && opts.format) || 'a4';

    const originalLabel = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = 'Preparing PDF…'; }
    const wrap = UI._buildPdfWrap(els, orientation, format);
    try {
      await UI._waitForPdfFonts();
      await html2pdf().set({
        margin: UI._pdfMarginArray(),
        filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format, orientation },
        pagebreak: { mode: ['css', 'legacy'] }
      }).from(wrap).toPdf().get('pdf').then(pdf => UI._stampPdfFooter(pdf, opts && opts.footer)).save();
    } catch (e) {
      UI.toast('Could not generate PDF: ' + e.message);
    } finally {
      UI._removePdfWrap(wrap);
      if (btn) { btn.disabled = false; btn.innerHTML = originalLabel; }
    }
  },

  // Stamps a footer onto the BOTTOM of every page of a generated PDF,
  // using jsPDF's own text/line API directly rather than anything
  // captured by html2canvas — that's what makes it repeat correctly
  // once per page instead of just once at the end of the last one.
  // Runs as a .toPdf() hook, after pagination has already happened
  // but before the file is saved, so UI._PDF_FOOTER_RESERVE_MM worth
  // of clear space is guaranteed to be waiting for it at the bottom
  // of each page already.
  //
  // `footerOpts` lets a caller override the default centred copyright
  // line (see buildPrintFooterHTML in views.js) with its own
  // left/center/right text — e.g. the broadsheet uses this to show
  // the school's motto centred and "B~CBE Analytics" on the right,
  // with no copyright line at all, instead of the default. Any of
  // left/center/right left unset renders as blank, not a fallback.
  _stampPdfFooter(pdf, footerOpts) {
    const pageCount = pdf.internal.getNumberOfPages();
    const { width: pw, height: ph } = pdf.internal.pageSize;
    const useDefault = !footerOpts;
    const leftText = useDefault ? '' : (footerOpts.left || '');
    const centerText = useDefault
      ? `Generated by B~CBE Analytics  \u00b7  ${new Date().toLocaleDateString()}  \u00b7  \u00a9 ${new Date().getFullYear()} B~CBE Analytics. All rights reserved.`
      : (footerOpts.center || '');
    const rightText = useDefault ? '' : (footerOpts.right || '');
    // html2pdf slices ONE continuous captured canvas into page-sized
    // chunks by raw pixel height — when the true content height isn't
    // an exact multiple of a page's height, a sliver of whatever row
    // sits right at that seam can still land inside the "reserved"
    // bottom margin band (rounding, not anything page-break-inside
    // actually failed to catch). Left alone, that stray sliver of
    // real content ends up sitting directly under our stamped text,
    // which is what produced the garbled/overlapping look. Painting
    // an opaque white bar across the FULL reserved band first, on
    // every page, guarantees the footer always lands on a clean
    // surface regardless of what the capture left behind under it.
    const bandTop = ph - (UI._PDF_MARGIN_MM + UI._PDF_FOOTER_RESERVE_MM);
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, bandTop, pw, ph - bandTop, 'F');
      const y = ph - (UI._PDF_MARGIN_MM + UI._PDF_FOOTER_RESERVE_MM / 2);
      pdf.setDrawColor(200);
      pdf.setLineWidth(0.2);
      pdf.line(UI._PDF_MARGIN_MM, y - 2.5, pw - UI._PDF_MARGIN_MM, y - 2.5);
      pdf.setFont(undefined, 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(120, 120, 120);
      if (leftText) pdf.text(leftText, UI._PDF_MARGIN_MM, y + 1.5, { align: 'left' });
      if (centerText) pdf.text(centerText, pw / 2, y + 1.5, { align: 'center' });
      if (rightText) pdf.text(rightText, pw - UI._PDF_MARGIN_MM, y + 1.5, { align: 'right' });
      pdf.setTextColor(0, 0, 0);
    }
    return pdf;
  },

  // Same as downloadPDF, but returns the PDF as a Blob instead of
  // triggering a download — used where the file needs to be shared
  // (Web Share API) or attached rather than saved straight to disk.
  async pdfBlob(target, opts) {
    if (typeof html2pdf === 'undefined') return null;
    const els = target instanceof Element ? [target] : Array.from(target || []);
    if (els.length === 0) return null;
    const orientation = (opts && opts.orientation) || 'portrait';
    const format = (opts && opts.format) || 'a4';
    const wrap = UI._buildPdfWrap(els, orientation, format);
    try {
      await UI._waitForPdfFonts();
      return await html2pdf().set({
        margin: UI._pdfMarginArray(),
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format, orientation },
        pagebreak: { mode: ['css', 'legacy'] }
      }).from(wrap).toPdf().get('pdf').then(pdf => UI._stampPdfFooter(pdf, opts && opts.footer)).outputPdf('blob');
    } finally {
      UI._removePdfWrap(wrap);
    }
  },

  // Lightweight "more actions" menu, shown as a modal action sheet
  // rather than a floating dropdown — safe inside scroll/overflow
  // containers (e.g. a table) where a positioned dropdown could get
  // clipped, and it doubles as a clean full-screen sheet on mobile
  // (the modal already goes full-screen under 900px).
  // items: [{ label, icon (fa- class suffix), danger, onClick }]
  openActionSheet(title, items) {
    UI.openModal(`
      <h2>${UI.esc(title)}</h2>
      <div class="action-sheet">
        ${items.map((it, i) => `
          <button class="action-sheet-item${it.danger ? ' danger' : ''}" data-i="${i}">
            <i class="fa-solid ${it.icon || 'fa-circle'}"></i> ${UI.esc(it.label)}
          </button>
        `).join('')}
      </div>
    `, (root) => {
      root.querySelectorAll('.action-sheet-item').forEach(btn => {
        btn.onclick = () => { UI.closeModal(); items[Number(btn.dataset.i)].onClick(); };
      });
    });
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
