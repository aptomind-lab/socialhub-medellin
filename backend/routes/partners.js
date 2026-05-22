const express = require('express');
const { customAlphabet } = require('nanoid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { refreshPartnerBlock, refreshAllPartnerBlocks } = require('../utils/blocking');

const router = express.Router();
const generateCode = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 6);

router.get('/', requireAuth, (req, res) => {
  refreshAllPartnerBlocks();
  const { module_id, status } = req.query;
  let sql = `
    SELECT p.*, m.number AS module_number, m.name AS module_name,
      (SELECT MAX(created_at) FROM daily_messages dm WHERE dm.partner_id = p.id) AS last_message_at,
      (SELECT COUNT(*) FROM guests g WHERE g.partner_id = p.id) AS total_guests
    FROM partners p
    LEFT JOIN modules m ON m.id = p.module_id
    WHERE 1=1
  `;
  const params = [];
  if (module_id) { sql += ' AND p.module_id = ?'; params.push(module_id); }
  if (status === 'blocked') sql += ' AND p.blocked = 1';
  if (status === 'active') sql += ' AND p.blocked = 0 AND p.active = 1';
  sql += ' ORDER BY p.full_name ASC';
  res.json({ partners: db.prepare(sql).all(...params) });
});

router.post('/', requireAuth, (req, res) => {
  const { full_name, email, phone, module_id } = req.body || {};
  if (!full_name || !email) return res.status(400).json({ error: 'Nombre y correo requeridos' });

  let code;
  for (let i = 0; i < 5; i++) {
    code = generateCode();
    const exists = db.prepare('SELECT 1 FROM partners WHERE access_code = ?').get(code);
    if (!exists) break;
  }

  try {
    const info = db.prepare(`
      INSERT INTO partners (full_name, email, phone, access_code, module_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(full_name, email.toLowerCase().trim(), phone || null, code, module_id || null);
    const partner = db.prepare('SELECT * FROM partners WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ partner });
  } catch (err) {
    if (String(err).includes('UNIQUE')) return res.status(409).json({ error: 'Correo ya registrado' });
    res.status(500).json({ error: 'Error al crear socio' });
  }
});

router.get('/:id', requireAuth, (req, res) => {
  refreshPartnerBlock(req.params.id);
  const p = db.prepare(`
    SELECT p.*, m.number AS module_number, m.name AS module_name
    FROM partners p LEFT JOIN modules m ON m.id = p.module_id
    WHERE p.id = ?
  `).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Socio no encontrado' });

  const guests = db.prepare('SELECT * FROM guests WHERE partner_id = ? ORDER BY created_at DESC').all(p.id);
  const messages = db.prepare(`
    SELECT date, count FROM daily_messages WHERE partner_id = ? ORDER BY date DESC LIMIT 30
  `).all(p.id);

  res.json({ partner: p, guests, messages });
});

router.patch('/:id', requireAuth, (req, res) => {
  const { full_name, email, phone, module_id, active } = req.body || {};
  const fields = [], values = [];
  if (full_name !== undefined) { fields.push('full_name = ?'); values.push(full_name); }
  if (email !== undefined)     { fields.push('email = ?');     values.push(email.toLowerCase().trim()); }
  if (phone !== undefined)     { fields.push('phone = ?');     values.push(phone); }
  if (module_id !== undefined) { fields.push('module_id = ?'); values.push(module_id); }
  if (active !== undefined)    { fields.push('active = ?');    values.push(active ? 1 : 0); }
  if (!fields.length) return res.status(400).json({ error: 'Sin campos' });
  values.push(req.params.id);
  db.prepare(`UPDATE partners SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ partner: db.prepare('SELECT * FROM partners WHERE id = ?').get(req.params.id) });
});

router.post('/:id/regenerate-code', requireAuth, (req, res) => {
  let code;
  for (let i = 0; i < 5; i++) {
    code = generateCode();
    if (!db.prepare('SELECT 1 FROM partners WHERE access_code = ?').get(code)) break;
  }
  db.prepare('UPDATE partners SET access_code = ? WHERE id = ?').run(code, req.params.id);
  res.json({ access_code: code });
});

router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM partners WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
