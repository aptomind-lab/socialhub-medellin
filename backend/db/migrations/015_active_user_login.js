require('dotenv').config();
const db = require('../index');
function colExists(t, c) { return db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c); }
console.log('► Migración 015: users.active (login permitido, UI bloqueada)');
db.transaction(() => {
  if (!colExists('users', 'active')) {
    db.exec(`ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
    console.log('  + users.active');
  } else {
    console.log('  = users.active ya existe — semántica cambia: active=0 permite login y muestra overlay UI');
  }
  const nulls = db.prepare(`UPDATE users SET active = 1 WHERE active IS NULL`).run().changes;
  if (nulls) console.log(`  + backfill: ${nulls} fila(s) NULL → 1`);
})();
console.log('✓');
if (require.main === module) process.exit(0);
