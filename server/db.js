/**
 * SQLite database for personal single-user mode.
 *
 * No users, no auth — just location settings and favorites.
 * Uses Node.js 22+ built-in `node:sqlite` (--experimental-sqlite).
 */
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const db = new DatabaseSync(config.paths.db);

db.exec('PRAGMA foreign_keys = ON');

function initDB() {
  // Clean up old multi-user tables if upgrading from v1 (harmless if absent)
  db.exec(`
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS memberships;
    DROP TABLE IF EXISTS activation_codes;
  `);

  // Create tables only if missing — never drop, so saved data survives restarts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS location (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      latitude    REAL    NOT NULL DEFAULT 39.9087,
      longitude   REAL    NOT NULL DEFAULT 116.3975,
      altitude    REAL    DEFAULT 0,
      accuracy    REAL    DEFAULT 65,
      updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      latitude    REAL    NOT NULL,
      longitude   REAL    NOT NULL,
      altitude    REAL    DEFAULT 0,
      accuracy    REAL    DEFAULT 65,
      created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed the single location row once; keep it untouched on later starts.
  db.exec('INSERT OR IGNORE INTO location (id) VALUES (1)');
}

initDB();

module.exports = db;
