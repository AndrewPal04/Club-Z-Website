const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

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
  fs.writeFileSync('students.json', JSON.stringify([]));
  res.redirect('/student-form');
});

app.get('/student-form', (req, res) => {
  let students = [];
  if (fs.existsSync('students.json')) {
    students = JSON.parse(fs.readFileSync('students.json'));
  }

  if (students.length >= 12) {
    res.send('<h2>Maximum of 12 students reached.</h2><a href="/dashboard">Back to Dashboard</a>');
  } else {
    res.sendFile(path.join(__dirname, 'student-hours.html'));
  }
});

app.post('/submit-student', (req, res) => {
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
    res.send('<h2>Maximum of 12 students reached.</h2><a href="/dashboard">Back to Dashboard</a>');
  } else {
    res.sendFile(path.join(__dirname, 'add-another.html'));
  }
});

app.post('/add-another', (req, res) => {
  const { choice } = req.body;

  if (choice === 'yes') {
    res.redirect('/student-form');
  } else {
    res.send('<h2>Student data saved. Ready for PDF generation or final steps.</h2><a href="/dashboard">Back to Dashboard</a>');
  }
});

app.get('/attendance', (req, res) => {
  res.send('<h2>Attendance Sheet Form Coming Soon!</h2>');
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
