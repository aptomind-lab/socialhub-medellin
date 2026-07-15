// Productividad detallada por rol.
//   SL → comparación entre módulos
//   ML → producción por PL de su módulo
//   PL → productividad por integrante de su mesa
//   Profesional Activo → sus propios datos + sus seguimientos
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, scopeUsersClause } = require('../middleware/auth');
const { getISOWeek } = require('../utils/calendar');

const router = express.Router();

function rangeBounds() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';
  // Lunes de la semana actual
  const d = new Date();
  const dow = (d.getUTCDay() + 6) % 7; // L=0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
  const weekStart = monday.toISOString().slice(0, 10);
  return { today, weekStart, monthStart };
}

// Helper: para un user_id, devuelve mensajes hoy/sem/mes, books hoy/sem/mes,
// shows/bit semana, last_message_at, alert_no_messages_48h.
function statsForUser(userId, b) {
  const r = db.prepare(`
    SELECT
      (SELECT IFNULL(SUM(messages),0)       FROM daily_activity WHERE user_id=? AND date=?)              AS messages_today,
      (SELECT IFNULL(SUM(messages),0)       FROM daily_activity WHERE user_id=? AND date>=?)             AS messages_week,
      (SELECT IFNULL(SUM(messages),0)       FROM daily_activity WHERE user_id=? AND date>=?)             AS messages_month,
      (SELECT IFNULL(SUM(books),0)          FROM daily_activity WHERE user_id=? AND date=?)              AS books_today,
      (SELECT IFNULL(SUM(books),0)          FROM daily_activity WHERE user_id=? AND date>=?)             AS books_week,
      (SELECT IFNULL(SUM(books),0)          FROM daily_activity WHERE user_id=? AND date>=?)             AS books_month,
      (SELECT MAX(created_at) FROM daily_activity WHERE user_id=?)                                       AS last_message_at,
      (SELECT COUNT(DISTINCT h.guest_id) FROM stage_history h
         JOIN guests g ON g.id=h.guest_id
         WHERE g.distributor_id=? AND h.to_stage='BOM' AND date(h.scanned_at, '-5 hours')>=?)                     AS shows_week,
      (SELECT COUNT(DISTINCT h.guest_id) FROM stage_history h
         JOIN guests g ON g.id=h.guest_id
         WHERE g.distributor_id=? AND h.to_stage='BIT' AND date(h.scanned_at, '-5 hours')>=?)                     AS bit_week
  `).get(
    userId, b.today,
    userId, b.weekStart,
    userId, b.monthStart,
    userId, b.today,
    userId, b.weekStart,
    userId, b.monthStart,
    userId,
    userId, b.weekStart,
    userId, b.weekStart
  );

  const lastMs = r.last_message_at ? new Date(r.last_message_at + 'Z').getTime() : null;
  const hoursSince = lastMs ? Math.floor((Date.now() - lastMs) / 3600000) : null;
  return {
    ...r,
    hours_since_last: hoursSince,
    alert_no_messages_48h: hoursSince == null || hoursSince >= 48,
  };
}

// GET /api/team/productivity — la vista clásica (lista de distributors visibles).
router.get('/productivity', requireAuth, requireRole('lider_supremo', 'system_leader', 'module_leader', 'productive_leader'),
  (req, res) => {
    const b = rangeBounds();
    const scope = scopeUsersClause(req.user, 'u');
    const users = db.prepare(`
      SELECT u.id, u.full_name, u.distributor_code, u.active, u.role,
             m.number AS module_number, pl.full_name AS productive_leader_name
      FROM users u
      LEFT JOIN modules m ON m.id = u.module_id
      LEFT JOIN users pl ON pl.id = u.productive_leader_id
      WHERE u.role = 'distributor' ${scope.sql}
      ORDER BY u.full_name
    `).all(...scope.params);

    const team = users.map((u) => {
      const s = statsForUser(u.id, b);
      const signedMonth = db.prepare(`
        SELECT COUNT(*) AS c FROM guests g
        WHERE g.distributor_id=? AND g.current_stage='FIRMADO' AND g.signed_month=substr(?,1,7)
      `).get(u.id, b.today).c;
      return { ...u, ...s, total_guests_signed_month: signedMonth };
    });

    const totals = team.reduce((acc, t) => {
      acc.messages_today += t.messages_today;
      acc.messages_week  += t.messages_week;
      acc.messages_month += t.messages_month;
      acc.books_today    += t.books_today;
      acc.books_week     += t.books_week;
      acc.books_month    += t.books_month;
      acc.shows_week     += t.shows_week;
      acc.bit_week       += t.bit_week;
      acc.alerts_48h     += t.alert_no_messages_48h ? 1 : 0;
      acc.signed_month   += t.total_guests_signed_month;
      return acc;
    }, { messages_today: 0, messages_week: 0, messages_month: 0, books_today: 0, books_week: 0, books_month: 0, shows_week: 0, bit_week: 0, alerts_48h: 0, signed_month: 0 });

    totals.books_to_shows_pct = totals.books_week > 0 ? Math.round((totals.shows_week / totals.books_week) * 1000) / 10 : 0;
    totals.shows_to_bit_pct = totals.shows_week > 0 ? Math.round((totals.bit_week / totals.shows_week) * 1000) / 10 : 0;

    res.json({ reference: { ...b, iso_week: getISOWeek(new Date()) }, team, totals });
  }
);

// GET /api/team/role-breakdown — datos específicos para la sección "Mi equipo" por rol.
//   SL → por módulo (3, 5, 6, 12)
//   ML → por PL de su módulo
//   PL → por distributor de su mesa
//   Distributor → solo lo propio
router.get('/role-breakdown', requireAuth, (req, res) => {
  const b = rangeBounds();
  const role = req.user.role;

  // lider_supremo: comparativa global de sistemas (en el futuro habrá varios).
  if (role === 'lider_supremo') {
    const systems = db.prepare('SELECT id, nombre FROM systems WHERE active=1 ORDER BY id').all();
    const rows = systems.map((s) => {
      const r = db.prepare(`
        SELECT
          (SELECT IFNULL(SUM(dm.messages),0) FROM daily_activity dm
             JOIN users u ON u.id=dm.user_id WHERE u.system_id=? AND dm.date>=?) AS messages_month,
          (SELECT IFNULL(SUM(dm.books),0) FROM daily_activity dm
             JOIN users u ON u.id=dm.user_id WHERE u.system_id=? AND dm.date>=?) AS books_month,
          (SELECT COUNT(DISTINCT h.guest_id) FROM stage_history h
             JOIN guests g ON g.id=h.guest_id JOIN users u ON u.id=g.distributor_id
             WHERE u.system_id=? AND h.to_stage='BIT' AND date(h.scanned_at, '-5 hours')>=?) AS bit_month,
          (SELECT COUNT(*) FROM guests g JOIN users u ON u.id=g.distributor_id
             WHERE u.system_id=? AND g.current_stage='FIRMADO' AND g.signed_month=substr(?,1,7)) AS signed_month
      `).get(s.id, b.monthStart, s.id, b.monthStart, s.id, b.monthStart, s.id, b.today);
      return {
        kind: 'system',
        id: s.id, label: s.nombre, sublabel: 'Sistema',
        ...r,
        conversion_pct: r.bit_month > 0 ? Math.round((r.signed_month / r.bit_month) * 1000) / 10 : 0,
      };
    });
    return res.json({ kind: 'systems', reference: b, rows });
  }

  if (role === 'system_leader') {
    // Solo módulos del PROPIO sistema — nada cross-system.
    const modules = db.prepare(
      'SELECT id, number, name FROM modules WHERE active=1 AND system_id = ? ORDER BY number'
    ).all(req.user.system_id);
    const rows = modules.map((m) => {
      const r = db.prepare(`
        SELECT
          (SELECT IFNULL(SUM(dm.messages),0) FROM daily_activity dm
             JOIN users u ON u.id=dm.user_id WHERE u.module_id=? AND dm.date>=?) AS messages_month,
          (SELECT IFNULL(SUM(dm.books),0) FROM daily_activity dm
             JOIN users u ON u.id=dm.user_id WHERE u.module_id=? AND dm.date>=?) AS books_month,
          (SELECT COUNT(DISTINCT h.guest_id) FROM stage_history h
             JOIN guests g ON g.id=h.guest_id JOIN users u ON u.id=g.distributor_id
             WHERE u.module_id=? AND h.to_stage='BIT' AND date(h.scanned_at, '-5 hours')>=?) AS bit_month,
          (SELECT COUNT(*) FROM guests g JOIN users u ON u.id=g.distributor_id
             WHERE u.module_id=? AND g.current_stage='FIRMADO' AND g.signed_month=substr(?,1,7)) AS signed_month
      `).get(m.id, b.monthStart, m.id, b.monthStart, m.id, b.monthStart, m.id, b.today);
      return {
        kind: 'module',
        id: m.id, label: `Módulo ${m.number}`, sublabel: m.name,
        ...r,
        conversion_pct: r.bit_month > 0 ? Math.round((r.signed_month / r.bit_month) * 1000) / 10 : 0,
      };
    });
    return res.json({ kind: 'modules', reference: b, rows });
  }

  if (role === 'module_leader') {
    const pls = db.prepare(`
      SELECT id, full_name, distributor_code FROM users
      WHERE role='productive_leader' AND module_id=? AND active=1
      ORDER BY full_name
    `).all(req.user.module_id);
    // El lider_modulo también tiene su propia mesa personal — aparece en la
    // lista junto a los PLs de su módulo (sus invitados directos + su equipo).
    pls.push({ id: req.user.id, full_name: `${req.user.full_name} (tú)`, distributor_code: req.user.distributor_code });
    const rows = pls.map((p) => {
      // Métricas del PL (sí mismo) + su mesa
      const mesaIds = db.prepare('SELECT id FROM users WHERE productive_leader_id=? OR id=?').all(p.id, p.id).map(r => r.id);
      const placeholders = mesaIds.map(() => '?').join(',');
      const sum = (col, dateCol, from) => db.prepare(`
        SELECT IFNULL(SUM(${col}),0) AS s FROM daily_activity
         WHERE user_id IN (${placeholders}) AND ${dateCol}>=?
      `).get(...mesaIds, from).s;
      const countBitWeek = db.prepare(`
        SELECT COUNT(DISTINCT h.guest_id) AS c FROM stage_history h
        JOIN guests g ON g.id=h.guest_id
        WHERE g.distributor_id IN (${placeholders}) AND h.to_stage='BIT' AND date(h.scanned_at, '-5 hours')>=?
      `).get(...mesaIds, b.weekStart).c;
      const messages_today  = sum('messages', 'date', b.today);
      const messages_week   = sum('messages', 'date', b.weekStart);
      const messages_month  = sum('messages', 'date', b.monthStart);
      const books_month     = sum('books', 'date', b.monthStart);
      const signed_month = db.prepare(`
        SELECT COUNT(*) AS c FROM guests g
        WHERE g.distributor_id IN (${placeholders}) AND g.current_stage='FIRMADO'
          AND g.signed_month=substr(?,1,7)
      `).get(...mesaIds, b.today).c;
      const bit_month = db.prepare(`
        SELECT COUNT(DISTINCT h.guest_id) AS c FROM stage_history h
        JOIN guests g ON g.id=h.guest_id
        WHERE g.distributor_id IN (${placeholders}) AND h.to_stage='BIT' AND date(h.scanned_at, '-5 hours')>=?
      `).get(...mesaIds, b.monthStart).c;
      return {
        kind: 'productive_leader',
        id: p.id, label: p.full_name, sublabel: p.distributor_code,
        messages_today, messages_week, messages_month, books_month,
        bit_week: countBitWeek, bit_month, signed_month,
        conversion_pct: bit_month > 0 ? Math.round((signed_month / bit_month) * 1000) / 10 : 0,
      };
    });
    return res.json({ kind: 'productive_leaders', reference: b, rows });
  }

  if (role === 'productive_leader') {
    const ds = db.prepare(`
      SELECT id, full_name, distributor_code FROM users
      WHERE role='distributor' AND productive_leader_id=? AND active=1
      ORDER BY full_name
    `).all(req.user.id);
    const rows = ds.map((u) => {
      const s = statsForUser(u.id, b);
      return {
        kind: 'distributor',
        id: u.id, label: u.full_name, sublabel: u.distributor_code,
        ...s,
        conversion_pct: s.shows_week > 0 ? Math.round((s.bit_week / s.shows_week) * 1000) / 10 : 0,
      };
    });
    // Totales mesa
    const totals = rows.reduce((acc, r) => {
      acc.messages_today += r.messages_today;
      acc.messages_week  += r.messages_week;
      acc.messages_month += r.messages_month;
      acc.books_today    += r.books_today;
      acc.books_week     += r.books_week;
      acc.books_month    += r.books_month;
      acc.shows_week     += r.shows_week;
      acc.bit_week       += r.bit_week;
      return acc;
    }, { messages_today: 0, messages_week: 0, messages_month: 0, books_today: 0, books_week: 0, books_month: 0, shows_week: 0, bit_week: 0 });
    totals.books_to_shows_pct = totals.books_week > 0 ? Math.round((totals.shows_week / totals.books_week) * 1000) / 10 : 0;
    totals.shows_to_bit_pct   = totals.shows_week > 0 ? Math.round((totals.bit_week / totals.shows_week) * 1000) / 10 : 0;
    return res.json({ kind: 'mesa', reference: b, rows, totals });
  }

  // Profesional Activo
  const s = statsForUser(req.user.id, b);
  const myGuests = db.prepare(`
    SELECT id, full_name, current_stage, color, bit_date
    FROM guests WHERE distributor_id=? ORDER BY created_at DESC LIMIT 50
  `).all(req.user.id);
  return res.json({
    kind: 'self',
    reference: b,
    self: { ...s, books_to_message_pct: s.messages_month > 0 ? Math.round((s.books_month / s.messages_month) * 1000) / 10 : 0 },
    guests: myGuests,
  });
});

module.exports = router;
