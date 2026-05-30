// Endpoints de gamificación.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const gam = require('../utils/gamification');

const router = express.Router();

// Resumen del usuario actual: streak, XP, logros desbloqueados + catálogo.
router.get('/me', requireAuth, (req, res) => {
  const streak = gam.getStreak(req.user.id);
  const xpTotal = gam.totalXp(req.user.id);
  const unlocked = gam.getAchievements(req.user.id);
  const unlockedKeys = new Set(unlocked.map((a) => a.achievement_key));
  const catalog = gam.ACHIEVEMENTS.map((a) => ({
    ...a,
    unlocked: unlockedKeys.has(a.key),
    unlocked_at: unlocked.find((u) => u.achievement_key === a.key)?.unlocked_at || null,
  }));
  res.json({ streak, xp_total: xpTotal, achievements: catalog, xp_actions: gam.XP });
});

// Top 3 mesa esta semana — visible para integrantes de la mesa + niveles superiores.
router.get('/rankings/week', requireAuth, (req, res) => {
  const weekStart = gam.mondayOf(new Date().toISOString().slice(0, 10));

  // Encontrar la mesa del actor.
  let plId;
  if (req.user.role === 'productive_leader') plId = req.user.id;
  else if (req.user.role === 'distributor') plId = req.user.productive_leader_id;
  else if (req.user.role === 'module_leader' || req.user.role === 'system_leader') {
    // Para ML/SL devolvemos el ranking de su módulo (o todo).
    return res.json({ scope: 'module', rows: rankByModule(req.user, weekStart) });
  }
  if (!plId) return res.json({ scope: 'mesa', rows: [] });

  const rows = db.prepare(`
    SELECT u.id, u.full_name, u.distributor_code,
           IFNULL(SUM(xp.xp_earned), 0) AS xp
    FROM users u
    LEFT JOIN xp_events xp ON xp.user_id = u.id AND date(xp.created_at) >= ?
    WHERE (u.productive_leader_id = ? OR u.id = ?) AND u.active = 1
    GROUP BY u.id
    ORDER BY xp DESC
    LIMIT 10
  `).all(weekStart, plId, plId);
  res.json({ scope: 'mesa', week_start: weekStart, rows });
});

// Top 3 módulo este mes.
router.get('/rankings/month', requireAuth, (req, res) => {
  const monthStart = new Date().toISOString().slice(0, 7) + '-01';
  const moduleId = req.user.role === 'system_leader' ? (req.query.module_id || null) : req.user.module_id;
  if (!moduleId) return res.json({ scope: 'module', rows: [] });

  const rows = db.prepare(`
    SELECT u.id, u.full_name, u.distributor_code, u.role,
           IFNULL(SUM(xp.xp_earned), 0) AS xp
    FROM users u
    LEFT JOIN xp_events xp ON xp.user_id = u.id AND date(xp.created_at) >= ?
    WHERE u.module_id = ? AND u.active = 1
    GROUP BY u.id
    ORDER BY xp DESC
    LIMIT 10
  `).all(monthStart, moduleId);
  res.json({ scope: 'module', month_start: monthStart, rows });
});

function rankByModule(actor, weekStart) {
  const moduleClause = actor.role === 'system_leader' ? '' : 'AND u.module_id = ?';
  const params = actor.role === 'system_leader' ? [weekStart] : [weekStart, actor.module_id];
  return db.prepare(`
    SELECT u.id, u.full_name, u.distributor_code, u.role,
           IFNULL(SUM(xp.xp_earned), 0) AS xp
    FROM users u
    LEFT JOIN xp_events xp ON xp.user_id = u.id AND date(xp.created_at) >= ?
    WHERE u.active = 1 ${moduleClause}
    GROUP BY u.id
    ORDER BY xp DESC
    LIMIT 10
  `).all(...params);
}

module.exports = router;
