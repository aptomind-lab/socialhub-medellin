require('dotenv').config();
const db = require('../index');
function colExists(t, c) { return db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c); }
console.log('► Migración 014: events.wg_session');
db.transaction(() => {
  if (!colExists('events', 'wg_session')) {
    db.exec(`ALTER TABLE events ADD COLUMN wg_session INTEGER`);
    console.log('  + events.wg_session');
  }
  // Backfill: parsear nombres "W1".."W9", "WG 1".."WG 9", "PT / WG 1".
  // PLAN_TRABAJO también recibe sesión = 1 cuando el nombre lo sugiere.
  const evs = db.prepare(`SELECT id, name, stage_target FROM events
                          WHERE stage_target IN ('WORKING_GROUP','PLAN_TRABAJO') AND wg_session IS NULL`).all();
  const upd = db.prepare('UPDATE events SET wg_session = ? WHERE id = ?');
  let n = 0;
  for (const ev of evs) {
    const m = String(ev.name || '').match(/(?:W|WG)\s*0*(\d)/i);
    if (m) { upd.run(parseInt(m[1], 10), ev.id); n++; }
  }
  console.log(`  + backfill: ${n} eventos`);
})();
console.log('✓');
if (require.main === module) process.exit(0);
