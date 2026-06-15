const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, nombre, active, created_at,
      (SELECT COUNT(*) FROM users u WHERE u.system_id = s.id) AS user_count,
      (SELECT COUNT(*) FROM modules m WHERE m.system_id = s.id) AS module_count
    FROM systems s ORDER BY id
  `).all();
  res.json({ systems: rows });
});

// Eliminar sistema — solo lider_supremo.
// Las FKs (users/modules/events.system_id) son ON DELETE SET NULL, así que los
// registros vinculados quedan huérfanos (system_id=NULL) en lugar de borrarse.
router.delete('/:id', requireAuth, requireRole('lider_supremo'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const sys = db.prepare('SELECT id, nombre FROM systems WHERE id = ?').get(id);
  if (!sys) return res.status(404).json({ error: 'Sistema no encontrado' });
  const orphaned = {
    users:   db.prepare('SELECT COUNT(*) AS c FROM users WHERE system_id = ?').get(id).c,
    modules: db.prepare('SELECT COUNT(*) AS c FROM modules WHERE system_id = ?').get(id).c,
    events:  db.prepare('SELECT COUNT(*) AS c FROM events WHERE system_id = ?').get(id).c,
  };
  db.prepare('DELETE FROM systems WHERE id = ?').run(id);
  res.json({ ok: true, deleted: sys.nombre, orphaned });
});

module.exports = router;
