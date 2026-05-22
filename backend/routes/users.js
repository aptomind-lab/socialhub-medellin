const express = require('express');
const bcrypt = require('bcryptjs');
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
      pl.full_name AS productive_leader_name,
      (SELECT MAX(created_at) FROM daily_messages dm WHERE dm.user_id = u.id) AS last_message_at,
      (SELECT COUNT(*) FROM guests g WHERE g.distributor_id = u.id) AS total_guests
    FROM users u
    LEFT JOIN modules m ON m.id = u.module_id
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
  const { distributor_code, email, role, bhip_rank, module_id, productive_leader_id } = req.body || {};
  if (!distributor_code || !email || !role || !bhip_rank) {
    return res.status(400).json({ error: 'ID, correo, rol y rango son obligatorios' });
  }
  if (!isValidRank(bhip_rank)) {
    return res.status(400).json({ error: 'Rango BHIP inválido', valid: BHIP_RANKS });
  }

  const allowedByActor = {
    system_leader: ['system_leader', 'module_leader', 'productive_leader', 'distributor'],
    module_leader: ['productive_leader', 'distributor'],
    productive_leader: [],
    distributor: [],
  }[req.user.role] || [];

  if (!allowedByActor.includes(role)) {
    return res.status(403).json({ error: 'No tienes permiso para crear este rol' });
  }

  // Módulo: SL libre; ML siempre el suyo
  let finalModuleId = module_id ? parseInt(module_id, 10) : null;
  if (req.user.role === 'module_leader') finalModuleId = req.user.module_id;
  if (role === 'system_leader') finalModuleId = null;
  if (role !== 'system_leader' && !finalModuleId) {
    return res.status(400).json({ error: 'Este rol requiere módulo' });
  }

  // PL opcional, solo aplica a distributors
  let finalPLId = productive_leader_id ? parseInt(productive_leader_id, 10) : null;
  if (role !== 'distributor') finalPLId = null;

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
                         role, module_id, productive_leader_id, bhip_rank,
                         password_must_change, profile_completed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
    `).run(placeholderName, cleanEmail, code, hash, role, finalModuleId, finalPLId, bhip_rank);
    newId = info.lastInsertRowid;
  } catch (err) {
    if (String(err).includes('UNIQUE')) return res.status(409).json({ error: 'Conflicto de unicidad' });
    console.error(err); return res.status(500).json({ error: 'Error al crear usuario' });
  }

  // Enviar email (no bloqueante: si SMTP no configurado, devolvemos pwd en respuesta)
  let emailResult = { skipped: true };
  try {
    emailResult = await sendWelcomeEmail({
      to: cleanEmail,
      distributorCode: code,
      password: tempPwd,
      roleLabel: ROLE_LABELS[role],
      rank: bhip_rank,
    });
  } catch (err) {
    console.error('[users/welcome-email]', err.message);
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(newId);
  res.status(201).json({
    user: decorate(user),
    initial_password: emailResult.skipped ? tempPwd : undefined, // solo si no se pudo enviar email
    email_sent: !emailResult.skipped,
    login_url: emailResult.login_url,
  });
});

router.get('/:id', requireAuth, (req, res) => {
  refreshUserBlock(req.params.id);
  const u = db.prepare(`
    SELECT u.*, m.number AS module_number, m.name AS module_name,
      pl.full_name AS productive_leader_name
    FROM users u
    LEFT JOIN modules m ON m.id = u.module_id
    LEFT JOIN users pl ON pl.id = u.productive_leader_id
    WHERE u.id = ?
  `).get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!canActOn(req.user, u)) return res.status(403).json({ error: 'No tienes acceso a este usuario' });

  const guests = db.prepare('SELECT * FROM guests WHERE distributor_id = ? ORDER BY created_at DESC').all(u.id);
  const messages = db.prepare('SELECT date, count FROM daily_messages WHERE user_id = ? ORDER BY date DESC LIMIT 30').all(u.id);
  res.json({ user: decorate(u), guests, messages });
});

router.patch('/:id', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!canActOn(req.user, target)) return res.status(403).json({ error: 'No tienes acceso a este usuario' });

  const { full_name, email, phone, module_id, productive_leader_id, active, password, bhip_rank } = req.body || {};
  const fields = [], values = [];
  if (full_name !== undefined) { fields.push('full_name = ?'); values.push(full_name); }
  if (email !== undefined)     { fields.push('email = ?');     values.push(email ? email.toLowerCase().trim() : null); }
  if (phone !== undefined)     { fields.push('phone = ?');     values.push(phone); }
  if (module_id !== undefined && req.user.role === 'system_leader') { fields.push('module_id = ?'); values.push(module_id || null); }
  if (productive_leader_id !== undefined) { fields.push('productive_leader_id = ?'); values.push(productive_leader_id || null); }
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
  if (actor.role === 'system_leader') return true;
  if (actor.role === 'module_leader') {
    if (target.role === 'system_leader') return false;
    return target.module_id === actor.module_id || target.id === actor.id;
  }
  if (actor.role === 'productive_leader') {
    if (target.role === 'system_leader' || target.role === 'module_leader') return false;
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
    module_id: u.module_id,
    module_number: u.module_number,
    module_name: u.module_name,
    productive_leader_id: u.productive_leader_id,
    productive_leader_name: u.productive_leader_name,
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
