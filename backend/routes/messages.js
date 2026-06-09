// Registro diario unificado (mensajes + books + TikTok Live).
// Tabla: daily_activity con UPSERT por (user_id, date).
// Endpoint mantiene compatibilidad: si solo llegan `count` y `books_count` (Tipo A),
// se preservan los campos TikTok existentes para esa fecha.
const express = require('express');
const db = require('../db');
const { requireAuth, scopeUsersClause } = require('../middleware/auth');
const { refreshUserBlock } = require('../utils/blocking');
const gam = require('../utils/gamification');

const router = express.Router();

function clampInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

// Acepta tanto los nombres nuevos (messages, books, tiktok_minutes, tiktok_leads)
// como los nombres viejos (count, books_count) para retro-compat.
router.post('/', requireAuth, (req, res) => {
  let { user_id, date, count, books_count, messages, books, tiktok_minutes, tiktok_leads, messages_leads, tiktok_books } = req.body || {};
  if (!user_id) user_id = req.user.id;
  if (!date) return res.status(400).json({ error: 'date es requerido' });

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  const allowed =
    target.id === req.user.id ||
    req.user.role === 'system_leader' ||
    (req.user.role === 'module_leader' && target.module_id === req.user.module_id) ||
    (req.user.role === 'productive_leader' && target.productive_leader_id === req.user.id);
  if (!allowed) return res.status(403).json({ error: 'No puedes registrar para este usuario' });

  // Carga la fila existente para preservar campos no enviados.
  const existing = db.prepare(`
    SELECT messages, books, tiktok_minutes, tiktok_leads, messages_leads, tiktok_books FROM daily_activity
    WHERE user_id = ? AND date = ?
  `).get(user_id, date) || { messages: 0, books: 0, tiktok_minutes: 0, tiktok_leads: 0, messages_leads: 0, tiktok_books: 0 };

  // Resuelve valores finales: nuevo > viejo > existente.
  const fMessages       = messages       !== undefined ? clampInt(messages, 0)
                        : count          !== undefined ? clampInt(count, 0)
                        : existing.messages;
  const fBooks          = books          !== undefined ? clampInt(books, 0)
                        : books_count    !== undefined ? clampInt(books_count, 0)
                        : existing.books;
  const fTiktokMinutes  = tiktok_minutes !== undefined ? clampInt(tiktok_minutes, 0) : existing.tiktok_minutes;
  const fTiktokLeads    = tiktok_leads   !== undefined ? clampInt(tiktok_leads, 0)   : existing.tiktok_leads;
  const fMessagesLeads  = messages_leads !== undefined ? clampInt(messages_leads, 0) : existing.messages_leads;
  const fTiktokBooks    = tiktok_books   !== undefined ? clampInt(tiktok_books, 0)   : existing.tiktok_books;

  db.prepare(`
    INSERT INTO daily_activity (user_id, date, messages, books, tiktok_minutes, tiktok_leads, messages_leads, tiktok_books)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      messages       = excluded.messages,
      books          = excluded.books,
      tiktok_minutes = excluded.tiktok_minutes,
      tiktok_leads   = excluded.tiktok_leads,
      messages_leads = excluded.messages_leads,
      tiktok_books   = excluded.tiktok_books,
      updated_at     = datetime('now')
  `).run(user_id, date, fMessages, fBooks, fTiktokMinutes, fTiktokLeads, fMessagesLeads, fTiktokBooks);

  const status = refreshUserBlock(user_id);

  // Gamificación: actualiza racha, XP y revisa logros (no bloqueante en errores).
  let gamResult = null;
  try {
    gamResult = gam.onActivityRegistered(
      user_id, date,
      existing,
      { messages: fMessages, books: fBooks, tiktok_minutes: fTiktokMinutes, tiktok_leads: fTiktokLeads }
    );
  } catch (e) { console.error('[messages/gamification]', e.message); }

  res.json({ ok: true, status, gamification: gamResult });
});

// Hoy del usuario autenticado (UX para el widget topbar y forms).
router.get('/today', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT date, messages, books, tiktok_minutes, tiktok_leads, messages_leads, tiktok_books, created_at, updated_at
    FROM daily_activity WHERE user_id = ? AND date = ?
  `).get(req.user.id, today);
  // Mantenemos compat con clientes que esperan count/books_count.
  let compat = null;
  if (row) {
    compat = { ...row, count: row.messages, books_count: row.books };
  }
  res.json({ date: today, record: compat });
});

router.get('/user/:userId', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT date, messages, books, tiktok_minutes, tiktok_leads, messages_leads, tiktok_books, created_at
    FROM daily_activity WHERE user_id = ? ORDER BY date DESC LIMIT 90
  `).all(req.params.userId);
  // Compat: emitir también count/books_count.
  const messages = rows.map((r) => ({ ...r, count: r.messages, books_count: r.books }));
  res.json({ messages });
});

router.get('/totals', requireAuth, (req, res) => {
  const { from, to, module_id } = req.query;
  const scope = scopeUsersClause(req.user, 'u');
  let sql = `
    SELECT u.id AS user_id, u.full_name, u.role, u.distributor_code,
           m.number AS module_number,
           IFNULL(SUM(a.messages), 0)       AS total_messages,
           IFNULL(SUM(a.books), 0)          AS total_books,
           IFNULL(SUM(a.tiktok_minutes), 0) AS total_tiktok_minutes,
           IFNULL(SUM(a.tiktok_leads), 0)   AS total_tiktok_leads,
           IFNULL(SUM(a.messages_leads), 0) AS total_messages_leads,
           IFNULL(SUM(a.tiktok_books), 0)   AS total_tiktok_books,
           COUNT(a.id) AS days_logged
    FROM users u
    LEFT JOIN modules m ON m.id = u.module_id
    LEFT JOIN daily_activity a ON a.user_id = u.id
      ${from ? "AND a.date >= ?" : ''}
      ${to ? "AND a.date <= ?" : ''}
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
