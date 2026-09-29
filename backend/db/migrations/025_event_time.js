// Migración 025 — events.event_time: hora real del evento (HH:MM, 24h),
// para mostrar "Jueves 25 Sep · 7:00 PM" en vez de solo la fecha, y para
// poder ocultar la ocurrencia de HOY una vez que ya pasó esa hora.
// Nullable — no toca eventos existentes, todos quedan en NULL hasta que se
// edite cada uno desde Eventos.
require('dotenv').config();
const db = require('../index');

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

console.log('► Migración 025: events.event_time');

db.transaction(() => {
  if (!columnExists('events', 'event_time')) {
    db.exec(`ALTER TABLE events ADD COLUMN event_time TEXT`);
    console.log('  + events.event_time');
  } else {
    console.log('  · ya existía');
  }
})();

db.pragma('wal_checkpoint(TRUNCATE)');
console.log('✓ Migración 025 completada');
if (require.main === module) process.exit(0);
