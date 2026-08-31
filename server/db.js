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
  // Clean up old multi-user tables if upgrading from v1
  db.exec(`
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS memberships;
    DROP TABLE IF EXISTS activation_codes;
  `);

  // Recreate location table (structure changed from v1 — no user_id)
  db.exec(`
    DROP TABLE IF EXISTS location;
    CREATE TABLE location (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      latitude    REAL    NOT NULL DEFAULT 39.9087,
      longitude   REAL    NOT NULL DEFAULT 116.3975,
      altitude    REAL    DEFAULT 0,
      accuracy    REAL    DEFAULT 65,
      updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO location (id) VALUES (1);

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
}

initDB();

module.exports = db;
