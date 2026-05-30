// Migración 007 — Gamificación (rachas, logros, XP).
require('dotenv').config();
const db = require('../index');

console.log('► Migración 007: gamification');

db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS streaks (
      user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      current_streak   INTEGER NOT NULL DEFAULT 0,
      longest_streak   INTEGER NOT NULL DEFAULT 0,
      last_active_date TEXT,
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS achievements (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_key  TEXT    NOT NULL,
      unlocked_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, achievement_key)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_achievements_user ON achievements(user_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS xp_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action_type  TEXT    NOT NULL,
      xp_earned    INTEGER NOT NULL,
      ref_type     TEXT,
      ref_id       INTEGER,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_xp_user ON xp_events(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_xp_date ON xp_events(created_at)`);
})();

console.log('✓ Migración 007 completada');
if (require.main === module) process.exit(0);
