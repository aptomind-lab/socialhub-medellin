const db = require('../db');

function hoursSince(dateStr) {
  if (!dateStr) return Infinity;
  const last = new Date(dateStr.replace(' ', 'T') + 'Z');
  return (Date.now() - last.getTime()) / 36e5;
}

function lastMessageAt(userId) {
  const row = db.prepare(`
    SELECT MAX(created_at) AS last_at FROM daily_messages WHERE user_id = ?
  `).get(userId);
  return row ? row.last_at : null;
}

function refreshUserBlock(userId) {
  const limit = parseFloat(process.env.INACTIVITY_BLOCK_HOURS || '48');
  const u = db.prepare('SELECT created_at, role FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  // Solo aplicamos auto-bloqueo a los distribuidores (Profesionales Activos)
  if (u.role !== 'distributor') {
    db.prepare('UPDATE users SET blocked = 0 WHERE id = ?').run(userId);
    return { blocked: false, applies: false };
  }
  const last = lastMessageAt(userId);
  const reference = last || u.created_at;
  const inactive = hoursSince(reference) > limit;
  db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(inactive ? 1 : 0, userId);
  return { blocked: inactive, hoursInactive: hoursSince(reference), applies: true };
}

function refreshAllUserBlocks() {
  const users = db.prepare("SELECT id FROM users WHERE active = 1 AND role = 'distributor'").all();
  for (const u of users) refreshUserBlock(u.id);
}

function isDistributorUsable(user) {
  if (!user) return { ok: false, reason: 'NOT_FOUND' };
  if (user.role !== 'distributor') return { ok: false, reason: 'NOT_DISTRIBUTOR' };
  if (!user.active) return { ok: false, reason: 'INACTIVE' };
  if (user.blocked) return { ok: false, reason: 'BLOCKED' };
  return { ok: true };
}

// Para el flujo del landing: cualquier rol puede contactar invitados (Opción B).
// Validamos solo que esté activo y no bloqueado.
const CONTACTOR_ROLES = ['distributor', 'productive_leader', 'module_leader', 'system_leader'];
function isContactorUsable(user) {
  if (!user) return { ok: false, reason: 'NOT_FOUND' };
  if (!CONTACTOR_ROLES.includes(user.role)) return { ok: false, reason: 'INVALID_ROLE' };
  if (!user.active) return { ok: false, reason: 'INACTIVE' };
  if (user.blocked) return { ok: false, reason: 'BLOCKED' };
  return { ok: true };
}

module.exports = {
  refreshUserBlock,
  refreshAllUserBlocks,
  isDistributorUsable,
  isContactorUsable,
  CONTACTOR_ROLES,
  hoursSince,
};
