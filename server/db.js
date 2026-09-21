/**
 * SQLite database for personal single-user mode.
 *
 * The web layer provides single-user Basic Auth; the database stores only
 * location settings and favorites.
 * Uses Node.js 22+ built-in `node:sqlite` (--experimental-sqlite).
 */
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const db = new DatabaseSync(config.paths.db);

db.exec('PRAGMA foreign_keys = ON');

function initDB() {
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

    -- The two range endpoints whose connecting segment is the circle's
    -- diameter. Coordinates are snapshotted from the favourite so the range
    -- keeps working after that favourite is deleted.
    CREATE TABLE IF NOT EXISTS random_range (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      a_name      TEXT,
      a_latitude  REAL,
      a_longitude REAL,
      b_name      TEXT,
      b_latitude  REAL,
      b_longitude REAL,
      updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed the single-row tables once; keep them untouched on later starts.
  db.exec('INSERT OR IGNORE INTO location (id) VALUES (1)');
  db.exec('INSERT OR IGNORE INTO random_range (id) VALUES (1)');
}

initDB();

module.exports = db;
