const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { localDate } = require('../utils/tz');

const router = express.Router();

// Safety-net: garantiza que las tablas existan en producción sin depender de
// que se corra la migración 016 manualmente. Idempotente por IF NOT EXISTS.
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
        order_number  TEXT    NOT NULL,
        date          TEXT    NOT NULL,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_promotions_cycle ON promotions(cycle_id);
      CREATE INDEX IF NOT EXISTS idx_promotions_user  ON promotions(user_id);
      CREATE INDEX IF NOT EXISTS idx_promotions_bv    ON promotions(bv_personal);
    `);
    const c = db.prepare('SELECT COUNT(*) AS c FROM promotion_cycles').get().c;
    if (c === 0) {
      db.prepare('INSERT INTO promotion_cycles (start_date, end_date) VALUES (?, ?)')
        .run(localDate(), '2026-08-04');
    }
  } catch (e) { console.error('[promotions/ensure]', e.message); }
})();

// Suma n días a un YYYY-MM-DD.
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Dado un start_date (ej. día 5 del mes), calcula el fin del ciclo mensual
// como el día 4 del mes siguiente. Ej: 2026-08-05 → 2026-09-04.
function monthlyEndFrom(startIso) {
  const [y, m] = startIso.split('-').map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return `${nextY}-${String(nextM).padStart(2, '0')}-04`;
}

// ¿Puede `actor` gestionar (crear/editar/borrar) un registro de BV de un usuario
// cuyo system_id es `targetSystemId`? lider_supremo: cualquiera. system_leader:
// solo su propio sistema. Resto: sin permiso de gestión (solo su propio registro,
// vía el flujo normal de POST / sin user_id).
function canManagePromotions(actor, targetSystemId) {
  if (actor.role === 'lider_supremo') return true;
  if (actor.role === 'system_leader') return targetSystemId === actor.system_id;
  return false;
}

// Devuelve el ciclo vigente para hoy. Si el último ciclo ya venció, auto-crea
// el siguiente (start = último.end + 1 día, end = día 4 del mes siguiente),
// avanzando cuantas veces sea necesario si hubo un gap grande.
function getCurrentCycle() {
  const today = localDate();
  let cycle = db.prepare(`
    SELECT * FROM promotion_cycles
    WHERE start_date <= ? AND end_date >= ?
    ORDER BY id DESC LIMIT 1
  `).get(today, today);
  if (cycle) return cycle;

  const last = db.prepare('SELECT * FROM promotion_cycles ORDER BY id DESC LIMIT 1').get();
  if (!last) return null;

  let start = addDays(last.end_date, 1);
  let end   = monthlyEndFrom(start);
  while (today > end) {
    // gap: avanza un ciclo más
    start = addDays(end, 1);
    end   = monthlyEndFrom(start);
  }
  const info = db.prepare('INSERT INTO promotion_cycles (start_date, end_date) VALUES (?, ?)').run(start, end);
  return db.prepare('SELECT * FROM promotion_cycles WHERE id = ?').get(info.lastInsertRowid);
}

// GET /api/promotions — ciclo vigente + top 50 records + mis registros del ciclo.
router.get('/', requireAuth, (req, res) => {
  const cycle = getCurrentCycle();
  if (!cycle) return res.json({ cycle: null, top: [], my: [] });

  // Top 50 usuarios (no records): BV Personal es acumulativo dentro del ciclo,
  // así cada usuario aparece una sola vez con la suma de sus órdenes.
  const top = db.prepare(`
    SELECT
      u.id       AS user_id,
      u.full_name,
      SUM(p.bv_personal) AS bv_personal,
      COUNT(*)   AS orders_count,
      MAX(p.date) AS last_date
    FROM promotions p
    JOIN users u ON u.id = p.user_id
    WHERE p.cycle_id = ?
    GROUP BY u.id
    ORDER BY bv_personal DESC, u.full_name ASC
    LIMIT 50
  `).all(cycle.id);

  const my = db.prepare(`
    SELECT id, bv_personal, order_number, date, created_at
    FROM promotions WHERE cycle_id = ? AND user_id = ?
    ORDER BY created_at DESC
  `).all(cycle.id, req.user.id);

  res.json({ cycle, top, my });
});

// POST /api/promotions — registrar BV/orden/fecha. Por defecto para el usuario
// autenticado; si se envía user_id de otro usuario, requiere que el actor sea
// system_leader (mismo sistema) o lider_supremo.
router.post('/', requireAuth, (req, res) => {
  const { bv_personal, order_number, date, user_id } = req.body || {};
  const bv = parseInt(bv_personal, 10);
  if (!Number.isFinite(bv) || bv < 0) return res.status(400).json({ error: 'BV Personal inválido' });
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

  const info = db.prepare(`
    INSERT INTO promotions (user_id, cycle_id, bv_personal, order_number, date)
    VALUES (?, ?, ?, ?, ?)
  `).run(targetUserId, cycle.id, bv, order, date);

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

  const user = db.prepare('SELECT id, full_name, system_id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const cycle = getCurrentCycle();
  if (!cycle) return res.json({ user, cycle: null, records: [], total: 0 });

  const records = db.prepare(`
    SELECT id, bv_personal, order_number, date, created_at
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

  const { bv_personal, order_number, date } = req.body || {};
  const fields = [], values = [];
  if (bv_personal !== undefined) {
    const bv = parseInt(bv_personal, 10);
    if (!Number.isFinite(bv) || bv < 0) return res.status(400).json({ error: 'BV Personal inválido' });
    fields.push('bv_personal = ?'); values.push(bv);
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
    record: db.prepare('SELECT id, user_id, bv_personal, order_number, date, created_at FROM promotions WHERE id = ?').get(req.params.id),
  });
});

// DELETE /api/promotions/:id — eliminar un registro de BV.
// Solo system_leader (mismo sistema del dueño del registro) o lider_supremo.
router.delete('/:id', requireAuth, (req, res) => {
  const record = db.prepare(`
    SELECT p.id, u.system_id AS user_system_id
    FROM promotions p JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `).get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Registro no encontrado' });
  if (!canManagePromotions(req.user, record.user_system_id)) {
    return res.status(403).json({ error: 'No tienes permiso para eliminar este registro' });
  }
  db.prepare('DELETE FROM promotions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
