const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

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

module.exports = router;
