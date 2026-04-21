const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'clubz.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS timesheet_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    tutor_name TEXT NOT NULL,
    month TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'draft'
  );

  CREATE TABLE IF NOT EXISTS timesheet_students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    student_name TEXT NOT NULL,
    in_person_hours REAL NOT NULL,
    online_hours REAL NOT NULL,
    FOREIGN KEY (session_id) REFERENCES timesheet_sessions(id)
  );

  CREATE TABLE IF NOT EXISTS attendance_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    student_name TEXT NOT NULL,
    tutor_name TEXT NOT NULL,
    month TEXT NOT NULL,
    subjects TEXT NOT NULL,
    grade TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'draft'
  );

  CREATE TABLE IF NOT EXISTS attendance_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    comments TEXT,
    is_online INTEGER DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES attendance_sessions(id)
  );

  CREATE TABLE IF NOT EXISTS attendance_extra (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL UNIQUE,
    progress_notes TEXT,
    review_date TEXT,
    online_count INTEGER DEFAULT 0,
    in_person_count INTEGER DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES attendance_sessions(id)
  );
`);

// Migrate users from users.json if the table is empty
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
if (userCount.count === 0) {
  const usersPath = path.join(__dirname, 'users.json');
  if (fs.existsSync(usersPath)) {
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    const insertUser = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    for (const [username, password] of Object.entries(users)) {
      const hash = bcrypt.hashSync(password, 10);
      insertUser.run(username, hash);
    }
    console.log('Migrated users from users.json to SQLite');
  }
}

module.exports = db;
