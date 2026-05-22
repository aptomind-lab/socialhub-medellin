// Sistema de colores del seguimiento — basado en días WG asistidos.
// Estados:
//   'none'         → aún no pasa Power Talk
//   'light_green'  → pasó Power Talk, en curso de la semana, sin faltas todavía
//   'strong_green' → completó semana 1 entera (4 días Mar+Mié+Jue+Vie) sin faltar
//   'yellow'       → 1 falta (no consecutiva) — bajada desde Verde Claro/Fuerte
//   'orange'       → 2 faltas CONSECUTIVAS (alerta a Líder Productivo y Líder de Módulo)
//   'red'          → muerte del seguimiento — SOLO manual por Líder de Módulo
//   'black'        → firmado en un mes previo (facturación mensual)
//
// Cobertura de días esperados desde power_talk_date:
//   - Semana 1 (4 días): Martes, Miércoles, Jueves, Viernes
//   - Semana 2+ (5 días): Lunes, Martes, Miércoles, Jueves, Viernes
const db = require('../db');

const COLORS = {
  NONE:         'none',
  LIGHT_GREEN:  'light_green',
  STRONG_GREEN: 'strong_green',
  YELLOW:       'yellow',
  ORANGE:       'orange',
  RED:          'red',
  BLACK:        'black',
};

const COLOR_LABELS = {
  none:         'Sin color',
  light_green:  'Verde claro',
  strong_green: 'Verde fuerte',
  yellow:       'Amarillo',
  orange:       'Naranja',
  red:          'Rojo',
  black:        'Negro',
};

const VALID_COLORS = Object.values(COLORS);

function fmtDate(d) { return d.toISOString().slice(0, 10); }

// Calcula el color que CORRESPONDE al guest hoy (ignora color_manual).
// Devuelve { color, reason, details }.
function computeColorForGuest(guestId, refDate = new Date()) {
  const g = db.prepare(`SELECT * FROM guests WHERE id = ?`).get(guestId);
  if (!g) return null;

  const refStr = fmtDate(refDate);
  const currentMonth = refStr.slice(0, 7);

  // 1. NEGRO automático: firmado en mes anterior.
  if (g.signed_month && g.signed_month < currentMonth) {
    return { color: COLORS.BLACK, reason: `Firmado en ${g.signed_month}`, details: {} };
  }

  // 2. Firmado este mes → mantenemos color o lo subimos a verde fuerte.
  if (g.signed_month === currentMonth) {
    const c = g.color && g.color !== COLORS.NONE ? g.color : COLORS.STRONG_GREEN;
    return { color: c, reason: 'Firmado este mes', details: {} };
  }

  // 3. Sin Power Talk → sin color (todavía en embudo previo).
  if (!g.power_talk_date) {
    return { color: COLORS.NONE, reason: 'Aún no pasa Power Talk', details: {} };
  }

  // 4. Cargar calendario WG del guest (semanas con días attended/missed).
  const wg = require('./wg').getCalendarForGuest(guestId, refDate);
  const weeks = (wg && wg.weeks) || [];
  const week1 = weeks.find((w) => w.week_number === 1);
  const week2 = weeks.find((w) => w.week_number === 2);

  // Faltas consecutivas (sobre todos los días pasados, en orden cronológico).
  const allPastDays = weeks.flatMap((w) => w.days.filter((d) => !d.is_future)
    .map((d) => ({ ...d, week_number: w.week_number })));
  allPastDays.sort((a, b) => a.date.localeCompare(b.date));
  let maxConsecMissed = 0, cur = 0;
  for (const d of allPastDays) {
    if (!d.attended) { cur++; if (cur > maxConsecMissed) maxConsecMissed = cur; }
    else cur = 0;
  }

  const details = {
    week_1: week1 ? { complete: week1.week_complete, finished: week1.week_finished, missed: week1.missed_count } : null,
    week_2: week2 ? { complete: week2.week_complete, finished: week2.week_finished, missed: week2.missed_count } : null,
    total_attendances: wg ? wg.total_attendances : 0,
    max_consecutive_missed: maxConsecMissed,
  };

  // 5. Reglas en orden:
  if (maxConsecMissed >= 2) {
    return { color: COLORS.ORANGE, reason: '2 faltas consecutivas en WG', details };
  }

  // Sin asistencia aún a ningún día WG → Verde Claro (pasó Power Talk pero aún no entra a la semana)
  if (!wg || !wg.total_attendances) {
    return { color: COLORS.LIGHT_GREEN, reason: 'Pasó Power Talk, citado a Plan de Trabajo', details };
  }

  // Semana 1 todavía no termina
  if (!week1 || !week1.week_finished) {
    if (week1 && week1.missed_count >= 1) {
      return { color: COLORS.YELLOW, reason: `${week1.missed_count} falta(s) en semana 1`, details };
    }
    return { color: COLORS.LIGHT_GREEN, reason: 'En curso semana 1, sin faltas', details };
  }

  // Semana 1 cerrada
  if (week1.week_complete) {
    if (!week2 || !week2.week_finished) {
      // Aún en semana 2 — Verde Fuerte si no hay faltas hasta ahora
      if (week2 && week2.missed_count >= 1) {
        return { color: COLORS.LIGHT_GREEN, reason: 'Verde fuerte degradado por 1 falta en semana 2', details };
      }
      return { color: COLORS.STRONG_GREEN, reason: 'Semana 1 completa', details };
    }
    // Semana 2 también terminó
    if (week2.week_complete) {
      return { color: COLORS.STRONG_GREEN, reason: 'Semana 1 y 2 completas', details };
    }
    if (week2.missed_count === 1) {
      return { color: COLORS.LIGHT_GREEN, reason: 'Verde fuerte degradado por 1 falta en semana 2', details };
    }
    return { color: COLORS.YELLOW, reason: `${week2.missed_count} faltas en semana 2`, details };
  }

  // Semana 1 terminó con faltas → Amarillo (Naranja ya se filtró arriba)
  return { color: COLORS.YELLOW, reason: `${week1.missed_count} falta(s) en semana 1`, details };
}

// Aplica un color al guest (escribe en DB). isManual=true protege de futuros recálculos automáticos.
function applyColor(guestId, color, { setByUserId = null, isManual = false } = {}) {
  if (!VALID_COLORS.includes(color)) throw new Error(`Color inválido: ${color}`);
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE guests
       SET color = ?, color_set_at = ?, color_set_by = ?, color_manual = ?,
           updated_at = datetime('now')
     WHERE id = ?
  `).run(color, now, setByUserId, isManual ? 1 : 0, guestId);
}

// Recalcula el color para un guest específico y lo persiste si cambió.
// Respeta color_manual (no toca colores puestos por Líder de Módulo)
// EXCEPTO transición a NEGRO, que es facturación y siempre aplica.
function refreshColor(guestId, refDate = new Date()) {
  const g = db.prepare(`SELECT id, color, color_manual FROM guests WHERE id = ?`).get(guestId);
  if (!g) return null;
  const computed = computeColorForGuest(guestId, refDate);
  if (!computed) return null;

  // Permitir NEGRO automático siempre; otros respetan manual.
  const allowOverride = computed.color === COLORS.BLACK || !g.color_manual;
  if (!allowOverride) return { skipped: true, current: g.color, computed: computed.color };

  if (g.color !== computed.color) {
    applyColor(guestId, computed.color, { setByUserId: null, isManual: false });
    return { changed: true, from: g.color, to: computed.color, reason: computed.reason };
  }
  return { changed: false, current: g.color };
}

// Recorre TODOS los guests activos (no firmados en meses pasados con color ya negro)
// y refresca su color. Devuelve cantidad actualizada.
function runDailyColorRefresh(refDate = new Date()) {
  const rows = db.prepare(`SELECT id FROM guests`).all();
  let changed = 0;
  for (const r of rows) {
    const res = refreshColor(r.id, refDate);
    if (res && res.changed) changed++;
  }
  return changed;
}

// Marca NEGRO a todos los firmados con signed_month anterior al actual.
function applyMonthlyBlackTransition(refDate = new Date()) {
  const currentMonth = fmtDate(refDate).slice(0, 7);
  const r = db.prepare(`
    UPDATE guests SET color = 'black', color_set_at = datetime('now'),
           color_set_by = NULL, color_manual = 0, updated_at = datetime('now')
     WHERE signed_month IS NOT NULL AND signed_month < ? AND color != 'black'
  `).run(currentMonth);
  return r.changes;
}

module.exports = {
  COLORS,
  COLOR_LABELS,
  VALID_COLORS,
  computeColorForGuest,
  refreshColor,
  applyColor,
  runDailyColorRefresh,
  applyMonthlyBlackTransition,
};
