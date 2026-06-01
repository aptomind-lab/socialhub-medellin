// Migración 009 — Eventos independientes por sistema.
// events.system_id: INTEGER FK systems(id). NULL = evento global (visible a todos).
require('dotenv').config();
const db = require('../index');

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

console.log('► Migración 009: events.system_id');

db.transaction(() => {
  if (!columnExists('events', 'system_id')) {
    db.exec(`ALTER TABLE events ADD COLUMN system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_events_system_id ON events(system_id)`);
    console.log('  + events.system_id (NULL = global)');
  } else {
    console.log('  · events.system_id ya existe');
  }
})();

console.log('✓ Migración 009 completada');
if (require.main === module) process.exit(0);
