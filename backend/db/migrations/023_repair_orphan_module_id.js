// Migración 023 — repara users.module_id NULL para los casos donde el propio
// distributor_code sigue el patrón M{número}... (ej. M3DS01, M5LD01, M12PR1).
// Antes de hoy los números de módulo eran únicos GLOBALMENTE, así que para
// estos usuarios (creados bajo esa regla) el número embebido en su código
// identifica sin ambigüedad un módulo — pero como HOY el número ya es único
// solo por sistema, se desambigua igual por system_id del propio usuario
// para estar seguros de no cruzar con un módulo de otro sistema.
//
// Solo toca roles que requieren módulo (module_leader, productive_leader,
// distributor) — lider_supremo/system_leader no lo necesitan y no se tocan.
//
// Deja un log detallado de cada reparación y de cada caso NO resuelto (sin
// patrón reconocible, o con patrón pero sin módulo real que le corresponda)
// para que se puedan reasignar a mano.
require('dotenv').config();
const db = require('../index');

const NEEDS_MODULE = ['module_leader', 'productive_leader', 'distributor'];

console.log('► Migración 023: reparar module_id huérfano vía patrón de distributor_code');

const orphans = db.prepare(`
  SELECT id, full_name, role, distributor_code, system_id
  FROM users
  WHERE module_id IS NULL AND role IN (${NEEDS_MODULE.map(() => '?').join(',')})
`).all(...NEEDS_MODULE);

const repaired = [];
const unresolvedNoPattern = [];
const unresolvedNoMatch = [];

const update = db.prepare('UPDATE users SET module_id = ? WHERE id = ?');
const findModule = db.prepare('SELECT id, number, name FROM modules WHERE number = ? AND system_id = ?');
const findModuleAnySystem = db.prepare('SELECT id, number, name, system_id FROM modules WHERE number = ?');

db.transaction(() => {
  for (const u of orphans) {
    const m = String(u.distributor_code).match(/^M(\d+)/i);
    if (!m) {
      unresolvedNoPattern.push(u);
      continue;
    }
    const number = parseInt(m[1], 10);
    let mod = u.system_id != null ? findModule.get(number, u.system_id) : null;
    if (!mod) {
      // Fallback: usuario sin system_id propio (raro, pero posible) — si hay
      // exactamente un módulo con ese número en TODA la plataforma, se usa.
      const candidates = findModuleAnySystem.all(number);
      if (candidates.length === 1) mod = candidates[0];
    }
    if (!mod) {
      unresolvedNoMatch.push({ ...u, guessed_number: number });
      continue;
    }
    update.run(mod.id, u.id);
    repaired.push({ user_id: u.id, name: u.full_name, code: u.distributor_code, role: u.role, module_id: mod.id, module_number: mod.number, module_name: mod.name });
  }
})();

console.log(`\n=== REPARADOS (${repaired.length}) ===`);
repaired.forEach((r) => console.log(`  [OK] user#${r.user_id} "${r.name}" (${r.code}, ${r.role}) -> module#${r.module_id} "M${r.module_number} - ${r.module_name}"`));

console.log(`\n=== SIN PATRÓN RECONOCIBLE EN EL CÓDIGO (${unresolvedNoPattern.length}) ===`);
unresolvedNoPattern.forEach((u) => console.log(`  [SIN PATRON] user#${u.id} "${u.full_name}" (${u.distributor_code}, ${u.role}, system_id=${u.system_id})`));

console.log(`\n=== CON PATRÓN PERO SIN MÓDULO REAL QUE COINCIDA (${unresolvedNoMatch.length}) ===`);
unresolvedNoMatch.forEach((u) => console.log(`  [SIN MATCH] user#${u.id} "${u.full_name}" (${u.distributor_code}, ${u.role}, system_id=${u.system_id}, numero_adivinado=${u.guessed_number})`));

console.log(`\n=== RESUMEN ===`);
console.log(`  huérfanos evaluados: ${orphans.length}`);
console.log(`  reparados:           ${repaired.length}`);
console.log(`  sin patrón:          ${unresolvedNoPattern.length}`);
console.log(`  con patrón sin match:${unresolvedNoMatch.length}`);

db.pragma('wal_checkpoint(TRUNCATE)');
console.log('\n✓ Migración 023 completada');
if (require.main === module) process.exit(0);
