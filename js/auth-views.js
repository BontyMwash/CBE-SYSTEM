/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   auth-views.js — Login screen, Schools (superadmin), and
   Users (admin) management views.
   ============================================================ */

/* ------------------------- HOMEPAGE ------------------------- */
// Marketing landing page shown to signed-out visitors before the
// login screen (see App.showHome() / App.boot()). onLogin() takes
// them to Views.login. Purely presentational — every button here
// ultimately calls the same onLogin() callback the old homepage
// used, since the app has no public self-signup flow (schools are
// provisioned by a superadmin); "Get Started" and "Log in" are the
// same destination, just different marketing copy.
Views.home = function (onLogin) {
  const root = document.getElementById('homeRoot');
  const year = new Date().getFullYear();
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const features = [
    { icon: 'fa-user-graduate', title: 'Learner Management', text: 'Manage learner profiles, classes, streams and academic records.' },
    { icon: 'fa-pen', title: 'Marks Entry', text: 'Enter and manage assessment marks quickly and accurately.' },
    { icon: 'fa-chart-column', title: 'Performance Analysis', text: 'Understand learner, subject, class and school performance.' },
    { icon: 'fa-star-half-stroke', title: 'CBE Performance Levels', text: 'Automatically analyse learner achievement using configurable CBE performance levels.' },
    { icon: 'fa-file-lines', title: 'Professional Reports', text: 'Generate learner report cards, broadsheets and performance reports.' },
    { icon: 'fa-paper-plane', title: 'Parent Communication', text: 'Share learner results and important academic information efficiently.' }
  ];

  const modules = [
    { icon: 'fa-user-graduate', title: 'Learners', text: 'Full learner register, per class and stream.' },
    { icon: 'fa-chalkboard-user', title: 'Teachers', text: 'Role-scoped logins for every teacher.' },
    { icon: 'fa-chalkboard', title: 'Classes & Streams', text: 'Grades, streams and CBC sections.' },
    { icon: 'fa-book', title: 'Subjects', text: 'A shared subject list across the school.' },
    { icon: 'fa-clipboard-list', title: 'Assessments', text: 'Every sitting, by type, term and year.' },
    { icon: 'fa-list-check', title: 'Marks Entry', text: 'Fast entry with instant % feedback.' },
    { icon: 'fa-chart-column', title: 'Performance Analysis', text: 'Trends by learner, subject and class.' },
    { icon: 'fa-file-lines', title: 'Reports', text: 'Auto-generated, printable and exportable.' },
    { icon: 'fa-id-card', title: 'Report Cards', text: 'Position, trend chart and comments.' },
    { icon: 'fa-table-list', title: 'Broadsheets', text: 'A whole class, every subject, one ledger.' },
    { icon: 'fa-comment-sms', title: 'SMS Results', text: 'Send results straight to parents.' },
    { icon: 'fa-gear', title: 'School Settings', text: 'Grading bands, exam types and branding.' }
  ];

  const steps = [
    { n: '01', title: 'Set Up Your School', text: 'Configure learners, teachers, classes and subjects.' },
    { n: '02', title: 'Record Assessment', text: 'Teachers enter marks and assessment information.' },
    { n: '03', title: 'Analyse & Report', text: 'Automatically generate insights, reports and learner results.' }
  ];

  const levelBands = [
    { code: 'EE1', pct: 12, color: '#10B981' }, { code: 'EE2', pct: 18, color: '#34D399' },
    { code: 'ME1', pct: 25, color: '#4F46E5' }, { code: 'ME2', pct: 23, color: '#6366F1' },
    { code: 'AE1', pct: 14, color: '#F59E0B' }, { code: 'AE2', pct: 6, color: '#FBBF24' },
    { code: 'BE', pct: 2, color: '#EF4444' }
  ];

  root.innerHTML = `
    <a class="home-skip-link" href="#homeMain">Skip to content</a>

    <header class="home-nav" id="homeNav">
      <div class="home-nav-inner">
        <a class="home-brand" href="#home" aria-label="B~CBE Analytics — home">
          <img src="icons/logo-mark.png" alt="" width="34" height="34" />
          <span class="home-brand-text">
            <span class="home-brand-name">B~CBE Analytics</span>
            <span class="home-brand-sub">Smart CBE Assessment &amp; Performance</span>
          </span>
        </a>

        <nav class="home-nav-links" id="homeNavLinks" aria-label="Primary">
          <a href="#home" class="active">Home</a>
          <a href="#features">Features</a>
          <a href="#modules">Modules</a>
          <a href="#analytics">Analytics</a>
          <a href="#about">About</a>
        </nav>

        <div class="home-nav-actions">
          <button class="btn btn-ghost" id="homeLoginBtn">Log in</button>
          <button class="btn btn-primary" id="homeGetStartedBtn">Get Started</button>
          <button class="home-nav-toggle" id="homeNavToggle" aria-label="Open menu" aria-expanded="false" aria-controls="homeMobileMenu">
            <i class="fa-solid fa-bars"></i>
          </button>
        </div>
      </div>

      <div class="home-mobile-menu" id="homeMobileMenu">
        <a href="#home">Home</a>
        <a href="#features">Features</a>
        <a href="#modules">Modules</a>
        <a href="#analytics">Analytics</a>
        <a href="#about">About</a>
        <div class="home-mobile-actions">
          <button class="btn btn-ghost" id="homeLoginBtnMobile" style="width:100%; justify-content:center;">Log in</button>
          <button class="btn btn-primary" id="homeGetStartedBtnMobile" style="width:100%; justify-content:center;">Get Started</button>
        </div>
      </div>
    </header>

    <main id="homeMain">
      <section class="home-hero" id="home">
        <div class="home-hero-inner">
          <div class="home-hero-text reveal">
            <span class="home-badge">SMART CBE ASSESSMENT PLATFORM</span>
            <h1>
              <span class="home-hero-line-dark">Smarter CBE Assessment.</span>
              <span class="home-hero-line-grad">Better Learner Outcomes.</span>
            </h1>
            <p class="home-hero-sub">Manage learner assessment, marks, performance analysis and reporting from one powerful platform designed for modern schools.</p>
            <div class="home-hero-actions">
              <button class="btn btn-primary btn-lg" id="homeHeroLoginBtn">Get Started <i class="fa-solid fa-arrow-right"></i></button>
              <a class="btn btn-secondary btn-lg" href="#features">Explore Features</a>
            </div>
            <ul class="home-trust">
              <li><i class="fa-solid fa-circle-check"></i> Built for modern schools</li>
              <li><i class="fa-solid fa-circle-check"></i> Secure</li>
              <li><i class="fa-solid fa-circle-check"></i> Data-driven</li>
              <li><i class="fa-solid fa-circle-check"></i> Easy to use</li>
            </ul>
          </div>

          <div class="home-hero-visual reveal" aria-hidden="true">
            <div class="home-dash-mock">
              <div class="home-dash-sidebar">
                <div class="home-dash-sidebar-brand"><i class="fa-solid fa-graduation-cap"></i></div>
                ${['fa-gauge-high', 'fa-user-graduate', 'fa-clipboard-list', 'fa-pen', 'fa-file-lines', 'fa-chart-column', 'fa-book', 'fa-gear']
                  .map((ic, i) => `<span class="home-dash-side-icon ${i === 0 ? 'active' : ''}"><i class="fa-solid ${ic}"></i></span>`).join('')}
              </div>
              <div class="home-dash-body">
                <div class="home-dash-head">Dashboard</div>
                <div class="home-dash-stats">
                  <div class="home-dash-stat"><span class="v">1,250</span><span class="k">Learners</span></div>
                  <div class="home-dash-stat"><span class="v">8,500</span><span class="k">Assessments</span></div>
                  <div class="home-dash-stat"><span class="v">12</span><span class="k">Subjects</span></div>
                  <div class="home-dash-stat"><span class="v">72.4%</span><span class="k">Avg. Score</span></div>
                </div>
                <div class="home-dash-charts">
                  <div class="home-dash-chart-card span-2">
                    <span class="home-dash-chart-label">Performance overview</span>
                    <div class="home-chart-canvas-wrap"><canvas id="homeChartTrend"></canvas></div>
                  </div>
                  <div class="home-dash-chart-card">
                    <span class="home-dash-chart-label">Performance levels</span>
                    <div class="home-chart-canvas-wrap"><canvas id="homeChartLevels"></canvas></div>
                  </div>
                </div>
                <div class="home-dash-table">
                  <div class="home-dash-table-row home-dash-table-head"><span>Assessment</span><span>Class</span><span>Score</span></div>
                  <div class="home-dash-table-row"><span>Midterm — Math</span><span>Grade 7</span><span class="ok">78%</span></div>
                  <div class="home-dash-table-row"><span>Opener — English</span><span>Grade 8</span><span class="ok">71%</span></div>
                  <div class="home-dash-table-row"><span>Endterm — Science</span><span>Grade 6</span><span class="warn">54%</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="home-stats reveal" aria-label="Platform usage">
        <div class="home-stats-inner">
          <div class="home-stat-card">
            <span class="home-stat-icon"><i class="fa-solid fa-users"></i></span>
            <span class="home-stat-value" id="homeStat1">0</span>
            <span class="home-stat-label">Learners</span>
            <span class="home-stat-sub">Actively managed</span>
          </div>
          <div class="home-stat-card">
            <span class="home-stat-icon"><i class="fa-solid fa-clipboard-check"></i></span>
            <span class="home-stat-value" id="homeStat2">0</span>
            <span class="home-stat-label">Assessments</span>
            <span class="home-stat-sub">Recorded this term</span>
          </div>
          <div class="home-stat-card">
            <span class="home-stat-icon"><i class="fa-solid fa-book"></i></span>
            <span class="home-stat-value" id="homeStat3">0</span>
            <span class="home-stat-label">Subjects</span>
            <span class="home-stat-sub">Active subjects</span>
          </div>
          <div class="home-stat-card">
            <span class="home-stat-icon"><i class="fa-solid fa-file-lines"></i></span>
            <span class="home-stat-value" id="homeStat4">0</span>
            <span class="home-stat-label">Reports</span>
            <span class="home-stat-sub">Generated reports</span>
          </div>
        </div>
      </section>

      <section class="home-section" id="features">
        <div class="home-section-inner">
          <div class="home-section-head reveal">
            <span class="home-badge home-badge-light">POWERFUL FEATURES</span>
            <h2>Everything You Need to Manage School Assessment</h2>
            <p>Powerful tools that simplify assessment management, performance analysis and reporting.</p>
          </div>
          <div class="home-feature-grid">
            ${features.map(f => `
              <div class="home-feature-card reveal">
                <div class="home-feature-icon"><i class="fa-solid ${f.icon}"></i></div>
                <h3>${UI.esc(f.title)}</h3>
                <p>${UI.esc(f.text)}</p>
                <span class="home-feature-arrow"><i class="fa-solid fa-arrow-right"></i></span>
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <section class="home-section home-section-alt" id="analytics">
        <div class="home-section-inner home-analytics-grid">
          <div class="reveal">
            <h2>Turn Assessment Data Into Meaningful Insights</h2>
            <p class="home-lead">Go beyond marks. Understand learner progress, identify areas requiring support and make better academic decisions using clear performance analytics.</p>
            <ul class="home-checklist">
              <li><i class="fa-solid fa-circle-check"></i> Individual learner analysis</li>
              <li><i class="fa-solid fa-circle-check"></i> Subject and class comparison</li>
              <li><i class="fa-solid fa-circle-check"></i> Performance trend tracking</li>
              <li><i class="fa-solid fa-circle-check"></i> School-wide performance insights</li>
            </ul>
            <a class="btn btn-primary" href="#analytics" id="homeExploreAnalyticsBtn">Explore Analytics <i class="fa-solid fa-arrow-right"></i></a>
          </div>
          <div class="home-analytics-preview reveal">
            <div class="home-analytics-head">
              <span>Overall Performance</span>
              <strong>72.4%</strong>
            </div>
            <div class="home-chart-canvas-wrap tall"><canvas id="homeChartAnalyticsTrend"></canvas></div>
            <div class="home-level-bars">
              ${levelBands.map(b => `
                <div class="home-level-row">
                  <span class="home-level-code">${b.code}</span>
                  <span class="home-level-track"><span class="home-level-fill" style="width:${b.pct}%; background:${b.color};"></span></span>
                  <span class="home-level-pct">${b.pct}%</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </section>

      <section class="home-section" aria-label="How it works">
        <div class="home-section-inner">
          <div class="home-section-head reveal">
            <h2>Simple. Fast. Powerful.</h2>
          </div>
          <div class="home-steps">
            ${steps.map((s, i) => `
              <div class="home-step reveal">
                <span class="home-step-n">${s.n}</span>
                <h3>${UI.esc(s.title)}</h3>
                <p>${UI.esc(s.text)}</p>
                ${i < steps.length - 1 ? '<span class="home-step-connector" aria-hidden="true"></span>' : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <section class="home-section home-section-alt" id="modules">
        <div class="home-section-inner">
          <div class="home-section-head reveal">
            <h2>One Platform. Complete Assessment Management.</h2>
          </div>
          <div class="home-module-grid">
            ${modules.map(m => `
              <div class="home-module-card reveal">
                <span class="home-module-icon"><i class="fa-solid ${m.icon}"></i></span>
                <span class="home-module-text">
                  <strong>${UI.esc(m.title)}</strong>
                  <span>${UI.esc(m.text)}</span>
                </span>
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <section class="home-section" id="about">
        <div class="home-section-inner home-about">
          <div class="reveal">
            <span class="home-badge home-badge-light">ABOUT B~CBE ANALYTICS</span>
            <h2>Built Around the CBC Grading Model</h2>
            <p class="home-lead">B~CBE Analytics was built specifically for schools running Competency Based Education — from marks entry through to published, parent-ready results — so assessment data stays accurate, consistent and easy to act on at every level of the school.</p>
          </div>
        </div>
      </section>

      <section class="home-cta reveal">
        <div class="home-cta-inner">
          <h2>Ready to Make Assessment Smarter?</h2>
          <p>Bring learner assessment, marks analysis and reporting together in one powerful platform.</p>
          <div class="home-cta-actions">
            <button class="btn btn-primary btn-lg" id="homeCtaGetStartedBtn">Get Started <i class="fa-solid fa-arrow-right"></i></button>
            <button class="btn btn-secondary-dark btn-lg" id="homeCtaLoginBtn">Log In</button>
          </div>
        </div>
      </section>
    </main>

    <footer class="home-footer-full">
      <div class="home-footer-inner">
        <div class="home-footer-brand">
          <div class="home-brand" style="pointer-events:none;">
            <img src="icons/logo-mark.png" alt="" width="30" height="30" />
            <span class="home-brand-text">
              <span class="home-brand-name">B~CBE Analytics</span>
              <span class="home-brand-sub">Smart CBE Assessment &amp; Performance Platform</span>
            </span>
          </div>
        </div>
        <div class="home-footer-col">
          <h4>Platform</h4>
          <a href="#features">Features</a>
          <a href="#modules">Modules</a>
          <a href="#analytics">Analytics</a>
          <a href="#analytics">Reports</a>
        </div>
        <div class="home-footer-col">
          <h4>Resources</h4>
          <a href="javascript:void(0)" id="homeHelpLink">Help</a>
          <a href="javascript:void(0)" id="homeSupportLink">Support</a>
          <a href="javascript:void(0)" id="homeDocsLink">Documentation</a>
          <a href="javascript:void(0)" id="homeTermsLink">Privacy</a>
        </div>
        <div class="home-footer-col">
          <h4>Account</h4>
          <a href="javascript:void(0)" id="homeFooterLoginLink">Log In</a>
          <a href="javascript:void(0)" id="homeFooterGetStartedLink">Get Started</a>
        </div>
      </div>
      <div class="home-footer-bottom">
        <span>&copy; ${year} B~CBE Analytics. All rights reserved.</span>
        <a href="javascript:void(0)" id="homeTermsLink2">Terms &amp; Copyright</a>
      </div>
    </footer>
  `;

  // ---- wire up every action (all routes lead to the same login flow) ----
  ['homeLoginBtn', 'homeLoginBtnMobile', 'homeCtaLoginBtn', 'homeFooterLoginLink'].forEach(id => {
    const el = document.getElementById(id); if (el) el.onclick = onLogin;
  });
  ['homeGetStartedBtn', 'homeGetStartedBtnMobile', 'homeHeroLoginBtn', 'homeCtaGetStartedBtn', 'homeFooterGetStartedLink'].forEach(id => {
    const el = document.getElementById(id); if (el) el.onclick = onLogin;
  });
  ['homeTermsLink', 'homeTermsLink2', 'homeHelpLink', 'homeSupportLink', 'homeDocsLink'].forEach(id => {
    const el = document.getElementById(id); if (el) el.onclick = () => UI.showTerms();
  });

  // ---- fade-up reveal on scroll ----
  // Goes FIRST and is wrapped defensively: .reveal elements start
  // hidden (opacity:0, see CSS) purely as a cosmetic entrance effect,
  // so if anything below this point throws, or IntersectionObserver
  // is unavailable/never fires for some element, the page must never
  // be left permanently blank. Every path here — success, unsupported
  // browser, thrown error, or just a safety timeout — ends with every
  // .reveal element visible.
  try {
    const revealEls = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window && !reduceMotion) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('in-view'); io.unobserve(entry.target); } });
      }, { threshold: 0.12 });
      revealEls.forEach(el => io.observe(el));
      // Belt-and-suspenders: whatever hasn't revealed itself within
      // 1.5s (offscreen sections on a short page, an observer that
      // never fires, etc.) is force-shown rather than left invisible.
      setTimeout(() => revealEls.forEach(el => el.classList.add('in-view')), 1500);
    } else {
      revealEls.forEach(el => el.classList.add('in-view'));
    }
  } catch (e) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('in-view'));
  }

  // ---- sticky nav shadow + active-link tracking on scroll ----
  try {
    // Views.home can run again (e.g. "Back to homepage" from the
    // login screen) — remove any listener from a previous run first,
    // since it's attached to `window` and would otherwise never be
    // cleaned up on its own, stacking a fresh one on every visit.
    if (Views._homeOnScroll) window.removeEventListener('scroll', Views._homeOnScroll);
    const navEl = document.getElementById('homeNav');
    const navLinks = Array.from(document.querySelectorAll('#homeNavLinks a'));
    const sections = ['home', 'features', 'analytics', 'modules', 'about'].map(id => document.getElementById(id)).filter(Boolean);
    function onScroll() {
      if (navEl) navEl.classList.toggle('scrolled', window.scrollY > 8);
      let current = sections[0];
      sections.forEach(sec => { if (window.scrollY >= sec.offsetTop - 120) current = sec; });
      navLinks.forEach(a => a.classList.toggle('active', current && a.getAttribute('href') === '#' + current.id));
    }
    Views._homeOnScroll = onScroll;
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  } catch (e) { /* purely cosmetic — never block the rest of the page */ }

  // ---- mobile menu toggle ----
  try {
    const navToggle = document.getElementById('homeNavToggle');
    const mobileMenu = document.getElementById('homeMobileMenu');
    if (navToggle && mobileMenu) {
      navToggle.onclick = () => {
        const open = mobileMenu.classList.toggle('open');
        navToggle.setAttribute('aria-expanded', String(open));
      };
      document.querySelectorAll('#homeMobileMenu a').forEach(a => {
        a.addEventListener('click', () => { mobileMenu.classList.remove('open'); navToggle.setAttribute('aria-expanded', 'false'); });
      });
    }
  } catch (e) { /* non-critical */ }

  // ---- smooth scroll for in-page nav links ----
  try {
    document.querySelectorAll('.home-nav-links a, .home-mobile-menu a').forEach(a => {
      a.addEventListener('click', (e) => {
        const target = document.getElementById(a.getAttribute('href').slice(1));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        }
      });
    });
  } catch (e) { /* non-critical */ }

  // ---- stat counters ----
  try {
    const statTargets = { homeStat1: 1250, homeStat2: 8500, homeStat3: 12, homeStat4: 4000 };
    Object.entries(statTargets).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (reduceMotion) el.textContent = val.toLocaleString() + '+';
      else UI.animateCount(el, val, { suffix: '+' });
    });
  } catch (e) { /* non-critical */ }

  // ---- dashboard-preview & analytics charts (purely illustrative,
  // no live data — homepage is shown to signed-out visitors). Skipped
  // entirely, never blocking, if the Chart.js CDN didn't load. ----
  try {
    if (typeof Chart !== 'undefined') {
      Views._homeCharts = Views._homeCharts || {};
      Object.values(Views._homeCharts).forEach(c => { try { c.destroy(); } catch (e) {} });
      Views._homeCharts = {};

      const trendCanvas = document.getElementById('homeChartTrend');
      if (trendCanvas) {
        Views._homeCharts.trend = new Chart(trendCanvas, {
          type: 'line',
          data: {
            labels: ['Opener', 'Midterm', 'Endterm'],
            datasets: [{ data: [64, 69, 72.4], borderColor: '#2563EB', backgroundColor: 'rgba(37,99,235,0.12)', fill: true, tension: 0.35, pointRadius: 3, borderWidth: 2 }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
            scales: { y: { display: false, min: 50, max: 90 }, x: { display: false } } }
        });
      }

      const levelsCanvas = document.getElementById('homeChartLevels');
      if (levelsCanvas) {
        Views._homeCharts.levels = new Chart(levelsCanvas, {
          type: 'doughnut',
          data: { labels: ['EE', 'ME', 'AE', 'BE'], datasets: [{ data: [30, 48, 20, 2], backgroundColor: ['#10B981', '#4F46E5', '#F59E0B', '#EF4444'], borderWidth: 0 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '68%' }
        });
      }

      const analyticsCanvas = document.getElementById('homeChartAnalyticsTrend');
      if (analyticsCanvas) {
        Views._homeCharts.analytics = new Chart(analyticsCanvas, {
          type: 'bar',
          data: {
            labels: ['Term 1', 'Term 2', 'Term 3'],
            datasets: [{ data: [66, 69.5, 72.4], backgroundColor: '#4F46E5', borderRadius: 6 }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, max: 100, grid: { color: '#EEF2F8' } }, x: { grid: { display: false } } } }
        });
      }
    }
  } catch (e) { /* charts are decorative — never block the rest of the page */ }
};

Views.login = function (onSuccess) {
  const root = document.getElementById('loginRoot');

  function brandBlock() {
    return `
      <div class="login-brand">
        <img src="icons/logo-full.png" alt="B~CBE Analytics — Record. Track. Result." class="login-logo" />
      </div>
    `;
  }

  function renderLoginForm() {
    root.innerHTML = `
      <div class="login-card">
        ${brandBlock()}
        <h1>Log in</h1>
        <p class="login-subtitle">Enter your email and password to open your school's register.</p>
        <div id="loginError" class="login-error" style="display:none;"></div>
        <div class="field full">
          <label>Email</label>
          <input type="email" id="loginEmail" autocomplete="username">
        </div>
   <div class="field full">
  <label>Password</label>
  <div class="password-wrapper">
    <input
      type="password"
      id="loginPassword"
      autocomplete="current-password">

    <button
      type="button"
      class="toggle-password"
      id="togglePassword">
      <i class="fa-solid fa-eye"></i>
    </button>
  </div>
</div>
        <button class="btn btn-primary" id="loginBtn" style="width:100%; justify-content:center; margin-top:6px;">Log in</button>
        <div class="login-links">
          <button class="login-link" id="forgotBtn" type="button">Forgot password?</button>
          <button class="login-link" id="backHomeBtn" type="button">&larr; Back to homepage</button>
        </div>
        <p style="text-align:center; margin-top:18px; font-size:12px; color:var(--ink-faint, #8a8a8a);">
          &copy; ${new Date().getFullYear()} B~CBE Analytics &middot; <a href="javascript:void(0)" id="loginTermsLink" style="color:inherit; text-decoration:underline;">Terms &amp; Copyright</a>
        </p>
      </div>
    `;

    async function attempt() {
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      const errBox = document.getElementById('loginError');
      const btn = document.getElementById('loginBtn');
      if (!email || !password) {
        errBox.textContent = 'Enter both an email and password.';
        errBox.style.display = 'block';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Logging in…';
      const result = await Auth.login(email, password);
      btn.disabled = false;
      btn.textContent = 'Log in';
      if (!result.ok) {
        errBox.textContent = result.error;
        errBox.style.display = 'block';
        return;
      }
      onSuccess();
    }

    document.getElementById('loginBtn').onclick = attempt;
    root.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
    });
    document.getElementById('forgotBtn').onclick = renderForgotForm;
    document.getElementById('loginEmail').focus();
    const termsLink = document.getElementById('loginTermsLink');
    if (termsLink) termsLink.onclick = () => UI.showTerms();
    const backHomeBtn = document.getElementById('backHomeBtn');
    if (backHomeBtn) backHomeBtn.onclick = () => App.showHome();
     const password = document.getElementById('loginPassword');
const toggle = document.getElementById('togglePassword');

toggle.addEventListener('click', () => {
  const icon = toggle.querySelector('i');

  if (password.type === 'password') {
    password.type = 'text';
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
  } else {
    password.type = 'password';
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  }
});
  }

  function renderForgotForm() {
    root.innerHTML = `
      <div class="login-card">
        ${brandBlock()}
        <h1>Reset password</h1>
        <p class="login-subtitle">Enter the email on your login and we'll send you a link to set a new password.</p>
        <div id="forgotError" class="login-error" style="display:none;"></div>
        <div id="forgotSuccess" class="login-success" style="display:none;"></div>
        <div class="field full">
          <label>Email</label>
          <input type="email" id="forgotEmail" autocomplete="username">
        </div>
        <button class="btn btn-primary" id="forgotSubmitBtn" style="width:100%; justify-content:center; margin-top:6px;">Send reset link</button>
        <div class="login-links">
          <button class="login-link" id="backToLoginBtn" type="button">&larr; Back to log in</button>
        </div>
      </div>
    `;

    async function submit() {
      const email = document.getElementById('forgotEmail').value.trim();
      const errBox = document.getElementById('forgotError');
      const okBox = document.getElementById('forgotSuccess');
      const btn = document.getElementById('forgotSubmitBtn');
      errBox.style.display = 'none';
      okBox.style.display = 'none';
      if (!email) {
        errBox.textContent = 'Enter your email address.';
        errBox.style.display = 'block';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Sending…';
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      btn.disabled = false;
      btn.textContent = 'Send reset link';
      if (error) {
        errBox.textContent = error.message;
        errBox.style.display = 'block';
        return;
      }
      okBox.textContent = "If that email has a login, we've sent a reset link to it. Check your inbox.";
      okBox.style.display = 'block';
    }

    document.getElementById('forgotSubmitBtn').onclick = submit;
    document.getElementById('forgotEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    document.getElementById('backToLoginBtn').onclick = renderLoginForm;
    document.getElementById('forgotEmail').focus();
  }

  renderLoginForm();
};

/* ------------------------- SET NEW PASSWORD (from reset-link) ------------------------- */
// Shown when Supabase detects a password-recovery link in the URL
// (see app.js's PASSWORD_RECOVERY handler). onDone() is called once
// the new password is saved successfully.

Views.setNewPassword = function (onDone) {
  const root = document.getElementById('loginRoot');
  root.innerHTML = `
    <div class="login-card">
      <div class="login-brand">
        <img src="icons/logo-full.png" alt="B~CBE Analytics — Record. Track. Result." class="login-logo" />
      </div>
      <h1>Set a new password</h1>
      <p class="login-subtitle">Choose a new password for your login.</p>
      <div id="newPwError" class="login-error" style="display:none;"></div>
      <div class="field full">
        <label>New password</label>
        <input type="password" id="newPw1" autocomplete="new-password" placeholder="Min 6 characters">
      </div>
      <div class="field full">
        <label>Confirm new password</label>
        <input type="password" id="newPw2" autocomplete="new-password">
      </div>
      <button class="btn btn-primary" id="newPwBtn" style="width:100%; justify-content:center; margin-top:6px;">Save new password</button>
    </div>
  `;

  async function submit() {
    const pw1 = document.getElementById('newPw1').value;
    const pw2 = document.getElementById('newPw2').value;
    const errBox = document.getElementById('newPwError');
    const btn = document.getElementById('newPwBtn');
    errBox.style.display = 'none';
    if (!pw1 || pw1.length < 6) {
      errBox.textContent = 'Password must be at least 6 characters.';
      errBox.style.display = 'block';
      return;
    }
    if (pw1 !== pw2) {
      errBox.textContent = "Passwords don't match.";
      errBox.style.display = 'block';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const result = await Auth.updateOwnPassword(pw1);
    btn.disabled = false;
    btn.textContent = 'Save new password';
    if (!result.ok) {
      errBox.textContent = result.error;
      errBox.style.display = 'block';
      return;
    }
    UI.toast('Password updated');
    onDone();
  }

  document.getElementById('newPwBtn').onclick = submit;
  root.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
  document.getElementById('newPw1').focus();
};

/* ------------------------- SCHOOLS (superadmin) ------------------------- */

Views.schools = async function () {
  setTopbarActions(`<button class="btn btn-primary" id="addSchoolBtn">+ New school</button>`);
  showLoading();

  const schools = await Store.listSchools();
  const statsList = await Promise.all(schools.map(s => Store.schoolStats(s.id)));

  function renderTable() {
    if (schools.length === 0) {
      return `<div class="empty"><div class="empty-title">No schools yet</div><p>Create your first school to get started.</p></div>`;
    }
    return `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>#</th><th>School</th><th>Status</th><th>Students</th><th>Subjects</th><th>Exams</th><th>Logins</th><th></th></tr></thead>
            <tbody>
              ${schools.map((s, i) => {
                const stats = statsList[i];
                const statusBadge = s.frozen
                  ? `<span class="badge badge-BE" title="${UI.esc(s.frozen_reason || '')}">Frozen</span>`
                  : `<span class="badge badge-EE">Active</span>`;
                return `<tr>
                  <td class="row-index">${i + 1}</td>
                  <td>${UI.esc(s.name)}</td>
                  <td>${statusBadge}</td>
                  <td class="num">${stats.students}</td>
                  <td class="num">${stats.subjects}</td>
                  <td class="num">${stats.exams}</td>
                  <td class="num">${stats.users}</td>
                  <td>
                    <button class="btn btn-sm btn-primary" data-open="${s.id}">Open</button>
                    <button class="btn btn-sm btn-ghost" data-rename="${s.id}">Rename</button>
                    ${s.frozen
                      ? `<button class="btn btn-sm btn-brass" data-unfreeze="${s.id}">Unfreeze</button>`
                      : `<button class="btn btn-sm btn-ghost" data-freeze="${s.id}">Freeze</button>`}
                    <button class="btn btn-sm btn-danger" data-del="${s.id}">Delete</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function wireRowActions() {
    document.querySelectorAll('[data-open]').forEach(btn => {
      btn.onclick = () => {
        Auth.viewSchool(btn.dataset.open);
        App.navigate('dashboard');
      };
    });
    document.querySelectorAll('[data-rename]').forEach(btn => {
      btn.onclick = () => {
        const school = schools.find(s => s.id === btn.dataset.rename);
        UI.openModal(`
          <h2>Rename school</h2>
          <div class="field full">
            <label>School name</label>
            <input type="text" id="f_name" value="${UI.esc(school.name)}">
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
            <button class="btn btn-primary" id="saveBtn">Save</button>
          </div>
        `, (root) => {
          root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
          root.querySelector('#saveBtn').onclick = async () => {
            const name = root.querySelector('#f_name').value.trim();
            if (!name) { UI.toast('Name is required'); return; }
            try {
              await Store.updateSchool(school.id, { name });
              UI.closeModal();
              UI.toast('School renamed');
              Views.schools();
            } catch (err) {
              UI.toast('Could not rename: ' + err.message);
            }
          };
        });
      };
    });
    document.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = () => {
        const school = schools.find(s => s.id === btn.dataset.del);
        UI.confirmAction(`Delete ${school.name}? This permanently erases all its students, exams, marks, and login accounts.`, async () => {
          try {
            await Store.deleteSchool(school.id);
            UI.toast('School deleted');
            Views.schools();
          } catch (err) {
            UI.toast('Could not delete: ' + err.message);
          }
        });
      };
    });
    document.querySelectorAll('[data-freeze]').forEach(btn => {
      btn.onclick = () => {
        const school = schools.find(s => s.id === btn.dataset.freeze);
        UI.openModal(`
          <h2>Freeze ${UI.esc(school.name)}</h2>
          <p class="field-hint" style="margin-bottom:14px;">
            Its admin and teacher logins will still be able to log in and view
            everything, but won't be able to add or change anything — no new
            students, marks, exams, subjects, or logins — until you unfreeze it.
          </p>
          <div class="field full">
            <label>Reason (optional, visible to other superadmins)</label>
            <input type="text" id="f_reason" placeholder="e.g. Term 2 fees outstanding">
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
            <button class="btn btn-danger" id="freezeBtn">Freeze school</button>
          </div>
        `, (root) => {
          root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
          root.querySelector('#freezeBtn').onclick = async () => {
            const reason = root.querySelector('#f_reason').value.trim();
            try {
              await Store.setSchoolFrozen(school.id, true, reason);
              UI.closeModal();
              UI.toast(`${school.name} frozen`);
              Views.schools();
            } catch (err) {
              UI.toast('Could not freeze: ' + err.message);
            }
          };
        });
      };
    });
    document.querySelectorAll('[data-unfreeze]').forEach(btn => {
      btn.onclick = () => {
        const school = schools.find(s => s.id === btn.dataset.unfreeze);
        UI.openModal(`
          <h2>Unfreeze ${UI.esc(school.name)}</h2>
          <p>This immediately restores full access for its admin and teacher logins.</p>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
            <button class="btn btn-primary" id="unfreezeBtn">Unfreeze school</button>
          </div>
        `, (root) => {
          root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
          root.querySelector('#unfreezeBtn').onclick = async () => {
            try {
              await Store.setSchoolFrozen(school.id, false);
              UI.closeModal();
              UI.toast(`${school.name} unfrozen`);
              Views.schools();
            } catch (err) {
              UI.toast('Could not unfreeze: ' + err.message);
            }
          };
        });
      };
    });
  }

  function openNewSchoolForm() {
    UI.openModal(`
      <h2>New school</h2>
      <p class="field-hint" style="margin-bottom:14px;">Creates the school and its first admin login in one step.</p>
      <div class="form-grid">
        <div class="field full">
          <label>School name</label>
          <input type="text" id="f_school" placeholder="e.g. Greenfield Academy">
        </div>
        <div class="field full">
          <label>Admin's full name</label>
          <input type="text" id="f_admname" placeholder="e.g. Jane Wambui">
        </div>
        <div class="field">
          <label>Admin email</label>
          <input type="email" id="f_adminemail" placeholder="e.g. jane@greenfield.ac.ke">
        </div>
        <div class="field">
          <label>Admin password</label>
          <input type="text" id="f_adminpw" placeholder="Choose a password (min 6 characters)">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">Create school</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const schoolName = root.querySelector('#f_school').value.trim();
        const adminName = root.querySelector('#f_admname').value.trim();
        const email = root.querySelector('#f_adminemail').value.trim();
        const password = root.querySelector('#f_adminpw').value;
        if (!schoolName || !adminName || !email || !password) { UI.toast('All fields are required'); return; }
        if (password.length < 6) { UI.toast('Password must be at least 6 characters'); return; }

        const saveBtn = root.querySelector('#saveBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Creating…';
        const result = await Auth.createUser({ email, password, name: adminName, role: 'admin', schoolName });
        saveBtn.disabled = false;
        saveBtn.textContent = 'Create school';
        if (!result.ok) { UI.toast('Could not create school: ' + result.error); return; }

        UI.closeModal();
        UI.toast(`${schoolName} created`);
        Views.schools();
      };
    });
  }

  document.getElementById('content').innerHTML = `<div id="wrap">${renderTable()}</div>`;
  document.getElementById('addSchoolBtn').onclick = openNewSchoolForm;
  wireRowActions();
};

/* ------------------------- USERS (admin, or superadmin viewing a school) ------------------------- */

Views.users = async function () {
  const schoolId = Store.activeSchoolId;
  const isSuperadmin = Auth.currentUser().role === 'superadmin';
  setTopbarActions(`<button class="btn btn-primary" id="addUserBtn">+ New login</button>`);
  showLoading();

  const users = await Store.listUsersForSchool(schoolId);
  // Subjects + existing teacher->subject assignments, for the "Manage
  // subjects" modal below (restricts what a teacher login can see/edit).
  const st = await Store.current();
  let teacherSubjects = st.teacherSubjects;
  let teacherClasses = st.teacherClasses;

  function subjectsForTeacher(teacherId) {
    return new Set(teacherSubjects.filter(ts => ts.teacherId === teacherId).map(ts => ts.subjectId));
  }
  function classesForTeacher(teacherId) {
    return new Set(teacherClasses.filter(tc => tc.teacherId === teacherId).map(tc => tc.classId));
  }

  const SECTION_LABELS = { primary: 'Primary', 'junior-secondary': 'Junior Secondary', 'senior-school': 'Senior School' };
  function sectionOptions(existingScope) {
    return `<option value="" ${!existingScope ? 'selected' : ''}>All sections (unrestricted)</option>` +
      Object.entries(SECTION_LABELS).map(([k, label]) => `<option value="${k}" ${existingScope === k ? 'selected' : ''}>${label} only</option>`).join('');
  }

  function renderTable() {
    if (users.length === 0) {
      return `<div class="empty"><div class="empty-title">No logins yet</div><p>Add a login for each teacher who needs to enter marks, or another admin.</p></div>`;
    }
    return `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>#</th><th>Name</th><th>Role</th><th>Section</th><th>Subjects</th><th></th></tr></thead>
            <tbody>
              ${users.map((u, i) => `<tr>
                <td class="row-index">${i + 1}</td>
                <td>${UI.esc(u.name)}</td>
                <td><span class="badge badge-${u.role === 'admin' ? 'ME' : 'EE'}">${u.role}</span></td>
                <td>${u.role === 'admin'
                  ? (u.sectionScope ? UI.esc(SECTION_LABELS[u.sectionScope] || u.sectionScope) : '<span class="row-index">All sections</span>')
                  : '<span class="row-index">—</span>'}</td>
                <td>${u.role === 'user'
                  ? (subjectsForTeacher(u.id).size
                      ? [...subjectsForTeacher(u.id)].map(id => UI.esc(st.subjects.find(s => s.id === id)?.name || '?')).join(', ')
                      : '<span class="row-index">none assigned</span>')
                  : '<span class="row-index">—</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-ghost" data-edit="${u.id}">Edit name/role</button>
                  ${u.role === 'user' ? `<button class="btn btn-sm btn-ghost" data-subjects="${u.id}">Manage subjects</button>` : ''}
                  ${u.role === 'user' ? `<button class="btn btn-sm btn-ghost" data-classes="${u.id}">Manage classes</button>` : ''}
                  <button class="btn btn-sm btn-ghost" data-reset="${u.id}">Reset password</button>
                  <button class="btn btn-sm btn-danger" data-del="${u.id}">Delete</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <p class="field-hint" style="margin-top:10px;">
        Note: logins are shown here by name only — email addresses aren't
        listed for privacy. Ask the person directly, or check Supabase's
        Authentication tab if you need to look one up.
      </p>
    `;
  }

  function roleOptions(existingRole) {
    const options = isSuperadmin ? ['admin', 'user'] : ['user'];
    return options.map(r => `<option value="${r}" ${existingRole === r ? 'selected' : ''}>${r === 'admin' ? 'Admin' : 'User (teacher)'}</option>`).join('');
  }

  function openEditForm(existing) {
    UI.openModal(`
      <h2>Edit login</h2>
      <div class="form-grid">
        <div class="field full">
          <label>Full name</label>
          <input type="text" id="f_name" value="${UI.esc(existing.name)}">
        </div>
        <div class="field full">
          <label>Role</label>
          <select id="f_role">${roleOptions(existing.role)}</select>
        </div>
        <div class="field full" id="f_section_wrap" style="${existing.role === 'admin' ? '' : 'display:none;'}">
          <label>Section</label>
          <select id="f_section">${sectionOptions(existing.sectionScope)}</select>
          <p class="field-hint">Restrict this admin login to only Primary, only Junior Secondary, or only Senior School — useful if the two levels are run day-to-day by different admins under you. Leave as "All sections" for a full-access admin.</p>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">Save changes</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#f_role').onchange = (e) => {
        root.querySelector('#f_section_wrap').style.display = e.target.value === 'admin' ? '' : 'none';
      };
      root.querySelector('#saveBtn').onclick = async () => {
        const name = root.querySelector('#f_name').value.trim();
        const role = root.querySelector('#f_role').value;
        const sectionScope = root.querySelector('#f_section')?.value || '';
        if (!name) { UI.toast('Name is required'); return; }
        try {
          await Store.updateUserProfile(existing.id, { name, role, sectionScope });
          UI.toast('Login updated');
          UI.closeModal();
          Views.users();
        } catch (err) {
          UI.toast('Could not save: ' + err.message);
        }
      };
    });
  }

  function openCreateForm() {
    UI.openModal(`
      <h2>New login</h2>
      <div class="form-grid">
        <div class="field full">
          <label>Full name</label>
          <input type="text" id="f_name">
        </div>
        <div class="field">
          <label>Email</label>
          <input type="email" id="f_email">
        </div>
        <div class="field">
          <label>Password</label>
          <input type="text" id="f_password" placeholder="Min 6 characters">
        </div>
        <div class="field full">
          <label>Role</label>
          <select id="f_role">${roleOptions('user')}</select>
        </div>
        <div class="field full" id="f_section_wrap" style="display:none;">
          <label>Section</label>
          <select id="f_section">${sectionOptions('')}</select>
          <p class="field-hint">Restrict this admin login to only Primary, only Junior Secondary, or only Senior School — useful if the two levels are run day-to-day by different admins under you. Leave as "All sections" for a full-access admin.</p>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">Create login</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#f_role').onchange = (e) => {
        root.querySelector('#f_section_wrap').style.display = e.target.value === 'admin' ? '' : 'none';
      };
      root.querySelector('#saveBtn').onclick = async () => {
        const name = root.querySelector('#f_name').value.trim();
        const email = root.querySelector('#f_email').value.trim();
        const password = root.querySelector('#f_password').value;
        const role = root.querySelector('#f_role').value;
        const sectionScope = root.querySelector('#f_section')?.value || '';
        if (!name || !email || !password) { UI.toast('All fields are required'); return; }
        if (password.length < 6) { UI.toast('Password must be at least 6 characters'); return; }

        const saveBtn = root.querySelector('#saveBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Creating…';
        const result = await Auth.createUser({ email, password, name, role, schoolId, sectionScope: role === 'admin' ? sectionScope : '' });
        saveBtn.disabled = false;
        saveBtn.textContent = 'Create login';
        if (!result.ok) { UI.toast('Could not create login: ' + result.error); return; }

        UI.closeModal();
        UI.toast('Login created');
        Views.users();
      };
    });
  }

  function openResetForm(existing) {
    UI.openModal(`
      <h2>Reset password — ${UI.esc(existing.name)}</h2>
      <div class="field full">
        <label>New password</label>
        <input type="text" id="f_newpw" placeholder="Min 6 characters">
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">Reset password</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const pw = root.querySelector('#f_newpw').value;
        if (!pw || pw.length < 6) { UI.toast('Password must be at least 6 characters'); return; }
        const result = await Auth.resetUserPassword(existing.id, pw);
        if (!result.ok) { UI.toast('Could not reset password: ' + result.error); return; }
        UI.closeModal();
        UI.toast('Password reset');
      };
    });
  }

  function openSubjectsForm(existing) {
    const assigned = subjectsForTeacher(existing.id);
    if (st.subjects.length === 0) {
      UI.openModal(`
        <h2>Manage subjects — ${UI.esc(existing.name)}</h2>
        <p class="field-hint">No subjects exist yet. Add some from the Subjects page first.</p>
        <div class="modal-actions"><button class="btn btn-ghost" id="cancelBtn">Close</button></div>
      `, (root) => { root.querySelector('#cancelBtn').onclick = () => UI.closeModal(); });
      return;
    }
    const sortedSubjects = [...st.subjects].sort((a, b) => a.name.localeCompare(b.name));
    UI.openModal(`
      <h2>Manage subjects — ${UI.esc(existing.name)}</h2>
      <p class="field-hint" style="margin-bottom:12px;">Only the subjects selected below will be visible to ${UI.esc(existing.name)} on Results Entry, Report Cards and Exams for editing — this keeps each teacher scoped to their own subject(s).</p>
      <div class="field full">
        <label>Subjects</label>
        <select id="subjectMultiSelect" multiple size="${Math.min(10, Math.max(4, sortedSubjects.length))}" style="width:100%;">
          ${sortedSubjects.map(s => `
            <option value="${s.id}" ${assigned.has(s.id) ? 'selected' : ''}>${UI.esc(s.name)}${s.code ? ` (${UI.esc(s.code)})` : ''}</option>
          `).join('')}
        </select>
        <p class="field-hint" style="margin-top:8px;">Hold Ctrl (Windows) or Cmd (Mac) to select more than one subject from the list.</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">Save subjects</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const subjectIds = Array.from(root.querySelector('#subjectMultiSelect').selectedOptions)
          .map(opt => opt.value);
        try {
          await Store.setTeacherSubjects(existing.id, subjectIds);
          UI.toast('Subjects updated');
          UI.closeModal();
          Views.users();
        } catch (err) {
          UI.toast('Could not save: ' + err.message);
        }
      };
    });
  }

  function openClassesForm(existing) {
    const assigned = classesForTeacher(existing.id);
    if (st.classes.length === 0) {
      UI.openModal(`
        <h2>Manage classes — ${UI.esc(existing.name)}</h2>
        <p class="field-hint">No classes exist yet. Add some from the Classes page first.</p>
        <div class="modal-actions"><button class="btn btn-ghost" id="cancelBtn">Close</button></div>
      `, (root) => { root.querySelector('#cancelBtn').onclick = () => UI.closeModal(); });
      return;
    }
    UI.openModal(`
      <h2>Manage classes — ${UI.esc(existing.name)}</h2>
      <p class="field-hint" style="margin-bottom:12px;">Only the classes checked below will show up under My Classes, Learners and Attendance for ${UI.esc(existing.name)} — this scopes a teacher (or class/homeroom teacher) to their own class(es).</p>
      <div class="form-grid">
        ${[...st.classes].sort((a, b) => a.label.localeCompare(b.label)).map(c => `
          <label class="field full" style="flex-direction:row; align-items:center; gap:10px;">
            <input type="checkbox" data-class-check="${c.id}" ${assigned.has(c.id) ? 'checked' : ''} style="width:auto;">
            <span>${UI.esc(c.label)}</span>
          </label>
        `).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">Save classes</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const classIds = Array.from(root.querySelectorAll('[data-class-check]'))
          .filter(cb => cb.checked)
          .map(cb => cb.dataset.classCheck);
        try {
          await Store.setTeacherClasses(existing.id, classIds);
          UI.toast('Classes updated');
          UI.closeModal();
          Views.users();
        } catch (err) {
          UI.toast('Could not save: ' + err.message);
        }
      };
    });
  }

  function wireRowActions() {
    document.querySelectorAll('[data-edit]').forEach(btn => {
      btn.onclick = () => openEditForm(users.find(u => u.id === btn.dataset.edit));
    });
    document.querySelectorAll('[data-subjects]').forEach(btn => {
      btn.onclick = () => openSubjectsForm(users.find(u => u.id === btn.dataset.subjects));
    });
    document.querySelectorAll('[data-classes]').forEach(btn => {
      btn.onclick = () => openClassesForm(users.find(u => u.id === btn.dataset.classes));
    });
    document.querySelectorAll('[data-reset]').forEach(btn => {
      btn.onclick = () => openResetForm(users.find(u => u.id === btn.dataset.reset));
    });
    document.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = () => {
        const u = users.find(u => u.id === btn.dataset.del);
        if (u.id === Auth.currentUser().id) { UI.toast("You can't delete the login you're currently using"); return; }
        UI.confirmAction(`Delete the login for ${u.name}?`, async () => {
          const result = await Auth.deleteUserAccount(u.id);
          if (!result.ok) { UI.toast('Could not delete: ' + result.error); return; }
          UI.toast('Login deleted');
          Views.users();
        });
      };
    });
  }

  document.getElementById('content').innerHTML = `<div id="wrap">${renderTable()}</div>`;
  document.getElementById('addUserBtn').onclick = openCreateForm;
  wireRowActions();
};
