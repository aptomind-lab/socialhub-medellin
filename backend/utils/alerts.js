// Centraliza la detección de alertas mostradas en el dashboard.
// Cada alerta es un objeto:
//   { type, severity, message, guest_id?, user_id?, link?, since? }
// type: 'orange_color' | 'no_messages_48h' | 'near_two_weeks_bit' | 'two_weeks_wg'
// severity: 'info' | 'warning' | 'critical'
const db = require('../db');
const { scopeUsersClause } = require('../middleware/auth');
const wg = require('./wg');

// Distribuidores que no registran mensajes hace más de 48hrs (sólo PL ve por defecto).
function noMessagesIn48h(actor) {
  const scope = scopeUsersClause(actor, 'u');
  const sql = `
    SELECT u.id, u.full_name, u.distributor_code,
           (SELECT MAX(created_at) FROM daily_messages dm WHERE dm.user_id = u.id) AS last_message_at,
           u.module_id
    FROM users u
    WHERE u.role = 'distributor' AND u.active = 1
    ${scope.sql}
  `;
  const rows = db.prepare(sql).all(...scope.params);
  const cutoffMs = Date.now() - 48 * 3600 * 1000;
  return rows
    .filter((r) => !r.last_message_at || new Date(r.last_message_at + 'Z').getTime() < cutoffMs)
    .map((r) => ({
      type: 'no_messages_48h',
      severity: 'warning',
      message: r.last_message_at
        ? `${r.full_name} (${r.distributor_code}) no actualiza mensajes hace ${Math.floor((Date.now() - new Date(r.last_message_at + 'Z').getTime()) / 3600000)}h`
        : `${r.full_name} (${r.distributor_code}) nunca ha registrado mensajes`,
      user_id: r.id,
      since: r.last_message_at,
    }));
}

// Guests en color naranja: visibles a PL y ML según scope.
function orangeColorGuests(actor) {
  const scope = scopeUsersClause(actor, 'u');
  const sql = `
    SELECT g.id, g.full_name, g.color, g.color_set_at, u.full_name AS distributor_name, u.distributor_code
    FROM guests g JOIN users u ON u.id = g.distributor_id
    WHERE g.color = 'orange' ${scope.sql}
  `;
  const rows = db.prepare(sql).all(...scope.params);
  return rows.map((r) => ({
    type: 'orange_color',
    severity: 'critical',
    message: `${r.full_name} entró en color naranja (2 faltas consecutivas)`,
    guest_id: r.id,
    since: r.color_set_at,
  }));
}

// Seguimientos cerca de cumplir 2 semanas desde B.I.T sin firmar — alerta amarilla.
// Umbral: bit_date entre 11 y 14 días atrás (ventana de aviso final).
function nearTwoWeeksBit(actor) {
  const scope = scopeUsersClause(actor, 'u');
  const sql = `
    SELECT g.id, g.full_name, g.bit_date, g.current_stage, u.full_name AS distributor_name
    FROM guests g JOIN users u ON u.id = g.distributor_id
    WHERE g.bit_date IS NOT NULL
      AND g.current_stage != 'FIRMADO'
      AND julianday('now') - julianday(g.bit_date) BETWEEN 11 AND 16
      ${scope.sql}
  `;
  const rows = db.prepare(sql).all(...scope.params);
  return rows.map((r) => {
    const days = Math.floor((Date.now() - new Date(r.bit_date + 'T00:00:00Z').getTime()) / 86400000);
    return {
      type: 'near_two_weeks_bit',
      severity: 'warning',
      message: `${r.full_name} lleva ${days} días desde B.I.T (${r.bit_date}) sin firmar`,
      guest_id: r.id,
      since: r.bit_date,
    };
  });
}

// Guests que completaron 2 semanas consecutivas de WG → destacar en verde.
function twoWeeksWg(actor) {
  const scope = scopeUsersClause(actor, 'u');
  const rows = db.prepare(`
    SELECT g.id, g.full_name FROM guests g
    JOIN users u ON u.id = g.distributor_id
    WHERE g.current_stage != 'FIRMADO'
      AND EXISTS (SELECT 1 FROM wg_attendance wa WHERE wa.guest_id = g.id)
      ${scope.sql}
  `).all(...scope.params);
  const out = [];
  for (const g of rows) {
    const st = wg.calculateStatus(g.id);
    if (st.max_consecutive_weeks >= 2 && st.status === 'green') {
      out.push({
        type: 'two_weeks_wg',
        severity: 'info',
        message: `${g.full_name} completó 2 semanas consecutivas de WG — alta probabilidad de firma`,
        guest_id: g.id,
      });
    }
  }
  return out;
}

function allAlerts(actor) {
  const buckets = {
    orange_color: orangeColorGuests(actor),
    near_two_weeks_bit: nearTwoWeeksBit(actor),
    two_weeks_wg: twoWeeksWg(actor),
    no_messages_48h: actor.role === 'productive_leader' || actor.role === 'module_leader' || actor.role === 'system_leader'
      ? noMessagesIn48h(actor)
      : [],
  };
  const flat = [
    ...buckets.orange_color,
    ...buckets.no_messages_48h,
    ...buckets.near_two_weeks_bit,
    ...buckets.two_weeks_wg,
  ];
  const counts = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]));
  return { alerts: flat, counts, total: flat.length };
}

module.exports = {
  orangeColorGuests,
  noMessagesIn48h,
  nearTwoWeeksBit,
  twoWeeksWg,
  allAlerts,
};
