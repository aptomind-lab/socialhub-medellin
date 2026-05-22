// Registro diario de actividad — mensajes + books.
// Cualquier usuario puede registrar lo SUYO; los líderes pueden registrar
// también el de su equipo según su scope.
const express = require('express');
const db = require('../db');
const { requireAuth, scopeUsersClause } = require('../middleware/auth');
const { refreshUserBlock } = require('../utils/blocking');

const router = express.Router();

router.post('/', requireAuth, (req, res) => {
  let { user_id, date, count, books_count } = req.body || {};
  // Si no se especifica user_id, se asume el propio usuario.
  if (!user_id) user_id = req.user.id;
  if (!date || count === undefined) {
    return res.status(400).json({ error: 'date y count son requeridos' });
  }
  if (count < 0) return res.status(400).json({ error: 'count debe ser positivo' });
  const books = Math.max(0, parseInt(books_count || 0, 10) || 0);

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  // Permisos: el propio usuario siempre puede; superiores en jerarquía también.
  const allowed =
    target.id === req.user.id ||
    req.user.role === 'system_leader' ||
    (req.user.role === 'module_leader' && target.module_id === req.user.module_id) ||
    (req.user.role === 'productive_leader' && target.productive_leader_id === req.user.id);
  if (!allowed) return res.status(403).json({ error: 'No puedes registrar para este usuario' });

  db.prepare(`
    INSERT INTO daily_messages (user_id, date, count, books_count) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      count = excluded.count,
      books_count = excluded.books_count,
      created_at = datetime('now')
  `).run(user_id, date, count, books);
  const status = refreshUserBlock(user_id);
  res.json({ ok: true, status });
});

// Registro de hoy del usuario autenticado (UX para el widget).
router.get('/today', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT date, count, books_count, created_at FROM daily_messages
    WHERE user_id = ? AND date = ?
  `).get(req.user.id, today);
  res.json({ date: today, record: row || null });
});

router.get('/user/:userId', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT date, count, books_count, created_at FROM daily_messages
    WHERE user_id = ? ORDER BY date DESC LIMIT 90
  `).all(req.params.userId);
  res.json({ messages: rows });
});

router.get('/totals', requireAuth, (req, res) => {
  const { from, to, module_id } = req.query;
  const scope = scopeUsersClause(req.user, 'u');
  let sql = `
    SELECT u.id AS user_id, u.full_name, u.role, u.distributor_code,
           m.number AS module_number,
           IFNULL(SUM(dm.count), 0) AS total_messages,
           IFNULL(SUM(dm.books_count), 0) AS total_books,
           COUNT(dm.id) AS days_logged
    FROM users u
    LEFT JOIN modules m ON m.id = u.module_id
    LEFT JOIN daily_messages dm ON dm.user_id = u.id
      ${from ? "AND dm.date >= ?" : ''}
      ${to ? "AND dm.date <= ?" : ''}
    WHERE u.active = 1
    ${scope.sql}
  `;
  const params = [];
  if (from) params.push(from);
  if (to) params.push(to);
  params.push(...scope.params);
  if (module_id) { sql += ' AND u.module_id = ?'; params.push(module_id); }
  sql += ' GROUP BY u.id ORDER BY total_messages DESC';
  res.json({ totals: db.prepare(sql).all(...params) });
});

module.exports = router;
