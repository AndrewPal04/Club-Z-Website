require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');
const db = require('./db');
const SqliteStore = require('better-sqlite3-session-store')(session);
const generatePDFBuffer = require('./generate-pdf');
const generateAttendancePDF = require('./generate-attendance');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(helmet());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  store: new SqliteStore({ client: db }),
  secret: process.env.SESSION_SECRET || 'clubz-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).type('text').send('Too many login attempts. Please try again in 15 minutes.')
});

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/');
}

// ─── Auth routes (no requireAuth) ────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: __dirname });
});

app.post('/login', loginLimiter, (req, res) => {
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
  res.sendFile('dashboard.html', { root: __dirname });
});

// ─── Timesheet workflow ───────────────────────────────────────────────────────

app.get('/timesheet', requireAuth, (req, res) => {
  res.sendFile('timesheet.html', { root: __dirname });
});

app.post('/submit-timesheet', requireAuth, (req, res) => {
  const tutorName = sanitize(req.body.tutorName);
  const month     = sanitize(req.body.month);
  if (!isNonEmpty(tutorName) || !isNonEmpty(month))
    return res.status(400).json({ error: 'Tutor name and month are required.' });
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
    res.sendFile('pdf-generated.html', { root: __dirname });
  } else {
    res.sendFile('student-hours.html', { root: __dirname });
  }
});

app.post('/submit-student', requireAuth, async (req, res) => {
  const studentFullName = sanitize(req.body.studentFullName);
  const { inPersonHours, onlineHours } = req.body;
  if (!isNonEmpty(studentFullName))
    return res.status(400).json({ error: 'Student name is required.' });
  if (!isValidHours(inPersonHours))
    return res.status(400).json({ error: 'In-person hours must be a number between 0 and 24.' });
  if (!isValidHours(onlineHours))
    return res.status(400).json({ error: 'Online hours must be a number between 0 and 24.' });

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
    res.sendFile('pdf-generated.html', { root: __dirname });
  } else {
    res.sendFile('add-another.html', { root: __dirname });
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
    res.sendFile('pdf-generated.html', { root: __dirname });
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
  res.sendFile('attendance-info.html', { root: __dirname });
});

app.post('/submit-attendance-info', requireAuth, (req, res) => {
  const studentName = sanitize(req.body.studentName);
  const tutorName   = sanitize(req.body.tutorName);
  const month       = sanitize(req.body.month);
  const subjects    = sanitize(req.body.subjects);
  const grade       = sanitize(req.body.grade);
  if ([studentName, tutorName, month, subjects, grade].some(v => !isNonEmpty(v)))
    return res.status(400).json({ error: 'All fields are required.' });
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
  res.sendFile('attendance-sessions.html', { root: __dirname });
});

app.post('/submit-attendance-sessions', requireAuth, (req, res) => {
  const entries = [];
  for (let i = 0; i < 12; i++) {
    const date     = sanitize(req.body[`date${i}`]);
    const start    = sanitize(req.body[`start${i}`]);
    const end      = sanitize(req.body[`end${i}`]);
    const comments = sanitize(req.body[`comments${i}`]);
    if (!date && !start && !end && !comments) continue;
    if (!isNonEmpty(date) || !isNonEmpty(start) || !isNonEmpty(end) || !isNonEmpty(comments))
      return res.status(400).json({ error: `All fields are required for session ${i + 1}.` });
    if (start >= end)
      return res.status(400).json({ error: `Start time must be before end time in session ${i + 1}.` });
    entries.push({ date, start, end, comments, isOnline: req.body[`online${i}`] ? 1 : 0 });
  }
  if (entries.length === 0)
    return res.status(400).json({ error: 'At least one session is required.' });

  db.prepare('DELETE FROM attendance_entries WHERE session_id = ?').run(req.session.currentAttendanceId);

  const insertEntry = db.prepare(
    'INSERT INTO attendance_entries (session_id, date, start_time, end_time, comments, is_online) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (const e of entries) {
    insertEntry.run(req.session.currentAttendanceId, e.date, e.start, e.end, e.comments, e.isOnline);
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
  res.sendFile('attendance-final.html', { root: __dirname });
});

app.post('/submit-attendance-final', requireAuth, async (req, res) => {
  const monthlyProgress = sanitize(req.body.monthlyProgress);
  const reviewDate      = sanitize(req.body.reviewDate);
  if (!isNonEmpty(monthlyProgress))
    return res.status(400).json({ error: 'Monthly progress is required.' });
  if (!isValidDate(reviewDate))
    return res.status(400).json({ error: 'Review date must be a valid date.' });

  db.prepare(
    `INSERT INTO attendance_extra (session_id, progress_notes, review_date)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET progress_notes = excluded.progress_notes, review_date = excluded.review_date`
  ).run(req.session.currentAttendanceId, req.body.monthlyProgress, req.body.reviewDate);

  db.prepare("UPDATE attendance_sessions SET updated_at = datetime('now') WHERE id = ?")
    .run(req.session.currentAttendanceId);

  const { info, sessions, counts, extra } = loadAttendanceData(req.session.currentAttendanceId);
  await generateAttendancePDF(info, sessions, counts, extra);
  res.sendFile('attendance-generated.html', { root: __dirname });
});

app.get('/download-attendance', requireAuth, async (req, res) => {
  try {
    const { info, sessions, counts, extra } = loadAttendanceData(req.session.currentAttendanceId);
    const filePath = await generateAttendancePDF(info, sessions, counts, extra);
    db.prepare("UPDATE attendance_sessions SET status = 'complete', updated_at = datetime('now') WHERE id = ?")
      .run(req.session.currentAttendanceId);
    const pdfBuf = fs.readFileSync(filePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=Student_Attendance_Sheet.pdf');
    res.send(pdfBuf);
  } catch (err) {
    res.status(500).send('Error generating attendance PDF.');
  }
});

// ─── Validation & sanitization helpers ───────────────────────────────────────

function sanitize(val) {
  if (typeof val !== 'string') return val;
  return sanitizeHtml(val, { allowedTags: [], allowedAttributes: {} });
}

function isNonEmpty(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function isValidHours(val) {
  const n = Number(val);
  return !isNaN(n) && n >= 0 && n <= 24;
}

function isValidDate(val) {
  return /^\d{4}-\d{2}-\d{2}$/.test(val) && !isNaN(Date.parse(val));
}

// ─── History & re-download ────────────────────────────────────────────────────

app.get('/history', requireAuth, (req, res) => {
  res.sendFile('history.html', { root: __dirname });
});

app.get('/api/history', requireAuth, (req, res) => {
  const timesheets = db.prepare(
    "SELECT id, tutor_name, month, updated_at FROM timesheet_sessions WHERE user_id = ? AND status = 'complete' ORDER BY updated_at DESC"
  ).all(req.session.userId);

  const attendances = db.prepare(
    "SELECT id, student_name, tutor_name, month, updated_at FROM attendance_sessions WHERE user_id = ? AND status = 'complete' ORDER BY updated_at DESC"
  ).all(req.session.userId);

  res.json({ timesheets, attendances });
});

app.get('/redownload/timesheet/:id', requireAuth, async (req, res) => {
  try {
    const ts = db.prepare(
      "SELECT * FROM timesheet_sessions WHERE id = ? AND user_id = ? AND status = 'complete'"
    ).get(req.params.id, req.session.userId);
    if (!ts) return res.status(404).send('Document not found.');

    const students = db.prepare(
      'SELECT * FROM timesheet_students WHERE session_id = ?'
    ).all(ts.id);

    const pdfBuffer = await generatePDFBuffer(
      { tutorName: ts.tutor_name, month: ts.month },
      students
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Tutor_Time_Summary_${ts.month}.pdf`);
    res.send(pdfBuffer);
  } catch {
    res.status(500).send('Error regenerating PDF.');
  }
});

app.get('/redownload/attendance/:id', requireAuth, async (req, res) => {
  try {
    const att = db.prepare(
      "SELECT id FROM attendance_sessions WHERE id = ? AND user_id = ? AND status = 'complete'"
    ).get(req.params.id, req.session.userId);
    if (!att) return res.status(404).send('Document not found.');

    const { info, sessions, counts, extra } = loadAttendanceData(att.id);
    const filePath = await generateAttendancePDF(info, sessions, counts, extra);
    const pdfBuf = fs.readFileSync(filePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Student_Attendance_Sheet_${info.month}.pdf`);
    res.send(pdfBuf);
  } catch {
    res.status(500).send('Error regenerating PDF.');
  }
});

// ─── Drafts & resume ─────────────────────────────────────────────────────────

app.get('/drafts', requireAuth, (req, res) => {
  const monthPattern = strftimeCurrentMonth();
  const timesheets = db.prepare(
    "SELECT id, tutor_name, month, updated_at FROM timesheet_sessions WHERE user_id = ? AND status = 'draft' AND strftime('%Y-%m', updated_at) = ?"
  ).all(req.session.userId, monthPattern);

  const attendances = db.prepare(
    "SELECT id, student_name, tutor_name, month, updated_at FROM attendance_sessions WHERE user_id = ? AND status = 'draft' AND strftime('%Y-%m', updated_at) = ?"
  ).all(req.session.userId, monthPattern);

  res.json({ timesheets, attendances });
});

app.get('/resume/timesheet/:id', requireAuth, (req, res) => {
  const ts = db.prepare(
    "SELECT id FROM timesheet_sessions WHERE id = ? AND user_id = ? AND status = 'draft'"
  ).get(req.params.id, req.session.userId);
  if (!ts) return res.redirect('/dashboard');

  req.session.currentTimesheetId = ts.id;
  const hasStudents = db.prepare('SELECT 1 FROM timesheet_students WHERE session_id = ?').get(ts.id);
  res.redirect(hasStudents ? '/student-form' : '/timesheet');
});

app.get('/resume/attendance/:id', requireAuth, (req, res) => {
  const att = db.prepare(
    "SELECT id FROM attendance_sessions WHERE id = ? AND user_id = ? AND status = 'draft'"
  ).get(req.params.id, req.session.userId);
  if (!att) return res.redirect('/dashboard');

  req.session.currentAttendanceId = att.id;
  const hasEntries = db.prepare('SELECT 1 FROM attendance_entries WHERE session_id = ?').get(att.id);
  const hasExtra = db.prepare('SELECT review_date FROM attendance_extra WHERE session_id = ?').get(att.id);

  if (hasExtra && hasExtra.review_date) return res.redirect('/attendance-final');
  if (hasEntries) return res.redirect('/attendance-sessions');
  res.redirect('/attendance');
});

// Pre-fill data endpoints (called by form pages on load to restore draft values)

app.get('/draft/timesheet', requireAuth, (req, res) => {
  const id = req.session.currentTimesheetId;
  if (!id) return res.json(null);
  const ts = db.prepare('SELECT tutor_name, month FROM timesheet_sessions WHERE id = ? AND user_id = ?')
    .get(id, req.session.userId);
  res.json(ts || null);
});

app.get('/draft/attendance/info', requireAuth, (req, res) => {
  const id = req.session.currentAttendanceId;
  if (!id) return res.json(null);
  const att = db.prepare(
    'SELECT student_name, tutor_name, month, subjects, grade FROM attendance_sessions WHERE id = ? AND user_id = ?'
  ).get(id, req.session.userId);
  res.json(att || null);
});

app.get('/draft/attendance/sessions', requireAuth, (req, res) => {
  const id = req.session.currentAttendanceId;
  if (!id) return res.json([]);
  const entries = db.prepare(
    'SELECT date, start_time, end_time, comments, is_online FROM attendance_entries WHERE session_id = ? ORDER BY id'
  ).all(id);
  res.json(entries);
});

app.get('/draft/attendance/extra', requireAuth, (req, res) => {
  const id = req.session.currentAttendanceId;
  if (!id) return res.json(null);
  const extra = db.prepare(
    'SELECT progress_notes, review_date FROM attendance_extra WHERE session_id = ?'
  ).get(id);
  res.json(extra || null);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function strftimeCurrentMonth() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

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
