require('dotenv').config();
const db = require('../index');
function colExists(t,c){return db.prepare(`PRAGMA table_info(${t})`).all().some(x=>x.name===c);}
console.log('► Migración 013: stage_history.amount');
db.transaction(()=>{
  if(!colExists('stage_history','amount')){
    db.exec(`ALTER TABLE stage_history ADD COLUMN amount REAL`);
    console.log('  + stage_history.amount');
  }
})();
console.log('✓');
if(require.main===module)process.exit(0);
