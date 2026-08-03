/* ============================================================
   import.js — bulk student import from CSV or Excel.
   CSV is parsed natively (works fully offline).
   Excel (.xlsx/.xls) is parsed via the SheetJS library loaded
   in index.html — that needs an internet connection on first
   use in a session; after that the browser caches it.
   ============================================================ */

const Importer = {

  // Minimal CSV parser: handles quoted fields, commas & newlines inside quotes.
  parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += c;
        }
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* skip, \n handles the break */ }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(cell => cell.trim() !== ''));
  },

  // Turn a 2D array of rows into {name, admissionNo, klass} records.
  // Detects a header row if it contains recognizable column names;
  // otherwise assumes column order: Name, Admission No, Class.
  rowsToStudents(rows, defaultKlass) {
    if (!rows.length) return { records: [], skipped: 0 };

    const norm = s => (s || '').toString().trim().toLowerCase();
    const headerCandidates = rows[0].map(norm);
    const looksLikeHeader = headerCandidates.some(h =>
      h.includes('name') || h.includes('admission') || h.includes('class') || h.includes('grade')
    );

    let nameIdx = 0, admIdx = -1, klassIdx = -1;
    let dataRows = rows;

    if (looksLikeHeader) {
      headerCandidates.forEach((h, i) => {
        if (h.includes('name')) nameIdx = i;
        else if (h.includes('admission') || h.includes('adm') || h.includes('reg')) admIdx = i;
        else if (h.includes('class') || h.includes('grade') || h.includes('stream')) klassIdx = i;
      });
      dataRows = rows.slice(1);
    } else {
      nameIdx = 0; admIdx = 1; klassIdx = 2;
    }

    let skipped = 0;
    const records = [];
    dataRows.forEach(r => {
      const name = (r[nameIdx] || '').toString().trim();
      if (!name) { skipped++; return; }
      const admissionNo = admIdx >= 0 ? (r[admIdx] || '').toString().trim() : '';
      const klass = (klassIdx >= 0 ? (r[klassIdx] || '').toString().trim() : '') || defaultKlass || '';
      records.push({ name, admissionNo, klass });
    });

    return { records, skipped };
  },

  parseFile(file, onDone, onError) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'csv') {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const rows = this.parseCSV(reader.result);
          onDone(rows);
        } catch (e) { onError(e); }
      };
      reader.onerror = () => onError(new Error('Could not read file'));
      reader.readAsText(file);
      return;
    }

    // Excel path
    if (typeof XLSX === 'undefined') {
      onError(new Error('The Excel reader has not loaded (no internet connection). Save the file as CSV instead, or reconnect and try again.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        onDone(rows);
      } catch (e) { onError(e); }
    };
    reader.onerror = () => onError(new Error('Could not read file'));
    reader.readAsArrayBuffer(file);
  },

  // Opens the full import flow: file picker -> preview -> confirm.
  // onImported(count) is called after students are saved.
  async openImportModal(onImported) {
    const st = await Store.current();
    UI.openModal(`
      <h2>Import students</h2>
      <p class="field-hint" style="margin-bottom:14px;">
        Upload a .csv or .xlsx file. If it has header columns like <strong>Name</strong>,
        <strong>Admission No.</strong> and <strong>Class</strong> they'll be detected automatically —
        otherwise the first three columns are read as Name, Admission No., Class in that order.
      </p>
      <div class="field full">
        <label>File</label>
        <input type="file" id="importFileInput" accept=".csv,.xlsx,.xls">
      </div>
      <div class="field full">
        <label>Default class (used for rows that don't specify one)</label>
        <input type="text" id="importDefaultKlass" list="importKlassList" placeholder="e.g. Grade 7">
        <datalist id="importKlassList">${classesFromStudents(st.students).map(c => `<option value="${UI.esc(c)}">`).join('')}</datalist>
      </div>
      <div id="importPreviewWrap"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="confirmImportBtn" disabled>Import 0 students</button>
      </div>
    `, (root) => {
      let parsedRecords = [];

      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();

      function renderPreview() {
        const previewWrap = root.querySelector('#importPreviewWrap');
        const confirmBtn = root.querySelector('#confirmImportBtn');
        if (!parsedRecords.length) {
          previewWrap.innerHTML = '';
          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Import 0 students';
          return;
        }
        const existingKeys = new Set(st.students.map(s => (s.admissionNo ? 'adm:' + s.admissionNo.toLowerCase() : 'nk:' + s.name.toLowerCase() + '|' + s.klass.toLowerCase())));
        const dupes = parsedRecords.filter(r => existingKeys.has(r.admissionNo ? 'adm:' + r.admissionNo.toLowerCase() : 'nk:' + r.name.toLowerCase() + '|' + r.klass.toLowerCase())).length;

        previewWrap.innerHTML = `
          <p class="field-hint" style="margin:14px 0 8px 0;">
            ${parsedRecords.length} student${parsedRecords.length === 1 ? '' : 's'} found
            ${dupes ? `&middot; ${dupes} look like duplicates of existing students and will be skipped` : ''}
          </p>
          <div class="ledger" style="max-height:240px; overflow-y:auto;">
            <div class="ledger-scroll">
              <table class="ledger-table">
                <thead><tr><th>Name</th><th>Admission No.</th><th>Class</th></tr></thead>
                <tbody>
                  ${parsedRecords.slice(0, 200).map(r => `<tr><td>${UI.esc(r.name)}</td><td class="num">${UI.esc(r.admissionNo) || '—'}</td><td>${UI.esc(r.klass) || '<span class="row-index">missing</span>'}</td></tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
          ${parsedRecords.length > 200 ? `<p class="field-hint">Showing first 200 rows.</p>` : ''}
        `;
        const importable = parsedRecords.length - dupes;
        confirmBtn.disabled = importable <= 0 || parsedRecords.some(r => !r.klass);
        confirmBtn.textContent = parsedRecords.some(r => !r.klass)
          ? 'Set a default class to continue'
          : `Import ${importable} student${importable === 1 ? '' : 's'}`;
      }

      root.querySelector('#importFileInput').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        Importer.parseFile(file, (rows) => {
          const defaultKlass = root.querySelector('#importDefaultKlass').value.trim();
          const { records, skipped } = Importer.rowsToStudents(rows, defaultKlass);
          parsedRecords = records;
          renderPreview();
          if (skipped) UI.toast(`${skipped} row(s) skipped (missing name)`);
        }, (err) => {
          UI.toast(err.message || 'Could not parse that file');
        });
      };

      root.querySelector('#importDefaultKlass').oninput = () => {
        const defaultKlass = root.querySelector('#importDefaultKlass').value.trim();
        parsedRecords = parsedRecords.map(r => ({ ...r, klass: r.klass || defaultKlass }));
        renderPreview();
      };

      root.querySelector('#confirmImportBtn').onclick = async () => {
        const existingKeys = new Set(st.students.map(s => (s.admissionNo ? 'adm:' + s.admissionNo.toLowerCase() : 'nk:' + s.name.toLowerCase() + '|' + s.klass.toLowerCase())));
        const toInsert = [];
        const seen = new Set();
        parsedRecords.forEach(r => {
          const key = r.admissionNo ? 'adm:' + r.admissionNo.toLowerCase() : 'nk:' + r.name.toLowerCase() + '|' + r.klass.toLowerCase();
          if (existingKeys.has(key) || seen.has(key)) return;
          seen.add(key);
          toInsert.push(r);
        });

        const confirmBtn = root.querySelector('#confirmImportBtn');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Importing…';
        try {
          await Store.addStudentsBulk(toInsert);
          UI.closeModal();
          UI.toast(`Imported ${toInsert.length} student${toInsert.length === 1 ? '' : 's'}`);
          if (onImported) onImported(toInsert.length);
        } catch (err) {
          UI.toast('Import failed: ' + err.message);
          confirmBtn.disabled = false;
          confirmBtn.textContent = `Import ${toInsert.length} student${toInsert.length === 1 ? '' : 's'}`;
        }
      };
    });
  }
};
