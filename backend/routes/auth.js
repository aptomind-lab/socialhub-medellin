const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { ROLE_LABELS } = require('../utils/stages');
const { sendPasswordResetEmail } = require('../utils/email');

const router = express.Router();

router.post('/login', (req, res) => {
  const { distributor_code, password } = req.body || {};
  if (!distributor_code || !password) {
    return res.status(400).json({ error: 'Código y contraseña son requeridos' });
  }

  const user = db.prepare('SELECT * FROM users WHERE distributor_code = ?')
    .get(String(distributor_code).toUpperCase().trim());
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  if (!user.active) return res.status(403).json({ error: 'Usuario inactivo' });

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  res.json({
    token: signToken(user),
    user: publicUser(user),
  });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

// Completa el perfil inicial. Se llama en el primer login y requiere
// nombre, celular y nueva contraseña. Tras ejecutarse, deja al usuario operativo.
router.post('/complete-profile', requireAuth, (req, res) => {
  const { full_name, phone, new_password } = req.body || {};
  if (!full_name || !phone || !new_password) {
    return res.status(400).json({ error: 'Nombre, celular y nueva contraseña son obligatorios' });
  }
  if (String(new_password).length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare(`
    UPDATE users SET full_name = ?, phone = ?, password_hash = ?,
                     password_must_change = 0, profile_completed = 1
     WHERE id = ?
  `).run(String(full_name).trim(), String(phone).trim(), hash, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, user: publicUser(user) });
});

// Cambio de contraseña desde el perfil (requiere actual).
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
  }
  if (String(new_password).length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }
  const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!u || !bcrypt.compareSync(current_password, u.password_hash)) {
    return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare(`
    UPDATE users SET password_hash = ?, password_must_change = 0 WHERE id = ?
  `).run(hash, req.user.id);
  res.json({ ok: true });
});

// ─── RECUPERACIÓN DE CONTRASEÑA ───
// 1) El usuario ingresa su ID. Generamos token de 24h y lo enviamos al correo registrado.
//    Respuesta siempre 200 para no exponer si existe o no.
router.post('/forgot-password', async (req, res) => {
  const { distributor_code } = req.body || {};
  if (!distributor_code) return res.status(400).json({ error: 'ID requerido' });
  const code = String(distributor_code).toUpperCase().trim();
  const user = db.prepare('SELECT id, full_name, email FROM users WHERE distributor_code = ?').get(code);

  if (user && user.email) {
    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    db.prepare(`
      INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)
    `).run(user.id, token, expires);
    const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:4000';
    const resetUrl = `${baseUrl}/dashboard/index.html#reset=${token}`;
    try {
      await sendPasswordResetEmail({ to: user.email, resetUrl, name: user.full_name });
    } catch (e) { console.error('[forgot-password]', e.message); }
  }
  res.json({ ok: true, message: 'Si el ID está registrado, recibirás un correo con instrucciones.' });
});

// 2) El usuario abre el link y envía token + nueva contraseña.
router.post('/reset-password', (req, res) => {
  const { token, new_password } = req.body || {};
  if (!token || !new_password) return res.status(400).json({ error: 'Token y nueva contraseña requeridos' });
  if (String(new_password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  const rec = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
  if (!rec) return res.status(400).json({ error: 'Token inválido' });
  if (rec.used_at) return res.status(400).json({ error: 'Este token ya fue usado' });
  if (new Date(rec.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'Token expirado' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.transaction(() => {
    db.prepare(`
      UPDATE users SET password_hash = ?, password_must_change = 0, profile_completed = 1
       WHERE id = ?
    `).run(hash, rec.user_id);
    db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`).run(rec.id);
  })();
  res.json({ ok: true });
});

function publicUser(u) {
  if (!u) return null;
  const moduleNumber = u.module_id
    ? db.prepare('SELECT number FROM modules WHERE id = ?').get(u.module_id)?.number
    : null;
  let teamLeaderName = null;
  if (u.productive_leader_id) {
    const tl = db.prepare('SELECT full_name FROM users WHERE id = ?').get(u.productive_leader_id);
    teamLeaderName = tl?.full_name || null;
  }
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
    module_number: moduleNumber,
    productive_leader_id: u.productive_leader_id,
    team_leader_name: teamLeaderName,
    password_must_change: !!u.password_must_change,
    profile_completed: !!u.profile_completed,
  };
}

module.exports = router;
