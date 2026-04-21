/**
 * Integration test suite for Club Z Website
 * Run with: node test.js
 */

process.env.PORT = '3099';
process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod';
process.env.DB_PATH = './clubz.db';
process.env.NODE_ENV = 'test';

const { spawn } = require('child_process');
const path = require('path');

const BASE = 'http://localhost:3099';
let passed = 0;
let failed = 0;
let serverProcess;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ok(label) {
  console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  passed++;
}

function fail(label, detail = '') {
  console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  failed++;
}

function check(label, condition, detail = '') {
  condition ? ok(label) : fail(label, detail);
}

function section(name) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

// Cookie jar (stores Set-Cookie across redirects)
class CookieJar {
  constructor() { this.cookies = {}; }
  store(headers) {
    const sc = headers['set-cookie'];
    if (!sc) return;
    [].concat(sc).forEach(c => {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      this.cookies[k.trim()] = v.trim();
    });
  }
  header() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function req(method, url, { body, jar, followRedirects = false } = {}) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (jar) headers['Cookie'] = jar.header();

  const opts = { method, headers, redirect: followRedirects ? 'follow' : 'manual' };
  if (body) opts.body = new URLSearchParams(body).toString();

  const res = await fetch(BASE + url, opts);
  if (jar) jar.store(Object.fromEntries(res.headers.entries()));
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
}

// ─── Start server ─────────────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['server.js'], {
      cwd: path.join(__dirname),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let ready = false;
    serverProcess.stdout.on('data', data => {
      if (!ready && data.toString().includes('Server running')) {
        ready = true;
        resolve();
      }
    });
    serverProcess.stderr.on('data', data => {
      if (!ready) reject(new Error(data.toString()));
    });
    serverProcess.on('error', reject);
    setTimeout(() => { if (!ready) reject(new Error('Server did not start in time')); }, 8000);
  });
}

function stopServer() {
  if (serverProcess) serverProcess.kill();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function runTests() {
  // ── 1. Module loading ────────────────────────────────────────────────────
  section('1. Module loading');
  try {
    require('./db');
    ok('db.js loads and initializes SQLite');
  } catch (e) { fail('db.js loads', e.message); }

  try {
    require('./generate-pdf');
    ok('generate-pdf.js loads');
  } catch (e) { fail('generate-pdf.js loads', e.message); }

  try {
    require('./generate-attendance');
    ok('generate-attendance.js loads');
  } catch (e) { fail('generate-attendance.js loads', e.message); }

  // ── 2. PDF generation (unit) ─────────────────────────────────────────────
  section('2. PDF generation (unit tests)');

  try {
    const generatePDFBuffer = require('./generate-pdf');
    const buf = await generatePDFBuffer(
      { tutorName: 'Test Tutor', month: 'April' },
      [
        { student_name: 'Smith, John', in_person_hours: 2, online_hours: 1 },
        { student_name: 'Doe, Jane',   in_person_hours: 0, online_hours: 3 }
      ]
    );
    check('Timesheet PDF returns a buffer',       Buffer.isBuffer(buf) || buf instanceof Uint8Array);
    check('Timesheet PDF starts with PDF header', Buffer.from(buf).slice(0, 4).toString() === '%PDF');
    check('Timesheet PDF is non-trivially sized', buf.length > 10000, `size=${buf.length}`);
  } catch (e) { fail('Timesheet PDF generation', e.message); }

  try {
    const generateAttendancePDF = require('./generate-attendance');
    const filePath = await generateAttendancePDF(
      { studentName: 'Smith, John', tutorName: 'Test Tutor', month: 'April', subjects: 'Math', grade: '7' },
      [
        { date: '4/1/2026', startTime: '14:00', endTime: '15:00', comments: 'Covered fractions', isOnline: false },
        { date: '4/8/2026', startTime: '14:00', endTime: '15:00', comments: 'Algebra intro',     isOnline: true  }
      ],
      { onlineCount: 1, inPersonCount: 1 },
      { progressNotes: 'Student is making great progress.', reviewDate: '2026-04-15' }
    );
    const fs = require('fs');
    check('Attendance PDF returns a file path',       typeof filePath === 'string');
    check('Attendance PDF file exists on disk',       fs.existsSync(filePath));
    check('Attendance PDF file is non-trivially sized', fs.statSync(filePath).size > 10000);
    const header = Buffer.alloc(4);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    check('Attendance PDF starts with PDF header', header.toString() === '%PDF');
  } catch (e) { fail('Attendance PDF generation', e.message); }

  // ── 3. Server startup ────────────────────────────────────────────────────
  section('3. Server startup');
  try {
    await startServer();
    ok('Server starts without errors');
  } catch (e) {
    fail('Server starts', e.message);
    return summarize();
  }

  // Small pause for server to fully settle
  await new Promise(r => setTimeout(r, 300));

  // ── 4. Unauthenticated access ────────────────────────────────────────────
  section('4. Unauthenticated access');

  const home = await req('GET', '/');
  check('GET / returns 200',                    home.status === 200,           `got ${home.status}`);
  check('GET / serves the login page',          home.text.includes('<form'),   'no form found');

  for (const route of ['/dashboard', '/timesheet', '/attendance', '/history']) {
    const r = await req('GET', route);
    check(`GET ${route} (no session) redirects to /`, r.status === 302 && r.location === '/', `status=${r.status} location=${r.location}`);
  }

  // ── 5. Authentication ────────────────────────────────────────────────────
  section('5. Authentication');

  const badLogin = await req('POST', '/login', { body: { username: 'nobody', password: 'wrong' } });
  check('POST /login with bad creds returns 200 with failure message',
    badLogin.status === 200 && badLogin.text.includes('Login Failed'),
    `status=${badLogin.status}`);

  const jar = new CookieJar();
  const goodLogin = await req('POST', '/login', {
    body: { username: 'andrewpalacios', password: 'palacios' },
    jar
  });
  check('POST /login with good creds returns 302',     goodLogin.status === 302, `got ${goodLogin.status}`);
  check('POST /login sets a session cookie',           jar.header().includes('connect.sid'));

  const dash = await req('GET', '/dashboard', { jar });
  check('GET /dashboard with valid session returns 200', dash.status === 200, `got ${dash.status}`);

  const logout = await req('POST', '/logout', { jar: new CookieJar() });
  check('POST /logout without session redirects to /',  logout.status === 302 && logout.location === '/');

  // ── 6. Timesheet workflow ────────────────────────────────────────────────
  section('6. Timesheet workflow');

  const tsJar = new CookieJar();
  await req('POST', '/login', { body: { username: 'andrewpalacios', password: 'palacios' }, jar: tsJar });

  const tsSubmit = await req('POST', '/submit-timesheet', {
    body: { tutorName: 'Test Tutor', month: 'April' },
    jar: tsJar
  });
  check('POST /submit-timesheet redirects to /student-form',
    tsSubmit.status === 302 && tsSubmit.location === '/student-form',
    `status=${tsSubmit.status} location=${tsSubmit.location}`);

  const addStudent = await req('POST', '/submit-student', {
    body: { studentFullName: 'Smith, John', inPersonHours: '2', onlineHours: '1' },
    jar: tsJar
  });
  check('POST /submit-student with valid data returns 200 or redirect',
    addStudent.status === 200 || addStudent.status === 302,
    `got ${addStudent.status}`);

  const addAnother = await req('POST', '/add-another', { body: { choice: 'no' }, jar: tsJar });
  check('POST /add-another choice=no returns 200 (pdf-generated page)',
    addAnother.status === 200, `got ${addAnother.status}`);

  const pdfDownload = await req('GET', '/download-pdf', { jar: tsJar });
  check('GET /download-pdf returns 200',                   pdfDownload.status === 200, `got ${pdfDownload.status}`);
  check('GET /download-pdf Content-Type is application/pdf',
    pdfDownload.headers.get('content-type')?.includes('application/pdf'),
    pdfDownload.headers.get('content-type'));
  check('GET /download-pdf body starts with PDF header',
    pdfDownload.text.startsWith('%PDF'));

  // ── 7. Timesheet validation ──────────────────────────────────────────────
  section('7. Timesheet validation');

  const tsValJar = new CookieJar();
  await req('POST', '/login', { body: { username: 'andrewpalacios', password: 'palacios' }, jar: tsValJar });

  const blankTs = await req('POST', '/submit-timesheet', { body: { tutorName: '', month: '' }, jar: tsValJar });
  check('POST /submit-timesheet with blank fields returns 400',
    blankTs.status === 400, `got ${blankTs.status}`);

  const badHours = await req('POST', '/submit-student', {
    body: { studentFullName: 'Test', inPersonHours: '999', onlineHours: '0' },
    jar: tsValJar
  });
  check('POST /submit-student with hours > 24 returns 400',
    badHours.status === 400, `got ${badHours.status}`);

  // ── 8. Attendance workflow ───────────────────────────────────────────────
  section('8. Attendance workflow');

  const attJar = new CookieJar();
  await req('POST', '/login', { body: { username: 'andrewpalacios', password: 'palacios' }, jar: attJar });

  const attInfo = await req('POST', '/submit-attendance-info', {
    body: { studentName: 'Doe, Jane', tutorName: 'Test Tutor', month: 'April', subjects: 'Math', grade: '7' },
    jar: attJar
  });
  check('POST /submit-attendance-info redirects to /attendance-sessions',
    attInfo.status === 302 && attInfo.location === '/attendance-sessions',
    `status=${attInfo.status} location=${attInfo.location}`);

  const sessionBody = {
    date0: '4/1/2026', start0: '14:00', end0: '15:00', comments0: 'Covered fractions',
    onlineCount: '0', inPersonCount: '1'
  };
  const attSessions = await req('POST', '/submit-attendance-sessions', { body: sessionBody, jar: attJar });
  check('POST /submit-attendance-sessions redirects to /attendance-final',
    attSessions.status === 302 && attSessions.location === '/attendance-final',
    `status=${attSessions.status} location=${attSessions.location}`);

  const attFinal = await req('POST', '/submit-attendance-final', {
    body: { monthlyProgress: 'Great progress this month.', reviewDate: '2026-04-15' },
    jar: attJar
  });
  check('POST /submit-attendance-final returns 200 (generated page)',
    attFinal.status === 200, `got ${attFinal.status}`);

  const attDownload = await req('GET', '/download-attendance', { jar: attJar });
  check('GET /download-attendance returns 200',  attDownload.status === 200, `got ${attDownload.status}`);
  check('GET /download-attendance Content-Type is application/pdf',
    attDownload.headers.get('content-type')?.includes('application/pdf'),
    attDownload.headers.get('content-type'));

  // ── 9. Attendance validation ─────────────────────────────────────────────
  section('9. Attendance validation');

  const attValJar = new CookieJar();
  await req('POST', '/login', { body: { username: 'andrewpalacios', password: 'palacios' }, jar: attValJar });
  await req('POST', '/submit-attendance-info', {
    body: { studentName: 'Val Test', tutorName: 'Tutor', month: 'April', subjects: 'Math', grade: '5' },
    jar: attValJar
  });

  const badTime = await req('POST', '/submit-attendance-sessions', {
    body: { date0: '4/1/2026', start0: '15:00', end0: '14:00', comments0: 'test', onlineCount: '0', inPersonCount: '1' },
    jar: attValJar
  });
  check('POST /submit-attendance-sessions with start >= end returns 400',
    badTime.status === 400, `got ${badTime.status}`);

  const noSessions = await req('POST', '/submit-attendance-sessions', {
    body: { onlineCount: '0', inPersonCount: '0' },
    jar: attValJar
  });
  check('POST /submit-attendance-sessions with no rows returns 400',
    noSessions.status === 400, `got ${noSessions.status}`);

  const blankFinal = await req('POST', '/submit-attendance-final', {
    body: { monthlyProgress: '', reviewDate: '' },
    jar: attValJar
  });
  check('POST /submit-attendance-final with blank fields returns 400',
    blankFinal.status === 400, `got ${blankFinal.status}`);

  // ── 10. Drafts & history API ─────────────────────────────────────────────
  section('10. Drafts & history API');

  const apiJar = new CookieJar();
  await req('POST', '/login', { body: { username: 'andrewpalacios', password: 'palacios' }, jar: apiJar });

  const drafts = await req('GET', '/drafts', { jar: apiJar });
  check('GET /drafts returns 200',            drafts.status === 200,  `got ${drafts.status}`);
  check('GET /drafts returns valid JSON',     (() => { try { JSON.parse(drafts.text); return true; } catch { return false; } })());
  const draftsJson = JSON.parse(drafts.text);
  check('GET /drafts response has timesheets and attendances arrays',
    Array.isArray(draftsJson.timesheets) && Array.isArray(draftsJson.attendances));

  const history = await req('GET', '/api/history', { jar: apiJar });
  check('GET /api/history returns 200',       history.status === 200, `got ${history.status}`);
  check('GET /api/history returns valid JSON', (() => { try { JSON.parse(history.text); return true; } catch { return false; } })());
  const historyJson = JSON.parse(history.text);
  check('GET /api/history has timesheets array with at least one completed entry',
    Array.isArray(historyJson.timesheets) && historyJson.timesheets.length > 0,
    `found ${historyJson.timesheets?.length}`);

  // ── 11. Re-download completed document ──────────────────────────────────
  section('11. Re-download from history');

  const redownloadId = historyJson.timesheets[0]?.id;
  if (redownloadId) {
    const redown = await req('GET', `/redownload/timesheet/${redownloadId}`, { jar: apiJar });
    check('GET /redownload/timesheet/:id returns 200',
      redown.status === 200, `got ${redown.status}`);
    check('GET /redownload/timesheet/:id Content-Type is application/pdf',
      redown.headers.get('content-type')?.includes('application/pdf'));
  } else {
    fail('Re-download test skipped — no completed timesheet found');
  }

  // ── 12. Rate limiter header present ─────────────────────────────────────
  section('12. Security headers');

  const loginRes = await req('POST', '/login', { body: { username: 'nobody', password: 'x' } });
  check('POST /login includes RateLimit headers (rate limiter active)',
    loginRes.headers.has('ratelimit-limit') || loginRes.headers.has('x-ratelimit-limit'),
    [...loginRes.headers.keys()].join(', '));

  const anyPage = await req('GET', '/');
  check('Helmet sets X-Content-Type-Options header',
    anyPage.headers.get('x-content-type-options') === 'nosniff');
  check('Helmet sets X-Frame-Options header',
    !!anyPage.headers.get('x-frame-options'));

  summarize();
}

function summarize() {
  stopServer();
  const total = passed + failed;
  console.log(`\n${'─'.repeat(40)}`);
  if (failed === 0) {
    console.log(`\x1b[32mAll ${total} tests passed.\x1b[0m`);
  } else {
    console.log(`\x1b[31m${failed} of ${total} tests failed.\x1b[0m`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('\nUnhandled error:', e.message);
  stopServer();
  process.exit(1);
});
