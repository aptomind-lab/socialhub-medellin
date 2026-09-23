const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { customAlphabet } = require('nanoid');
const db = require('../db');
const { requireAuth, requireRole, scopeUsersClause } = require('../middleware/auth');
const { refreshUserBlock, refreshAllUserBlocks } = require('../utils/blocking');
const { ROLE_LABELS } = require('../utils/stages');
const { BHIP_RANKS, isValidRank } = require('../utils/bhip');
const { generateInitialPassword } = require('../utils/password');
const { sendWelcomeEmail, sendAdminResetEmail } = require('../utils/email');

const router = express.Router();
const generateCode = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 6);

// Lista usuarios visibles según jerarquía. Filtros: role, module_id, productive_leader_id, status
router.get('/', requireAuth, (req, res) => {
  refreshAllUserBlocks();
  const { role, module_id, productive_leader_id, status } = req.query;
  const scope = scopeUsersClause(req.user, 'u');

  let sql = `
    SELECT u.*, m.number AS module_number, m.name AS module_name,
      s.nombre AS system_name,
      pl.full_name AS productive_leader_name,
      (SELECT MAX(created_at) FROM daily_activity dm WHERE dm.user_id = u.id) AS last_message_at,
      (SELECT COUNT(*) FROM guests g WHERE g.distributor_id = u.id) AS total_guests
    FROM users u
    LEFT JOIN modules m ON m.id = u.module_id
    LEFT JOIN systems s ON s.id = u.system_id
    LEFT JOIN users pl ON pl.id = u.productive_leader_id
    WHERE 1=1 ${scope.sql}
  `;
  const params = [...scope.params];
  if (role) { sql += ' AND u.role = ?'; params.push(role); }
  if (module_id) { sql += ' AND u.module_id = ?'; params.push(module_id); }
  if (productive_leader_id) { sql += ' AND u.productive_leader_id = ?'; params.push(productive_leader_id); }
  if (status === 'blocked') sql += ' AND u.blocked = 1';
  if (status === 'active') sql += ' AND u.blocked = 0 AND u.active = 1';
  sql += ' ORDER BY u.role, u.full_name ASC';

  const rows = db.prepare(sql).all(...params).map(decorate);
  res.json({ users: rows });
});

// ─── Modal obligatorio "completa tu módulo" (module_id NULL al entrar) ───
const NEEDS_MODULE_ROLES = ['module_leader', 'productive_leader', 'distributor'];

// GET /api/users/module-gate/options — módulos del propio sistema del actor.
router.get('/module-gate/options', requireAuth, (req, res) => {
  if (req.user.system_id == null) return res.json({ modules: [] });
  const modules = db.prepare(`
    SELECT id, number, name FROM modules WHERE system_id = ? AND active = 1 ORDER BY number
  `).all(req.user.system_id);
  res.json({ modules });
});

// GET /api/users/module-gate/leaders?module_id=X — líderes productivos de ese módulo.
router.get('/module-gate/leaders', requireAuth, (req, res) => {
  const moduleId = parseInt(req.query.module_id, 10);
  if (!moduleId) return res.status(400).json({ error: 'module_id requerido' });
  const mod = db.prepare('SELECT id, system_id FROM modules WHERE id = ?').get(moduleId);
  if (!mod || mod.system_id !== req.user.system_id) {
    return res.status(403).json({ error: 'Módulo fuera de tu sistema' });
  }
  const leaders = db.prepare(`
    SELECT id, full_name FROM users WHERE role = 'productive_leader' AND module_id = ? ORDER BY full_name
  `).all(moduleId);
  res.json({ productive_leaders: leaders });
});

// POST /api/users/module-gate/complete — el propio usuario completa su módulo
// (y opcionalmente su líder productivo) desde el modal obligatorio de login.
// Tres formas de resolver el líder productivo:
//   - productive_leader_id de un líder real de ese módulo.
//   - ninguno de los dos campos → "Yo soy líder productivo" (no aplica).
//   - pending_productive_leader_name → aún no está registrado; se guarda el
//     texto como pista y productive_leader_id queda NULL hasta que
//     lider_modulo/lider_sistema lo asignen a mano desde Usuarios.
router.post('/module-gate/complete', requireAuth, (req, res) => {
  if (!NEEDS_MODULE_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Tu rol no requiere módulo' });
  }
  const { module_id, productive_leader_id, pending_productive_leader_name } = req.body || {};
  const modId = parseInt(module_id, 10);
  if (!modId) return res.status(400).json({ error: 'Selecciona tu módulo' });
  const mod = db.prepare('SELECT id, system_id FROM modules WHERE id = ?').get(modId);
  if (!mod || mod.system_id !== req.user.system_id) {
    return res.status(400).json({ error: 'Módulo inválido para tu sistema' });
  }

  let finalPlId = null;
  let pendingName = null;
  if (productive_leader_id) {
    const pl = db.prepare(`
      SELECT id FROM users WHERE id = ? AND role = 'productive_leader' AND module_id = ?
    `).get(parseInt(productive_leader_id, 10), modId);
    if (!pl) return res.status(400).json({ error: 'Líder productivo inválido para ese módulo' });
    finalPlId = pl.id;
  } else if (pending_productive_leader_name && String(pending_productive_leader_name).trim()) {
    pendingName = String(pending_productive_leader_name).trim();
  }
  // Si no vino ninguno de los dos: "Yo soy líder productivo" — ambos quedan NULL.

  db.prepare(`
    UPDATE users SET module_id = ?, productive_leader_id = ?, pending_productive_leader_name = ?
    WHERE id = ?
  `).run(modId, finalPlId, pendingName, req.user.id);

  res.json({ user: decorate(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// Crear usuario (nuevo flujo BHIP).
// Campos obligatorios: distributor_code (ID BHIP), email, role, bhip_rank, module_id.
// Sistema genera contraseña aleatoria, marca password_must_change=1 y profile_completed=0,
// y envía email de bienvenida con credenciales + link.
//
// Permisos:
//   system_leader  → puede crear cualquier rol (incluso otro system_leader)
//   module_leader  → solo productive_leader y distributor, dentro de SU módulo
//   productive_leader / distributor → no pueden crear
router.post('/', requireAuth, async (req, res) => {
  const { distributor_code, email, role, bhip_rank, module_id, productive_leader_id, system_id } = req.body || {};
  if (!distributor_code || !email || !role || !bhip_rank) {
    return res.status(400).json({ error: 'ID, correo, rol y rango son obligatorios' });
  }
  if (!isValidRank(bhip_rank)) {
    return res.status(400).json({ error: 'Rango BHIP inválido', valid: BHIP_RANKS });
  }

  // Matriz de creación:
  //   lider_supremo  → cualquier rol (incluye otro lider_supremo)
  //   system_leader  → module_leader, productive_leader, distributor (solo en su sistema)
  //   module_leader  → productive_leader, distributor (solo en su módulo)
  //   PL / distributor → no pueden crear
  const allowedByActor = {
    lider_supremo:    ['lider_supremo', 'system_leader', 'module_leader', 'productive_leader', 'distributor'],
    system_leader:    ['module_leader', 'productive_leader', 'distributor'],
    module_leader:    ['productive_leader', 'distributor'],
    productive_leader: ['distributor'],
    distributor:      [],
  }[req.user.role] || [];

  if (!allowedByActor.includes(role)) {
    return res.status(403).json({ error: 'No tienes permiso para crear este rol' });
  }

  // system_id: lider_supremo puede crear/elegir el sistema; resto hereda.
  // Si crea un system_leader y pasa `system_name`, busca/crea el sistema con ese nombre.
  let finalSystemId = null;
  const warnings = [];
  if (req.user.role === 'lider_supremo') {
    if (role === 'system_leader' && req.body.system_name) {
      const sysName = String(req.body.system_name).trim();
      let sys = db.prepare('SELECT id FROM systems WHERE nombre = ?').get(sysName);
      if (!sys) {
        const info = db.prepare('INSERT INTO systems (nombre) VALUES (?)').run(sysName);
        sys = { id: info.lastInsertRowid };
      }
      finalSystemId = sys.id;
    } else {
      finalSystemId = system_id ? parseInt(system_id, 10) : (req.user.system_id || 1);
    }
  } else {
    finalSystemId = req.user.system_id; // SL/ML solo dentro de su sistema
  }
  if (role === 'lider_supremo') finalSystemId = null; // cross-system

  // Warning si el sistema ya tiene 2+ system_leaders.
  if (role === 'system_leader' && finalSystemId) {
    const slCount = db.prepare(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'system_leader' AND system_id = ? AND active = 1"
    ).get(finalSystemId).c;
    if (slCount >= 2) {
      warnings.push(`Este sistema ya tiene ${slCount} líder(es) de sistema activo(s). Se permite por encima del máximo recomendado (2).`);
    }
  }

  // Módulo: lider_supremo y SL libres; ML/PL siempre el suyo. Roles altos no requieren módulo.
  let finalModuleId = module_id ? parseInt(module_id, 10) : null;
  if (req.user.role === 'module_leader')    finalModuleId = req.user.module_id;
  if (req.user.role === 'productive_leader') finalModuleId = req.user.module_id;
  if (role === 'lider_supremo' || role === 'system_leader') finalModuleId = null;
  const needsModule = role === 'module_leader' || role === 'productive_leader' || role === 'distributor';
  if (needsModule && !finalModuleId) {
    return res.status(400).json({ error: 'Este rol requiere módulo' });
  }

  // PL opcional, solo aplica a distributors.
  // Si el actor es PL creando distributor → PL.id por defecto (su mesa).
  let finalPLId = productive_leader_id ? parseInt(productive_leader_id, 10) : null;
  if (role !== 'distributor') finalPLId = null;
  else if (req.user.role === 'productive_leader') finalPLId = req.user.id;

  // Validar unicidad de código y correo
  const code = String(distributor_code).toUpperCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE distributor_code = ?').get(code)) {
    return res.status(409).json({ error: 'El ID de distribuidor ya está en uso' });
  }
  const cleanEmail = String(email).toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(cleanEmail)) {
    return res.status(409).json({ error: 'El correo ya está registrado' });
  }

  // Generar pwd inicial y crear usuario con full_name placeholder
  const tempPwd = generateInitialPassword(10);
  const hash = bcrypt.hashSync(tempPwd, 10);
  const placeholderName = `Pendiente (${code})`;

  let newId;
  try {
    const info = db.prepare(`
      INSERT INTO users (full_name, email, distributor_code, password_hash,
                         role, system_id, module_id, productive_leader_id, bhip_rank,
                         password_must_change, profile_completed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
    `).run(placeholderName, cleanEmail, code, hash, role, finalSystemId, finalModuleId, finalPLId, bhip_rank);
    newId = info.lastInsertRowid;
  } catch (err) {
    if (String(err).includes('UNIQUE')) return res.status(409).json({ error: 'Conflicto de unicidad' });
    console.error(err); return res.status(500).json({ error: 'Error al crear usuario' });
  }

  // Link de auto-login de un solo uso (24h) — el usuario entra directo desde
  // el correo, sin escribir código+contraseña. Se genera ANTES del envío:
  // si el correo falla (SMTP caído, cuota agotada, etc.) el link sigue
  // siendo válido y el admin puede pasarlo a mano como respaldo.
  const loginToken = crypto.randomBytes(24).toString('hex');
  const loginExpires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  db.prepare(`
    INSERT INTO login_tokens (user_id, token, expires_at) VALUES (?, ?, ?)
  `).run(newId, loginToken, loginExpires);
  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:4000';
  const loginUrl = `${baseUrl}/dashboard/index.html#login=${loginToken}`;

  // Enviar email (no bloqueante: si falla — SMTP no configurado, cuota
  // agotada, etc. — devolvemos pwd + link en la respuesta para entrega manual).
  let emailSent = false;
  try {
    const result = await sendWelcomeEmail({
      to: cleanEmail,
      distributorCode: code,
      password: tempPwd,
      roleLabel: ROLE_LABELS[role],
      rank: bhip_rank,
      loginUrl,
    });
    emailSent = !result.skipped;
  } catch (err) {
    console.error('[users/welcome-email]', err.message);
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(newId);
  res.status(201).json({
    user: decorate(user),
    initial_password: emailSent ? undefined : tempPwd, // solo si no se pudo enviar email
    email_sent: emailSent,
    login_url: loginUrl,
    warnings: warnings.length ? warnings : undefined,
  });
});

router.get('/:id', requireAuth, (req, res) => {
  refreshUserBlock(req.params.id);
  const u = db.prepare(`
    SELECT u.*, m.number AS module_number, m.name AS module_name,
      s.nombre AS system_name,
      pl.full_name AS productive_leader_name
    FROM users u
    LEFT JOIN modules m ON m.id = u.module_id
    LEFT JOIN systems s ON s.id = u.system_id
    LEFT JOIN users pl ON pl.id = u.productive_leader_id
    WHERE u.id = ?
  `).get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!canActOn(req.user, u)) return res.status(403).json({ error: 'No tienes acceso a este usuario' });

  const guests = db.prepare('SELECT * FROM guests WHERE distributor_id = ? ORDER BY created_at DESC').all(u.id);
  const messages = db.prepare('SELECT date, messages AS count, books, tiktok_minutes, tiktok_leads FROM daily_activity WHERE user_id = ? ORDER BY date DESC LIMIT 30').all(u.id);
  res.json({ user: decorate(u), guests, messages });
});

router.patch('/:id', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!canActOn(req.user, target)) return res.status(403).json({ error: 'No tienes acceso a este usuario' });

  const { full_name, email, phone, module_id, productive_leader_id, active, password, bhip_rank, system_id, role, distributor_code } = req.body || {};
  const fields = [], values = [];
  if (full_name !== undefined) { fields.push('full_name = ?'); values.push(full_name); }
  if (email !== undefined)     { fields.push('email = ?');     values.push(email ? email.toLowerCase().trim() : null); }
  if (phone !== undefined)     { fields.push('phone = ?');     values.push(phone); }
  // ID/código de distribuidor: editable por Líder de Módulo hacia arriba.
  if (distributor_code !== undefined) {
    if (!['lider_supremo', 'system_leader', 'module_leader'].includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permiso para cambiar el ID de distribuidor' });
    }
    const code = String(distributor_code).toUpperCase().trim();
    if (!code) return res.status(400).json({ error: 'El ID de distribuidor no puede estar vacío' });
    const clash = db.prepare('SELECT id FROM users WHERE distributor_code = ? AND id != ?').get(code, req.params.id);
    if (clash) return res.status(409).json({ error: 'El ID de distribuidor ya está en uso' });
    fields.push('distributor_code = ?'); values.push(code);
  }
  // Cambio de rol (jerarquía):
  //   lider_supremo → cualquier rol.
  //   system_leader → solo module_leader, productive_leader, distributor (no puede crear pares ni superiores).
  //   resto         → no permitido.
  if (role !== undefined) {
    const validRoles = ['lider_supremo','system_leader','module_leader','productive_leader','distributor'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Rol inválido' });
    const SL_ASSIGNABLE = ['module_leader','productive_leader','distributor'];
    const canChangeRole =
      req.user.role === 'lider_supremo' ||
      (req.user.role === 'system_leader' && SL_ASSIGNABLE.includes(role));
    if (!canChangeRole) {
      return res.status(403).json({ error: 'No puedes asignar este rol' });
    }
    fields.push('role = ?'); values.push(role);
  }
  // Solo lider_supremo puede mover usuarios entre sistemas.
  if (system_id !== undefined && req.user.role === 'lider_supremo') {
    fields.push('system_id = ?'); values.push(system_id || null);
  }
  if (module_id !== undefined && ['lider_supremo','system_leader'].includes(req.user.role)) {
    // Blindaje: un rol que requiere módulo (module_leader/productive_leader/
    // distributor) nunca puede quedar sin uno vía PATCH — mismo criterio que
    // al crear el usuario. Evita que un bug de frontend (o una llamada directa
    // a la API) borre el módulo en silencio; hay que mandar uno válido.
    const effectiveRole = role !== undefined ? role : target.role;
    const needsModule = ['module_leader', 'productive_leader', 'distributor'].includes(effectiveRole);
    if (needsModule && !module_id) {
      return res.status(400).json({ error: 'Este rol requiere módulo — no se puede dejar sin asignar' });
    }
    fields.push('module_id = ?'); values.push(module_id || null);
  }
  if (productive_leader_id !== undefined) {
    fields.push('productive_leader_id = ?'); values.push(productive_leader_id || null);
    // Asignar un líder productivo real resuelve el pendiente — limpia el
    // nombre a mano que se había guardado desde el modal de "aún no está".
    if (productive_leader_id) { fields.push('pending_productive_leader_name = ?'); values.push(null); }
  }
  if (active !== undefined)    { fields.push('active = ?');    values.push(active ? 1 : 0); }
  if (bhip_rank !== undefined) {
    if (!isValidRank(bhip_rank)) return res.status(400).json({ error: 'Rango BHIP inválido' });
    fields.push('bhip_rank = ?'); values.push(bhip_rank);
  }
  if (password) { fields.push('password_hash = ?'); values.push(bcrypt.hashSync(password, 10)); }
  if (!fields.length) return res.status(400).json({ error: 'Sin campos' });
  values.push(req.params.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ user: decorate(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)) });
});

// Toggle de desactivación temporal: el usuario puede seguir entrando al
// dashboard, pero la UI muestra overlay rojo que bloquea interacción.
// Permisos: lider_supremo (cualquier usuario), system_leader (solo su sistema).
// Restricciones: no puedes desactivarte a ti mismo, ni desactivar a un lider_supremo.
router.patch('/:id/toggle-active', requireAuth, (req, res) => {
  if (!['lider_supremo', 'system_leader'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Solo Líder Supremo o Líder de Sistema pueden activar/desactivar usuarios' });
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'No puedes desactivarte a ti mismo' });
  }
  if (target.role === 'lider_supremo') {
    return res.status(403).json({ error: 'No puedes desactivar a un Líder Supremo' });
  }
  if (req.user.role === 'system_leader' && target.system_id !== req.user.system_id) {
    return res.status(403).json({ error: 'Solo puedes gestionar usuarios de tu sistema' });
  }
  const next = target.active ? 0 : 1;
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(next, target.id);
  res.json({ ok: true, active: next });
});

router.post('/:id/regenerate-code', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!canActOn(req.user, target)) return res.status(403).json({ error: 'No tienes acceso a este usuario' });
  let code;
  for (let i = 0; i < 5; i++) {
    code = generateCode();
    if (!db.prepare('SELECT 1 FROM users WHERE distributor_code = ?').get(code)) break;
  }
  db.prepare('UPDATE users SET distributor_code = ? WHERE id = ?').run(code, req.params.id);
  res.json({ distributor_code: code });
});

// Reset admin: SL puede a cualquiera; ML solo a usuarios de su módulo (excepto SL).
// Genera pwd genérica, marca password_must_change=1 y envía email.
router.post('/:id/reset-password', requireAuth, async (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!canActOn(req.user, target)) return res.status(403).json({ error: 'No tienes acceso a este usuario' });
  if (req.user.role === 'module_leader' && target.role === 'system_leader') {
    return res.status(403).json({ error: 'No puedes restablecer la contraseña de un Líder de Sistema' });
  }
  if (!target.email) return res.status(400).json({ error: 'El usuario no tiene correo registrado' });

  const tempPwd = generateInitialPassword(10);
  const hash = bcrypt.hashSync(tempPwd, 10);
  db.prepare(`
    UPDATE users SET password_hash = ?, password_must_change = 1 WHERE id = ?
  `).run(hash, target.id);

  let emailResult = { skipped: true };
  try {
    emailResult = await sendAdminResetEmail({
      to: target.email, name: target.full_name,
      distributorCode: target.distributor_code, password: tempPwd,
    });
  } catch (e) { console.error('[reset-password/email]', e.message); }

  res.json({
    ok: true,
    email_sent: !emailResult.skipped,
    temporary_password: emailResult.skipped ? tempPwd : undefined,
  });
});

router.delete('/:id', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!canActOn(req.user, target)) return res.status(403).json({ error: 'No tienes acceso a este usuario' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

function canActOn(actor, target) {
  if (actor.role === 'lider_supremo') return true;
  if (actor.role === 'system_leader') {
    if (target.role === 'lider_supremo') return false;
    return target.system_id === actor.system_id || target.id === actor.id;
  }
  if (actor.role === 'module_leader') {
    if (target.role === 'lider_supremo' || target.role === 'system_leader') return false;
    if (target.system_id !== actor.system_id) return false;
    return target.module_id === actor.module_id || target.id === actor.id;
  }
  if (actor.role === 'productive_leader') {
    if (['lider_supremo','system_leader','module_leader'].includes(target.role)) return false;
    return target.productive_leader_id === actor.id || target.id === actor.id;
  }
  return target.id === actor.id;
}

function decorate(u) {
  if (!u) return null;
  return {
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    phone: u.phone,
    distributor_code: u.distributor_code,
    role: u.role,
    role_label: ROLE_LABELS[u.role],
    bhip_rank: u.bhip_rank,
    system_id: u.system_id,
    system_name: u.system_name,
    module_id: u.module_id,
    module_number: u.module_number,
    module_name: u.module_name,
    productive_leader_id: u.productive_leader_id,
    productive_leader_name: u.productive_leader_name,
    pending_productive_leader_name: u.pending_productive_leader_name,
    active: u.active,
    blocked: u.blocked,
    password_must_change: u.password_must_change,
    profile_completed: u.profile_completed,
    last_message_at: u.last_message_at,
    total_guests: u.total_guests,
    created_at: u.created_at,
  };
}

module.exports = router;
