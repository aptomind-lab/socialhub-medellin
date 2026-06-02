const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Helper: trae módulo + verifica que el actor pueda operarlo según su scope.
function ensureModuleInScope(actor, moduleId) {
  const m = db.prepare('SELECT * FROM modules WHERE id = ?').get(moduleId);
  if (!m) return { ok: false, code: 404, error: 'Módulo no encontrado' };
  if (actor.role === 'lider_supremo') return { ok: true, module: m };
  if (actor.role === 'system_leader' && m.system_id === actor.system_id) return { ok: true, module: m };
  return { ok: false, code: 403, error: 'Módulo fuera de tu sistema' };
}

// Listar módulos. Scope:
//   lider_supremo → todos
//   system_leader → solo de su sistema
//   resto         → solo el suyo
router.get('/', requireAuth, (req, res) => {
  let rows;
  const baseSelect = `
    SELECT m.*, s.nombre AS system_name,
      (SELECT COUNT(*) FROM users u WHERE u.module_id = m.id) AS member_count
    FROM modules m
    LEFT JOIN systems s ON s.id = m.system_id
  `;
  if (req.user.role === 'lider_supremo') {
    rows = db.prepare(`${baseSelect} ORDER BY m.system_id, m.number ASC`).all();
  } else if (req.user.role === 'system_leader') {
    rows = db.prepare(`${baseSelect} WHERE m.system_id = ? ORDER BY m.number ASC`).all(req.user.system_id);
  } else {
    rows = req.user.module_id
      ? db.prepare(`${baseSelect} WHERE m.id = ?`).all(req.user.module_id)
      : [];
  }
  res.json({ modules: rows });
});

// Crear módulo. lider_supremo puede elegir system_id; system_leader hereda el suyo.
router.post('/', requireAuth, requireRole('lider_supremo', 'system_leader'), (req, res) => {
  const { number, name, system_id } = req.body || {};
  if (!number || !name) return res.status(400).json({ error: 'Número y nombre requeridos' });

  const finalSystemId = req.user.role === 'lider_supremo'
    ? (system_id ? parseInt(system_id, 10) : null)
    : req.user.system_id;

  try {
    const info = db.prepare(
      'INSERT INTO modules (number, name, system_id) VALUES (?, ?, ?)'
    ).run(number, name, finalSystemId);
    const m = db.prepare(`
      SELECT m.*, s.nombre AS system_name FROM modules m
      LEFT JOIN systems s ON s.id = m.system_id WHERE m.id = ?
    `).get(info.lastInsertRowid);
    res.status(201).json({ module: m });
  } catch (err) {
    if (String(err).includes('UNIQUE')) return res.status(409).json({ error: 'Número de módulo ya existe' });
    res.status(500).json({ error: 'Error al crear módulo' });
  }
});

router.patch('/:id', requireAuth, requireRole('lider_supremo', 'system_leader'), (req, res) => {
  const check = ensureModuleInScope(req.user, req.params.id);
  if (!check.ok) return res.status(check.code).json({ error: check.error });

  const { name, active, system_id } = req.body || {};
  const fields = [], values = [];
  if (name !== undefined)   { fields.push('name = ?');   values.push(name); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
  // Solo lider_supremo puede mover módulos entre sistemas.
  if (system_id !== undefined && req.user.role === 'lider_supremo') {
    fields.push('system_id = ?'); values.push(system_id || null);
  }
  if (!fields.length) return res.status(400).json({ error: 'Sin campos para actualizar' });
  values.push(req.params.id);
  db.prepare(`UPDATE modules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ module: db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id) });
});

router.delete('/:id', requireAuth, requireRole('lider_supremo', 'system_leader'), (req, res) => {
  const check = ensureModuleInScope(req.user, req.params.id);
  if (!check.ok) return res.status(check.code).json({ error: check.error });
  db.prepare('DELETE FROM modules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
