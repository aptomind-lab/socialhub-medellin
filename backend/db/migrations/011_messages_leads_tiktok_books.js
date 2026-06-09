// Migración 011 — Campos adicionales en daily_activity.
//   messages_leads: leads generados por mensajes tradicionales (Tipo A)
//   tiktok_books:   books cerrados por TikTok Live (Tipo B)
require('dotenv').config();
const db = require('../index');

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

console.log('► Migración 011: messages_leads + tiktok_books');
db.transaction(() => {
  if (!columnExists('daily_activity', 'messages_leads')) {
    db.exec(`ALTER TABLE daily_activity ADD COLUMN messages_leads INTEGER NOT NULL DEFAULT 0`);
    console.log('  + messages_leads');
  }
  if (!columnExists('daily_activity', 'tiktok_books')) {
    db.exec(`ALTER TABLE daily_activity ADD COLUMN tiktok_books INTEGER NOT NULL DEFAULT 0`);
    console.log('  + tiktok_books');
  }
})();
console.log('✓ Migración 011 completada');
if (require.main === module) process.exit(0);
