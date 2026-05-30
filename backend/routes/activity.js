// Calendario de consistencia y promedios diarios.
// GET /api/activity/calendar?month=YYYY-MM&user_id=X
//   - user_id por defecto = req.user.id
//   - Si un líder pide otro user_id, debe estar en su scope
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function daysInMonth(year, month1) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

router.get('/calendar', requireAuth, (req, res) => {
  const monthStr = req.query.month || new Date().toISOString().slice(0, 7);
  const m = /^(\d{4})-(\d{2})$/.exec(monthStr);
  if (!m) return res.status(400).json({ error: 'month inválido (formato YYYY-MM)' });
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const totalDays = daysInMonth(year, month);

  const targetUserId = parseInt(req.query.user_id, 10) || req.user.id;

  // Scope check: el actor solo puede ver su propio data o el de usuarios visibles.
  if (targetUserId !== req.user.id) {
    const target = db.prepare('SELECT module_id, productive_leader_id FROM users WHERE id = ?').get(targetUserId);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    const allowed =
      req.user.role === 'system_leader' ||
      (req.user.role === 'module_leader' && target.module_id === req.user.module_id) ||
      (req.user.role === 'productive_leader' && target.productive_leader_id === req.user.id);
    if (!allowed) return res.status(403).json({ error: 'Fuera de tu scope' });
  }

  const from = `${monthStr}-01`;
  const to = `${monthStr}-${String(totalDays).padStart(2, '0')}`;
  const rows = db.prepare(`
    SELECT date, messages, books, tiktok_minutes, tiktok_leads
    FROM daily_activity WHERE user_id = ? AND date BETWEEN ? AND ?
  `).all(targetUserId, from, to);
  const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));

  const days = [];
  for (let d = 1; d <= totalDays; d++) {
    const date = `${monthStr}-${String(d).padStart(2, '0')}`;
    const r = byDate[date];
    days.push({
      date,
      day: d,
      messages:        r ? r.messages : 0,
      books:           r ? r.books : 0,
      tiktok_minutes:  r ? r.tiktok_minutes : 0,
      tiktok_leads:    r ? r.tiktok_leads : 0,
      has_activity:    !!r && (r.messages > 0 || r.books > 0 || r.tiktok_minutes > 0 || r.tiktok_leads > 0),
    });
  }

  const totals = days.reduce((acc, x) => ({
    messages: acc.messages + x.messages,
    books: acc.books + x.books,
    tiktok_minutes: acc.tiktok_minutes + x.tiktok_minutes,
    tiktok_leads: acc.tiktok_leads + x.tiktok_leads,
    active_days: acc.active_days + (x.has_activity ? 1 : 0),
  }), { messages: 0, books: 0, tiktok_minutes: 0, tiktok_leads: 0, active_days: 0 });

  // Promedio diario sobre 30 días (referencia de "vida cotidiana").
  const div = (n) => Math.round((n / 30) * 10) / 10;
  const averages = {
    messages: div(totals.messages),
    books: div(totals.books),
    tiktok_minutes: div(totals.tiktok_minutes),
    tiktok_leads: div(totals.tiktok_leads),
  };

  res.json({
    month: monthStr,
    user_id: targetUserId,
    days,
    totals,
    averages,
    consistency_pct: Math.round((totals.active_days / totalDays) * 100),
  });
});

module.exports = router;
