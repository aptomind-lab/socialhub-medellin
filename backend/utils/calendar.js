// Helpers de calendario: ISO week, día de la semana, recurrencia.

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAYS_ES = {
  sunday: 'Domingo',
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado',
};

function dayOfWeekKey(date = new Date()) {
  return DAYS[date.getUTCDay()];
}

function dayOfWeekLabel(date = new Date()) {
  return DAYS_ES[dayOfWeekKey(date)];
}

// ISO 8601 week: 'YYYY-WNN'
function getISOWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// Devuelve el lunes (UTC) de la semana ISO dada
function isoWeekToMonday(week) {
  const [y, w] = week.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (w - 1) * 7);
  return target;
}

function areConsecutiveISOWeeks(weekA, weekB) {
  const a = isoWeekToMonday(weekA);
  const b = isoWeekToMonday(weekB);
  const diffDays = Math.round((b - a) / 86400000);
  return diffDays === 7;
}

// ¿El evento ocurre hoy? Para weekly: today's day debe estar en recurrence_days CSV.
function eventHappensToday(event, refDate = new Date()) {
  if (event.recurrence_type === 'weekly') {
    if (!event.recurrence_days) return false;
    const today = dayOfWeekKey(refDate);
    return event.recurrence_days.split(',').map((s) => s.trim().toLowerCase()).includes(today);
  }
  // one_time
  return event.date === refDate.toISOString().slice(0, 10);
}

// Próxima ocurrencia (>= refDate) de un evento weekly según su CSV de días.
// Devuelve fecha ISO 'YYYY-MM-DD' o null si no hay días configurados.
function nextOccurrenceForWeeklyEvent(recurrenceDaysCsv, refDate = new Date()) {
  if (!recurrenceDaysCsv) return null;
  const days = recurrenceDaysCsv.split(',').map((s) => s.trim().toLowerCase());
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), refDate.getUTCDate() + i));
    const key = DAYS[d.getUTCDay()];
    if (days.includes(key)) return d.toISOString().slice(0, 10);
  }
  return null;
}

module.exports = {
  DAYS, DAYS_ES,
  dayOfWeekKey, dayOfWeekLabel,
  getISOWeek, isoWeekToMonday,
  areConsecutiveISOWeeks,
  eventHappensToday,
  nextOccurrenceForWeeklyEvent,
};
