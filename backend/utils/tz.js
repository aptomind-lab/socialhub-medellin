// Colombia es UTC-5 sin DST. Centralizado para que filtros de fecha sobre
// stage_history (embudo, today-count) y sellos como bit_date se interpreten
// en hora local. El storage sigue siendo UTC (datetime('now')).
const TZ_OFFSET_HOURS = -5;
const SQL_TZ = `${TZ_OFFSET_HOURS} hours`; // p.ej. '-5 hours' para SQLite date(x, ...)

// Devuelve la fecha local Colombia en formato YYYY-MM-DD.
function localDate(d = new Date()) {
  const shifted = new Date(d.getTime() + TZ_OFFSET_HOURS * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

module.exports = { SQL_TZ, TZ_OFFSET_HOURS, localDate };
