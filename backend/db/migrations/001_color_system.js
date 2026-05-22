// Migración 001 — Sistema de colores de seguimiento + ajustes asociados.
// No destructiva: usa ALTER TABLE y backfill desde stage_history.
// Idempotente: detecta columnas existentes antes de crearlas.
require('dotenv').config();
const db = require('../index');

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function addColumnIfMissing(table, column, definition) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`  + ${table}.${column}`);
  }
}

console.log('► Migración 001: sistema de colores');

db.transaction(() => {
  // ── guests: campos de color y fechas clave ──
  // color valores: 'none' | 'light_green' | 'strong_green' | 'yellow' | 'orange' | 'red' | 'black'
  addColumnIfMissing('guests', 'color',          "TEXT NOT NULL DEFAULT 'none'");
  addColumnIfMissing('guests', 'color_set_at',   "TEXT");
  addColumnIfMissing('guests', 'color_set_by',   "INTEGER REFERENCES users(id) ON DELETE SET NULL");
  addColumnIfMissing('guests', 'color_manual',   "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing('guests', 'bit_date',       "TEXT");
  addColumnIfMissing('guests', 'power_talk_date',"TEXT");
  addColumnIfMissing('guests', 'signed_month',   "TEXT"); // 'YYYY-MM'

  // ── users: sponsor (quien lo contactó) ──
  addColumnIfMissing('users', 'sponsor_id', "INTEGER REFERENCES users(id) ON DELETE SET NULL");

  // ── Índices nuevos ──
  db.exec(`CREATE INDEX IF NOT EXISTS idx_guests_color        ON guests(color)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_guests_signed_month ON guests(signed_month)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_sponsor       ON users(sponsor_id)`);

  // ── Cambio de código JCM001 → 1340 ──
  const jcm = db.prepare(`SELECT id, distributor_code FROM users WHERE distributor_code = 'JCM001'`).get();
  if (jcm) {
    db.prepare(`UPDATE users SET distributor_code = '1340' WHERE id = ?`).run(jcm.id);
    console.log("  ↻ JCM001 → 1340 (Juan Carlos Medellín)");
  }

  // ── Backfill bit_date / power_talk_date desde stage_history ──
  const fillBit = db.prepare(`
    UPDATE guests SET bit_date = (
      SELECT date(MIN(h.scanned_at)) FROM stage_history h
      WHERE h.guest_id = guests.id AND h.to_stage = 'BIT'
    )
    WHERE bit_date IS NULL
  `).run();
  if (fillBit.changes) console.log(`  ⇢ bit_date backfilled: ${fillBit.changes}`);

  const fillPt = db.prepare(`
    UPDATE guests SET power_talk_date = (
      SELECT date(MIN(h.scanned_at)) FROM stage_history h
      WHERE h.guest_id = guests.id AND h.to_stage = 'POWER_TALK'
    )
    WHERE power_talk_date IS NULL
  `).run();
  if (fillPt.changes) console.log(`  ⇢ power_talk_date backfilled: ${fillPt.changes}`);

  // ── Backfill signed_month para FIRMADOS existentes ──
  const fillSm = db.prepare(`
    UPDATE guests SET signed_month = substr(date(signed_at), 1, 7)
    WHERE current_stage = 'FIRMADO' AND signed_at IS NOT NULL AND signed_month IS NULL
  `).run();
  if (fillSm.changes) console.log(`  ⇢ signed_month backfilled: ${fillSm.changes}`);

  console.log('✓ Migración 001 completada');
})();

// Recalcular colores iniciales (fuera de la transacción para que utils/colors vea los cambios)
try {
  const colors = require('../../utils/colors');
  const refreshed = colors.runDailyColorRefresh();
  console.log(`✓ Colores iniciales calculados (${refreshed} guests actualizados)`);
  const blacked = colors.applyMonthlyBlackTransition();
  if (blacked) console.log(`✓ Color negro aplicado a ${blacked} firmados de meses pasados`);
} catch (err) {
  console.warn('⚠ utils/colors aún no disponible:', err.message);
}

process.exit(0);
