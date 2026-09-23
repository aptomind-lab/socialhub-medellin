// Migración 020 — promotions.bv_type ('general' | 'personal').
// Distingue el BV general del "BV Personal" dentro del mismo registro de
// promociones. Ambos tipos suman al mismo pool (Top 80 y 100 BV Sorteo ya
// suman bv_personal sin filtrar por tipo) — bv_type solo existe para poder
// distinguirlos visualmente en el historial del usuario.
require('dotenv').config();
const db = require('../index');

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

console.log('► Migración 020: promotions.bv_type');

db.transaction(() => {
  if (!columnExists('promotions', 'bv_type')) {
    db.exec(`ALTER TABLE promotions ADD COLUMN bv_type TEXT NOT NULL DEFAULT 'general'`);
    console.log('  + promotions.bv_type (default \'general\')');
  } else {
    console.log('  · promotions.bv_type ya existía');
  }
})();

console.log('✓ Migración 020 completada');
if (require.main === module) process.exit(0);
