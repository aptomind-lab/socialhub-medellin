const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Todos los roles autenticados pueden listar módulos (filtrado por scope)
router.get('/', requireAuth, (req, res) => {
  let rows;
  if (req.user.role === 'system_leader') {
    rows = db.prepare(`
      SELECT m.*,
        (SELECT COUNT(*) FROM users u WHERE u.module_id = m.id) AS member_count
      FROM modules m ORDER BY m.number ASC
    `).all();
  } else {
    rows = req.user.module_id
      ? db.prepare(`
          SELECT m.*,
            (SELECT COUNT(*) FROM users u WHERE u.module_id = m.id) AS member_count
          FROM modules m WHERE m.id = ?
        `).all(req.user.module_id)
      : [];
  }
  res.json({ modules: rows });
});

// Solo system leaders crean / editan / borran módulos
router.post('/', requireAuth, requireRole('system_leader'), (req, res) => {
  const { number, name } = req.body || {};
  if (!number || !name) return res.status(400).json({ error: 'Número y nombre requeridos' });
  try {
    const info = db.prepare('INSERT INTO modules (number, name) VALUES (?, ?)').run(number, name);
    res.status(201).json({ module: db.prepare('SELECT * FROM modules WHERE id = ?').get(info.lastInsertRowid) });
  } catch (err) {
    if (String(err).includes('UNIQUE')) return res.status(409).json({ error: 'Número de módulo ya existe' });
    res.status(500).json({ error: 'Error al crear módulo' });
  }
});

router.patch('/:id', requireAuth, requireRole('system_leader'), (req, res) => {
  const { name, active } = req.body || {};
  const fields = [], values = [];
  if (name !== undefined)   { fields.push('name = ?');   values.push(name); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
  if (!fields.length) return res.status(400).json({ error: 'Sin campos para actualizar' });
  values.push(req.params.id);
  db.prepare(`UPDATE modules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ module: db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id) });
});

router.delete('/:id', requireAuth, requireRole('system_leader'), (req, res) => {
  db.prepare('DELETE FROM modules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
