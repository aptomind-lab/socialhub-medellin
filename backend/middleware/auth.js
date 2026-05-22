const jwt = require('jsonwebtoken');
const db = require('../db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Refrescar el usuario desde DB para tener role/scope al día
    const user = db.prepare(`
      SELECT id, full_name, distributor_code, role, module_id, productive_leader_id, active,
             password_must_change, profile_completed, bhip_rank, phone, email
      FROM users WHERE id = ?
    `).get(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Usuario no disponible' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Bloquea cualquier endpoint protegido si el perfil no está completo o si la pwd debe cambiarse.
// Aplica DESPUÉS de requireAuth. Las rutas de auth (/me, /complete-profile, /change-password)
// quedan exentas en server.js.
function requireOnboarded(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  if (!req.user.profile_completed || req.user.password_must_change) {
    return res.status(428).json({
      error: 'Perfil incompleto',
      profile_completed: !!req.user.profile_completed,
      password_must_change: !!req.user.password_must_change,
    });
  }
  next();
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' });
    }
    next();
  };
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, code: user.distributor_code },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

// Devuelve un objeto con los IDs de usuarios visibles para el actor según jerarquía.
// Útil para queries: WHERE user_id IN (visibleUserIds)
function visibleUserIds(actor) {
  if (actor.role === 'system_leader') {
    return db.prepare('SELECT id FROM users').all().map((r) => r.id);
  }
  if (actor.role === 'module_leader') {
    return db.prepare('SELECT id FROM users WHERE module_id = ? OR id = ?')
      .all(actor.module_id, actor.id).map((r) => r.id);
  }
  if (actor.role === 'productive_leader') {
    return db.prepare('SELECT id FROM users WHERE productive_leader_id = ? OR id = ?')
      .all(actor.id, actor.id).map((r) => r.id);
  }
  // distributor
  return [actor.id];
}

// Devuelve { sql, params } con la cláusula WHERE adicional para limitar a usuarios visibles.
function scopeUsersClause(actor, alias = 'u') {
  if (actor.role === 'system_leader') return { sql: '', params: [] };
  if (actor.role === 'module_leader') {
    return { sql: `AND (${alias}.module_id = ? OR ${alias}.id = ?)`, params: [actor.module_id, actor.id] };
  }
  if (actor.role === 'productive_leader') {
    return { sql: `AND (${alias}.productive_leader_id = ? OR ${alias}.id = ?)`, params: [actor.id, actor.id] };
  }
  return { sql: `AND ${alias}.id = ?`, params: [actor.id] };
}

// Filtra módulos visibles
function visibleModuleIds(actor) {
  if (actor.role === 'system_leader') {
    return db.prepare('SELECT id FROM modules').all().map((r) => r.id);
  }
  return actor.module_id ? [actor.module_id] : [];
}

module.exports = { requireAuth, requireOnboarded, requireRole, signToken, visibleUserIds, scopeUsersClause, visibleModuleIds };
