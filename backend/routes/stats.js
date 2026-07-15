const express = require('express');
const db = require('../db');
const { requireAuth, scopeUsersClause } = require('../middleware/auth');
const { STAGES, STAGE_LABELS, MESA_OWNER_ROLES } = require('../utils/stages');

const router = express.Router();

function buildMonthRange(month) {
  const ref = month ? new Date(month + '-01T00:00:00Z') : new Date();
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { from, to, ym: `${y}-${String(m + 1).padStart(2, '0')}` };
}

function buildWeekRange(weekOffset = 0) {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7; // Lunes = 0
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day - 7 * weekOffset));
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

// ================= KPIs PRINCIPALES =================
router.get('/kpis', requireAuth, (req, res) => {
  const { module_id, system_id, month } = req.query;
  const { from, to, ym } = buildMonthRange(month);
  const scope = scopeUsersClause(req.user, 'u');

  // Filtro módulo (con validación de sistema)
  let moduleFilter = { sql: '', params: [] };
  if (module_id) {
    const m = db.prepare('SELECT system_id FROM modules WHERE id = ?').get(module_id);
    const allowed =
      req.user.role === 'lider_supremo' ||
      (req.user.role === 'system_leader' && m && m.system_id === req.user.system_id) ||
      parseInt(module_id, 10) === req.user.module_id;
    if (allowed) moduleFilter = { sql: ' AND u.module_id = ?', params: [module_id] };
  }
  // Filtro system (solo lider_supremo puede elegir; otros heredan via scope)
  let systemFilter = { sql: '', params: [] };
  if (system_id && req.user.role === 'lider_supremo') {
    systemFilter = { sql: ' AND u.system_id = ?', params: [system_id] };
  }
  const extra = moduleFilter.sql + systemFilter.sql;
  const extraP = [...moduleFilter.params, ...systemFilter.params];

  // KPI 1 — Socios Activos: usuarios con ≥2 días CONSECUTIVOS de actividad este mes (cualquier rol)
  const activePartners = db.prepare(`
    SELECT COUNT(DISTINCT a1.user_id) AS c
    FROM daily_activity a1
    JOIN daily_activity a2 ON a2.user_id = a1.user_id
      AND date(a2.date) = date(a1.date, '+1 day')
    JOIN users u ON u.id = a1.user_id
    WHERE a1.date BETWEEN ? AND ? AND a2.date BETWEEN ? AND ?
    ${scope.sql} ${extra}
  `).get(from, to, from, to, ...scope.params, ...extraP).c;

  // Total mensajes (mes) + count usuarios activos
  const totalMessages = db.prepare(`
    SELECT IFNULL(SUM(dm.messages), 0) AS total
    FROM daily_activity dm
    JOIN users u ON u.id = dm.user_id
    WHERE dm.date BETWEEN ? AND ?
    ${scope.sql} ${extra}
  `).get(from, to, ...scope.params, ...extraP).total;

  const activeUsers = db.prepare(`
    SELECT COUNT(DISTINCT dm.user_id) AS c
    FROM daily_activity dm
    JOIN users u ON u.id = dm.user_id
    WHERE dm.date BETWEEN ? AND ? AND (dm.messages > 0 OR dm.tiktok_minutes > 0)
    ${scope.sql} ${extra}
  `).get(from, to, ...scope.params, ...extraP).c;

  // KPI 2 — Promedio mensajes por usuario activo este mes
  const messagesPerActive = activeUsers > 0 ? Math.round((totalMessages / activeUsers) * 10) / 10 : 0;

  // KPI 3 — Conversión BIT→Firmado: invitados que pasaron por BIT este mes Y firmaron este mes / total BIT este mes
  const bitGuests = db.prepare(`
    SELECT COUNT(DISTINCT h.guest_id) AS c
    FROM stage_history h
    JOIN guests g ON g.id = h.guest_id
    JOIN users u ON u.id = g.distributor_id
    WHERE h.to_stage = 'BIT' AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
    ${scope.sql} ${extra}
  `).get(from, to, ...scope.params, ...extraP).c;

  const bitAndSigned = db.prepare(`
    SELECT COUNT(DISTINCT h_bit.guest_id) AS c
    FROM stage_history h_bit
    JOIN stage_history h_sig ON h_sig.guest_id = h_bit.guest_id AND h_sig.to_stage = 'FIRMADO'
      AND date(h_sig.scanned_at, '-5 hours') BETWEEN ? AND ?
    JOIN guests g ON g.id = h_bit.guest_id
    JOIN users u ON u.id = g.distributor_id
    WHERE h_bit.to_stage = 'BIT' AND date(h_bit.scanned_at, '-5 hours') BETWEEN ? AND ?
    ${scope.sql} ${extra}
  `).get(from, to, from, to, ...scope.params, ...extraP).c;

  const bitToSignedConversion = bitGuests > 0 ? Math.round((bitAndSigned / bitGuests) * 1000) / 10 : 0;

  const signedCount = db.prepare(`
    SELECT COUNT(*) AS c FROM stage_history h
    JOIN guests g ON g.id = h.guest_id
    JOIN users u ON u.id = g.distributor_id
    WHERE h.to_stage = 'FIRMADO' AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
    ${scope.sql} ${extra}
  `).get(from, to, ...scope.params, ...extraP).c;

  res.json({
    period: ym,
    range: { from, to },
    actor_role: req.user.role,
    kpis: {
      active_partners: activePartners,
      messages_per_active: messagesPerActive,
      active_users: activeUsers,
      total_messages: totalMessages,
      total_signed: signedCount,
      total_bit: bitGuests,
      bit_to_signed_pct: bitToSignedConversion,
    },
  });
});

// ================= EMBUDO =================
// Filtros respetan rol: SL puede module_id; ML puede productive_leader_id de su módulo;
// PL puede distributor_id de su mesa; distributor solo ve lo suyo (forzado por scope).
router.get('/funnel', requireAuth, (req, res) => {
  const { module_id, productive_leader_id, distributor_id, month, from: qFrom, to: qTo } = req.query;
  // Rango personalizado from/to ANULA el filtro de mes si se pasa.
  let from, to;
  if (qFrom && qTo) { from = qFrom; to = qTo; }
  else { ({ from, to } = buildMonthRange(month)); }
  const scope = scopeUsersClause(req.user, 'u');

  const extraFilters = [];
  const extraParams = [];

  if (module_id) {
    const m = db.prepare('SELECT system_id FROM modules WHERE id = ?').get(module_id);
    const allowed =
      req.user.role === 'lider_supremo' ||
      (req.user.role === 'system_leader' && m && m.system_id === req.user.system_id) ||
      parseInt(module_id, 10) === req.user.module_id;
    if (allowed) { extraFilters.push('u.module_id = ?'); extraParams.push(module_id); }
  }
  if (productive_leader_id) {
    // ML solo puede filtrar por PL de su propio módulo
    if (req.user.role === 'module_leader') {
      const pl = db.prepare('SELECT module_id FROM users WHERE id = ?').get(productive_leader_id);
      if (!pl || pl.module_id !== req.user.module_id) {
        return res.status(403).json({ error: 'Líder Productivo fuera de tu módulo' });
      }
    }
    extraFilters.push('(u.productive_leader_id = ? OR u.id = ?)'); extraParams.push(productive_leader_id, productive_leader_id);
  }
  if (distributor_id) {
    // PL solo puede filtrar por distributor de su mesa
    if (req.user.role === 'productive_leader') {
      const ds = db.prepare('SELECT productive_leader_id FROM users WHERE id = ?').get(distributor_id);
      if (!ds || ds.productive_leader_id !== req.user.id) {
        return res.status(403).json({ error: 'Profesional fuera de tu mesa' });
      }
    }
    extraFilters.push('u.id = ?'); extraParams.push(distributor_id);
  }
  const extraSql = extraFilters.length ? ' AND ' + extraFilters.join(' AND ') : '';

  // Etapas del embudo lineal — incluye paso virtual "BOLETOS" entre BOM y BIT.
  const FUNNEL_STAGES = ['REGISTRO', 'BOM', 'BOLETOS', 'BIT', 'POWER_TALK', 'PLAN_TRABAJO', 'FIRMADO'];
  const STAGE_LABEL_MAP = { ...STAGE_LABELS, BOLETOS: 'Boletos' };
  const stageCounts = {};
  const boletoBreakdown = {};
  for (const stage of FUNNEL_STAGES) {
    if (stage === 'BOLETOS') {
      // Suma de Pago + Abonado + No Pago (excluye No Interesado del conteo del embudo).
      const subs = ['BOLETO_PAGO','BOLETO_ABONADO','BOLETO_NO_PAGO'];
      let total = 0;
      for (const sub of subs) {
        const r = db.prepare(`
          SELECT COUNT(DISTINCT h.guest_id) AS c
          FROM stage_history h
          JOIN guests g ON g.id = h.guest_id
          JOIN users u ON u.id = g.distributor_id
          WHERE h.to_stage = ? AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
          ${scope.sql} ${extraSql}
        `).get(sub, from, to, ...scope.params, ...extraParams);
        boletoBreakdown[sub] = r.c;
        total += r.c;
      }
      // No interesado se cuenta aparte (no entra al embudo gráfico).
      const ni = db.prepare(`
        SELECT COUNT(DISTINCT h.guest_id) AS c
        FROM stage_history h
        JOIN guests g ON g.id = h.guest_id
        JOIN users u ON u.id = g.distributor_id
        WHERE h.to_stage = 'BOLETO_NO_INTERESADO' AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
        ${scope.sql} ${extraSql}
      `).get(from, to, ...scope.params, ...extraParams);
      boletoBreakdown.BOLETO_NO_INTERESADO = ni.c;
      stageCounts[stage] = total;
    } else {
      const row = db.prepare(`
        SELECT COUNT(DISTINCT h.guest_id) AS c
        FROM stage_history h
        JOIN guests g ON g.id = h.guest_id
        JOIN users u ON u.id = g.distributor_id
        WHERE h.to_stage = ? AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
        ${scope.sql} ${extraSql}
      `).get(stage, from, to, ...scope.params, ...extraParams);
      stageCounts[stage] = row.c;
    }
  }

  const funnel = FUNNEL_STAGES.map((s, i) => {
    const count = stageCounts[s];
    let conversion_pct = null;
    if (i > 0) {
      const prev = stageCounts[FUNNEL_STAGES[i - 1]];
      conversion_pct = prev > 0 ? Math.round((count / prev) * 1000) / 10 : 0;
    }
    const row = { stage: s, label: STAGE_LABEL_MAP[s], count, conversion_from_previous_pct: conversion_pct };
    if (s === 'BOLETOS') row.breakdown = boletoBreakdown;
    return row;
  });

  // INPUTS — Embudo dual con fuentes separadas:
  //   Tipo A: mensajes → books (columna `books`)
  //   Tipo B: tiktok_leads → tiktok_books (columna `tiktok_books`)
  // NUNCA se cruzan ni se duplican.
  const inputsRow = db.prepare(`
    SELECT IFNULL(SUM(a.messages), 0)       AS messages,
           IFNULL(SUM(a.books), 0)          AS books_messages,
           IFNULL(SUM(a.tiktok_leads), 0)   AS tiktok_leads,
           IFNULL(SUM(a.tiktok_books), 0)   AS books_tiktok
    FROM daily_activity a
    JOIN users u ON u.id = a.user_id
    WHERE a.date BETWEEN ? AND ? ${scope.sql} ${extraSql}
  `).get(from, to, ...scope.params, ...extraParams);

  const inputs = {
    messages: {
      count: inputsRow.messages,
      books: inputsRow.books_messages,
      to_books_pct: inputsRow.messages > 0 ? Math.round((inputsRow.books_messages / inputsRow.messages) * 1000) / 10 : 0,
    },
    tiktok_leads: {
      count: inputsRow.tiktok_leads,
      books: inputsRow.books_tiktok,
      to_books_pct: inputsRow.tiktok_leads > 0 ? Math.round((inputsRow.books_tiktok / inputsRow.tiktok_leads) * 1000) / 10 : 0,
    },
    books_total: inputsRow.books_messages + inputsRow.books_tiktok,
  };

  // WG sessions (WG1..WG9): distinct guests escaneados en algún evento con wg_session = N
  // dentro del rango. WG1 ya incluye scans de PLAN_TRABAJO porque su evento PT tiene wg_session=1.
  const wgSessions = {};
  for (let n = 1; n <= 9; n++) {
    const r = db.prepare(`
      SELECT COUNT(DISTINCT h.guest_id) AS c
      FROM stage_history h
      JOIN events e ON e.id = h.event_id
      JOIN guests g ON g.id = h.guest_id
      JOIN users u ON u.id = g.distributor_id
      WHERE e.wg_session = ?
        AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
        ${scope.sql} ${extraSql}
    `).get(n, from, to, ...scope.params, ...extraParams);
    wgSessions[`WG${n}`] = r.c;
  }

  res.json({ range: { from, to }, inputs, funnel, wg_sessions: wgSessions });
});

// ================= COMPARACIÓN POR MÓDULO (solo system_leader) =================
router.get('/by-module', requireAuth, (req, res) => {
  const { month } = req.query;
  const { from, to } = buildMonthRange(month);

  let modules;
  if (req.user.role === 'lider_supremo') {
    modules = db.prepare('SELECT * FROM modules ORDER BY system_id, number').all();
  } else if (req.user.role === 'system_leader') {
    // SOLO módulos del propio sistema — sin cross-system leak.
    modules = db.prepare('SELECT * FROM modules WHERE system_id = ? ORDER BY number').all(req.user.system_id);
  } else if (req.user.module_id) {
    modules = db.prepare('SELECT * FROM modules WHERE id = ?').all(req.user.module_id);
  } else {
    modules = [];
  }

  const rows = modules.map((m) => {
    const totalGuests = db.prepare(`
      SELECT COUNT(*) AS c FROM guests g
      JOIN users u ON u.id = g.distributor_id
      WHERE u.module_id = ? AND date(g.created_at) BETWEEN ? AND ?
    `).get(m.id, from, to).c;
    const signed = db.prepare(`
      SELECT COUNT(*) AS c FROM stage_history h
      JOIN guests g ON g.id = h.guest_id
      JOIN users u ON u.id = g.distributor_id
      WHERE h.to_stage = 'FIRMADO' AND u.module_id = ?
        AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
    `).get(m.id, from, to).c;
    const messages = db.prepare(`
      SELECT IFNULL(SUM(dm.messages), 0) AS t FROM daily_activity dm
      JOIN users u ON u.id = dm.user_id
      WHERE u.module_id = ? AND dm.date BETWEEN ? AND ?
    `).get(m.id, from, to).t;
    const activePartners = db.prepare(`
      SELECT COUNT(DISTINCT g.distributor_id) AS c FROM guests g
      JOIN users u ON u.id = g.distributor_id
      JOIN stage_history h ON h.guest_id = g.id AND h.to_stage = 'BOM'
      WHERE u.module_id = ? AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
    `).get(m.id, from, to).c;
    return {
      module_id: m.id, number: m.number, name: m.name,
      total_guests: totalGuests, total_signed: signed, total_messages: messages,
      active_partners: activePartners,
      messages_per_signed: signed > 0 ? Math.round((messages / signed) * 10) / 10 : null,
    };
  });
  res.json({ range: { from, to }, modules: rows });
});

// ================= SERIE MENSUAL =================
router.get('/monthly', requireAuth, (req, res) => {
  // Devuelve series DIARIA del mes actual: por día, # invitados nuevos + # firmas.
  const { module_id, system_id, month } = req.query;
  const { from, to } = buildMonthRange(month);
  const scope = scopeUsersClause(req.user, 'u');

  let moduleFilter = { sql: '', params: [] };
  if (module_id) {
    const m = db.prepare('SELECT system_id FROM modules WHERE id = ?').get(module_id);
    const allowed =
      req.user.role === 'lider_supremo' ||
      (req.user.role === 'system_leader' && m && m.system_id === req.user.system_id) ||
      parseInt(module_id, 10) === req.user.module_id;
    if (allowed) moduleFilter = { sql: ' AND u.module_id = ?', params: [module_id] };
  }
  let systemFilter = { sql: '', params: [] };
  if (system_id && req.user.role === 'lider_supremo') {
    systemFilter = { sql: ' AND u.system_id = ?', params: [system_id] };
  }
  const extra = moduleFilter.sql + systemFilter.sql;
  const extraP = [...moduleFilter.params, ...systemFilter.params];

  // Invitados creados por día
  const guestsByDay = db.prepare(`
    SELECT date(g.created_at) AS d, COUNT(*) AS c
    FROM guests g
    JOIN users u ON u.id = g.distributor_id
    WHERE date(g.created_at) BETWEEN ? AND ? ${scope.sql} ${extra}
    GROUP BY d
  `).all(from, to, ...scope.params, ...extraP);

  // Firmas por día (stage_history → FIRMADO)
  const signedByDay = db.prepare(`
    SELECT date(h.scanned_at, '-5 hours') AS d, COUNT(*) AS c
    FROM stage_history h
    JOIN guests g ON g.id = h.guest_id
    JOIN users u ON u.id = g.distributor_id
    WHERE h.to_stage = 'FIRMADO' AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ? ${scope.sql} ${extra}
    GROUP BY d
  `).all(from, to, ...scope.params, ...extraP);

  const guestsMap = Object.fromEntries(guestsByDay.map((r) => [r.d, r.c]));
  const signedMap = Object.fromEntries(signedByDay.map((r) => [r.d, r.c]));

  // Construir array con TODOS los días del rango (incluye días con 0)
  const out = [];
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    out.push({ day: k, guests: guestsMap[k] || 0, signed: signedMap[k] || 0 });
  }
  res.json({ monthly: out });
});

// ================= COMPARACIÓN SEMANAL Y MENSUAL =================
router.get('/comparison', requireAuth, (req, res) => {
  const scope = scopeUsersClause(req.user, 'u');
  let moduleFilter = { sql: '', params: [] };
  if (req.query.module_id) {
    const m = db.prepare('SELECT system_id FROM modules WHERE id = ?').get(req.query.module_id);
    const allowed =
      req.user.role === 'lider_supremo' ||
      (req.user.role === 'system_leader' && m && m.system_id === req.user.system_id) ||
      parseInt(req.query.module_id, 10) === req.user.module_id;
    if (allowed) moduleFilter = { sql: ' AND u.module_id = ?', params: [req.query.module_id] };
  }

  function metricsInRange(from, to) {
    const guests = db.prepare(`
      SELECT COUNT(*) AS c FROM guests g
      JOIN users u ON u.id = g.distributor_id
      WHERE date(g.created_at) BETWEEN ? AND ?
      ${scope.sql} ${moduleFilter.sql}
    `).get(from, to, ...scope.params, ...moduleFilter.params).c;
    const signed = db.prepare(`
      SELECT COUNT(*) AS c FROM stage_history h
      JOIN guests g ON g.id = h.guest_id
      JOIN users u ON u.id = g.distributor_id
      WHERE h.to_stage = 'FIRMADO' AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
      ${scope.sql} ${moduleFilter.sql}
    `).get(from, to, ...scope.params, ...moduleFilter.params).c;
    const bit = db.prepare(`
      SELECT COUNT(DISTINCT h.guest_id) AS c FROM stage_history h
      JOIN guests g ON g.id = h.guest_id
      JOIN users u ON u.id = g.distributor_id
      WHERE h.to_stage = 'BIT' AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
      ${scope.sql} ${moduleFilter.sql}
    `).get(from, to, ...scope.params, ...moduleFilter.params).c;
    const messages = db.prepare(`
      SELECT IFNULL(SUM(dm.messages),0) AS t FROM daily_activity dm
      JOIN users u ON u.id = dm.user_id
      WHERE dm.date BETWEEN ? AND ?
      ${scope.sql} ${moduleFilter.sql}
    `).get(from, to, ...scope.params, ...moduleFilter.params).t;
    return { from, to, guests, signed, bit, messages };
  }

  const thisWeek = buildWeekRange(0);
  const lastWeek = buildWeekRange(1);
  const thisMonth = buildMonthRange();
  const last = new Date(); last.setUTCMonth(last.getUTCMonth() - 1);
  const lastMonth = buildMonthRange(`${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}`);

  res.json({
    weekly: { current: metricsInRange(thisWeek.from, thisWeek.to), previous: metricsInRange(lastWeek.from, lastWeek.to) },
    monthly: { current: metricsInRange(thisMonth.from, thisMonth.to), previous: metricsInRange(lastMonth.from, lastMonth.to) },
  });
});

// ================= KPIs ESPECÍFICOS DE LÍDER PRODUCTIVO =================
// Para productive_leader (siempre su propia mesa) y para lider_modulo/sistema/supremo,
// que ahora también tienen mesa propia: por defecto ven la suya; pueden pasar
// productive_leader_id para ver otra mesa dentro de su scope.
router.get('/team', requireAuth, (req, res) => {
  const { week_offset = 0, productive_leader_id } = req.query;
  const targetPLId = req.user.role === 'productive_leader'
    ? req.user.id
    : (productive_leader_id
        ? parseInt(productive_leader_id, 10)
        : (MESA_OWNER_ROLES.includes(req.user.role) ? req.user.id : null));

  if (!targetPLId) return res.status(400).json({ error: 'productive_leader_id requerido para este rol' });

  // Si el actor no es system_leader, validar que la mesa pertenezca a su módulo
  const pl = db.prepare('SELECT * FROM users WHERE id = ?').get(targetPLId);
  if (!pl || !MESA_OWNER_ROLES.includes(pl.role)) return res.status(404).json({ error: 'Mesa no encontrada' });
  if (req.user.role === 'module_leader' && pl.module_id !== req.user.module_id) {
    return res.status(403).json({ error: 'Mesa fuera de tu módulo' });
  }

  const { from, to } = buildWeekRange(parseInt(week_offset, 10));

  // Mesa = distribuidores con productive_leader_id = pl.id
  const team = db.prepare(`
    SELECT u.id, u.full_name, u.distributor_code, u.blocked,
      IFNULL((SELECT SUM(dm.messages) FROM daily_activity dm WHERE dm.user_id = u.id AND dm.date BETWEEN ? AND ?), 0) AS messages_week,
      IFNULL((SELECT COUNT(*) FROM guests g WHERE g.distributor_id = u.id AND date(g.created_at) BETWEEN ? AND ?), 0) AS books_week,
      IFNULL((SELECT COUNT(DISTINCT h.guest_id) FROM stage_history h
              JOIN guests g ON g.id = h.guest_id
              WHERE g.distributor_id = u.id AND h.to_stage = 'BOM' AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?), 0) AS shows_week,
      IFNULL((SELECT COUNT(DISTINCT h.guest_id) FROM stage_history h
              JOIN guests g ON g.id = h.guest_id
              WHERE g.distributor_id = u.id AND h.to_stage = 'BIT' AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?), 0) AS bit_week
    FROM users u
    WHERE u.productive_leader_id = ? AND u.role = 'distributor'
    ORDER BY u.full_name
  `).all(from, to, from, to, from, to, from, to, targetPLId);

  // Totales
  const totalBooks = team.reduce((s, t) => s + t.books_week, 0);
  const totalShows = team.reduce((s, t) => s + t.shows_week, 0);
  const totalBit = team.reduce((s, t) => s + t.bit_week, 0);
  const totalMsgs = team.reduce((s, t) => s + t.messages_week, 0);

  res.json({
    productive_leader: { id: pl.id, full_name: pl.full_name, code: pl.distributor_code, module_id: pl.module_id },
    range: { from, to },
    team,
    totals: {
      books: totalBooks,
      shows: totalShows,
      bit: totalBit,
      messages: totalMsgs,
      shows_to_bit_pct: totalShows > 0 ? Math.round((totalBit / totalShows) * 1000) / 10 : 0,
      books_to_shows_pct: totalBooks > 0 ? Math.round((totalShows / totalBooks) * 1000) / 10 : 0,
    },
  });
});

// Lista de invitados que pasaron por una etapa del embudo dentro del rango.
// Para BOLETOS: incluye los 4 sub-estados y los devuelve ordenados Pago, Abonado, No Pago, No Interesado.
router.get('/funnel/guests', requireAuth, (req, res) => {
  const { stage, from, to, module_id, productive_leader_id, distributor_id } = req.query;
  if (!stage || !from || !to) return res.status(400).json({ error: 'stage, from, to son obligatorios' });
  const scope = scopeUsersClause(req.user, 'u');

  const extraFilters = [];
  const extraParams = [];
  if (module_id) {
    const m = db.prepare('SELECT system_id FROM modules WHERE id = ?').get(module_id);
    const allowed =
      req.user.role === 'lider_supremo' ||
      (req.user.role === 'system_leader' && m && m.system_id === req.user.system_id) ||
      parseInt(module_id, 10) === req.user.module_id;
    if (allowed) { extraFilters.push('u.module_id = ?'); extraParams.push(module_id); }
  }
  if (productive_leader_id) { extraFilters.push('(u.productive_leader_id = ? OR u.id = ?)'); extraParams.push(productive_leader_id, productive_leader_id); }
  if (distributor_id) { extraFilters.push('u.id = ?'); extraParams.push(distributor_id); }
  const extraSql = extraFilters.length ? ' AND ' + extraFilters.join(' AND ') : '';

  // WG1..WG9: filtra por wg_session del evento (no por to_stage).
  const wgMatch = /^WG([1-9])$/.exec(stage);
  let rows;
  if (wgMatch) {
    const n = parseInt(wgMatch[1], 10);
    const sql = `
      SELECT g.id, g.full_name, g.email, g.phone,
             u.full_name AS distributor_name,
             h.to_stage AS scan_stage, h.scanned_at, h.amount,
             e.name AS event_name,
             m.number AS module_number, s.nombre AS system_name
      FROM stage_history h
      JOIN events e ON e.id = h.event_id
      JOIN guests g ON g.id = h.guest_id
      JOIN users u ON u.id = g.distributor_id
      LEFT JOIN modules m ON m.id = u.module_id
      LEFT JOIN systems s ON s.id = u.system_id
      WHERE e.wg_session = ?
        AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
        ${scope.sql} ${extraSql}
      ORDER BY h.scanned_at DESC
    `;
    rows = db.prepare(sql).all(n, from, to, ...scope.params, ...extraParams);
    return res.json({ stage, from, to, guests: rows });
  }

  const stagesToQuery = stage === 'BOLETOS'
    ? ['BOLETO_PAGO','BOLETO_ABONADO','BOLETO_NO_PAGO','BOLETO_NO_INTERESADO']
    : [stage];
  const order = { BOLETO_PAGO: 1, BOLETO_ABONADO: 2, BOLETO_NO_PAGO: 3, BOLETO_NO_INTERESADO: 4 };

  const sql = `
    SELECT g.id, g.full_name, g.email, g.phone,
           u.full_name AS distributor_name,
           h.to_stage AS scan_stage, h.scanned_at, h.amount,
           m.number AS module_number, s.nombre AS system_name
    FROM stage_history h
    JOIN guests g ON g.id = h.guest_id
    JOIN users u ON u.id = g.distributor_id
    LEFT JOIN modules m ON m.id = u.module_id
    LEFT JOIN systems s ON s.id = u.system_id
    WHERE h.to_stage IN (${stagesToQuery.map(()=>'?').join(',')})
      AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
      ${scope.sql} ${extraSql}
    ORDER BY h.scanned_at DESC
  `;
  rows = db.prepare(sql).all(...stagesToQuery, from, to, ...scope.params, ...extraParams);

  // Si es BOLETOS, ordenar Pago → Abonado → NoPago → NoInteresado, luego por fecha desc.
  if (stage === 'BOLETOS') {
    rows.sort((a, b) => (order[a.scan_stage] - order[b.scan_stage]) || b.scanned_at.localeCompare(a.scanned_at));
  }

  res.json({ stage, from, to, guests: rows });
});

// Fechas B.I.T disponibles para el selector del embudo (Ciclo B.I.T).
// Retorna cada fecha con el número de invitados que tuvieron su BIT ese día,
// scoped por visibilidad del actor. Ordenado descendente. Acepta module_id opcional.
router.get('/funnel/bit-dates', requireAuth, (req, res) => {
  const { module_id } = req.query;
  const scope = scopeUsersClause(req.user, 'u');

  const extraFilters = [];
  const extraParams = [];
  if (module_id) {
    const m = db.prepare('SELECT system_id FROM modules WHERE id = ?').get(module_id);
    const allowed =
      req.user.role === 'lider_supremo' ||
      (req.user.role === 'system_leader' && m && m.system_id === req.user.system_id) ||
      parseInt(module_id, 10) === req.user.module_id;
    if (allowed) { extraFilters.push('u.module_id = ?'); extraParams.push(module_id); }
  }
  const extraSql = extraFilters.length ? ' AND ' + extraFilters.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT g.bit_date AS date, COUNT(*) AS count
    FROM guests g
    JOIN users u ON u.id = g.distributor_id
    WHERE g.bit_date IS NOT NULL
      ${scope.sql} ${extraSql}
    GROUP BY g.bit_date
    ORDER BY g.bit_date DESC
    LIMIT 60
  `).all(...scope.params, ...extraParams);

  res.json({ dates: rows });
});

// Ciclo B.I.T: cohort de guests cuyo primer BIT cae en el rango. Para cada uno:
//   - fechas clave (BIT/PT/PLAN_TRABAJO/FIRMADO)
//   - último escaneo y si está inactivo (3 días hábiles sin scan, no firmado)
//   - etapa en la que se inactivaron (la más alta alcanzada)
router.get('/funnel/bit-cycle', requireAuth, (req, res) => {
  const { from, to, module_id, productive_leader_id, distributor_id } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from, to son obligatorios' });
  const scope = scopeUsersClause(req.user, 'u');

  const extraFilters = [];
  const extraParams = [];
  if (module_id) {
    const m = db.prepare('SELECT system_id FROM modules WHERE id = ?').get(module_id);
    const allowed =
      req.user.role === 'lider_supremo' ||
      (req.user.role === 'system_leader' && m && m.system_id === req.user.system_id) ||
      parseInt(module_id, 10) === req.user.module_id;
    if (allowed) { extraFilters.push('u.module_id = ?'); extraParams.push(module_id); }
  }
  if (productive_leader_id) { extraFilters.push('(u.productive_leader_id = ? OR u.id = ?)'); extraParams.push(productive_leader_id, productive_leader_id); }
  if (distributor_id) { extraFilters.push('u.id = ?'); extraParams.push(distributor_id); }
  const extraSql = extraFilters.length ? ' AND ' + extraFilters.join(' AND ') : '';

  const guests = db.prepare(`
    SELECT g.id, g.full_name, g.email, g.phone, g.current_stage,
           g.bit_date, g.power_talk_date, g.signed_at,
           u.full_name AS distributor_name,
           m.number AS module_number,
           (SELECT MAX(scanned_at) FROM stage_history sh WHERE sh.guest_id = g.id) AS last_scan_at,
           (SELECT MIN(date(scanned_at, '-5 hours')) FROM stage_history sh
              WHERE sh.guest_id = g.id AND sh.to_stage = 'PLAN_TRABAJO') AS plan_trabajo_date
    FROM guests g
    JOIN users u ON u.id = g.distributor_id
    LEFT JOIN modules m ON m.id = u.module_id
    WHERE g.bit_date IS NOT NULL
      AND g.bit_date BETWEEN ? AND ?
      ${scope.sql} ${extraSql}
    ORDER BY g.bit_date DESC
  `).all(from, to, ...scope.params, ...extraParams);

  // 3 días hábiles desde hoy (Colombia local). Lun-Vie.
  function businessDaysAgo(n) {
    const d = new Date();
    // Convertir a Colombia local restando 5h
    d.setUTCHours(d.getUTCHours() - 5);
    let remaining = n;
    while (remaining > 0) {
      d.setUTCDate(d.getUTCDate() - 1);
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) remaining--;
    }
    return d.toISOString().slice(0, 10);
  }
  const inactiveThreshold = businessDaysAgo(3);

  const STAGE_ORDER = { REGISTRO:0, BOM:1, BOLETO_PAGO:2, BOLETO_ABONADO:2, BOLETO_NO_PAGO:2, BOLETO_NO_INTERESADO:2, BIT:3, POWER_TALK:4, PLAN_TRABAJO:5, FIRMADO:6 };
  const cohort = guests.map((g) => {
    const lastScanDate = g.last_scan_at ? String(g.last_scan_at).slice(0, 10) : null;
    const isSigned = g.current_stage === 'FIRMADO';
    const inactive = !isSigned && lastScanDate && lastScanDate < inactiveThreshold;
    return {
      ...g,
      last_scan_date: lastScanDate,
      inactive: !!inactive,
      stuck_at: inactive ? g.current_stage : null,
    };
  });

  // Conteos por etapa dentro del cohort (porcentaje sobre total cohort).
  const total = cohort.length;
  const stageCounts = { BIT: total, POWER_TALK: 0, PLAN_TRABAJO: 0, FIRMADO: 0, INACTIVE: 0 };
  cohort.forEach((g) => {
    if (g.power_talk_date) stageCounts.POWER_TALK++;
    if (g.plan_trabajo_date) stageCounts.PLAN_TRABAJO++;
    if (g.signed_at) stageCounts.FIRMADO++;
    if (g.inactive) stageCounts.INACTIVE++;
  });
  const stagePct = {};
  Object.entries(stageCounts).forEach(([k, v]) => { stagePct[k] = total ? Math.round((v / total) * 1000) / 10 : 0; });

  // Conteo de "se quedaron en" — por etapa más alta alcanzada de los inactivos.
  const stuckCounts = {};
  cohort.filter((g) => g.inactive).forEach((g) => {
    const s = g.stuck_at || 'UNKNOWN';
    stuckCounts[s] = (stuckCounts[s] || 0) + 1;
  });

  res.json({ from, to, total, cohort, stage_counts: stageCounts, stage_pct: stagePct, stuck_counts: stuckCounts });
});

module.exports = router;
