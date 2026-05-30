// Motor de gamificación: rachas, XP, logros.
// Diseño positivo — celebramos avances, no penalizamos faltas.
const db = require('../db');

const XP = {
  daily_activity: 10,
  book: 50,
  show: 75,
  bit: 150,
  firmado: 500,
};

const ACHIEVEMENTS = [
  { key: 'first_sign',      label: 'Primera Firma',     icon: '🎉', desc: 'Tu primer profesional firmado' },
  { key: 'streak_7',        label: 'En Racha',          icon: '🔥', desc: '7 días consecutivos activo' },
  { key: 'streak_30',       label: 'Constante',         icon: '⭐', desc: '30 días consecutivos activo' },
  { key: 'books_10_week',   label: 'Máquina de Books',  icon: '📚', desc: '10 books en una semana' },
  { key: 'tiktok_5h_week',  label: 'Live Master',       icon: '🎥', desc: '5 horas de TikTok Live en una semana' },
  { key: 'top_mesa_month',  label: 'Top Mesa',          icon: '👑', desc: 'Mejor conversión de tu mesa este mes' },
];

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // Lun=0
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() - dow);
  return m.toISOString().slice(0, 10);
}

function awardXp(userId, actionType, xp, refType = null, refId = null) {
  if (!xp || xp <= 0) return;
  db.prepare(`
    INSERT INTO xp_events (user_id, action_type, xp_earned, ref_type, ref_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, actionType, xp, refType, refId);
}

function totalXp(userId) {
  return db.prepare(`SELECT IFNULL(SUM(xp_earned), 0) AS t FROM xp_events WHERE user_id = ?`)
    .get(userId).t;
}

function getStreak(userId) {
  let s = db.prepare(`SELECT * FROM streaks WHERE user_id = ?`).get(userId);
  if (!s) {
    db.prepare(`INSERT INTO streaks (user_id) VALUES (?)`).run(userId);
    s = db.prepare(`SELECT * FROM streaks WHERE user_id = ?`).get(userId);
  }
  return s;
}

// Actualiza la racha del usuario para una fecha de actividad.
// Devuelve {current_streak, longest_streak, last_active_date, just_incremented}.
function updateStreakForDate(userId, dateStr) {
  const s = getStreak(userId);
  let newCurrent = s.current_streak;
  let justIncremented = false;

  if (!s.last_active_date) {
    newCurrent = 1;
    justIncremented = true;
  } else {
    const lastD = new Date(s.last_active_date + 'T00:00:00Z');
    const newD = new Date(dateStr + 'T00:00:00Z');
    const diffDays = Math.round((newD - lastD) / 86400000);
    if (diffDays === 0) return { ...s, just_incremented: false };
    if (diffDays === 1) { newCurrent = s.current_streak + 1; justIncremented = true; }
    else if (diffDays >= 2) { newCurrent = 1; justIncremented = true; }
    else return { ...s, just_incremented: false }; // fecha pasada, no toca
  }
  const longest = Math.max(newCurrent, s.longest_streak || 0);
  db.prepare(`
    UPDATE streaks SET current_streak = ?, longest_streak = ?, last_active_date = ?, updated_at = datetime('now')
     WHERE user_id = ?
  `).run(newCurrent, longest, dateStr, userId);
  return { user_id: userId, current_streak: newCurrent, longest_streak: longest, last_active_date: dateStr, just_incremented: justIncremented };
}

function unlock(userId, key) {
  try {
    db.prepare(`INSERT INTO achievements (user_id, achievement_key) VALUES (?, ?)`).run(userId, key);
    return true;
  } catch (e) { return false; } // UNIQUE conflict — ya desbloqueado
}

function getAchievements(userId) {
  return db.prepare(`SELECT achievement_key, unlocked_at FROM achievements WHERE user_id = ?`).all(userId);
}

// ─────── HOOKS PÚBLICOS ───────

// Llamado tras un POST de actividad diaria.
// prev/new: valores ANTES y DESPUÉS del UPSERT (para calcular delta de books).
function onActivityRegistered(userId, dateStr, prev, next) {
  const streak = updateStreakForDate(userId, dateStr);

  // XP por registrar el día — solo una vez por fecha.
  const exists = db.prepare(`
    SELECT 1 FROM xp_events WHERE user_id = ? AND action_type = 'daily_activity' AND ref_id = ?
  `).get(userId, _dateAsRefId(dateStr));
  if (!exists) awardXp(userId, 'daily_activity', XP.daily_activity, 'date', _dateAsRefId(dateStr));

  // XP por books NUEVOS (delta positivo).
  const bookDelta = Math.max(0, (next.books || 0) - (prev.books || 0));
  if (bookDelta > 0) awardXp(userId, 'book', XP.book * bookDelta, 'date', _dateAsRefId(dateStr));

  // Check logros semanales.
  const weekStart = mondayOf(dateStr);
  const weekStats = db.prepare(`
    SELECT IFNULL(SUM(books), 0) AS wb, IFNULL(SUM(tiktok_minutes), 0) AS wt
    FROM daily_activity WHERE user_id = ? AND date >= ?
  `).get(userId, weekStart);

  const unlocked = [];
  if (streak.current_streak >= 7  && unlock(userId, 'streak_7'))      unlocked.push('streak_7');
  if (streak.current_streak >= 30 && unlock(userId, 'streak_30'))     unlocked.push('streak_30');
  if (weekStats.wb >= 10          && unlock(userId, 'books_10_week')) unlocked.push('books_10_week');
  if (weekStats.wt >= 300         && unlock(userId, 'tiktok_5h_week'))unlocked.push('tiktok_5h_week');

  return { streak, unlocked };
}

function onShowScanned(userId, guestId) {
  awardXp(userId, 'show', XP.show, 'guest', guestId);
}
function onBitScanned(userId, guestId) {
  awardXp(userId, 'bit', XP.bit, 'guest', guestId);
}
function onFirmado(userId, guestId) {
  awardXp(userId, 'firmado', XP.firmado, 'guest', guestId);
  const totalSigns = db.prepare(`
    SELECT COUNT(*) AS c FROM xp_events WHERE user_id = ? AND action_type = 'firmado'
  `).get(userId).c;
  if (totalSigns === 1) unlock(userId, 'first_sign');
}

// Convierte 'YYYY-MM-DD' a un entero para usar como ref_id (sin colisiones).
function _dateAsRefId(dateStr) {
  return parseInt(dateStr.replace(/-/g, ''), 10);
}

module.exports = {
  XP, ACHIEVEMENTS,
  awardXp, totalXp,
  getStreak, updateStreakForDate,
  unlock, getAchievements,
  onActivityRegistered, onShowScanned, onBitScanned, onFirmado,
  mondayOf,
};
