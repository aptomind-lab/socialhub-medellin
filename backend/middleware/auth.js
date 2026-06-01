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
      SELECT id, full_name, distributor_code, role, system_id, module_id, productive_leader_id, active,
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

// Downline recursivo: TODOS los usuarios que están debajo del actor en la cadena
// (vía firmado_por O productive_leader_id), incluyendo al propio actor.
// Usado para PL y distributor — cumple regla: "ves a todos los que están debajo de ti".
function downlineUserIds(actorId) {
  const visited = new Set([actorId]);
  const queue = [actorId];
  const stmt = db.prepare(
    'SELECT id FROM users WHERE firmado_por = ? OR productive_leader_id = ?'
  );
  while (queue.length) {
    const current = queue.shift();
    const children = stmt.all(current, current);
    for (const c of children) {
      if (!visited.has(c.id)) {
        visited.add(c.id);
        queue.push(c.id);
      }
    }
  }
  return Array.from(visited);
}

// Devuelve un objeto con los IDs de usuarios visibles para el actor según jerarquía.
function visibleUserIds(actor) {
  // Líder Supremo: TODO el universo (cross-system).
  if (actor.role === 'lider_supremo') {
    return db.prepare('SELECT id FROM users').all().map((r) => r.id);
  }
  // Líder de Sistema: solo usuarios de su system_id.
  if (actor.role === 'system_leader') {
    return db.prepare('SELECT id FROM users WHERE system_id = ?').all(actor.system_id).map((r) => r.id);
  }
  // Líder de Módulo: usuarios de su módulo dentro de su sistema.
  if (actor.role === 'module_leader') {
    return db.prepare('SELECT id FROM users WHERE module_id = ? AND system_id = ? OR id = ?')
      .all(actor.module_id, actor.system_id, actor.id).map((r) => r.id);
  }
  // PL y distributor: downline recursivo (incluye al actor).
  return downlineUserIds(actor.id);
}

// Devuelve { sql, params } con la cláusula WHERE adicional para limitar a usuarios visibles.
function scopeUsersClause(actor, alias = 'u') {
  if (actor.role === 'lider_supremo') return { sql: '', params: [] };
  if (actor.role === 'system_leader') {
    return { sql: `AND ${alias}.system_id = ?`, params: [actor.system_id] };
  }
  if (actor.role === 'module_leader') {
    return {
      sql: `AND ((${alias}.module_id = ? AND ${alias}.system_id = ?) OR ${alias}.id = ?)`,
      params: [actor.module_id, actor.system_id, actor.id],
    };
  }
  // PL / distributor → downline.
  const ids = downlineUserIds(actor.id);
  const placeholders = ids.map(() => '?').join(',');
  return { sql: `AND ${alias}.id IN (${placeholders})`, params: ids };
}

// Filtra módulos visibles
function visibleModuleIds(actor) {
  if (actor.role === 'lider_supremo' || actor.role === 'system_leader') {
    return db.prepare('SELECT id FROM modules').all().map((r) => r.id);
  }
  return actor.module_id ? [actor.module_id] : [];
}

module.exports = { requireAuth, requireOnboarded, requireRole, signToken, visibleUserIds, downlineUserIds, scopeUsersClause, visibleModuleIds };
