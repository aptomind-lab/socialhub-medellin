// Migración 018 — Agrega guests.bit_assigned_date + stage_history.bit_assigned_date.
// Fecha del B.I.T al que el invitado se compromete a asistir, elegida por el líder
// al escanear Boleto Pago/Abonado/No Pago (ver /api/events/next-bit-dates).
require('dotenv').config();
const db = require('../index');

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

console.log('► Migración 018: bit_assigned_date');

db.transaction(() => {
  if (!columnExists('guests', 'bit_assigned_date')) {
    db.exec(`ALTER TABLE guests ADD COLUMN bit_assigned_date TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_guests_bit_assigned ON guests(bit_assigned_date)`);
    console.log('  + guests.bit_assigned_date');
  } else {
    console.log('  · guests.bit_assigned_date ya existía');
  }

  if (!columnExists('stage_history', 'bit_assigned_date')) {
    db.exec(`ALTER TABLE stage_history ADD COLUMN bit_assigned_date TEXT`);
    console.log('  + stage_history.bit_assigned_date');
  } else {
    console.log('  · stage_history.bit_assigned_date ya existía');
  }
})();

console.log('✓ Migración 018 completada');
if (require.main === module) process.exit(0);
