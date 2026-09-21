// Migración 019 — Nueva promoción "LIFE STYLE DAY CARTAGENA".
// Reemplaza el ciclo mensual de BV por una única campaña larga:
//   2026-09-01 → 2027-04-30, con TODOS los usuarios de la plataforma compitiendo.
// Es retroactiva a septiembre 2026: los registros con fecha >= 2026-09-01 que
// estaban en ciclos mensuales viejos se reasignan a la nueva campaña.
require('dotenv').config();
const db = require('../index');

const PROMO_NAME  = 'LIFE STYLE DAY CARTAGENA';
const PROMO_START = '2026-09-01';
const PROMO_END   = '2027-04-30';

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

console.log('► Migración 019: LIFE STYLE DAY CARTAGENA');

db.transaction(() => {
  if (!columnExists('promotion_cycles', 'name')) {
    db.exec(`ALTER TABLE promotion_cycles ADD COLUMN name TEXT`);
    db.prepare(`UPDATE promotion_cycles SET name = 'Ciclo BV mensual' WHERE name IS NULL`).run();
    console.log('  + promotion_cycles.name');
  } else {
    console.log('  · promotion_cycles.name ya existía');
  }

  let cycle = db.prepare('SELECT * FROM promotion_cycles WHERE name = ?').get(PROMO_NAME);
  if (!cycle) {
    const info = db.prepare(`
      INSERT INTO promotion_cycles (name, start_date, end_date) VALUES (?, ?, ?)
    `).run(PROMO_NAME, PROMO_START, PROMO_END);
    cycle = db.prepare('SELECT * FROM promotion_cycles WHERE id = ?').get(info.lastInsertRowid);
    console.log(`  + ciclo "${PROMO_NAME}" ${PROMO_START} → ${PROMO_END} (id ${cycle.id})`);
  } else {
    db.prepare('UPDATE promotion_cycles SET start_date = ?, end_date = ? WHERE id = ?')
      .run(PROMO_START, PROMO_END, cycle.id);
    console.log(`  = ciclo "${PROMO_NAME}" ya existía (id ${cycle.id}) — fechas sincronizadas`);
  }

  // Retroactivo: todo registro de sept-2026 en adelante pertenece a la nueva campaña.
  const moved = db.prepare(`
    UPDATE promotions SET cycle_id = ?
    WHERE cycle_id != ? AND date >= ? AND date <= ?
  `).run(cycle.id, cycle.id, PROMO_START, PROMO_END);
  console.log(`  ↻ ${moved.changes} registro(s) reasignado(s) a la nueva campaña`);
})();

console.log('✓ Migración 019 completada');
if (require.main === module) process.exit(0);
