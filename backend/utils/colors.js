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

  // Días pasados ordenados cronológicamente. Filtros:
  //   1) NO futuros
  //   2) SOLO L-V (dow 1..5) — sábado y domingo NUNCA cuentan
  //   3) Posteriores al Power Talk (el guest no podía asistir antes de pasar PT)
  const ptDate = g.power_talk_date;
  const allPastDays = weeks.flatMap((w) => w.days
    .filter((d) => !d.is_future && d.day >= 1 && d.day <= 5 && d.date > ptDate)
    .map((d) => ({ ...d, week_number: w.week_number })));
  allPastDays.sort((a, b) => a.date.localeCompare(b.date));

  const totalMissed = allPastDays.filter((d) => !d.attended).length;

  // Faltas consecutivas ACTUALES (streak terminal). Asistir rompe el streak →
  // permite que un naranja vuelva a amarillo al asistir.
  let currentConsecMissed = 0;
  for (let i = allPastDays.length - 1; i >= 0; i--) {
    if (!allPastDays[i].attended) currentConsecMissed++;
    else break;
  }

  const details = {
    total_past_days: allPastDays.length,
    total_attended: wg ? wg.total_attendances : 0,
    total_missed: totalMissed,
    current_consec_missed: currentConsecMissed,
  };

  // Reglas (5 estados):
  //   2+ consecutivas → naranja
  //   1+ falta histórica → amarillo (incluye amarillo recuperado desde naranja)
  //   0 faltas         → verde
  if (currentConsecMissed >= 2) {
    return { color: COLORS.ORANGE, reason: `${currentConsecMissed} faltas WG consecutivas`, details };
  }
  if (totalMissed >= 1) {
    return { color: COLORS.YELLOW, reason: `${totalMissed} falta(s) en WG`, details };
  }
  return { color: COLORS.STRONG_GREEN, reason: 'Asistencia WG perfecta', details };
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
