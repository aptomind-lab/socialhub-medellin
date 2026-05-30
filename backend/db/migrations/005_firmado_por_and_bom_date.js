// Migración 005 — Renombra sponsor_id → firmado_por + agrega guests.bom_assigned_date.
require('dotenv').config();
const db = require('../index');

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

console.log('► Migración 005: firmado_por + bom_assigned_date');

db.transaction(() => {
  // 1. Renombrar users.sponsor_id → users.firmado_por (SQLite 3.25+ soporta RENAME COLUMN).
  if (columnExists('users', 'sponsor_id') && !columnExists('users', 'firmado_por')) {
    db.exec(`ALTER TABLE users RENAME COLUMN sponsor_id TO firmado_por`);
    db.exec(`DROP INDEX IF EXISTS idx_users_sponsor`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_users_firmado_por ON users(firmado_por)`);
    console.log('  ↻ users.sponsor_id → firmado_por (índice recreado)');
  } else if (columnExists('users', 'firmado_por')) {
    console.log('  · users.firmado_por ya existía');
  }

  // 2. guests.bom_assigned_date — fecha del B.O.M al que el invitado fue asignado al registrarse.
  if (!columnExists('guests', 'bom_assigned_date')) {
    db.exec(`ALTER TABLE guests ADD COLUMN bom_assigned_date TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_guests_bom_date ON guests(bom_assigned_date)`);
    console.log('  + guests.bom_assigned_date');
  } else {
    console.log('  · guests.bom_assigned_date ya existía');
  }
})();

console.log('✓ Migración 005 completada');
if (require.main === module) process.exit(0);
