/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

   auth.js — Supabase Auth session, profile/role cache, and
   role-based route access.

   Login now uses EMAIL + password (Supabase Auth's native model)
   instead of the old made-up "username" field. The profile's role
   and school_id come from the `profiles` table, fetched once after
   login/session-restore and cached here so most of the app can
   read Auth.currentUser() synchronously without re-querying.
   ============================================================ */

const Auth = {
  _profile: null,       // {id, school_id, role, name, isClassTeacher}
  _viewingSchoolId: null, // superadmin "open school" context, not persisted

  ROLE_ROUTES: {
    superadmin: ['schools'],
    admin: [
      'dashboard', 'classes', 'students', 'subjects', 'exams', 'results', 'gradebook',
      'reports', 'attendance', 'competency', 'lessonPlans', 'broadsheet', 'analysis',
      'notify', 'users', 'settings'
    ],
    // Teacher section — kept in this order because it's the order the
    // sidebar is meant to walk a teacher through their day:
    // Dashboard -> My Classes -> Learners -> Assessments -> Marks Entry
    // -> Marks Analysis -> Gradebook -> Report Cards -> Attendance ->
    // Competency Assessment -> Reports. Broadsheet (whole-class, every
    // subject) and Send to Parents are deliberately NOT in this base
    // list — those are whole-class-scope actions, only appropriate for
    // a teacher who actually holds a class (a "class teacher"), and are
    // added back in allowedRoutes() below for exactly those teachers.
    user: [
      'dashboard', 'myClasses', 'learners', 'assessments', 'results', 'analysis',
      'gradebook', 'reports', 'attendance', 'competency', 'lessonPlans'
    ],
    // Routes added on top of `user` only for teachers who are a class
    // teacher for at least one class (see _loadProfile / isClassTeacher).
    userClassTeacherExtra: ['broadsheet', 'notify']
  },

  ROUTE_TITLES: {
    dashboard: 'Dashboard', classes: 'Classes', students: 'Students', subjects: 'Subjects', exams: 'Exams',
    myClasses: 'My Classes', learners: 'Learners', assessments: 'Assessments',
    results: 'Marks Entry', reports: 'Report Cards', broadsheet: 'Broadsheet', analysis: 'Marks Analysis',
    gradebook: 'Gradebook', attendance: 'Attendance', competency: 'Competency Assessment',
    lessonPlans: 'Lesson Plans & Schemes of Work',
    notify: 'Send Results to Parents',
    users: 'Users', settings: 'Settings', schools: 'Schools'
  },
  ROUTE_LABELS: {
    dashboard: 'Dashboard', classes: 'Classes', students: 'Students', subjects: 'Subjects', exams: 'Exams',
    myClasses: 'My Classes', learners: 'Learners', assessments: 'Assessments',
    results: 'Marks Entry', reports: 'Report Cards', broadsheet: 'Broadsheet', analysis: 'Marks Analysis',
    gradebook: 'Gradebook', attendance: 'Attendance', competency: 'Competency',
    lessonPlans: 'Lesson Plans',
    notify: 'Send to Parents',
    users: 'Users', settings: 'Settings', schools: 'Schools'
  },

  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    await this._loadProfile(data.user.id);
    if (!this._profile) return { ok: false, error: 'No profile found for this login — contact your administrator.' };
    return { ok: true, user: this._profile };
  },

  async logout() {
    await supabase.auth.signOut();
    this._profile = null;
    this._viewingSchoolId = null;
    Store.activeSchoolId = null;
  },

  // Call once on page load to pick back up an existing session.
  async restoreSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return null;
    await this._loadProfile(data.session.user.id);
    return this._profile;
  },

  async _loadProfile(userId) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error || !data) { this._profile = null; return; }
    this._profile = data; // {id, school_id, role, name}
    this._applyActiveSchool();
    await this._loadClassTeacherFlag();
  },

  // A "class teacher" is a teacher who's been explicitly assigned at
  // least one class via the Users page ("Manage classes") — as
  // distinct from a subject-only teacher. Whole-class-scope screens
  // (Broadsheet, Send Results to Parents) are gated on this, since
  // they expose every subject/every learner in a class rather than
  // just the teacher's own subject. Cheap head-count query, only run
  // for role='user'; admins/superadmins never need it.
  async _loadClassTeacherFlag() {
    if (!this._profile || this._profile.role !== 'user') return;
    try {
      const { count, error } = await supabase.from('teacher_classes')
        .select('id', { count: 'exact', head: true })
        .eq('teacher_id', this._profile.id);
      this._profile.isClassTeacher = !error && !!count && count > 0;
    } catch (e) {
      this._profile.isClassTeacher = false;
    }
  },

  currentUser() {
    return this._profile;
  },

  _applyActiveSchool() {
    if (!this._profile) { Store.activeSchoolId = null; return; }
    if (this._profile.role === 'superadmin') {
      Store.activeSchoolId = this._viewingSchoolId || null;
    } else {
      Store.activeSchoolId = this._profile.school_id;
    }
  },

  // Superadmin "opens" a school to browse/manage its data.
  viewSchool(schoolId) { this._viewingSchoolId = schoolId; this._applyActiveSchool(); },
  stopViewingSchool() { this._viewingSchoolId = null; this._applyActiveSchool(); },
  isViewingSchool() { return !!this._viewingSchoolId; },

  allowedRoutes() {
    const user = this._profile;
    if (!user) return [];
    if (user.role === 'superadmin') {
      return this.isViewingSchool() ? [...this.ROLE_ROUTES.admin, 'schools'] : ['schools'];
    }
    if (user.role === 'user') {
      return user.isClassTeacher
        ? [...this.ROLE_ROUTES.user, ...this.ROLE_ROUTES.userClassTeacherExtra]
        : this.ROLE_ROUTES.user;
    }
    return this.ROLE_ROUTES[user.role] || [];
  },

  defaultRoute() {
    const routes = this.allowedRoutes();
    return routes[0] || 'schools';
  },

  // ---- Login management (goes through the manage-user Edge Function,
  // because creating/deleting logins and resetting others' passwords
  // needs the service role key, which stays server-side only) ----
  async _callManageUser(payload) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return { ok: false, error: 'Not logged in' };
    const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error || 'Request failed' };
    return { ok: true, ...json };
  },

  createUser({ email, password, name, role, schoolId, schoolName, sectionScope }) {
    return this._callManageUser({ action: 'create', email, password, name, role, schoolId, schoolName, sectionScope });
  },
  resetUserPassword(userId, newPassword) {
    return this._callManageUser({ action: 'resetPassword', userId, newPassword });
  },
  deleteUserAccount(userId) {
    return this._callManageUser({ action: 'delete', userId });
  },

  // Changing YOUR OWN password doesn't need the service role — this
  // works with the caller's own session directly.
  async updateOwnPassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  // ---- generic Edge Function caller, reused by anything that needs
  // server-side secrets (e.g. the Anthropic API key for AI-generated
  // schemes/lesson plans — see generate-curriculum-content) ----
  async callEdgeFunction(name, payload) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return { ok: false, error: 'Not logged in' };
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error || 'Request failed' };
    return { ok: true, ...json };
  }
};
