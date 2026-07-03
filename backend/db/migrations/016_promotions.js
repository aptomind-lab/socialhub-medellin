require('dotenv').config();
const db = require('../index');
const { localDate } = require('../../utils/tz');

console.log('► Migración 016: promotions & promotion_cycles');

db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS promotion_cycles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      start_date  TEXT    NOT NULL,
      end_date    TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS promotions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cycle_id      INTEGER NOT NULL REFERENCES promotion_cycles(id) ON DELETE CASCADE,
      bv_personal   INTEGER NOT NULL,
      order_number  TEXT    NOT NULL,
      date          TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_promotions_cycle ON promotions(cycle_id);
    CREATE INDEX IF NOT EXISTS idx_promotions_user  ON promotions(user_id);
    CREATE INDEX IF NOT EXISTS idx_promotions_bv    ON promotions(bv_personal);
  `);
  console.log('  + tablas promotion_cycles, promotions');

  const existing = db.prepare('SELECT COUNT(*) AS c FROM promotion_cycles').get().c;
  if (existing === 0) {
    const start = localDate();
    db.prepare('INSERT INTO promotion_cycles (start_date, end_date) VALUES (?, ?)').run(start, '2026-08-04');
    console.log(`  + ciclo inicial ${start} → 2026-08-04`);
  } else {
    console.log(`  = ${existing} ciclo(s) ya presentes — no re-seed`);
  }
})();

console.log('✓');
if (require.main === module) process.exit(0);
