// Migración 010 — Aislar módulos por sistema.
// modules.system_id: INTEGER FK systems(id). Backfill todos los módulos existentes a system 1.
require('dotenv').config();
const db = require('../index');

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

console.log('► Migración 010: modules.system_id');

db.transaction(() => {
  if (!columnExists('modules', 'system_id')) {
    db.exec(`ALTER TABLE modules ADD COLUMN system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_modules_system_id ON modules(system_id)`);
    // Backfill: si existe system 1, todos los módulos van ahí.
    const sys1 = db.prepare('SELECT id FROM systems WHERE id = 1').get();
    if (sys1) {
      const r = db.prepare('UPDATE modules SET system_id = 1 WHERE system_id IS NULL').run();
      console.log(`  + modules.system_id (backfill: ${r.changes} módulos asignados a system 1)`);
    } else {
      console.log('  + modules.system_id (sin system 1 — backfill omitido)');
    }
  } else {
    console.log('  · modules.system_id ya existe');
  }
})();

console.log('✓ Migración 010 completada');
if (require.main === module) process.exit(0);
