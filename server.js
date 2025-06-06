const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle login POST
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  fs.readFile('users.json', 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading users.json:', err);
      return res.status(500).send('Server error');
    }

    const users = JSON.parse(data);

    if (users[username] && users[username] === password) {
      res.send(`<h2>Welcome, ${username}!</h2><a href="/">Back to login</a>`);
      // Later you can redirect to: res.redirect('/dashboard') or similar
    } else {
      res.send(`
        <h2>Login Failed</h2>
        <p>Invalid username or password.</p>
        <a href="/">Try again</a>
      `);
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
