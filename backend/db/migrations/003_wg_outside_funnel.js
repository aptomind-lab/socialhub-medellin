// Migración 003 — Working Group ya no es una etapa del embudo lineal.
// Guests con current_stage='WORKING_GROUP' pasan a 'PLAN_TRABAJO'.
require('dotenv').config();
const db = require('../index');

console.log('► Migración 003: WG fuera del embudo lineal');

db.transaction(() => {
  const r = db.prepare(`
    UPDATE guests SET current_stage = 'PLAN_TRABAJO', updated_at = datetime('now')
     WHERE current_stage = 'WORKING_GROUP'
  `).run();
  if (r.changes) console.log(`  ↻ ${r.changes} guests reubicados de WORKING_GROUP → PLAN_TRABAJO`);
})();

console.log('✓ Migración 003 completada');
process.exit(0);
