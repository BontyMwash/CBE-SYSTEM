/* ============================================================
   Copyright (c) 2026 B~CBE Analytics. All rights reserved.

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
  _mapClass: (r) => ({ id: r.id, name: r.name, stream: r.stream || '', label: r.stream ? `${r.name} ${r.stream}` : r.name, teacherName: r.teacher_name || '' }),
  _mapStudent: (r) => ({
    id: r.id, name: r.name, admissionNo: r.admission_no || '', klass: r.klass,
    parentName: r.parent_name || '', parentPhone: r.parent_phone || '', parentEmail: r.parent_email || ''
  }),
  _mapSubject: (r) => ({ id: r.id, name: r.name, code: r.code || '' }),
  _mapExamType: (r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order || 0 }),
  _mapExam: (r) => ({ id: r.id, type: r.type, term: r.term, year: r.year, klass: r.klass, subjectId: r.subject_id, totalMarks: Number(r.total_marks), date: r.exam_date || '' }),
  _mapResult: (r) => ({ id: r.id, examId: r.exam_id, studentId: r.student_id, marks: Number(r.marks) }),
  _mapTeacherSubject: (r) => ({ id: r.id, teacherId: r.teacher_id, subjectId: r.subject_id }),
  _mapTeacherClass: (r) => ({ id: r.id, teacherId: r.teacher_id, classId: r.class_id }),
  _mapAttendance: (r) => ({ id: r.id, klass: r.klass, date: r.att_date, studentId: r.student_id, status: r.status, remarks: r.remarks || '', markedBy: r.marked_by }),
  _mapCompetency: (r) => ({
    id: r.id, studentId: r.student_id, subjectId: r.subject_id, term: r.term, year: r.year,
    strand: r.strand, subStrand: r.sub_strand || '', rating: r.rating, remarks: r.remarks || '',
    assessedBy: r.assessed_by, updatedAt: r.updated_at
  }),
  _mapPublished: (r) => ({ id: r.id, klass: r.klass, type: r.type, term: r.term, year: r.year, publishedAt: r.published_at, publishedBy: r.published_by }),
  _mapScheme: (r) => ({
    id: r.id, subjectId: r.subject_id, klass: r.klass, term: r.term, year: r.year, week: r.week, lessonNo: r.lesson_no,
    strand: r.strand || '', subStrand: r.sub_strand || '', outcomes: r.specific_learning_outcomes || '',
    inquiryQuestion: r.key_inquiry_question || '', experiences: r.learning_experiences || '',
    resources: r.learning_resources || '', assessment: r.assessment_methods || '', reflection: r.reflection || '',
    updatedAt: r.updated_at
  }),
  _mapLessonPlan: (r) => ({
    id: r.id, subjectId: r.subject_id, klass: r.klass, term: r.term, year: r.year, week: r.week, lessonNo: r.lesson_no,
    date: r.lesson_date || '', strand: r.strand || '', subStrand: r.sub_strand || '', outcomes: r.specific_learning_outcomes || '',
    inquiryQuestion: r.key_inquiry_question || '', coreCompetencies: r.core_competencies || '', values: r.values_taught || '',
    pcis: r.pcis || '', resources: r.learning_resources || '', introduction: r.introduction || '',
    development: r.lesson_development || '', conclusion: r.conclusion || '', extendedActivities: r.extended_activities || '',
    reflection: r.reflection || '', updatedAt: r.updated_at
  }),
  _mapCurriculumDoc: (r) => ({ id: r.id, subjectId: r.subject_id, klass: r.klass, title: r.title || '', storagePath: r.storage_path, createdAt: r.created_at }),
  _mapSchoolSettings: (r) => ({
    schoolName: r.name, motto: r.motto || '', term: r.term, year: r.year, gradingBands: r.grading_bands,
    frozen: !!r.frozen, frozenAt: r.frozen_at || null, frozenReason: r.frozen_reason || '', headName: r.head_name || ''
  }),

  _throwIfError(label, error) {
    if (error) { console.error(label, error); throw new Error(error.message || label); }
  },

  // ---- school-scoped bundle (what every view renders from) ----
  async current() {
    const schoolId = this.activeSchoolId;
    if (!schoolId) {
      return {
        settings: { schoolName: '', motto: '', term: 'Term 1', year: new Date().getFullYear(), gradingBands: [], headName: '' },
        classes: [], students: [], subjects: [], examTypes: [], exams: [], results: [], teacherSubjects: [], teacherClasses: [], published: []
      };
    }

    const [schoolRes, classesRes, studentsRes, subjectsRes, examTypesRes, examsRes, resultsRes, teacherSubjectsRes, teacherClassesRes, publishedRes] = await Promise.all([
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
      // Same idea as teacher_subjects, but for classes — powers "My
      // Classes" / "Learners" / "Attendance" for a teacher login.
      supabase.from('teacher_classes').select('*').eq('school_id', schoolId),
      // Which (class, exam type, term, year) sittings the admin has
      // published — this is what unlocks the Analysis page for teachers.
      supabase.from('published_results').select('*').eq('school_id', schoolId)
    ]);

    this._throwIfError('load school', schoolRes.error);
    this._throwIfError('load classes', classesRes.error);
    this._throwIfError('load students', studentsRes.error);
    this._throwIfError('load subjects', subjectsRes.error);
    this._throwIfError('load exam types', examTypesRes.error);
    this._throwIfError('load exams', examsRes.error);
    this._throwIfError('load results', resultsRes.error);
    this._throwIfError('load teacher subjects', teacherSubjectsRes.error);
    this._throwIfError('load teacher classes', teacherClassesRes.error);
    this._throwIfError('load published results', publishedRes.error);

    return {
      settings: this._mapSchoolSettings(schoolRes.data),
      classes: (classesRes.data || []).map(this._mapClass),
      students: (studentsRes.data || []).map(this._mapStudent),
      subjects: (subjectsRes.data || []).map(this._mapSubject),
      examTypes: (examTypesRes.data || []).map(this._mapExamType),
      exams: (examsRes.data || []).map(this._mapExam),
      results: (resultsRes.data || []).map(this._mapResult),
      teacherSubjects: (teacherSubjectsRes.data || []).map(this._mapTeacherSubject),
      teacherClasses: (teacherClassesRes.data || []).map(this._mapTeacherClass),
      published: (publishedRes.data || []).map(this._mapPublished)
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
    return data.map(u => ({ id: u.id, name: u.name, role: u.role, schoolId: u.school_id, sectionScope: u.section_scope || '' }));
  },
  // Creating/deleting logins and resetting other people's passwords go
  // through Auth.manageUser(...) (calls the manage-user Edge Function)
  // because they require the service role key, which never reaches the
  // browser. Editing name/role/section only (not password) can go direct:
  async updateUserProfile(id, patch) {
    const dbPatch = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.role !== undefined) dbPatch.role = patch.role;
    // section_scope only means anything for admins — clearing it for a
    // 'user' (teacher) row keeps the column tidy, since teachers are
    // never restricted by it (they use teacher_classes instead).
    if (patch.sectionScope !== undefined) {
      dbPatch.section_scope = (patch.role || 'user') === 'admin' ? (patch.sectionScope || null) : null;
    }
    const { data, error } = await supabase.from('profiles').update(dbPatch).eq('id', id).select().single();
    this._throwIfError('update profile', error);
    return data;
  },

  // ---- Classes / Streams ----
  async addClass(c) {
    const { data, error } = await supabase.from('classes').insert({
      school_id: this.activeSchoolId, name: c.name.trim(), stream: (c.stream || '').trim(), teacher_name: (c.teacherName || '').trim()
    }).select().single();
    this._throwIfError('add class', error);
    return this._mapClass(data);
  },
  async updateClass(id, patch) {
    const dbPatch = {};
    if (patch.name !== undefined) dbPatch.name = patch.name.trim();
    if (patch.stream !== undefined) dbPatch.stream = (patch.stream || '').trim();
    if (patch.teacherName !== undefined) dbPatch.teacher_name = (patch.teacherName || '').trim();
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
      school_id: this.activeSchoolId, name: s.name.trim(), admission_no: (s.admissionNo || '').trim(), klass: s.klass.trim(),
      parent_name: (s.parentName || '').trim(), parent_phone: (s.parentPhone || '').trim(), parent_email: (s.parentEmail || '').trim()
    }).select().single();
    this._throwIfError('add student', error);
    return this._mapStudent(data);
  },
  async updateStudent(id, patch) {
    const dbPatch = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.admissionNo !== undefined) dbPatch.admission_no = patch.admissionNo;
    if (patch.klass !== undefined) dbPatch.klass = patch.klass;
    if (patch.parentName !== undefined) dbPatch.parent_name = (patch.parentName || '').trim();
    if (patch.parentPhone !== undefined) dbPatch.parent_phone = (patch.parentPhone || '').trim();
    if (patch.parentEmail !== undefined) dbPatch.parent_email = (patch.parentEmail || '').trim();
    const { data, error } = await supabase.from('students').update(dbPatch).eq('id', id).select().single();
    this._throwIfError('update student', error);
    return this._mapStudent(data);
  },
  async deleteStudent(id) {
    // results for this student cascade-delete automatically (FK on delete cascade)
    const { error } = await supabase.from('students').delete().eq('id', id);
    this._throwIfError('delete student', error);
  },

  // "Promote" — move a batch of learners into a new class in one go
  // (year-end promotion, or moving a few transfers/repeaters). One
  // network call for the whole batch rather than one per student.
  async promoteStudents(studentIds, newKlass) {
    if (!studentIds.length) return [];
    const { data, error } = await supabase
      .from('students')
      .update({ klass: newKlass.trim() })
      .in('id', studentIds)
      .select();
    this._throwIfError('promote students', error);
    return (data || []).map(this._mapStudent);
  },

  // Bulk insert for CSV/Excel import — one network call instead of N.
  async addStudentsBulk(records) {
    const rows = records.map(r => ({
      school_id: this.activeSchoolId,
      name: r.name.trim(),
      admission_no: (r.admissionNo || '').trim(),
      klass: r.klass.trim(),
      parent_name: (r.parentName || '').trim(),
      parent_phone: (r.parentPhone || '').trim(),
      parent_email: (r.parentEmail || '').trim()
    }));
    const { data, error } = await supabase.from('students').insert(rows).select();
    this._throwIfError('bulk add students', error);
    return (data || []).map(this._mapStudent);
  },

  // ---- Parent result notifications (log of "sent" messages, so the
  // Send Results to Parents screen can show who's been contacted for
  // a given sitting). Sending itself happens on-device (WhatsApp/SMS/
  // email links) — this table just tracks that it happened.
  _mapNotification: (r) => ({
    id: r.id, studentId: r.student_id, klass: r.klass, type: r.type, term: r.term, year: r.year,
    channel: r.channel, sentAt: r.sent_at, sentBy: r.sent_by
  }),
  async notificationsFor(klass, type, term, year) {
    const { data, error } = await supabase.from('result_notifications').select('*')
      .eq('school_id', this.activeSchoolId).eq('klass', klass).eq('type', type).eq('term', term).eq('year', year);
    this._throwIfError('load notifications', error);
    return (data || []).map(this._mapNotification);
  },
  async logNotification({ studentId, klass, type, term, year, channel }) {
    const user = Auth.currentUser();
    const { data, error } = await supabase.from('result_notifications').insert({
      school_id: this.activeSchoolId, student_id: studentId, klass, type, term, year, channel,
      sent_by: user ? user.id : null
    }).select().single();
    this._throwIfError('log notification', error);
    return this._mapNotification(data);
  },
  async clearNotification(id) {
    const { error } = await supabase.from('result_notifications').delete().eq('id', id);
    this._throwIfError('clear notification', error);
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
    if (patch.headName !== undefined) dbPatch.head_name = patch.headName;
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

  // ---- Teacher <-> class assignments ("My Classes" / roster / attendance scope) ----
  async setTeacherClasses(teacherId, classIds) {
    const { error: delErr } = await supabase.from('teacher_classes').delete().eq('teacher_id', teacherId);
    this._throwIfError('clear teacher classes', delErr);
    if (!classIds.length) return [];
    const rows = classIds.map(classId => ({ school_id: this.activeSchoolId, teacher_id: teacherId, class_id: classId }));
    const { data, error } = await supabase.from('teacher_classes').insert(rows).select();
    this._throwIfError('save teacher classes', error);
    return (data || []).map(this._mapTeacherClass);
  },

  // ---- Attendance ----
  async attendanceFor(klass, date) {
    const { data, error } = await supabase.from('attendance').select('*')
      .eq('school_id', this.activeSchoolId).eq('klass', klass).eq('att_date', date);
    this._throwIfError('load attendance', error);
    return (data || []).map(this._mapAttendance);
  },
  // Summary rows (one per date) for a class over a date range — powers
  // the attendance history/percentage view.
  async attendanceRange(klass, fromDate, toDate) {
    let q = supabase.from('attendance').select('*').eq('school_id', this.activeSchoolId).eq('klass', klass);
    if (fromDate) q = q.gte('att_date', fromDate);
    if (toDate) q = q.lte('att_date', toDate);
    const { data, error } = await q.order('att_date', { ascending: false });
    this._throwIfError('load attendance range', error);
    return (data || []).map(this._mapAttendance);
  },
  // Bulk upsert — one network call for the whole class register on a given day.
  async saveAttendanceBulk(klass, date, entries) {
    const user = Auth.currentUser();
    const rows = entries.map(e => ({
      school_id: this.activeSchoolId, klass, att_date: date, student_id: e.studentId,
      status: e.status, remarks: (e.remarks || '').trim(), marked_by: user ? user.id : null
    }));
    const { data, error } = await supabase.from('attendance')
      .upsert(rows, { onConflict: 'klass,att_date,student_id' }).select();
    this._throwIfError('save attendance', error);
    return (data || []).map(this._mapAttendance);
  },
  async deleteAttendanceRecord(id) {
    const { error } = await supabase.from('attendance').delete().eq('id', id);
    this._throwIfError('delete attendance record', error);
  },

  // ---- Competency Assessment (CBC strand ratings, EE/ME/AE/BE) ----
  async competenciesFor(subjectId, term, year) {
    const { data, error } = await supabase.from('competency_assessments').select('*')
      .eq('school_id', this.activeSchoolId).eq('subject_id', subjectId).eq('term', term).eq('year', year);
    this._throwIfError('load competencies', error);
    return (data || []).map(this._mapCompetency);
  },
  async saveCompetency(c) {
    const user = Auth.currentUser();
    const { data, error } = await supabase.from('competency_assessments')
      .upsert({
        school_id: this.activeSchoolId, student_id: c.studentId, subject_id: c.subjectId,
        term: c.term, year: Number(c.year), strand: c.strand.trim(), sub_strand: (c.subStrand || '').trim(),
        rating: c.rating, remarks: (c.remarks || '').trim(), assessed_by: user ? user.id : null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'student_id,subject_id,term,year,strand,sub_strand' })
      .select().single();
    this._throwIfError('save competency', error);
    return this._mapCompetency(data);
  },
  async deleteCompetency(id) {
    const { error } = await supabase.from('competency_assessments').delete().eq('id', id);
    this._throwIfError('delete competency', error);
  },

  // ---- Schemes of Work (term-long plan, one row per week/lesson) ----
  async schemesFor(subjectId, klass, term, year) {
    const { data, error } = await supabase.from('schemes_of_work').select('*')
      .eq('school_id', this.activeSchoolId).eq('subject_id', subjectId).eq('klass', klass).eq('term', term).eq('year', year)
      .order('week', { ascending: true }).order('lesson_no', { ascending: true });
    this._throwIfError('load schemes of work', error);
    return (data || []).map(this._mapScheme);
  },
  async saveSchemeRow(s) {
    const row = {
      school_id: this.activeSchoolId, subject_id: s.subjectId, klass: s.klass, term: s.term, year: Number(s.year),
      week: Number(s.week), lesson_no: Number(s.lessonNo || 1), strand: (s.strand || '').trim(), sub_strand: (s.subStrand || '').trim(),
      specific_learning_outcomes: (s.outcomes || '').trim(), key_inquiry_question: (s.inquiryQuestion || '').trim(),
      learning_experiences: (s.experiences || '').trim(), learning_resources: (s.resources || '').trim(),
      assessment_methods: (s.assessment || '').trim(), reflection: (s.reflection || '').trim(), updated_at: new Date().toISOString()
    };
    if (!s.id) { const user = Auth.currentUser(); row.created_by = user ? user.id : null; }
    const { data, error } = await supabase.from('schemes_of_work')
      .upsert(row, { onConflict: 'subject_id,klass,term,year,week,lesson_no' }).select().single();
    this._throwIfError('save scheme of work row', error);
    return this._mapScheme(data);
  },
  // Bulk-fills empty skeleton rows (week/lesson only) for weeks that
  // don't have a row yet — never overwrites a row a teacher has
  // already started filling in, since it uses ignoreDuplicates.
  async generateSchemeSkeleton(subjectId, klass, term, year, weeks, lessonsPerWeek) {
    const user = Auth.currentUser();
    const rows = [];
    for (let w = 1; w <= weeks; w++) {
      for (let l = 1; l <= lessonsPerWeek; l++) {
        rows.push({
          school_id: this.activeSchoolId, subject_id: subjectId, klass, term, year: Number(year),
          week: w, lesson_no: l, created_by: user ? user.id : null
        });
      }
    }
    const { data, error } = await supabase.from('schemes_of_work')
      .upsert(rows, { onConflict: 'subject_id,klass,term,year,week,lesson_no', ignoreDuplicates: true }).select();
    this._throwIfError('generate scheme of work', error);
    return (data || []).map(this._mapScheme);
  },
  async deleteSchemeRow(id) {
    const { error } = await supabase.from('schemes_of_work').delete().eq('id', id);
    this._throwIfError('delete scheme of work row', error);
  },

  // ---- Lesson Plans (one full CBC lesson document per week/lesson) ----
  async lessonPlansFor(subjectId, klass, term, year) {
    const { data, error } = await supabase.from('lesson_plans').select('*')
      .eq('school_id', this.activeSchoolId).eq('subject_id', subjectId).eq('klass', klass).eq('term', term).eq('year', year)
      .order('week', { ascending: true }).order('lesson_no', { ascending: true });
    this._throwIfError('load lesson plans', error);
    return (data || []).map(this._mapLessonPlan);
  },
  async saveLessonPlan(p) {
    const row = {
      school_id: this.activeSchoolId, subject_id: p.subjectId, klass: p.klass, term: p.term, year: Number(p.year),
      week: Number(p.week), lesson_no: Number(p.lessonNo || 1), lesson_date: p.date || null,
      strand: (p.strand || '').trim(), sub_strand: (p.subStrand || '').trim(), specific_learning_outcomes: (p.outcomes || '').trim(),
      key_inquiry_question: (p.inquiryQuestion || '').trim(), core_competencies: (p.coreCompetencies || '').trim(),
      values_taught: (p.values || '').trim(), pcis: (p.pcis || '').trim(), learning_resources: (p.resources || '').trim(),
      introduction: (p.introduction || '').trim(), lesson_development: (p.development || '').trim(),
      conclusion: (p.conclusion || '').trim(), extended_activities: (p.extendedActivities || '').trim(),
      reflection: (p.reflection || '').trim(), updated_at: new Date().toISOString()
    };
    if (!p.id) { const user = Auth.currentUser(); row.created_by = user ? user.id : null; }
    const { data, error } = await supabase.from('lesson_plans')
      .upsert(row, { onConflict: 'subject_id,klass,term,year,week,lesson_no' }).select().single();
    this._throwIfError('save lesson plan', error);
    return this._mapLessonPlan(data);
  },
  async deleteLessonPlan(id) {
    const { error } = await supabase.from('lesson_plans').delete().eq('id', id);
    this._throwIfError('delete lesson plan', error);
  },

  // ---- Curriculum Documents (uploaded KICD curriculum design PDFs
  // that ground the "Generate with AI" scheme/lesson-plan buttons) ----
  async curriculumDocsFor(subjectId, klass) {
    const { data, error } = await supabase.from('curriculum_documents').select('*')
      .eq('school_id', this.activeSchoolId).eq('subject_id', subjectId).eq('klass', klass)
      .order('created_at', { ascending: false });
    this._throwIfError('load curriculum documents', error);
    return (data || []).map(this._mapCurriculumDoc);
  },
  async uploadCurriculumDoc(subjectId, klass, title, file) {
    const user = Auth.currentUser();
    const safeName = (file.name || 'curriculum.pdf').replace(/[^\w.\-]+/g, '_');
    const path = `${this.activeSchoolId}/${subjectId}/${encodeURIComponent(klass)}/${Date.now()}-${safeName}`;
    const { error: uploadErr } = await supabase.storage.from('curriculum-designs').upload(path, file, {
      contentType: file.type || 'application/pdf', upsert: false
    });
    this._throwIfError('upload curriculum document', uploadErr);
    const { data, error } = await supabase.from('curriculum_documents').insert({
      school_id: this.activeSchoolId, subject_id: subjectId, klass, title: (title || file.name || '').trim(),
      storage_path: path, file_size: file.size || null, uploaded_by: user ? user.id : null
    }).select().single();
    if (error) { await supabase.storage.from('curriculum-designs').remove([path]); this._throwIfError('save curriculum document', error); }
    return this._mapCurriculumDoc(data);
  },
  async deleteCurriculumDoc(id) {
    const { data: existing } = await supabase.from('curriculum_documents').select('storage_path').eq('id', id).single();
    const { error } = await supabase.from('curriculum_documents').delete().eq('id', id);
    this._throwIfError('delete curriculum document', error);
    if (existing?.storage_path) await supabase.storage.from('curriculum-designs').remove([existing.storage_path]);
  },

  // ---- AI generation (Edge Function — needs the Anthropic API key,
  // which stays server-side; see generate-curriculum-content) ----
  async generateSchemeWithAI(subjectId, klass, term, year, weeks, lessonsPerWeek) {
    const res = await Auth.callEdgeFunction('generate-curriculum-content', {
      action: 'scheme', subjectId, klass, term, year: Number(year), weeks, lessonsPerWeek
    });
    if (!res.ok) throw new Error(res.error || 'Could not generate scheme of work');
    return res.rows || [];
  },
  async generateLessonWithAI(subjectId, klass, term, year, week, lessonNo, schemeRow) {
    const res = await Auth.callEdgeFunction('generate-curriculum-content', {
      action: 'lesson', subjectId, klass, term, year: Number(year), week, lessonNo, schemeRow: schemeRow || null
    });
    if (!res.ok) throw new Error(res.error || 'Could not generate lesson plan');
    return res.plan || {};
  },

  // ---- Backup (export only — see README for why import/reset were dropped) ----
  async exportSchoolJSON() {
    const data = await this.current();
    return JSON.stringify(data, null, 2);
  }
};
