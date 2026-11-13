/* ------------------------------------------------------------
   Developer-tools guard
   Discourages casual poking around in the browser's developer tools:
     - blocks F12, Ctrl/Cmd+Shift+I/J/C/K and View-Source (Ctrl/Cmd+U)
     - blocks the right-click menu (still allowed inside text boxes,
       so copy/paste in forms keeps working)
     - if developer tools are opened anyway, covers the app with a
       "close developer tools" screen until they are closed again

   IMPORTANT: this is a deterrent, not real security. Anyone determined
   can still read the site's code another way. What actually protects the
   school's data is the database access rules in Supabase (row-level
   security), which are enforced on the server and cannot be bypassed from
   the browser. Never put secrets in the front-end code.

   Not active on localhost / file:// so you can still develop and debug.
   To switch the guard off entirely, remove the <script src="js/guard.js">
   line from index.html.
   ------------------------------------------------------------ */
(function () {
  'use strict';
  var host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '' || location.protocol === 'file:') return;

  /* ---- 1. shortcuts + context menu ---- */
  function isTextField(el) {
    if (!el || !el.tagName) return false;
    var t = el.tagName.toLowerCase();
    return t === 'input' || t === 'textarea' || el.isContentEditable;
  }
  document.addEventListener('contextmenu', function (e) {
    if (!isTextField(e.target)) e.preventDefault();
  });
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();
    var ctrlOrCmd = e.ctrlKey || e.metaKey;
    var blocked =
      e.key === 'F12' ||
      (ctrlOrCmd && e.shiftKey && (k === 'i' || k === 'j' || k === 'c' || k === 'k')) ||
      (e.metaKey && e.altKey && (k === 'i' || k === 'j' || k === 'c' || k === 'u')) ||
      (ctrlOrCmd && k === 'u');
    if (blocked) { e.preventDefault(); e.stopPropagation(); return false; }
  }, true);

  /* ---- 2. detect developer tools being open ---- */
  var overlay = null;
  function lock() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.setAttribute('style',
      'position:fixed;inset:0;z-index:2147483647;background:#12172b;color:#fff;' +
      'display:flex;align-items:center;justify-content:center;text-align:center;' +
      'padding:24px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;');
    overlay.innerHTML =
      '<div style="max-width:420px">' +
      '<div style="font-size:42px;margin-bottom:10px">&#128274;</div>' +
      '<h2 style="margin:0 0 10px;font-size:22px">Developer tools detected</h2>' +
      '<p style="margin:0;line-height:1.5;opacity:.85">For security, this system can\'t be used while the ' +
      'browser developer tools are open. Please close them (press F12 again, or use the X on the panel) ' +
      'and this screen will clear.</p></div>';
    document.documentElement.appendChild(overlay);
  }
  function unlock() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  // While developer tools are open, a `debugger` statement pauses the page, so
  // it takes noticeably longer than normal. Closed tools = instant (no pause).
  function toolsOpen() {
    var t0 = performance.now();
    (function () {}['constructor']('debugger')());
    return performance.now() - t0 > 120;
  }
  function tick() {
    try { if (toolsOpen()) lock(); else unlock(); } catch (e) { /* never break the app */ }
  }
  setInterval(tick, 1500);
  tick();
})();
