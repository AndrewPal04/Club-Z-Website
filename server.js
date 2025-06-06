const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public')); // Serves ClubZ Logo.jpg and other static files

// Serve login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle login form POST
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  fs.readFile('users.json', 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading users.json:', err);
      return res.status(500).send('Server error');
    }

    const users = JSON.parse(data);

    if (users[username] && users[username] === password) {
      // Successful login, redirect to dashboard
      res.redirect('/dashboard');
    } else {
      // Failed login
      res.send(`
        <h2>Login Failed</h2>
        <p>Invalid username or password.</p>
        <a href="/">Try Again</a>
      `);
    }
  });
});

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Placeholder route for timesheet
app.get('/timesheet', (req, res) => {
  res.send('<h2>Time Sheet Form Coming Soon!</h2>');
});

// Placeholder route for attendance
app.get('/attendance', (req, res) => {
  res.send('<h2>Attendance Sheet Form Coming Soon!</h2>');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
