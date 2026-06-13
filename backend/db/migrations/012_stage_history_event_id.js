require('dotenv').config();
const db = require('../index');
function colExists(t,c){return db.prepare(`PRAGMA table_info(${t})`).all().some(x=>x.name===c);}
console.log('► Migración 012: stage_history.event_id');
db.transaction(()=>{
  if(!colExists('stage_history','event_id')){
    db.exec(`ALTER TABLE stage_history ADD COLUMN event_id INTEGER REFERENCES events(id) ON DELETE SET NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_history_event ON stage_history(event_id)`);
    console.log('  + stage_history.event_id');
  }
})();
console.log('✓');
if(require.main===module)process.exit(0);
