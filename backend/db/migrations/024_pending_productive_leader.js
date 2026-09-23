// Migración 024 — users.pending_productive_leader_name.
// Cuando se registra un nuevo profesional y su líder productivo real todavía
// no está en el sistema, se guarda el module_id pero productive_leader_id
// queda NULL a propósito — el nombre escrito a mano queda acá como pista para
// que lider_modulo/lider_sistema lo asignen bien después desde Usuarios.
require('dotenv').config();
const db = require('../index');

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

console.log('► Migración 024: users.pending_productive_leader_name');

db.transaction(() => {
  if (!columnExists('users', 'pending_productive_leader_name')) {
    db.exec(`ALTER TABLE users ADD COLUMN pending_productive_leader_name TEXT`);
    console.log('  + users.pending_productive_leader_name');
  } else {
    console.log('  · ya existía');
  }
})();

db.pragma('wal_checkpoint(TRUNCATE)');
console.log('✓ Migración 024 completada');
if (require.main === module) process.exit(0);
