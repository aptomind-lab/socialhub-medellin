// Migración 026 — user_roles: roles múltiples simultáneos por usuario.
// El campo users.role se mantiene como "rol principal" (de donde salen los
// permisos — el más alto). user_roles es puramente aditivo: guarda TODOS los
// roles que un usuario ha tenido/tiene, empezando por un backfill del rol
// actual de cada usuario, para que listados/selectores por rol puedan incluir
// también a quien tiene ese rol de forma secundaria.
// No toca users ni ningún otro dato existente.
require('dotenv').config();
const db = require('../index');

function tableExists(name) {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

console.log('► Migración 026: user_roles');

db.transaction(() => {
  if (!tableExists('user_roles')) {
    db.exec(`
      CREATE TABLE user_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        created_by INTEGER,
        UNIQUE(user_id, role)
      )
    `);
    db.exec(`CREATE INDEX idx_user_roles_user ON user_roles(user_id)`);
    db.exec(`CREATE INDEX idx_user_roles_role ON user_roles(role)`);
    console.log('  + tabla user_roles creada');
  } else {
    console.log('  · tabla user_roles ya existía');
  }

  const insertBackfill = db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)`);
  const users = db.prepare('SELECT id, role FROM users').all();
  let backfilled = 0;
  for (const u of users) {
    const info = insertBackfill.run(u.id, u.role);
    if (info.changes) backfilled++;
  }
  console.log(`  + backfill: ${backfilled} filas (rol principal actual de cada usuario)`);
})();

db.pragma('wal_checkpoint(TRUNCATE)');
console.log('✓ Migración 026 completada');
if (require.main === module) process.exit(0);
