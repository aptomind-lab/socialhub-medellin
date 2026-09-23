// Migración 022 — tabla login_tokens: auto-login de un solo uso para el link
// "Ingresar a la plataforma" del correo de bienvenida a usuarios nuevos.
require('dotenv').config();
const db = require('../index');

console.log('► Migración 022: login_tokens');

db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token       TEXT    NOT NULL UNIQUE,
      expires_at  TEXT    NOT NULL,
      used_at     TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_logintoken_token ON login_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_logintoken_user  ON login_tokens(user_id);
  `);
  console.log('  + tabla login_tokens');
})();

db.pragma('wal_checkpoint(TRUNCATE)');
console.log('✓ Migración 022 completada');
if (require.main === module) process.exit(0);
