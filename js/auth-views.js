/* ============================================================
   auth-views.js — Login screen, Schools (superadmin), and
   Users (admin) management views.
   ============================================================ */

Views.login = function (onSuccess) {
  const root = document.getElementById('loginRoot');

  function brandBlock() {
    return `
      <div class="login-brand">
        <img src="icons/logo-full.png" alt="CBE Exam Register — Record. Track. Result." class="login-logo" />
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
        </div>
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
        <img src="icons/logo-full.png" alt="CBE Exam Register — Record. Track. Result." class="login-logo" />
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

  function subjectsForTeacher(teacherId) {
    return new Set(teacherSubjects.filter(ts => ts.teacherId === teacherId).map(ts => ts.subjectId));
  }

  function renderTable() {
    if (users.length === 0) {
      return `<div class="empty"><div class="empty-title">No logins yet</div><p>Add a login for each teacher who needs to enter marks, or another admin.</p></div>`;
    }
    return `
      <div class="ledger">
        <div class="ledger-scroll">
          <table class="ledger-table">
            <thead><tr><th>#</th><th>Name</th><th>Role</th><th>Subjects</th><th></th></tr></thead>
            <tbody>
              ${users.map((u, i) => `<tr>
                <td class="row-index">${i + 1}</td>
                <td>${UI.esc(u.name)}</td>
                <td><span class="badge badge-${u.role === 'admin' ? 'ME' : 'EE'}">${u.role}</span></td>
                <td>${u.role === 'user'
                  ? (subjectsForTeacher(u.id).size
                      ? [...subjectsForTeacher(u.id)].map(id => UI.esc(st.subjects.find(s => s.id === id)?.name || '?')).join(', ')
                      : '<span class="row-index">none assigned</span>')
                  : '<span class="row-index">—</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-ghost" data-edit="${u.id}">Edit name/role</button>
                  ${u.role === 'user' ? `<button class="btn btn-sm btn-ghost" data-subjects="${u.id}">Manage subjects</button>` : ''}
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
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">Save changes</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const name = root.querySelector('#f_name').value.trim();
        const role = root.querySelector('#f_role').value;
        if (!name) { UI.toast('Name is required'); return; }
        try {
          await Store.updateUserProfile(existing.id, { name, role });
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
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">Create login</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const name = root.querySelector('#f_name').value.trim();
        const email = root.querySelector('#f_email').value.trim();
        const password = root.querySelector('#f_password').value;
        const role = root.querySelector('#f_role').value;
        if (!name || !email || !password) { UI.toast('All fields are required'); return; }
        if (password.length < 6) { UI.toast('Password must be at least 6 characters'); return; }

        const saveBtn = root.querySelector('#saveBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Creating…';
        const result = await Auth.createUser({ email, password, name, role, schoolId });
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
    UI.openModal(`
      <h2>Manage subjects — ${UI.esc(existing.name)}</h2>
      <p class="field-hint" style="margin-bottom:12px;">Only the subjects checked below will be visible to ${UI.esc(existing.name)} on Results Entry, Report Cards and Exams for editing — this keeps each teacher scoped to their own subject(s).</p>
      <div class="form-grid">
        ${[...st.subjects].sort((a, b) => a.name.localeCompare(b.name)).map(s => `
          <label class="field full" style="flex-direction:row; align-items:center; gap:10px;">
            <input type="checkbox" data-subj-check="${s.id}" ${assigned.has(s.id) ? 'checked' : ''} style="width:auto;">
            <span>${UI.esc(s.name)}${s.code ? ` <span class="row-index">(${UI.esc(s.code)})</span>` : ''}</span>
          </label>
        `).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="saveBtn">Save subjects</button>
      </div>
    `, (root) => {
      root.querySelector('#cancelBtn').onclick = () => UI.closeModal();
      root.querySelector('#saveBtn').onclick = async () => {
        const subjectIds = Array.from(root.querySelectorAll('[data-subj-check]'))
          .filter(cb => cb.checked)
          .map(cb => cb.dataset.subjCheck);
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

  function wireRowActions() {
    document.querySelectorAll('[data-edit]').forEach(btn => {
      btn.onclick = () => openEditForm(users.find(u => u.id === btn.dataset.edit));
    });
    document.querySelectorAll('[data-subjects]').forEach(btn => {
      btn.onclick = () => openSubjectsForm(users.find(u => u.id === btn.dataset.subjects));
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
