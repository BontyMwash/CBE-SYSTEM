/* ============================================================
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

  badge(band) {
    if (!band) return `<span class="badge badge-none">—</span>`;
    return `<span class="badge badge-${band.code}">${band.code}</span>`;
  },

  confirmAction(message, onConfirm) {
    UI.openModal(`
      <h2>Are you sure?</h2>
      <p>${UI.esc(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-danger" id="confirmBtn">Delete</button>
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
