/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   app.js — login gate, routing, and role-based sidebar.
   ============================================================ */

const App = {
  state: {
    route: 'dashboard',
    selectedExamId: null
  },

  navigate(route) {
    this.state.route = route;
    location.hash = route;
    this.closeMobileNav();
    this.renderShell();
  },

  ROUTE_ICONS: {
    dashboard: 'fa-gauge-high', classes: 'fa-chalkboard', students: 'fa-user-graduate',
    subjects: 'fa-book', exams: 'fa-file-pen', results: 'fa-list-check',
    myClasses: 'fa-chalkboard-user', learners: 'fa-people-group', assessments: 'fa-clipboard-list',
    gradebook: 'fa-book-open', attendance: 'fa-calendar-check', competency: 'fa-star-half-stroke',
    reports: 'fa-file-lines', broadsheet: 'fa-table-list', meritList: 'fa-ranking-star', analysis: 'fa-chart-column', notify: 'fa-paper-plane', sms: 'fa-comment-sms', users: 'fa-users-gear',
    settings: 'fa-gear', schools: 'fa-school'
  },

  buildNav() {
    const routes = Auth.allowedRoutes();
    const nav = document.getElementById('navList');
    nav.innerHTML = routes.map((r) => `
      <button class="nav-item" data-route="${r}">
        <span class="nav-icon"><i class="fa-solid ${this.ROUTE_ICONS[r] || 'fa-circle'}"></i></span>
        <span>${Auth.ROUTE_LABELS[r]}</span>
      </button>
    `).join('');
    nav.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.route));
    });
  },

  // Level switcher (Primary / Junior Secondary / Senior School), shown
  // right under the logo. A section-scoped admin (profiles.section_scope)
  // is locked to their section and sees a plain badge instead of a
  // dropdown; everyone else (superadmin, unrestricted admin, teachers)
  // gets the dropdown, backed by localStorage so the choice sticks
  // across reloads. effectiveLevel()/levelAllows() in views.js read the
  // same localStorage key to actually do the filtering.
  buildLevelSwitcher() {
    const user = Auth.currentUser();
    const wrap = document.getElementById('levelSwitcherWrap');
    if (!wrap) return;
    if (!user || !['superadmin', 'admin', 'user'].includes(user.role) || (user.role === 'superadmin' && !Auth.isViewingSchool())) {
      wrap.innerHTML = '';
      return;
    }
    const LABELS = { primary: 'Primary', 'junior-secondary': 'Junior Secondary', 'senior-school': 'Senior School' };
    if (user.role === 'admin' && user.section_scope) {
      wrap.innerHTML = `<div class="level-locked-badge" title="This login is limited to ${LABELS[user.section_scope]} by your superadmin."><i class="fa-solid fa-lock"></i> ${LABELS[user.section_scope]}</div>`;
      return;
    }
    let current = '';
    try { current = localStorage.getItem('cbeLevel') || ''; } catch (e) {}
    wrap.innerHTML = `
      <select id="levelSwitcherSel" title="Filter the whole app to one section">
        <option value="" ${current === '' ? 'selected' : ''}>All levels</option>
        <option value="primary" ${current === 'primary' ? 'selected' : ''}>Primary</option>
        <option value="junior-secondary" ${current === 'junior-secondary' ? 'selected' : ''}>Junior Secondary</option>
        <option value="senior-school" ${current === 'senior-school' ? 'selected' : ''}>Senior School</option>
      </select>
    `;
    document.getElementById('levelSwitcherSel').onchange = (e) => {
      try { localStorage.setItem('cbeLevel', e.target.value); } catch (err) {}
      App.renderShell();
    };
  },

  async buildSidebarFoot() {
    const user = Auth.currentUser();
    const foot = document.getElementById('sidebarFoot');
    if (!user) { foot.innerHTML = ''; return; }

    let schoolLine = '';
    let viewedSchool = null;
    if (user.role === 'superadmin') {
      if (Auth.isViewingSchool()) {
        viewedSchool = await Store.getSchool(Store.activeSchoolId);
        const frozenNote = viewedSchool && viewedSchool.frozen ? ' <span style="color:var(--brass-soft);">(frozen)</span>' : '';
        schoolLine = `<p class="muted">Viewing: ${UI.esc(viewedSchool ? viewedSchool.name : '')}${frozenNote}</p>
          <button class="btn btn-sm btn-ghost" id="backToSchoolsBtn" style="margin-top:6px; color:#EFEEE6; border-color:rgba(239,238,230,0.3);">&larr; Back to Schools</button>`;
      } else {
        schoolLine = `<p class="muted">All schools</p>`;
      }
    } else {
      viewedSchool = await Store.getSchool(user.school_id);
      schoolLine = `<p class="muted">${UI.esc(viewedSchool ? viewedSchool.name : '')}</p>`;
    }

    foot.innerHTML = `
      <p><strong>${UI.esc(user.name)}</strong> &middot; ${UI.esc(user.role)}</p>
      ${schoolLine}
      <button class="btn btn-sm btn-ghost" id="logoutBtn" style="margin-top:10px; color:#EFEEE6; border-color:rgba(239,238,230,0.3); width:100%;">Log out</button>
    `;

    const backBtn = document.getElementById('backToSchoolsBtn');
    if (backBtn) backBtn.onclick = () => { Auth.stopViewingSchool(); App.navigate('schools'); };

    document.getElementById('logoutBtn').onclick = async () => {
      await Auth.logout();
      App.boot();
    };

    // Only admins/teachers of the frozen school see the banner —
    // superadmins are never restricted, so it stays hidden for them.
    const banner = document.getElementById('frozenBanner');
    if (banner) {
      const showBanner = user.role !== 'superadmin' && viewedSchool && viewedSchool.frozen;
      banner.classList.toggle('show', !!showBanner);
      if (showBanner) {
        const detail = document.getElementById('frozenBannerDetail');
        detail.textContent = viewedSchool.frozen_reason
          ? `Reason: ${viewedSchool.frozen_reason}. You can view records but not add or edit anything.`
          : 'You can view records but not add or edit anything.';
      }
    }
  },

  renderShell() {
    const allowed = Auth.allowedRoutes();
    if (!allowed.includes(this.state.route)) {
      this.state.route = Auth.defaultRoute();
    }
    const route = this.state.route;
    document.getElementById('pageTitle').textContent = Auth.ROUTE_TITLES[route] || '';
    this.buildNav();
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.route === route);
    });
    this.buildSidebarFoot();
    this.buildHeaderExtras();
    this.buildLevelSwitcher();
    (Views[route] || Views.dashboard)();
  },

  // Welcome message, avatar, role, last-sync time, and the
  // notifications/user dropdowns in the topbar. Reads only from
  // Auth.currentUser() (already cached) and Store, so it never
  // triggers an extra network round trip beyond what Store.current()
  // already does inside the view that's about to render.
  async buildHeaderExtras() {
    const user = Auth.currentUser();
    const welcomeEl = document.getElementById('topbarWelcome');
    const avatarEl = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userMenuName');
    const roleEl = document.getElementById('userMenuRole');
    const syncEl = document.getElementById('lastSync');
    if (!user) return;

    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    if (welcomeEl) welcomeEl.textContent = `${greeting}, ${user.name.split(' ')[0]}`;
    if (avatarEl) avatarEl.textContent = UI.initials(user.name);
    if (nameEl) nameEl.textContent = user.name;
    if (roleEl) roleEl.textContent = user.role;
    if (syncEl) syncEl.textContent = `Synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    // Notifications: low-performing learners needing intervention.
    // Computed live from real results data — not a fabricated feed.
    const notifPanel = document.getElementById('notifPanel');
    const notifDot = document.getElementById('notifDot');
    if (notifPanel && Store.activeSchoolId) {
      try {
        const st = await Store.current();
        const atRisk = App.computeAtRiskStudents(st);
        if (atRisk.length) {
          notifDot.classList.add('show');
          notifPanel.innerHTML = `<h4>Needs attention</h4>` + atRisk.slice(0, 6).map(s => `
            <div class="dropdown-item">
              <div class="d-title">${UI.esc(s.name)}</div>
              <div class="d-sub">${UI.esc(s.klass)} · average ${s.average.toFixed(1)}%</div>
            </div>
          `).join('');
        } else {
          notifDot.classList.remove('show');
          notifPanel.innerHTML = `<h4>Needs attention</h4><div class="dropdown-empty">No learners currently flagged — nice work.</div>`;
        }
      } catch (e) { /* dashboard view will surface any real load error */ }
    } else if (notifPanel) {
      notifPanel.innerHTML = `<div class="dropdown-empty">Nothing to show yet.</div>`;
    }
  },

  // Students averaging below the "Approaching Expectation" band
  // across every result they have on record. Shared by the header
  // notification bell and the dashboard's intervention list.
  computeAtRiskStudents(st) {
    const out = [];
    st.students.forEach(s => {
      const pcts = [];
      st.results.filter(r => r.studentId === s.id).forEach(r => {
        const exam = st.exams.find(e => e.id === r.examId);
        if (exam) pcts.push(Grading.percent(r.marks, exam.totalMarks));
      });
      const avg = Grading.average(pcts);
      if (avg !== null && avg < 50) out.push({ ...s, average: avg });
    });
    return out.sort((a, b) => a.average - b.average);
  },

  openMobileNav() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarBackdrop').classList.add('open');
  },
  closeMobileNav() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarBackdrop').classList.remove('open');
  },

  showApp() {
    document.getElementById('homeRoot').style.display = 'none';
    document.getElementById('loginRoot').style.display = 'none';
    document.getElementById('appRoot').style.display = '';
    const initial = (location.hash || '').replace('#', '');
    this.state.route = Auth.allowedRoutes().includes(initial) ? initial : Auth.defaultRoute();
    this.renderShell();
  },

  showLogin() {
    document.getElementById('homeRoot').style.display = 'none';
    document.getElementById('appRoot').style.display = 'none';
    document.getElementById('loginRoot').style.display = 'flex';
    Views.login(() => this.showApp());
  },

  // Marketing homepage — the first thing a signed-out visitor sees,
  // unless they land directly on #login (e.g. a bookmarked link) or
  // are already mid-session, in which case boot() skips straight past
  // it. "Log in" on this page hands off to the existing login screen.
  showHome() {
    document.getElementById('appRoot').style.display = 'none';
    document.getElementById('loginRoot').style.display = 'none';
    document.getElementById('homeRoot').style.display = 'block';
    Views.home(() => this.showLogin());
  },

  // Reached when someone clicks the link from a "forgot password" email.
  // Supabase signs them into a temporary recovery session and fires the
  // PASSWORD_RECOVERY auth event, which App.init() listens for below.
  showPasswordRecovery() {
    document.getElementById('appRoot').style.display = 'none';
    document.getElementById('loginRoot').style.display = 'flex';
    Views.setNewPassword(async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await Auth._loadProfile(data.session.user.id);
        if (Auth.currentUser()) { this.showApp(); return; }
      }
      this.showLogin();
    });
  },

  async boot() {
    // Guard against a slow/hanging network call to Supabase leaving a
    // signed-out visitor staring at a blank page indefinitely — after
    // 6s, assume no session and show the homepage. If the real
    // restoreSession() call resolves after that with an actual user,
    // it still hands off to the app normally.
    const hash = (location.hash || '').replace('#', '');

    // A "forgot password" link lands here with type=recovery in the
    // hash. Supabase's client auto-detects that access_token and
    // treats it as a normal logged-in session, so a plain "if (user)
    // showApp()" below would race the PASSWORD_RECOVERY event and
    // often win — sending the person straight into the dashboard
    // instead of the "set a new password" screen. Recognize it here
    // so recovery always goes to showPasswordRecovery(), never showApp(),
    // no matter which async call resolves first.
    const isRecovery = hash.includes('type=recovery');
    if (isRecovery) { this.showPasswordRecovery(); return; }

    let settled = false;
    const fallback = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (hash === 'login') this.showLogin(); else this.showHome();
    }, 6000);

    let user = null;
    try {
      user = await Auth.restoreSession();
    } catch (e) {
      user = null;
    }
    if (settled) { if (user) this.showApp(); return; } // fallback already fired
    settled = true;
    clearTimeout(fallback);

    if (user) { this.showApp(); return; }
    if (hash === 'login') this.showLogin();
    else this.showHome();
  },

  init() {
    document.getElementById('menuToggle').addEventListener('click', () => this.openMobileNav());
    document.getElementById('sidebarBackdrop').addEventListener('click', () => this.closeMobileNav());

    // Desktop sidebar collapse (persisted).
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    if (collapseBtn) {
      if (localStorage.getItem('cbeSidebarCollapsed') === '1') {
        document.getElementById('appRoot').classList.add('sidebar-collapsed');
      }
      collapseBtn.addEventListener('click', () => {
        const root = document.getElementById('appRoot');
        const collapsed = root.classList.toggle('sidebar-collapsed');
        localStorage.setItem('cbeSidebarCollapsed', collapsed ? '1' : '0');
      });
    }

    // Dark mode toggle (persisted, applied pre-paint by the inline
    // script in index.html — this just keeps the icon + storage in sync).
    const themeBtn = document.getElementById('themeToggleBtn');
    const themeIcon = document.getElementById('themeToggleIcon');
    const syncThemeIcon = () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (themeIcon) themeIcon.className = dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    };
    syncThemeIcon();
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (isDark) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('cbeTheme', 'light'); }
        else { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('cbeTheme', 'dark'); }
        syncThemeIcon();
      });
    }

    // Button ripple, delegated so every .btn (existing or future) gets it.
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn');
      if (btn) UI.attachRipple(btn, e);
    });

    // Notification bell + user menu dropdowns.
    const wireDropdown = (btnId, panelId) => {
      const btn = document.getElementById(btnId);
      const panel = document.getElementById(panelId);
      if (!btn || !panel) return;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !panel.classList.contains('open');
        document.querySelectorAll('.dropdown-panel.open').forEach(p => p.classList.remove('open'));
        if (willOpen) panel.classList.add('open');
      });
    };
    wireDropdown('notifBellBtn', 'notifPanel');
    wireDropdown('userMenuBtn', 'userPanel');
    document.addEventListener('click', () => {
      document.querySelectorAll('.dropdown-panel.open').forEach(p => p.classList.remove('open'));
    });

    // Global header search: jumps to Students and pre-fills its filter.
    const globalSearch = document.getElementById('globalSearch');
    if (globalSearch) {
      globalSearch.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const q = globalSearch.value.trim();
        this._pendingStudentSearch = q;
        if (Auth.allowedRoutes().includes('students')) this.navigate('students');
      });
    }

    // Mobile floating action button -> jump straight to Results entry.
    const fab = document.getElementById('fabEnterMarks');
    if (fab) fab.addEventListener('click', () => {
      if (Auth.allowedRoutes().includes('results')) this.navigate('results');
    });

    window.addEventListener('hashchange', () => {
      if (!Auth.currentUser()) {
        const r = (location.hash || '').replace('#', '');
        if (r === 'login') this.showLogin();
        return;
      }
      const r = (location.hash || '').replace('#', '');
      if (Auth.allowedRoutes().includes(r)) {
        this.state.route = r;
        this.renderShell();
      }
    });

    // Keep the app in sync if the Supabase session expires or is
    // refreshed in another tab.
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') this.boot();
      if (event === 'PASSWORD_RECOVERY') this.showPasswordRecovery();
    });

    this.boot();
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
