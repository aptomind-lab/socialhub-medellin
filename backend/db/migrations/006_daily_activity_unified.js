// Migración 006 — Estructura unificada daily_activity.
// Reemplaza daily_messages como fuente única de actividad diaria:
//   messages       (mensajes tradicionales enviados)
//   books          (books generados ese día — antes en daily_messages.books_count)
//   tiktok_minutes (minutos en TikTok Live ese día)
//   tiktok_leads   (leads generados en TikTok Live ese día)
//
// Migramos los datos existentes para preservar histórico. La tabla daily_messages
// se DEJA en disco como respaldo durante esta transición — el código nuevo no la lee.
require('dotenv').config();
const db = require('../index');

console.log('► Migración 006: daily_activity unificada');

db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_activity (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date            TEXT    NOT NULL,
      messages        INTEGER NOT NULL DEFAULT 0,
      books           INTEGER NOT NULL DEFAULT 0,
      tiktok_minutes  INTEGER NOT NULL DEFAULT 0,
      tiktok_leads    INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, date)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_user ON daily_activity(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_date ON daily_activity(date)`);

  // Migrar datos existentes desde daily_messages.
  // Idempotente: si ya hay filas en daily_activity para el mismo (user_id, date), no las pisamos.
  const existing = db.prepare(`SELECT COUNT(*) AS c FROM daily_messages`).get();
  if (existing && existing.c) {
    const r = db.prepare(`
      INSERT OR IGNORE INTO daily_activity (user_id, date, messages, books, created_at)
      SELECT user_id, date, count, books_count, created_at FROM daily_messages
    `).run();
    console.log(`  ⇢ Migradas ${r.changes} filas de daily_messages → daily_activity`);
  }
})();

console.log('✓ Migración 006 completada');
if (require.main === module) process.exit(0);
