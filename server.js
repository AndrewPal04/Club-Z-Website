const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');
const SqliteStore = require('better-sqlite3-session-store')(session);
const generatePDFBuffer = require('./generate-pdf');
const generateAttendancePDF = require('./generate-attendance');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  store: new SqliteStore({ client: db }),
  secret: process.env.SESSION_SECRET || 'clubz-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/');
}

// ─── Auth routes (no requireAuth) ────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (user && bcrypt.compareSync(password, user.password_hash)) {
    req.session.userId = user.id;
    req.session.username = user.username;
    res.redirect('/dashboard');
  } else {
    res.send(`<h2>Login Failed</h2><a href="/">Try Again</a>`);
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ─── Protected routes ─────────────────────────────────────────────────────────

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ─── Timesheet workflow ───────────────────────────────────────────────────────

app.get('/timesheet', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'timesheet.html'));
});

app.post('/submit-timesheet', requireAuth, (req, res) => {
  const { tutorName, month } = req.body;
  const existingId = req.session.currentTimesheetId;
  const existing = existingId
    ? db.prepare("SELECT id FROM timesheet_sessions WHERE id = ? AND status = 'draft'").get(existingId)
    : null;

  if (existing) {
    db.prepare(
      "UPDATE timesheet_sessions SET tutor_name = ?, month = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(tutorName, month, existing.id);
    db.prepare('DELETE FROM timesheet_students WHERE session_id = ?').run(existing.id);
    req.session.currentTimesheetId = existing.id;
  } else {
    const result = db.prepare(
      'INSERT INTO timesheet_sessions (user_id, tutor_name, month, status) VALUES (?, ?, ?, ?)'
    ).run(req.session.userId, tutorName, month, 'draft');
    req.session.currentTimesheetId = result.lastInsertRowid;
  }
  res.redirect('/student-form');
});

app.get('/student-form', requireAuth, async (req, res) => {
  const students = db.prepare(
    'SELECT * FROM timesheet_students WHERE session_id = ?'
  ).all(req.session.currentTimesheetId);

  if (students.length >= 12) {
    const ts = db.prepare('SELECT * FROM timesheet_sessions WHERE id = ?').get(req.session.currentTimesheetId);
    await generatePDFBuffer({ tutorName: ts.tutor_name, month: ts.month }, students);
    res.sendFile(path.join(__dirname, 'pdf-generated.html'));
  } else {
    res.sendFile(path.join(__dirname, 'student-hours.html'));
  }
});

app.post('/submit-student', requireAuth, async (req, res) => {
  const { studentFullName, inPersonHours, onlineHours } = req.body;
  db.prepare(
    'INSERT INTO timesheet_students (session_id, student_name, in_person_hours, online_hours) VALUES (?, ?, ?, ?)'
  ).run(req.session.currentTimesheetId, studentFullName, +inPersonHours, +onlineHours);

  db.prepare("UPDATE timesheet_sessions SET updated_at = datetime('now') WHERE id = ?")
    .run(req.session.currentTimesheetId);

  const students = db.prepare(
    'SELECT * FROM timesheet_students WHERE session_id = ?'
  ).all(req.session.currentTimesheetId);

  if (students.length >= 12) {
    const ts = db.prepare('SELECT * FROM timesheet_sessions WHERE id = ?').get(req.session.currentTimesheetId);
    await generatePDFBuffer({ tutorName: ts.tutor_name, month: ts.month }, students);
    res.sendFile(path.join(__dirname, 'pdf-generated.html'));
  } else {
    res.sendFile(path.join(__dirname, 'add-another.html'));
  }
});

app.post('/add-another', requireAuth, async (req, res) => {
  db.prepare("UPDATE timesheet_sessions SET updated_at = datetime('now') WHERE id = ?")
    .run(req.session.currentTimesheetId);

  if (req.body.choice === 'yes') {
    res.redirect('/student-form');
  } else {
    const ts = db.prepare('SELECT * FROM timesheet_sessions WHERE id = ?').get(req.session.currentTimesheetId);
    const students = db.prepare(
      'SELECT * FROM timesheet_students WHERE session_id = ?'
    ).all(req.session.currentTimesheetId);
    await generatePDFBuffer({ tutorName: ts.tutor_name, month: ts.month }, students);
    res.sendFile(path.join(__dirname, 'pdf-generated.html'));
  }
});

app.get('/download-pdf', requireAuth, async (req, res) => {
  try {
    const ts = db.prepare('SELECT * FROM timesheet_sessions WHERE id = ?').get(req.session.currentTimesheetId);
    const students = db.prepare(
      'SELECT * FROM timesheet_students WHERE session_id = ?'
    ).all(req.session.currentTimesheetId);
    const pdfBuffer = await generatePDFBuffer(
      { tutorName: ts.tutor_name, month: ts.month },
      students
    );
    db.prepare("UPDATE timesheet_sessions SET status = 'complete', updated_at = datetime('now') WHERE id = ?")
      .run(req.session.currentTimesheetId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=Tutor_Time_Summary.pdf');
    res.send(pdfBuffer);
  } catch {
    res.status(500).send('Error generating PDF.');
  }
});

// ─── Attendance workflow ──────────────────────────────────────────────────────

app.get('/attendance', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'attendance-info.html'));
});

app.post('/submit-attendance-info', requireAuth, (req, res) => {
  const { studentName, tutorName, month, subjects, grade } = req.body;
  const existingId = req.session.currentAttendanceId;
  const existing = existingId
    ? db.prepare("SELECT id FROM attendance_sessions WHERE id = ? AND status = 'draft'").get(existingId)
    : null;

  if (existing) {
    db.prepare(
      "UPDATE attendance_sessions SET student_name = ?, tutor_name = ?, month = ?, subjects = ?, grade = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(studentName, tutorName, month, subjects, grade, existing.id);
    db.prepare('DELETE FROM attendance_entries WHERE session_id = ?').run(existing.id);
    db.prepare('DELETE FROM attendance_extra WHERE session_id = ?').run(existing.id);
    req.session.currentAttendanceId = existing.id;
  } else {
    const result = db.prepare(
      'INSERT INTO attendance_sessions (user_id, student_name, tutor_name, month, subjects, grade, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.session.userId, studentName, tutorName, month, subjects, grade, 'draft');
    req.session.currentAttendanceId = result.lastInsertRowid;
  }
  res.redirect('/attendance-sessions');
});

app.get('/attendance-sessions', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'attendance-sessions.html'));
});

app.post('/submit-attendance-sessions', requireAuth, (req, res) => {
  db.prepare('DELETE FROM attendance_entries WHERE session_id = ?').run(req.session.currentAttendanceId);

  const insertEntry = db.prepare(
    'INSERT INTO attendance_entries (session_id, date, start_time, end_time, comments, is_online) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (let i = 0; i < 12; i++) {
    const date = req.body[`date${i}`];
    const start = req.body[`start${i}`];
    const end = req.body[`end${i}`];
    const comments = req.body[`comments${i}`];
    if (!date || !start || !end || !comments) continue;
    const isOnline = req.body[`online${i}`] ? 1 : 0;
    insertEntry.run(req.session.currentAttendanceId, date, start, end, comments, isOnline);
  }

  db.prepare(
    `INSERT INTO attendance_extra (session_id, online_count, in_person_count)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET online_count = excluded.online_count, in_person_count = excluded.in_person_count`
  ).run(req.session.currentAttendanceId, req.body.onlineCount, req.body.inPersonCount);

  db.prepare("UPDATE attendance_sessions SET updated_at = datetime('now') WHERE id = ?")
    .run(req.session.currentAttendanceId);

  res.redirect('/attendance-final');
});

app.get('/attendance-final', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'attendance-final.html'));
});

app.post('/submit-attendance-final', requireAuth, async (req, res) => {
  db.prepare(
    `INSERT INTO attendance_extra (session_id, progress_notes, review_date)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET progress_notes = excluded.progress_notes, review_date = excluded.review_date`
  ).run(req.session.currentAttendanceId, req.body.monthlyProgress, req.body.reviewDate);

  db.prepare("UPDATE attendance_sessions SET updated_at = datetime('now') WHERE id = ?")
    .run(req.session.currentAttendanceId);

  const { info, sessions, counts, extra } = loadAttendanceData(req.session.currentAttendanceId);
  await generateAttendancePDF(info, sessions, counts, extra);
  res.sendFile(path.join(__dirname, 'attendance-generated.html'));
});

app.get('/download-attendance', requireAuth, async (req, res) => {
  try {
    const { info, sessions, counts, extra } = loadAttendanceData(req.session.currentAttendanceId);
    const filePath = await generateAttendancePDF(info, sessions, counts, extra);
    db.prepare("UPDATE attendance_sessions SET status = 'complete', updated_at = datetime('now') WHERE id = ?")
      .run(req.session.currentAttendanceId);
    res.download(filePath, 'Student_Attendance_Sheet.pdf');
  } catch (err) {
    res.status(500).send('Error generating attendance PDF.');
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadAttendanceData(sessionId) {
  const row = db.prepare('SELECT * FROM attendance_sessions WHERE id = ?').get(sessionId);
  const info = {
    studentName: row.student_name,
    tutorName: row.tutor_name,
    month: row.month,
    subjects: row.subjects,
    grade: row.grade
  };

  const entries = db.prepare('SELECT * FROM attendance_entries WHERE session_id = ? ORDER BY id').all(sessionId);
  const sessions = entries.map(e => ({
    date: e.date,
    startTime: e.start_time,
    endTime: e.end_time,
    comments: e.comments,
    isOnline: e.is_online === 1
  }));

  const extraRow = db.prepare('SELECT * FROM attendance_extra WHERE session_id = ?').get(sessionId) || {};
  const counts = {
    onlineCount: extraRow.online_count || 0,
    inPersonCount: extraRow.in_person_count || 0
  };
  const extra = {
    progressNotes: extraRow.progress_notes || '',
    reviewDate: extraRow.review_date || ''
  };

  return { info, sessions, counts, extra };
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
