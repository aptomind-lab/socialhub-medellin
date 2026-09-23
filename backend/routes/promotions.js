const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { localDate } = require('../utils/tz');

const router = express.Router();

// Campaña vigente: LIFE STYLE DAY CARTAGENA. Un único ciclo largo (no mensual),
// retroactivo a septiembre 2026, en el que compiten TODOS los usuarios.
const PROMO_NAME  = 'LIFE STYLE DAY CARTAGENA';
const PROMO_START = '2026-09-01';
const PROMO_END   = '2027-04-30';

// Tamaño del ranking publicado y cuántos puestos quedan CALIFICADOS.
const TOP_LIMIT      = 80;
const QUALIFY_SLOTS  = 20;

// "100 BV Sorteo": mismo pool de registros que el Top 80 (misma tabla,
// mismo cycle_id) — solo se reagrupan por mes calendario. Un mes califica
// al sorteo si el usuario acumuló >= 100 BV en ese mes.
const QUALIFY_BV_SORTEO = 100;

// Lista de meses YYYY-MM entre dos fechas ISO, inclusive.
function monthsBetween(startIso, endIso) {
  const months = [];
  let [y, m] = startIso.split('-').map(Number);
  const [ey, em] = endIso.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

// Safety-net: garantiza que las tablas, la columna `name` y la campaña vigente
// existan en producción sin depender de correr las migraciones 016/019 a mano.
// Idempotente.
(function ensureTables() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS promotion_cycles (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        start_date  TEXT    NOT NULL,
        end_date    TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS promotions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cycle_id      INTEGER NOT NULL REFERENCES promotion_cycles(id) ON DELETE CASCADE,
        bv_personal   INTEGER NOT NULL,
        bv_type       TEXT    NOT NULL DEFAULT 'general',
        order_number  TEXT    NOT NULL,
        date          TEXT    NOT NULL,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_promotions_cycle ON promotions(cycle_id);
      CREATE INDEX IF NOT EXISTS idx_promotions_user  ON promotions(user_id);
      CREATE INDEX IF NOT EXISTS idx_promotions_bv    ON promotions(bv_personal);
    `);

    const hasName = db.prepare(`PRAGMA table_info(promotion_cycles)`).all().some((c) => c.name === 'name');
    if (!hasName) {
      db.exec(`ALTER TABLE promotion_cycles ADD COLUMN name TEXT`);
      db.prepare(`UPDATE promotion_cycles SET name = 'Ciclo BV mensual' WHERE name IS NULL`).run();
    }

    const hasBvType = db.prepare(`PRAGMA table_info(promotions)`).all().some((c) => c.name === 'bv_type');
    if (!hasBvType) {
      db.exec(`ALTER TABLE promotions ADD COLUMN bv_type TEXT NOT NULL DEFAULT 'general'`);
    }

    let cycle = db.prepare('SELECT * FROM promotion_cycles WHERE name = ?').get(PROMO_NAME);
    if (!cycle) {
      const info = db.prepare('INSERT INTO promotion_cycles (name, start_date, end_date) VALUES (?, ?, ?)')
        .run(PROMO_NAME, PROMO_START, PROMO_END);
      cycle = db.prepare('SELECT * FROM promotion_cycles WHERE id = ?').get(info.lastInsertRowid);
      // Retroactivo: los registros de sept-2026 en adelante pasan a esta campaña.
      db.prepare(`
        UPDATE promotions SET cycle_id = ?
        WHERE cycle_id != ? AND date >= ? AND date <= ?
      `).run(cycle.id, cycle.id, PROMO_START, PROMO_END);
    }
  } catch (e) { console.error('[promotions/ensure]', e.message); }
})();

// ¿Puede `actor` crear/editar un registro de BV de un usuario cuyo system_id es
// `targetSystemId`? lider_supremo: cualquiera. system_leader: solo su propio
// sistema. Resto: sin permiso de gestión (solo su propio registro, vía el flujo
// normal de POST / sin user_id).
function canManagePromotions(actor, targetSystemId) {
  if (actor.role === 'lider_supremo') return true;
  if (actor.role === 'system_leader') return targetSystemId === actor.system_id;
  return false;
}

// Eliminar es más amplio que editar: el líder de módulo también puede borrar
// registros de BV de los usuarios de SU módulo.
function canDeletePromotion(actor, target) {
  if (canManagePromotions(actor, target.system_id)) return true;
  if (actor.role === 'module_leader') {
    return actor.module_id != null && target.module_id === actor.module_id;
  }
  return false;
}

// Devuelve la campaña vigente hoy. Si ninguna cubre la fecha actual (la campaña
// todavía no arranca o ya cerró), se devuelve la más reciente para que el tablero
// siga mostrando las posiciones; el POST igual valida el rango de fechas.
function getCurrentCycle() {
  const today = localDate();
  return db.prepare(`
    SELECT * FROM promotion_cycles
    WHERE start_date <= ? AND end_date >= ?
    ORDER BY id DESC LIMIT 1
  `).get(today, today)
    || db.prepare('SELECT * FROM promotion_cycles ORDER BY id DESC LIMIT 1').get()
    || null;
}

// GET /api/promotions — campaña vigente + Top 80 + mis registros de la campaña.
router.get('/', requireAuth, (req, res) => {
  const cycle = getCurrentCycle();
  if (!cycle) return res.json({ cycle: null, top: [], my: [], qualify_slots: QUALIFY_SLOTS, qualify_cutoff: null });

  // Compiten TODOS los usuarios de la plataforma: se parte de `users` con LEFT
  // JOIN, así quien aún no registra BV aparece en 0 y ve cuánto le falta.
  // El BV es acumulativo, por eso cada usuario aparece una sola vez.
  const top = db.prepare(`
    SELECT
      u.id       AS user_id,
      u.full_name,
      COALESCE(SUM(p.bv_personal), 0) AS bv_personal,
      COUNT(p.id) AS orders_count,
      MAX(p.date) AS last_date
    FROM users u
    LEFT JOIN promotions p ON p.user_id = u.id AND p.cycle_id = ?
    WHERE u.blocked = 0
    GROUP BY u.id
    ORDER BY bv_personal DESC, u.full_name ASC
    LIMIT ${TOP_LIMIT}
  `).all(cycle.id);

  // Puntaje del puesto 20 = corte de calificación. Los puestos 21-80 muestran
  // cuánto les falta para alcanzarlo.
  const cutoffRow = top[QUALIFY_SLOTS - 1];
  const qualify_cutoff = cutoffRow ? cutoffRow.bv_personal : null;

  const my = db.prepare(`
    SELECT id, bv_personal, order_number, date, created_at
    FROM promotions WHERE cycle_id = ? AND user_id = ?
    ORDER BY created_at DESC
  `).all(cycle.id, req.user.id);

  res.json({ cycle, top, my, qualify_slots: QUALIFY_SLOTS, qualify_cutoff });
});

// GET /api/promotions/sorteo — "100 BV Sorteo": para CADA usuario de la
// plataforma (no solo el Top 80), su BV agrupado por mes calendario dentro
// de la campaña vigente, y si ese mes calificó (>= 100 BV). Mismo pool de
// registros que el Top 80 — un registro cuenta para ambas vistas a la vez.
router.get('/sorteo', requireAuth, (req, res) => {
  const cycle = getCurrentCycle();
  if (!cycle) return res.json({ cycle: null, months: [], users: [], qualify_bv: QUALIFY_BV_SORTEO });

  const months = monthsBetween(cycle.start_date, cycle.end_date);

  const rows = db.prepare(`
    SELECT p.user_id, strftime('%Y-%m', p.date) AS ym, SUM(p.bv_personal) AS bv
    FROM promotions p
    WHERE p.cycle_id = ?
    GROUP BY p.user_id, ym
  `).all(cycle.id);

  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, {});
    byUser.get(r.user_id)[r.ym] = r.bv;
  }

  const allUsers = db.prepare(`
    SELECT id, full_name FROM users WHERE blocked = 0 ORDER BY full_name ASC
  `).all();

  const users = allUsers.map((u) => {
    const monthly = byUser.get(u.id) || {};
    const monthsData = months.map((ym) => {
      const bv = monthly[ym] || 0;
      return { ym, bv, qualified: bv >= QUALIFY_BV_SORTEO };
    });
    return {
      user_id: u.id,
      full_name: u.full_name,
      months: monthsData,
      qualified_count: monthsData.filter((m) => m.qualified).length,
    };
  });

  res.json({ cycle, months, users, qualify_bv: QUALIFY_BV_SORTEO });
});

// POST /api/promotions — registrar BV/orden/fecha. Por defecto para el usuario
// autenticado; si se envía user_id de otro usuario, requiere que el actor sea
// system_leader (mismo sistema) o lider_supremo.
router.post('/', requireAuth, (req, res) => {
  const { bv_personal, order_number, date, user_id, confirm_duplicate, bv_type } = req.body || {};
  const bv = parseInt(bv_personal, 10);
  if (!Number.isFinite(bv) || bv < 0) return res.status(400).json({ error: 'BV inválido' });
  const type = bv_type === 'personal' ? 'personal' : 'general';
  const order = String(order_number || '').trim();
  if (!order) return res.status(400).json({ error: '# de Orden requerido' });
  if (!date) return res.status(400).json({ error: 'Fecha requerida' });

  let targetUserId = req.user.id;
  if (user_id != null && parseInt(user_id, 10) !== req.user.id) {
    const target = db.prepare('SELECT id, system_id FROM users WHERE id = ?').get(parseInt(user_id, 10));
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!canManagePromotions(req.user, target.system_id)) {
      return res.status(403).json({ error: 'No tienes permiso para registrar BV a nombre de este usuario' });
    }
    targetUserId = target.id;
  }

  const cycle = getCurrentCycle();
  if (!cycle) return res.status(500).json({ error: 'No hay ciclo vigente' });
  if (date < cycle.start_date || date > cycle.end_date) {
    return res.status(400).json({ error: `La fecha debe estar entre ${cycle.start_date} y ${cycle.end_date}` });
  }

  // Anti-duplicado: si el último registro de este MISMO tipo (general o
  // personal) para este usuario tiene exactamente el mismo BV, se pide
  // confirmación explícita antes de sumar. Se compara solo dentro del mismo
  // tipo — un BV general no bloquea un BV Personal con el mismo valor.
  if (!confirm_duplicate) {
    const last = db.prepare(`
      SELECT bv_personal, order_number, date FROM promotions
      WHERE cycle_id = ? AND user_id = ? AND bv_type = ?
      ORDER BY id DESC LIMIT 1
    `).get(cycle.id, targetUserId, type);
    if (last && last.bv_personal === bv) {
      const typeLabel = type === 'personal' ? 'BV Personal' : 'BV';
      return res.status(409).json({
        duplicate: true,
        bv_personal: bv,
        last,
        error: `¿Seguro que quieres agregar ${bv} ${typeLabel} de nuevo? Ya registraste este mismo valor.`,
      });
    }
  }

  const info = db.prepare(`
    INSERT INTO promotions (user_id, cycle_id, bv_personal, bv_type, order_number, date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(targetUserId, cycle.id, bv, type, order, date);

  res.status(201).json({
    id: info.lastInsertRowid,
    cycle,
  });
});

// GET /api/promotions/user/:userId — historial de registros del ciclo vigente
// para un usuario específico. Solo para roles con supervisión.
router.get('/user/:userId', requireAuth, (req, res) => {
  if (!['module_leader', 'system_leader', 'lider_supremo'].includes(req.user.role)) {
    return res.status(403).json({ error: 'No tienes permiso para ver historial' });
  }
  const userId = parseInt(req.params.userId, 10);
  if (!userId) return res.status(400).json({ error: 'userId inválido' });

  const user = db.prepare('SELECT id, full_name, system_id, module_id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const cycle = getCurrentCycle();
  if (!cycle) return res.json({ user, cycle: null, records: [], total: 0 });

  const records = db.prepare(`
    SELECT id, bv_personal, bv_type, order_number, date, created_at
    FROM promotions
    WHERE user_id = ? AND cycle_id = ?
    ORDER BY created_at DESC
  `).all(userId, cycle.id);

  const total = records.reduce((s, r) => s + r.bv_personal, 0);
  res.json({ user, cycle, records, total });
});

// PATCH /api/promotions/cycle — ajustar la fecha de corte del ciclo vigente.
// Solo lider_supremo y system_leader.
router.patch('/cycle', requireAuth, (req, res) => {
  if (!['lider_supremo', 'system_leader'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Solo Líder Supremo o Líder de Sistema pueden ajustar el ciclo' });
  }
  const { end_date } = req.body || {};
  if (!end_date) return res.status(400).json({ error: 'end_date requerido' });
  const cycle = getCurrentCycle();
  if (!cycle) return res.status(404).json({ error: 'Sin ciclo vigente' });
  if (end_date < cycle.start_date) {
    return res.status(400).json({ error: 'end_date no puede ser anterior al inicio del ciclo' });
  }
  db.prepare('UPDATE promotion_cycles SET end_date = ? WHERE id = ?').run(end_date, cycle.id);
  res.json({ ok: true, cycle: db.prepare('SELECT * FROM promotion_cycles WHERE id = ?').get(cycle.id) });
});

// PATCH /api/promotions/:id — editar bv_personal/order_number/date de un registro.
// Solo system_leader (mismo sistema del dueño del registro) o lider_supremo.
router.patch('/:id', requireAuth, (req, res) => {
  const record = db.prepare(`
    SELECT p.*, u.system_id AS user_system_id
    FROM promotions p JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `).get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Registro no encontrado' });
  if (!canManagePromotions(req.user, record.user_system_id)) {
    return res.status(403).json({ error: 'No tienes permiso para editar este registro' });
  }

  const { bv_personal, bv_type, order_number, date } = req.body || {};
  const fields = [], values = [];
  if (bv_personal !== undefined) {
    const bv = parseInt(bv_personal, 10);
    if (!Number.isFinite(bv) || bv < 0) return res.status(400).json({ error: 'BV inválido' });
    fields.push('bv_personal = ?'); values.push(bv);
  }
  if (bv_type !== undefined) {
    fields.push('bv_type = ?'); values.push(bv_type === 'personal' ? 'personal' : 'general');
  }
  if (order_number !== undefined) {
    const order = String(order_number).trim();
    if (!order) return res.status(400).json({ error: '# de Orden requerido' });
    fields.push('order_number = ?'); values.push(order);
  }
  if (date !== undefined) {
    const cycle = db.prepare('SELECT * FROM promotion_cycles WHERE id = ?').get(record.cycle_id);
    if (cycle && (date < cycle.start_date || date > cycle.end_date)) {
      return res.status(400).json({ error: `La fecha debe estar entre ${cycle.start_date} y ${cycle.end_date}` });
    }
    fields.push('date = ?'); values.push(date);
  }
  if (!fields.length) return res.status(400).json({ error: 'Sin campos para actualizar' });

  values.push(req.params.id);
  db.prepare(`UPDATE promotions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({
    ok: true,
    record: db.prepare('SELECT id, user_id, bv_personal, bv_type, order_number, date, created_at FROM promotions WHERE id = ?').get(req.params.id),
  });
});

// DELETE /api/promotions/:id — eliminar un registro de BV.
// lider_supremo: cualquiera. system_leader: su sistema. module_leader: su módulo.
router.delete('/:id', requireAuth, (req, res) => {
  const record = db.prepare(`
    SELECT p.id, u.system_id, u.module_id
    FROM promotions p JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `).get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Registro no encontrado' });
  if (!canDeletePromotion(req.user, record)) {
    return res.status(403).json({ error: 'No tienes permiso para eliminar este registro' });
  }
  db.prepare('DELETE FROM promotions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
