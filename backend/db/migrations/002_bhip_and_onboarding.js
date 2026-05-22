// Migración 002 — Rangos BHIP, onboarding obligatorio y first-login.
require('dotenv').config();
const db = require('../index');

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
function addColumn(table, column, def) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    console.log(`  + ${table}.${column}`);
  }
}

console.log('► Migración 002: BHIP + onboarding');

db.transaction(() => {
  // bhip_rank — uno de los 11 rangos. Default 'Profesional' (rango más bajo).
  addColumn('users', 'bhip_rank',             "TEXT NOT NULL DEFAULT 'Profesional'");
  // password_must_change — true cuando admin crea usuario con pwd genérica
  addColumn('users', 'password_must_change',  "INTEGER NOT NULL DEFAULT 0");
  // profile_completed — true cuando ya completó nombre+celular+pwd propia
  addColumn('users', 'profile_completed',     "INTEGER NOT NULL DEFAULT 1");

  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_rank ON users(bhip_rank)`);

  // Usuarios existentes ya tienen perfil completo (vinieron del seed o se firmaron)
  db.prepare(`UPDATE users SET profile_completed = 1, password_must_change = 0 WHERE password_hash IS NOT NULL AND password_hash != ''`).run();

  // Líderes de Sistema fundadores → Diamante Negro
  const jcm = db.prepare(`UPDATE users SET bhip_rank = 'Diamante Negro' WHERE distributor_code = '1340'`).run();
  if (jcm.changes) console.log("  ↻ JCM (1340) → Diamante Negro");
  const fb  = db.prepare(`UPDATE users SET bhip_rank = 'Diamante Negro' WHERE role = 'system_leader' AND distributor_code != '1340'`).run();
  if (fb.changes)  console.log(`  ↻ Otros system_leaders → Diamante Negro (${fb.changes})`);

  console.log('✓ Migración 002 completada');
})();

process.exit(0);
