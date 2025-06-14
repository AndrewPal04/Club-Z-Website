const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const generatePDF = require('./generate-pdf');
const generatePDFBuffer = require('./generate-pdf');
const generateAttendancePDF = require('./generate-attendance');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
  if (users[username] && users[username] === password) {
    res.redirect('/dashboard');
  } else {
    res.send(`<h2>Login Failed</h2><a href="/">Try Again</a>`);
  }
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/timesheet', (req, res) => {
  res.sendFile(path.join(__dirname, 'timesheet.html'));
});

app.post('/submit-timesheet', (req, res) => {
  const { tutorName, month } = req.body;
  fs.writeFileSync('currentSession.json', JSON.stringify({ tutorName, month }));
  fs.writeFileSync('students.json', JSON.stringify([]));
  res.redirect('/student-form');
});

app.get('/student-form', (req, res) => {
  const students = fs.existsSync('students.json') ? JSON.parse(fs.readFileSync('students.json')) : [];
  if (students.length >= 12) {
    generatePDF().then(() => res.sendFile(path.join(__dirname, 'pdf-generated.html')));
  } else {
    res.sendFile(path.join(__dirname, 'student-hours.html'));
  }
});

app.post('/submit-student', async (req, res) => {
  const { studentFullName, inPersonHours, onlineHours } = req.body;
  const student = { name: studentFullName, inPersonHours: +inPersonHours, onlineHours: +onlineHours };
  const students = fs.existsSync('students.json') ? JSON.parse(fs.readFileSync('students.json')) : [];
  students.push(student);
  fs.writeFileSync('students.json', JSON.stringify(students, null, 2));
  if (students.length >= 12) {
    await generatePDF();
    res.sendFile(path.join(__dirname, 'pdf-generated.html'));
  } else {
    res.sendFile(path.join(__dirname, 'add-another.html'));
  }
});

app.post('/add-another', async (req, res) => {
  if (req.body.choice === 'yes') {
    res.redirect('/student-form');
  } else {
    await generatePDF();
    res.sendFile(path.join(__dirname, 'pdf-generated.html'));
  }
});

app.get('/download-pdf', async (req, res) => {
  try {
    const pdfBuffer = await generatePDFBuffer();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=Tutor_Time_Summary.pdf');
    res.send(pdfBuffer);
  } catch {
    res.status(500).send('Error generating PDF.');
  }
});

app.get('/attendance', (req, res) => {
  res.sendFile(path.join(__dirname, 'attendance-info.html'));
});

app.post('/submit-attendance-info', (req, res) => {
  fs.writeFileSync('currentAttendance.json', JSON.stringify(req.body, null, 2));
  res.redirect('/attendance-sessions');
});

app.get('/attendance-sessions', (req, res) => {
  res.sendFile(path.join(__dirname, 'attendance-sessions.html'));
});

app.post('/submit-attendance-sessions', (req, res) => {
  const entries = [];
  for (let i = 0; i < 12; i++) {
    const { [`date${i}`]: date, [`start${i}`]: start, [`end${i}`]: end, [`comments${i}`]: comments } = req.body;
    if (!date || !start || !end || !comments) continue;
    entries.push({ date, start, end, comments, online: !!req.body[`online${i}`] });
  }
  fs.writeFileSync('attendanceEntries.json', JSON.stringify(entries, null, 2));
  fs.writeFileSync('attendanceCounts.json', JSON.stringify({
    onlineCount: req.body.onlineCount,
    inPersonCount: req.body.inPersonCount
  }, null, 2));
  res.redirect('/attendance-final');
});

app.get('/attendance-final', (req, res) => {
  res.sendFile(path.join(__dirname, 'attendance-final.html'));
});

app.post('/submit-attendance-final', async (req, res) => {
  fs.writeFileSync('attendanceExtra.json', JSON.stringify(req.body, null, 2));
  await generateAttendancePDF();
  res.sendFile(path.join(__dirname, 'attendance-generated.html'));
});

app.get('/download-attendance', async (req, res) => {
  try {
    const filePath = await generateAttendancePDF();
    res.download(filePath, 'Student_Attendance_Sheet.pdf');
  } catch (err) {
    res.status(500).send('Error generating attendance PDF.');
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
