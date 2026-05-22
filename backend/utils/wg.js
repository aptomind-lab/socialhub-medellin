// Working Group: calendario semanal de asistencia.
// Semana 1 = 4 días (Mar, Mié, Jue, Vie) — empieza el día después del Power Talk.
// Semana N (N≥2) = 5 días (Lun-Vie).
// Verde Fuerte = completó semana 1 entera sin faltar.
// "Sólido" / 2-semanas-consecutivas-completas = alta probabilidad de firma.
const db = require('../db');
const { getISOWeek, dayOfWeekKey, DAYS_ES } = require('./calendar');

const STATUS = {
  GREEN:  'green',   // 2+ semanas consecutivas COMPLETAS
  YELLOW: 'yellow',  // asistencia irregular (alguna semana incompleta o gap)
  RED:    'red',     // abandonó (>14 días sin asistir)
  NONE:   'none',    // nunca asistió
};

const STATUS_LABELS = {
  green:  'Sólido',
  yellow: 'Irregular',
  red:    'Abandonó',
  none:   'No ha asistido',
};

function fmt(d) { return d.toISOString().slice(0, 10); }
function parseDate(s) { return new Date(s + 'T00:00:00Z'); }
function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }

function recordAttendance({ guestId, scannedBy, refDate = new Date(), notes }) {
  const attendedDate = fmt(refDate);
  const dayKey = dayOfWeekKey(refDate);
  const week = getISOWeek(refDate);
  const exists = db.prepare(`
    SELECT id FROM wg_attendance WHERE guest_id = ? AND attended_date = ?
  `).get(guestId, attendedDate);
  let inserted = false;
  if (!exists) {
    db.prepare(`
      INSERT INTO wg_attendance (guest_id, attended_date, day_of_week, iso_week, scanned_by, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(guestId, attendedDate, dayKey, week, scannedBy || null, notes || null);
    inserted = true;
  }
  return { inserted, attended_date: attendedDate, day_of_week: dayKey, iso_week: week };
}

function getAttendanceForGuest(guestId) {
  return db.prepare(`
    SELECT attended_date, day_of_week, iso_week
    FROM wg_attendance WHERE guest_id = ?
    ORDER BY attended_date ASC
  `).all(guestId);
}

// Día de la semana 0=Sun, 1=Mon, ..., 5=Fri
function findMondayOnOrBefore(date) {
  const d = parseDate(fmt(date));
  const day = d.getUTCDay();
  const back = day === 0 ? 6 : day - 1; // distancia al lunes anterior
  return addDays(d, -back);
}

// Genera los días esperados de una semana específica desde el anchor (lunes de semana 0).
// Semana 1 = Mar, Mié, Jue, Vie (4 días, los días posteriores al lunes del Power Talk).
// Semana N (N≥2) = Lun, Mar, Mié, Jue, Vie (5 días).
function expectedDaysForWeek(anchorMondayDate, weekNumber) {
  const startOfWeekN = addDays(anchorMondayDate, (weekNumber - 1) * 7);
  if (weekNumber === 1) {
    // Tue=+1, Wed=+2, Thu=+3, Fri=+4
    return [1, 2, 3, 4].map((o) => addDays(startOfWeekN, o));
  }
  // Mon..Fri = +0..+4
  return [0, 1, 2, 3, 4].map((o) => addDays(startOfWeekN, o));
}

// Devuelve el calendario completo de WG de un guest desde su Power Talk (o primera asistencia)
// hasta la semana actual. Cada semana lleva sus días con attended true/false.
// La semana se considera "completa" solo cuando TODOS sus días pasaron y todos están asistidos.
function getCalendarForGuest(guestId, refDate = new Date()) {
  const g = db.prepare(`SELECT id, power_talk_date FROM guests WHERE id = ?`).get(guestId);
  if (!g) return null;

  const attendance = getAttendanceForGuest(guestId);
  const attendedSet = new Set(attendance.map((a) => a.attended_date));

  // Anchor: lunes de la semana del Power Talk; si no hay Power Talk, primera asistencia.
  let anchor = null;
  if (g.power_talk_date) {
    anchor = findMondayOnOrBefore(parseDate(g.power_talk_date));
  } else if (attendance.length) {
    anchor = findMondayOnOrBefore(parseDate(attendance[0].attended_date));
  }
  if (!anchor) return { weeks: [], anchor: null, total_attendances: 0 };

  const today = fmt(refDate);
  const weeks = [];
  for (let n = 1; n < 26; n++) { // límite de 26 semanas, suficiente para cualquier caso real
    const expected = expectedDaysForWeek(anchor, n);
    const weekStart = fmt(expected[0]);
    if (weekStart > today) break;
    const days = expected.map((d) => {
      const date = fmt(d);
      return {
        date,
        day: d.getUTCDay(),
        day_label: DAYS_ES[Object.keys(DAYS_ES)[d.getUTCDay()]] || '',
        is_future: date > today,
        attended: attendedSet.has(date),
      };
    });
    const past = days.filter((d) => !d.is_future);
    const allPast = past.length === days.length;
    const attendedCount = days.filter((d) => d.attended).length;
    const missed = past.filter((d) => !d.attended).length;
    weeks.push({
      week_number: n,
      anchor_date: weekStart,
      days,
      total_days: days.length,
      attended_count: attendedCount,
      missed_count: missed,
      week_complete: allPast && missed === 0 && attendedCount === days.length,
      week_finished: allPast,
    });
  }

  // Cadena máxima de semanas COMPLETAS consecutivas
  let maxConsec = 0, cur = 0;
  for (const w of weeks) {
    if (w.week_complete) { cur++; if (cur > maxConsec) maxConsec = cur; }
    else cur = 0;
  }

  const lastAttended = attendance.length ? attendance[attendance.length - 1].attended_date : null;
  const daysSinceLast = lastAttended
    ? Math.floor((refDate - new Date(lastAttended + 'T00:00:00Z')) / 86400000)
    : null;

  let status;
  if (!attendance.length) status = STATUS.NONE;
  else if (daysSinceLast > 14) status = STATUS.RED;
  else if (maxConsec >= 2) status = STATUS.GREEN;
  else status = STATUS.YELLOW;

  return {
    anchor_date: fmt(anchor),
    weeks,
    consecutive_full_weeks: maxConsec,
    total_attendances: attendance.length,
    last_attended: lastAttended,
    days_since_last: daysSinceLast,
    status,
    status_label: STATUS_LABELS[status],
  };
}

// Stub legacy para código que aún lo invoca.
function calculateStatus(guestId, refDate = new Date()) {
  const cal = getCalendarForGuest(guestId, refDate);
  if (!cal) return { status: STATUS.NONE, status_label: STATUS_LABELS.none, total_attendances: 0, total_weeks: 0, max_consecutive_weeks: 0, last_attended: null, days_since_last: null, weeks: [] };
  return {
    status: cal.status,
    status_label: cal.status_label,
    total_attendances: cal.total_attendances,
    total_weeks: cal.weeks.length,
    max_consecutive_weeks: cal.consecutive_full_weeks,
    last_attended: cal.last_attended,
    days_since_last: cal.days_since_last,
    weeks: cal.weeks.map((w) => w.anchor_date),
  };
}

// Resumen de estado WG dentro del scope visible.
// Buckets nuevos: green (2+ sem consec completas), irregular (yellow), orange (color del guest).
function summarizeForScope(scopeSqlClause, scopeParams) {
  const rows = db.prepare(`
    SELECT g.id, g.color FROM guests g
    JOIN users u ON u.id = g.distributor_id
    WHERE g.current_stage != 'FIRMADO'
      AND (EXISTS (SELECT 1 FROM wg_attendance wa WHERE wa.guest_id = g.id) OR g.power_talk_date IS NOT NULL)
      ${scopeSqlClause}
  `).all(...scopeParams);

  const counts = { green: 0, yellow: 0, orange: 0, red: 0, none: 0 };
  for (const g of rows) {
    if (g.color === 'orange') { counts.orange++; continue; }
    const st = calculateStatus(g.id);
    if (st.status === 'green') counts.green++;
    else if (st.status === 'red') counts.red++;
    else if (st.status === 'yellow') counts.yellow++;
    else counts.none++;
  }
  return { counts, total: rows.length };
}

module.exports = {
  STATUS,
  STATUS_LABELS,
  recordAttendance,
  getAttendanceForGuest,
  calculateStatus,
  getCalendarForGuest,
  summarizeForScope,
};
