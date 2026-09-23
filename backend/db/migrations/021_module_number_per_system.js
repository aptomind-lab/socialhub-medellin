// Migración 021 — modules.number pasa de único global a único por sistema.
// SQLite no permite ALTER de una constraint UNIQUE existente: recreamos la
// tabla con UNIQUE(system_id, number) en vez de UNIQUE(number).
// Nota: SQLite trata NULL != NULL en constraints UNIQUE, así que dos módulos
// con system_id NULL con el mismo number no quedarían bloqueados solo por
// esto — el backend valida ese caso también a nivel de aplicación.
require('dotenv').config();
const db = require('../index');

function hasCompositeUnique() {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'modules'`).get();
  return !!row && /UNIQUE\s*\(\s*system_id\s*,\s*number\s*\)/i.test(row.sql);
}

console.log('► Migración 021: modules.number único por sistema (no global)');

db.transaction(() => {
  if (hasCompositeUnique()) {
    console.log('  · modules ya tiene UNIQUE(system_id, number) — saltando recreación');
    return;
  }

  db.exec(`PRAGMA foreign_keys = OFF`);

  db.exec(`
    CREATE TABLE modules_new (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      number       INTEGER NOT NULL,
      name         TEXT    NOT NULL,
      active       INTEGER NOT NULL DEFAULT 1,
      system_id    INTEGER REFERENCES systems(id) ON DELETE SET NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(system_id, number)
    )
  `);

  db.exec(`
    INSERT INTO modules_new (id, number, name, active, system_id, created_at)
    SELECT id, number, name, active, system_id, created_at FROM modules
  `);

  db.exec(`DROP TABLE modules`);
  db.exec(`ALTER TABLE modules_new RENAME TO modules`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_modules_system_id ON modules(system_id)`);

  db.exec(`PRAGMA foreign_keys = ON`);
  console.log('  ↻ modules recreado con UNIQUE(system_id, number)');
})();

// Vuelca el WAL al archivo principal antes de salir — este script corre como
// proceso de un solo uso; sin este checkpoint explícito, un DROP TABLE/rename
// recién commiteado puede quedar solo en el -wal y perderse si algo borra
// esos archivos antes del próximo checkpoint natural.
db.pragma('wal_checkpoint(TRUNCATE)');

console.log('✓ Migración 021 completada');
if (require.main === module) process.exit(0);
