/* ============================================================
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

  buildNav() {
    const routes = Auth.allowedRoutes();
    const nav = document.getElementById('navList');
    nav.innerHTML = routes.map((r, i) => `
      <button class="nav-item" data-route="${r}">
        <span class="nav-eyebrow">${String(i + 1).padStart(2, '0')}</span> ${Auth.ROUTE_LABELS[r]}
      </button>
    `).join('');
    nav.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.route));
    });
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
    (Views[route] || Views.dashboard)();
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
    document.getElementById('loginRoot').style.display = 'none';
    document.getElementById('appRoot').style.display = '';
    const initial = (location.hash || '').replace('#', '');
    this.state.route = Auth.allowedRoutes().includes(initial) ? initial : Auth.defaultRoute();
    this.renderShell();
  },

  showLogin() {
    document.getElementById('appRoot').style.display = 'none';
    document.getElementById('loginRoot').style.display = 'flex';
    Views.login(() => this.showApp());
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
    const user = await Auth.restoreSession();
    if (user) this.showApp();
    else this.showLogin();
  },

  init() {
    document.getElementById('menuToggle').addEventListener('click', () => this.openMobileNav());
    document.getElementById('sidebarBackdrop').addEventListener('click', () => this.closeMobileNav());

    window.addEventListener('hashchange', () => {
      if (!Auth.currentUser()) return;
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
