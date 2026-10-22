const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

// Vercel's filesystem is read-only except /tmp, so the database lives there in production.
const defaultPath = process.env.VERCEL ? '/tmp/lakeside.db' : path.join(__dirname, 'lakeside.db');
const databasePath = process.env.DB_PATH || defaultPath;
if (databasePath !== ':memory:') {
  mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
}

const db = new DatabaseSync(databasePath);
db.exec(`
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    specialty TEXT NOT NULL,
    doctor TEXT NOT NULL,
    appointmentDateTime TEXT NOT NULL,
    patientName TEXT NOT NULL,
    patientPhone TEXT NOT NULL,
    patientEmail TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Booked',
    createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
`);

module.exports = db;
