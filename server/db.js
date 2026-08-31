/**
 * SQLite database initialization and helpers.
 *
 * Uses Node.js 22+ built-in `node:sqlite` module (experimental).
 * Requires the `--experimental-sqlite` flag when starting Node.
 *
 * API is nearly identical to better-sqlite3:
 *   db.exec(sql)
 *   db.prepare(sql).get(...params)
 *   db.prepare(sql).all(...params)
 *   db.prepare(sql).run(...params) → { lastInsertRowid, changes }
 */
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const db = new DatabaseSync(config.paths.db);

// Enable WAL mode and foreign keys
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/** Initialize all tables */
function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    NOT NULL UNIQUE,
      password    TEXT    NOT NULL,
      device_id   TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS locations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      latitude    REAL    NOT NULL,
      longitude   REAL    NOT NULL,
      altitude    REAL    DEFAULT 0,
      accuracy    REAL    DEFAULT 65,
      is_active   INTEGER DEFAULT 1,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      latitude    REAL    NOT NULL,
      longitude   REAL    NOT NULL,
      altitude    REAL    DEFAULT 0,
      accuracy    REAL    DEFAULT 65,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memberships (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL UNIQUE,
      is_active   INTEGER DEFAULT 0,
      device_id   TEXT,
      expire_at   TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activation_codes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT    NOT NULL UNIQUE,
      duration_days INTEGER NOT NULL,
      used_by     INTEGER,
      used_at     TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (used_by) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}

initDB();

module.exports = db;
