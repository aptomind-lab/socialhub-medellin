require('dotenv').config();
const db = require('../index');

console.log('► Migración 017: lider_modulo/lider_sistema/lider_supremo también actúan como lider_productivo (mesa propia)');

// RETROACTIVO: profesionales (users.role='distributor') que fueron firmados a
// partir de un invitado cuyo contactador (firmado_por) era un lider_modulo,
// lider_sistema o lider_supremo, pero que quedaron SIN mesa asignada porque el
// flujo de firma anterior no reconocía a estos roles como dueños de mesa propia
// (solo caía en su productive_leader_id, que para ellos siempre es NULL).
// Los invitados aún sin firmar NO necesitan tocarse: su mesa se resuelve en
// tiempo real vía guests.distributor_id (que ya apunta directo al contactador).
db.transaction(() => {
  const affected = db.prepare(`
    SELECT u.id, u.full_name, fp.full_name AS firmado_por_name, fp.role AS firmado_por_role
    FROM users u
    JOIN users fp ON fp.id = u.firmado_por
    WHERE u.role = 'distributor'
      AND u.productive_leader_id IS NULL
      AND fp.role IN ('module_leader', 'system_leader', 'lider_supremo')
  `).all();

  if (!affected.length) {
    console.log('  = 0 profesionales para corregir — nada que migrar');
  } else {
    const update = db.prepare(`
      UPDATE users SET productive_leader_id = firmado_por
      WHERE role = 'distributor' AND productive_leader_id IS NULL
        AND firmado_por IN (
          SELECT id FROM users WHERE role IN ('module_leader', 'system_leader', 'lider_supremo')
        )
    `);
    const info = update.run();
    console.log(`  + ${info.changes} profesional(es) reasignado(s) a la mesa de su contactador:`);
    affected.forEach((r) => console.log(`    · ${r.full_name} → mesa de ${r.firmado_por_name} (${r.firmado_por_role})`));
  }
})();

console.log('✓');
if (require.main === module) process.exit(0);
