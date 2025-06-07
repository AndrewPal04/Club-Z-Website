const generatePDFBuffer = require('./generate-pdf');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const generatePDF = require('./generate-pdf'); // PDF generator
const app = express();
const PORT = process.env.PORT || 3000;


app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  fs.readFile('users.json', 'utf8', (err, data) => {
    if (err) {
      res.status(500).send('Server error');
      return;
    }

    const users = JSON.parse(data);

    if (users[username] && users[username] === password) {
      res.redirect('/dashboard');
    } else {
      res.send(`
        <h2>Login Failed</h2>
        <p>Invalid username or password.</p>
        <a href="/">Try Again</a>
      `);
    }
  });
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
  fs.writeFileSync('students.json', JSON.stringify([])); // Reset students
  res.redirect('/student-form');
});

app.get('/student-form', (req, res) => {
  let students = [];
  if (fs.existsSync('students.json')) {
    students = JSON.parse(fs.readFileSync('students.json'));
  }

  if (students.length >= 12) {
    generatePDF().then(() => {
      res.sendFile(path.join(__dirname, 'pdf-generated.html'));
    });
  } else {
    res.sendFile(path.join(__dirname, 'student-hours.html'));
  }
});

app.post('/submit-student', async (req, res) => {
  const { studentFullName, inPersonHours, onlineHours } = req.body;

  const student = {
    name: studentFullName,
    inPersonHours: Number(inPersonHours),
    onlineHours: Number(onlineHours)
  };

  let students = [];
  if (fs.existsSync('students.json')) {
    students = JSON.parse(fs.readFileSync('students.json'));
  }

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
  const { choice } = req.body;

  if (choice === 'yes') {
    res.redirect('/student-form');
  } else {
    await generatePDF();
    res.sendFile(path.join(__dirname, 'pdf-generated.html'));
  }
});

app.get('/attendance', (req, res) => {
  res.send('<h2>Attendance Sheet Form Coming Soon!</h2>');
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
app.get('/download-pdf', async (req, res) => {
  try {
    const pdfBuffer = await generatePDFBuffer();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=Tutor_Time_Summary.pdf');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).send('Error generating PDF.');
  }
});
