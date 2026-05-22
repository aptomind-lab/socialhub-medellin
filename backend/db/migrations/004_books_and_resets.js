// Migración 004 — Books diarios + recuperación de contraseña.
require('dotenv').config();
const db = require('../index');

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

console.log('► Migración 004: books_count + password_resets');

db.transaction(() => {
  // 1. daily_messages.books_count
  if (!columnExists('daily_messages', 'books_count')) {
    db.exec(`ALTER TABLE daily_messages ADD COLUMN books_count INTEGER NOT NULL DEFAULT 0`);
    console.log('  + daily_messages.books_count');
  }

  // 2. tabla password_resets
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token       TEXT    NOT NULL UNIQUE,
      expires_at  TEXT    NOT NULL,
      used_at     TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pwreset_token ON password_resets(token)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pwreset_user  ON password_resets(user_id)`);
  console.log('  + tabla password_resets');
})();

console.log('✓ Migración 004 completada');
process.exit(0);
