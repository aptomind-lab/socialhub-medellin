const express = require('express');
const db = require('../db');
const { requireAuth, scopeUsersClause } = require('../middleware/auth');
const wg = require('../utils/wg');
const { DAYS_ES } = require('../utils/calendar');

const router = express.Router();

// Estado WG de un invitado específico (con scope check)
router.get('/guest/:guestId', requireAuth, (req, res) => {
  const guest = db.prepare(`
    SELECT g.*, u.module_id, u.productive_leader_id
    FROM guests g JOIN users u ON u.id = g.distributor_id
    WHERE g.id = ?
  `).get(req.params.guestId);
  if (!guest) return res.status(404).json({ error: 'Invitado no encontrado' });

  if (req.user.role === 'module_leader' && guest.module_id !== req.user.module_id) {
    return res.status(403).json({ error: 'Fuera de tu módulo' });
  }
  if (req.user.role === 'productive_leader' && guest.productive_leader_id !== req.user.id) {
    return res.status(403).json({ error: 'Fuera de tu mesa' });
  }

  const status = wg.calculateStatus(req.params.guestId);
  const attendance = wg.getAttendanceForGuest(req.params.guestId).map((a) => ({
    ...a, day_label: DAYS_ES[a.day_of_week],
  }));
  res.json({ status, attendance });
});

// Resumen agregado: conteos verde/amarillo/rojo según jerarquía
router.get('/summary', requireAuth, (req, res) => {
  const scope = scopeUsersClause(req.user, 'u');
  const summary = wg.summarizeForScope(scope.sql, scope.params);
  res.json(summary);
});

// Calendario semanal de TODOS los guests visibles. Devuelve por guest:
//   id, full_name, color, color_manual, bit_date, power_talk_date, consecutive_full_weeks,
//   total_attendances, weeks (cada una con días y estado).
router.get('/calendar', requireAuth, (req, res) => {
  const { module_id, filter } = req.query;
  const scope = scopeUsersClause(req.user, 'u');
  let sql = `
    SELECT g.id, g.full_name, g.color, g.color_manual, g.bit_date, g.power_talk_date,
           g.current_stage, u.full_name AS distributor_name, m.number AS module_number
    FROM guests g
    JOIN users u ON u.id = g.distributor_id
    LEFT JOIN modules m ON m.id = u.module_id
    WHERE g.current_stage != 'FIRMADO'
      AND (g.power_talk_date IS NOT NULL
           OR EXISTS (SELECT 1 FROM wg_attendance wa WHERE wa.guest_id = g.id))
      ${scope.sql}
  `;
  const params = [...scope.params];
  if (module_id) { sql += ' AND u.module_id = ?'; params.push(module_id); }
  sql += ' ORDER BY g.bit_date DESC, g.full_name ASC';

  const guests = db.prepare(sql).all(...params).map((g) => {
    const cal = wg.getCalendarForGuest(g.id) || { weeks: [], consecutive_full_weeks: 0, total_attendances: 0, status: 'none' };
    return {
      id: g.id,
      full_name: g.full_name,
      distributor_name: g.distributor_name,
      module_number: g.module_number,
      color: g.color,
      color_manual: g.color_manual,
      bit_date: g.bit_date,
      power_talk_date: g.power_talk_date,
      current_stage: g.current_stage,
      consecutive_full_weeks: cal.consecutive_full_weeks,
      total_attendances: cal.total_attendances,
      status: cal.status,
      weeks: cal.weeks,
    };
  });

  let filtered = guests;
  if (filter === 'solid')      filtered = guests.filter((g) => g.consecutive_full_weeks >= 2);
  if (filter === 'irregular')  filtered = guests.filter((g) => g.status === 'yellow');
  if (filter === 'orange')     filtered = guests.filter((g) => g.color === 'orange');

  const summary = {
    solid:     guests.filter((g) => g.consecutive_full_weeks >= 2).length,
    irregular: guests.filter((g) => g.status === 'yellow').length,
    orange:    guests.filter((g) => g.color === 'orange').length,
    total:     guests.length,
  };
  res.json({ guests: filtered, summary });
});

// Listado de invitados con su estado WG (filtrable)
router.get('/guests', requireAuth, (req, res) => {
  const { status_filter, module_id } = req.query;
  const scope = scopeUsersClause(req.user, 'u');
  let sql = `
    SELECT g.*, u.full_name AS distributor_name, u.distributor_code,
           m.number AS module_number,
           pl.full_name AS productive_leader_name
    FROM guests g
    JOIN users u ON u.id = g.distributor_id
    LEFT JOIN modules m ON m.id = u.module_id
    LEFT JOIN users pl ON pl.id = u.productive_leader_id
    WHERE 1=1 ${scope.sql}
  `;
  const params = [...scope.params];
  if (module_id) { sql += ' AND u.module_id = ?'; params.push(module_id); }
  sql += ' ORDER BY g.created_at DESC';

  const rows = db.prepare(sql).all(...params).map((g) => ({
    ...g,
    wg: wg.calculateStatus(g.id),
  }));
  const filtered = status_filter
    ? rows.filter((r) => r.wg.status === status_filter)
    : rows;
  res.json({ guests: filtered });
});

// Comparación de tasa de firma: con vs sin 2 semanas consecutivas
router.get('/conversion-impact', requireAuth, (req, res) => {
  const scope = scopeUsersClause(req.user, 'u');
  const guests = db.prepare(`
    SELECT g.id, g.current_stage FROM guests g
    JOIN users u ON u.id = g.distributor_id
    WHERE 1=1 ${scope.sql}
  `).all(...scope.params);

  const buckets = { green: { total: 0, signed: 0 }, others: { total: 0, signed: 0 } };
  for (const g of guests) {
    const st = wg.calculateStatus(g.id);
    const bucket = st.status === 'green' ? buckets.green : buckets.others;
    bucket.total++;
    if (g.current_stage === 'FIRMADO') bucket.signed++;
  }
  res.json({
    green: {
      ...buckets.green,
      conversion_pct: buckets.green.total > 0 ? Math.round((buckets.green.signed / buckets.green.total) * 1000) / 10 : 0,
    },
    others: {
      ...buckets.others,
      conversion_pct: buckets.others.total > 0 ? Math.round((buckets.others.signed / buckets.others.total) * 1000) / 10 : 0,
    },
  });
});

module.exports = router;
