/* ============================================================
   data.js — Supabase-backed data store.

   Every method that touches the database is now ASYNC (returns a
   Promise) since it's a real network call. The shapes returned
   match the old localStorage version exactly (camelCase fields
   like admissionNo, subjectId, totalMarks) so the rendering code
   in views.js needed only "async/await" added, not a rewrite.

   Row Level Security (see sql/schema.sql) is what actually
   enforces who can read/write what — Store.activeSchoolId here is
   just which school's data the CURRENT screen should ask for; it
   is not a security boundary by itself.
   ============================================================ */

const Store = {
  activeSchoolId: null, // set by Auth after login / "view school" (superadmin)

  // ---- mappers: DB snake_case -> app camelCase ----
  _mapClass: (r) => ({ id: r.id, name: r.name, stream: r.stream || '', label: r.stream ? `${r.name} ${r.stream}` : r.name }),
  _mapStudent: (r) => ({ id: r.id, name: r.name, admissionNo: r.admission_no || '', klass: r.klass }),
  _mapSubject: (r) => ({ id: r.id, name: r.name, code: r.code || '' }),
  _mapExamType: (r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order || 0 }),
  _mapExam: (r) => ({ id: r.id, type: r.type, term: r.term, year: r.year, klass: r.klass, subjectId: r.subject_id, totalMarks: Number(r.total_marks), date: r.exam_date || '' }),
  _mapResult: (r) => ({ id: r.id, examId: r.exam_id, studentId: r.student_id, marks: Number(r.marks) }),
  _mapTeacherSubject: (r) => ({ id: r.id, teacherId: r.teacher_id, subjectId: r.subject_id }),
  _mapPublished: (r) => ({ id: r.id, klass: r.klass, type: r.type, term: r.term, year: r.year, publishedAt: r.published_at, publishedBy: r.published_by }),
  _mapReportComment: (r) => ({ id: r.id, klass: r.klass, term: r.term, year: r.year, classTeacherComment: r.class_teacher_comment || '', headComment: r.head_comment || '', updatedAt: r.updated_at }),
  _mapSchoolSettings: (r) => ({
    schoolName: r.name, motto: r.motto || '', term: r.term, year: r.year, gradingBands: r.grading_bands,
    frozen: !!r.frozen, frozenAt: r.frozen_at || null, frozenReason: r.frozen_reason || ''
  }),

  _throwIfError(label, error) {
    if (error) { console.error(label, error); throw new Error(error.message || label); }
  },

  // ---- school-scoped bundle (what every view renders from) ----
  async current() {
    const schoolId = this.activeSchoolId;
    if (!schoolId) {
      return {
        settings: { schoolName: '', motto: '', term: 'Term 1', year: new Date().getFullYear(), gradingBands: [] },
        classes: [], students: [], subjects: [], examTypes: [], exams: [], results: [], teacherSubjects: [], published: [], reportComments: []
      };
    }

    const [schoolRes, classesRes, studentsRes, subjectsRes, examTypesRes, examsRes, resultsRes, teacherSubjectsRes, publishedRes, reportCommentsRes] = await Promise.all([
      supabase.from('schools').select('*').eq('id', schoolId).single(),
      supabase.from('classes').select('*').eq('school_id', schoolId).order('name').order('stream'),
      supabase.from('students').select('*').eq('school_id', schoolId).order('name'),
      supabase.from('subjects').select('*').eq('school_id', schoolId).order('name'),
      supabase.from('exam_types').select('*').eq('school_id', schoolId).order('sort_order').order('name'),
      supabase.from('exams').select('*').eq('school_id', schoolId),
      supabase.from('results').select('*, exams!inner(school_id)').eq('exams.school_id', schoolId),
      // RLS scopes this automatically: admins see every assignment in the
      // school (to manage them), teachers see only their own (to filter
      // their own Results Entry / marks-editing screens).
      supabase.from('teacher_subjects').select('*').eq('school_id', schoolId),
      // Which (class, exam type, term, year) sittings the admin has
      // published — this is what unlocks the Analysis page for teachers.
      supabase.from('published_results').select('*').eq('school_id', schoolId),
      // Class Teacher's / Head of Institution's own typed remarks, one row
      // per (class, term, year) — auto-filled onto every report card for
      // that class/term/year instead of the old auto-generated comment.
      supabase.from('report_comments').select('*').eq('school_id', schoolId)
    ]);

    this._throwIfError('load school', schoolRes.error);
    this._throwIfError('load classes', classesRes.error);
    this._throwIfError('load students', studentsRes.error);
    this._throwIfError('load subjects', subjectsRes.error);
    this._throwIfError('load exam types', examTypesRes.error);
    this._throwIfError('load exams', examsRes.error);
    this._throwIfError('load results', resultsRes.error);
    this._throwIfError('load teacher subjects', teacherSubjectsRes.error);
    this._throwIfError('load published results', publishedRes.error);
    this._throwIfError('load report comments', reportCommentsRes.error);

    return {
      settings: this._mapSchoolSettings(schoolRes.data),
      classes: (classesRes.data || []).map(this._mapClass),
      students: (studentsRes.data || []).map(this._mapStudent),
      subjects: (subjectsRes.data || []).map(this._mapSubject),
      examTypes: (examTypesRes.data || []).map(this._mapExamType),
      exams: (examsRes.data || []).map(this._mapExam),
      results: (resultsRes.data || []).map(this._mapResult),
      teacherSubjects: (teacherSubjectsRes.data || []).map(this._mapTeacherSubject),
      published: (publishedRes.data || []).map(this._mapPublished),
      reportComments: (reportCommentsRes.data || []).map(this._mapReportComment)
    };
  },
  // alias kept so any older call sites still work
  load() { return this.current(); },

  // ---- Schools (superadmin) ----
  async listSchools() {
    const { data, error } = await supabase.from('schools').select('*').order('name');
    this._throwIfError('list schools', error);
    return data;
  },
  async getSchool(id) {
    const { data, error } = await supabase.from('schools').select('*').eq('id', id).single();
    this._throwIfError('get school', error);
    return data;
  },
  async updateSchool(id, patch) {
    const dbPatch = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    const { data, error } = await supabase.from('schools').update(dbPatch).eq('id', id).select().single();
    this._throwIfError('update school', error);
    return data;
  },
  async deleteSchool(id) {
    const { error } = await supabase.from('schools').delete().eq('id', id);
    this._throwIfError('delete school', error);
  },
  // Freeze locks a school to read-only (superadmin unaffected) — for
  // accounts that haven't paid. `reason` is optional, shown to other
  // superadmins as a note (e.g. "Term 2 fees outstanding").
  async setSchoolFrozen(id, frozen, reason) {
    const dbPatch = {
      frozen,
      frozen_at: frozen ? new Date().toISOString() : null,
      frozen_reason: frozen ? (reason || '') : ''
    };
    const { data, error } = await supabase.from('schools').update(dbPatch).eq('id', id).select().single();
    this._throwIfError('update school frozen status', error);
    return data;
  },
  async schoolStats(id) {
    const [students, subjects, exams, users] = await Promise.all([
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', id),
      supabase.from('subjects').select('id', { count: 'exact', head: true }).eq('school_id', id),
      supabase.from('exams').select('id', { count: 'exact', head: true }).eq('school_id', id),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('school_id', id)
    ]);
    return { students: students.count || 0, subjects: subjects.count || 0, exams: exams.count || 0, users: users.count || 0 };
  },

  // ---- Users / logins (profiles table + Edge Function for auth) ----
  async listUsersForSchool(schoolId) {
    const { data, error } = await supabase.from('profiles').select('*').eq('school_id', schoolId).order('name');
    this._throwIfError('list users', error);
    return data.map(u => ({ id: u.id, name: u.name, role: u.role, schoolId: u.school_id }));
  },
  // Creating/deleting logins and resetting other people's passwords go
  // through Auth.manageUser(...) (calls the manage-user Edge Function)
  // because they require the service role key, which never reaches the
  // browser. Editing name/role only (not password) can go direct:
  async updateUserProfile(id, patch) {
    const dbPatch = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.role !== undefined) dbPatch.role = patch.role;
    const { data, error } = await supabase.from('profiles').update(dbPatch).eq('id', id).select().single();
    this._throwIfError('update profile', error);
    return data;
  },

  // ---- Classes / Streams ----
  async addClass(c) {
    const { data, error } = await supabase.from('classes').insert({
      school_id: this.activeSchoolId, name: c.name.trim(), stream: (c.stream || '').trim()
    }).select().single();
    this._throwIfError('add class', error);
    return this._mapClass(data);
  },
  async updateClass(id, patch) {
    const dbPatch = {};
    if (patch.name !== undefined) dbPatch.name = patch.name.trim();
    if (patch.stream !== undefined) dbPatch.stream = (patch.stream || '').trim();
    const { data, error } = await supabase.from('classes').update(dbPatch).eq('id', id).select().single();
    this._throwIfError('update class', error);
    return this._mapClass(data);
  },
  async deleteClass(id) {
    // Note: this only removes the class/stream entry itself — any
    // students or exams already using that class name as text are
    // untouched (klass is stored as plain text, not a foreign key).
    const { error } = await supabase.from('classes').delete().eq('id', id);
    this._throwIfError('delete class', error);
  },

  // ---- Students ----
  async addStudent(s) {
    const { data, error } = await supabase.from('students').insert({
      school_id: this.activeSchoolId, name: s.name.trim(), admission_no: (s.admissionNo || '').trim(), klass: s.klass.trim()
    }).select().single();
    this._throwIfError('add student', error);
    return this._mapStudent(data);
  },
  async updateStudent(id, patch) {
    const dbPatch = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.admissionNo !== undefined) dbPatch.admission_no = patch.admissionNo;
    if (patch.klass !== undefined) dbPatch.klass = patch.klass;
    const { data, error } = await supabase.from('students').update(dbPatch).eq('id', id).select().single();
    this._throwIfError('update student', error);
    return this._mapStudent(data);
  },
  async deleteStudent(id) {
    // results for this student cascade-delete automatically (FK on delete cascade)
    const { error } = await supabase.from('students').delete().eq('id', id);
    this._throwIfError('delete student', error);
  },

  // Bulk insert for CSV/Excel import — one network call instead of N.
  async addStudentsBulk(records) {
    const rows = records.map(r => ({
      school_id: this.activeSchoolId,
      name: r.name.trim(),
      admission_no: (r.admissionNo || '').trim(),
      klass: r.klass.trim()
    }));
    const { data, error } = await supabase.from('students').insert(rows).select();
    this._throwIfError('bulk add students', error);
    return (data || []).map(this._mapStudent);
  },

  // ---- Subjects ----
  async addSubject(s) {
    const { data, error } = await supabase.from('subjects').insert({
      school_id: this.activeSchoolId, name: s.name.trim(), code: (s.code || '').trim().toUpperCase()
    }).select().single();
    this._throwIfError('add subject', error);
    return this._mapSubject(data);
  },
  async updateSubject(id, s) {
    const dbPatch = {};
    if (s.name !== undefined) dbPatch.name = s.name.trim();
    if (s.code !== undefined) dbPatch.code = (s.code || '').trim().toUpperCase();
    const { data, error } = await supabase.from('subjects').update(dbPatch).eq('id', id).select().single();
    this._throwIfError('update subject', error);
    return this._mapSubject(data);
  },
  async deleteSubject(id) {
    // exams (and their results) under this subject cascade-delete automatically
    const { error } = await supabase.from('subjects').delete().eq('id', id);
    this._throwIfError('delete subject', error);
  },

  // ---- Exam types (admin-defined sittings, e.g. Opener/Midterm/Endterm) ----
  async addExamType(t) {
    const { data, error } = await supabase.from('exam_types').insert({
      school_id: this.activeSchoolId, name: t.name.trim(), sort_order: Number(t.sortOrder) || 0
    }).select().single();
    this._throwIfError('add exam type', error);
    return this._mapExamType(data);
  },
  async updateExamType(id, patch) {
    const dbPatch = {};
    if (patch.name !== undefined) dbPatch.name = patch.name.trim();
    if (patch.sortOrder !== undefined) dbPatch.sort_order = Number(patch.sortOrder) || 0;
    const { data, error } = await supabase.from('exam_types').update(dbPatch).eq('id', id).select().single();
    this._throwIfError('update exam type', error);
    return this._mapExamType(data);
  },
  async deleteExamType(id) {
    // Note: this only removes the exam-type entry itself — any exams
    // already created with that type text are untouched (exams.type is
    // stored as plain text, not a foreign key), matching how Classes work.
    const { error } = await supabase.from('exam_types').delete().eq('id', id);
    this._throwIfError('delete exam type', error);
  },

  // ---- Teacher <-> subject assignments ("see/edit their subjects only") ----
  async setTeacherSubjects(teacherId, subjectIds) {
    const { error: delErr } = await supabase.from('teacher_subjects').delete().eq('teacher_id', teacherId);
    this._throwIfError('clear teacher subjects', delErr);
    if (!subjectIds.length) return [];
    const rows = subjectIds.map(subjectId => ({ school_id: this.activeSchoolId, teacher_id: teacherId, subject_id: subjectId }));
    const { data, error } = await supabase.from('teacher_subjects').insert(rows).select();
    this._throwIfError('save teacher subjects', error);
    return (data || []).map(this._mapTeacherSubject);
  },

  // ---- Exams ----
  async addExam(e) {
    const { data, error } = await supabase.from('exams').insert({
      school_id: this.activeSchoolId, type: e.type, term: e.term, year: e.year, klass: e.klass.trim(),
      subject_id: e.subjectId, total_marks: Number(e.totalMarks) || 100, exam_date: e.date || null
    }).select().single();
    this._throwIfError('add exam', error);
    return this._mapExam(data);
  },
  async updateExam(id, patch) {
    const dbPatch = {};
    if (patch.type !== undefined) dbPatch.type = patch.type;
    if (patch.term !== undefined) dbPatch.term = patch.term;
    if (patch.year !== undefined) dbPatch.year = patch.year;
    if (patch.klass !== undefined) dbPatch.klass = patch.klass;
    if (patch.subjectId !== undefined) dbPatch.subject_id = patch.subjectId;
    if (patch.totalMarks !== undefined) dbPatch.total_marks = patch.totalMarks;
    if (patch.date !== undefined) dbPatch.exam_date = patch.date || null;
    const { data, error } = await supabase.from('exams').update(dbPatch).eq('id', id).select().single();
    this._throwIfError('update exam', error);
    return this._mapExam(data);
  },
  async deleteExam(id) {
    const { error } = await supabase.from('exams').delete().eq('id', id);
    this._throwIfError('delete exam', error);
  },

  // ---- Results ----
  // marks === '' clears/deletes the result (student didn't sit the exam).
  async setResult(examId, studentId, marks) {
    if (marks === '' || marks === null || marks === undefined) {
      const { error } = await supabase.from('results').delete().eq('exam_id', examId).eq('student_id', studentId);
      this._throwIfError('clear result', error);
      return null;
    }
    const { data, error } = await supabase.from('results')
      .upsert({ exam_id: examId, student_id: studentId, marks: Number(marks) }, { onConflict: 'exam_id,student_id' })
      .select().single();
    this._throwIfError('save result', error);
    return this._mapResult(data);
  },

  // ---- Settings (per school) ----
  async updateSettings(patch) {
    const dbPatch = {};
    if (patch.schoolName !== undefined) dbPatch.name = patch.schoolName;
    if (patch.motto !== undefined) dbPatch.motto = patch.motto;
    if (patch.term !== undefined) dbPatch.term = patch.term;
    if (patch.year !== undefined) dbPatch.year = patch.year;
    const { data, error } = await supabase.from('schools').update(dbPatch).eq('id', this.activeSchoolId).select().single();
    this._throwIfError('update settings', error);
    return this._mapSchoolSettings(data);
  },
  async setGradingBands(bands) {
    const { error } = await supabase.from('schools').update({ grading_bands: bands }).eq('id', this.activeSchoolId);
    this._throwIfError('save grading bands', error);
  },

  // ---- Published results ("release" a sitting to teachers once every
  // subject's marks are entered — see js/analysis.js for the UI) ----
  async publishResults(klass, type, term, year) {
    const { data, error } = await supabase.from('published_results')
      .upsert({
        school_id: this.activeSchoolId, klass, type, term, year: Number(year),
        published_at: new Date().toISOString(), published_by: Auth.currentUser()?.id || null
      }, { onConflict: 'school_id,klass,type,term,year' })
      .select().single();
    this._throwIfError('publish results', error);
    return this._mapPublished(data);
  },
  async unpublishResults(id) {
    const { error } = await supabase.from('published_results').delete().eq('id', id);
    this._throwIfError('unpublish results', error);
  },

  // ---- Report comments (Class Teacher's / Head of Institution's own
  // remark, saved once per class+term+year and auto-filled onto every
  // student's report card for that class/term/year) ----
  async saveReportComment(klass, term, year, patch) {
    const dbPatch = {
      school_id: this.activeSchoolId, klass, term, year: Number(year),
      updated_at: new Date().toISOString(), updated_by: Auth.currentUser()?.id || null
    };
    if (patch.classTeacherComment !== undefined) dbPatch.class_teacher_comment = patch.classTeacherComment;
    if (patch.headComment !== undefined) dbPatch.head_comment = patch.headComment;
    const { data, error } = await supabase.from('report_comments')
      .upsert(dbPatch, { onConflict: 'school_id,klass,term,year' })
      .select().single();
    this._throwIfError('save report comment', error);
    return this._mapReportComment(data);
  },

  // ---- Backup (export only — see README for why import/reset were dropped) ----
  async exportSchoolJSON() {
    const data = await this.current();
    return JSON.stringify(data, null, 2);
  }
};
