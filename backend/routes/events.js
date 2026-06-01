const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { STAGES, SCANNABLE_STAGES, nextStageAfterScan, STAGE_LABELS } = require('../utils/stages');
const { eventHappensToday, dayOfWeekLabel, DAYS_ES, DAYS, getISOWeek, dayOfWeekKey, nextOccurrenceForWeeklyEvent } = require('../utils/calendar');
const wg = require('../utils/wg');
const colors = require('../utils/colors');
const gam = require('../utils/gamification');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const activeOnly = req.query.active_only === 'true';
  const todayOnly = req.query.today === 'true';

  // Filtro por sistema:
  //   lider_supremo → ve TODOS los eventos (todos los sistemas + globales)
  //   resto         → eventos de su sistema OR globales (system_id IS NULL)
  let scopeSql = '';
  const params = [];
  if (req.user.role !== 'lider_supremo') {
    scopeSql = ' AND (system_id = ? OR system_id IS NULL)';
    params.push(req.user.system_id);
  }

  const base = activeOnly
    ? `SELECT * FROM events WHERE active = 1 ${scopeSql} ORDER BY date DESC, id DESC`
    : `SELECT * FROM events WHERE 1=1 ${scopeSql} ORDER BY active DESC, date DESC, id DESC`;
  let events = db.prepare(base).all(...params);
  if (todayOnly) events = events.filter((ev) => eventHappensToday(ev));

  // Decorar con label legible de día
  events = events.map((ev) => ({
    ...ev,
    recurrence_days_label: ev.recurrence_days
      ? ev.recurrence_days.split(',').map((d) => DAYS_ES[d.trim()] || d.trim()).join(', ')
      : null,
  }));

  res.json({
    events,
    stages: STAGES,
    scannable_stages: SCANNABLE_STAGES,
    stage_labels: STAGE_LABELS,
    today_label: dayOfWeekLabel(),
  });
});

router.post('/', requireAuth, requireRole('lider_supremo', 'system_leader', 'module_leader'), (req, res) => {
  const { name, stage_target, date, recurrence_type, recurrence_days, system_id } = req.body || {};
  if (!name || !stage_target || !date) return res.status(400).json({ error: 'Faltan campos' });
  if (!SCANNABLE_STAGES.includes(stage_target)) return res.status(400).json({ error: 'Etapa inválida' });

  // system_id:
  //   lider_supremo → puede crear global (NULL) o específico (envía system_id)
  //   resto         → siempre del sistema propio
  let finalSystemId;
  if (req.user.role === 'lider_supremo') {
    finalSystemId = system_id === null ? null : (system_id ? parseInt(system_id, 10) : null);
  } else {
    finalSystemId = req.user.system_id;
  }

  const info = db.prepare(`
    INSERT INTO events (name, stage_target, date, recurrence_type, recurrence_days, system_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, stage_target, date, recurrence_type || 'one_time', recurrence_days || null, finalSystemId);
  res.status(201).json({ event: db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid) });
});

router.patch('/:id', requireAuth, requireRole('lider_supremo', 'system_leader', 'module_leader'), (req, res) => {
  const { name, stage_target, date, active, recurrence_type, recurrence_days } = req.body || {};
  const fields = [], values = [];
  if (name !== undefined)            { fields.push('name = ?');            values.push(name); }
  if (stage_target !== undefined) {
    if (!SCANNABLE_STAGES.includes(stage_target)) return res.status(400).json({ error: 'Etapa inválida' });
    fields.push('stage_target = ?'); values.push(stage_target);
  }
  if (date !== undefined)            { fields.push('date = ?');            values.push(date); }
  if (active !== undefined)          { fields.push('active = ?');          values.push(active ? 1 : 0); }
  if (recurrence_type !== undefined) { fields.push('recurrence_type = ?'); values.push(recurrence_type); }
  if (recurrence_days !== undefined) { fields.push('recurrence_days = ?'); values.push(recurrence_days || null); }
  if (!fields.length) return res.status(400).json({ error: 'Sin campos' });
  values.push(req.params.id);
  db.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ event: db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) });
});

router.delete('/:id', requireAuth, requireRole('lider_supremo', 'system_leader'), (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/scan', requireAuth, (req, res) => {
  const { event_id, qr_token } = req.body || {};
  if (!event_id || !qr_token) return res.status(400).json({ error: 'event_id y qr_token requeridos' });

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(event_id);
  if (!event) return res.status(404).json({ error: 'Evento no encontrado' });

  const cleanedToken = String(qr_token).trim().split('/').pop();
  const guest = db.prepare(`
    SELECT g.*, u.full_name AS distributor_name, m.number AS module_number
    FROM guests g
    JOIN users u ON u.id = g.distributor_id
    LEFT JOIN modules m ON m.id = u.module_id
    WHERE g.qr_token = ?
  `).get(cleanedToken);
  if (!guest) return res.status(404).json({ error: 'QR inválido o no encontrado' });

  const isWG = event.stage_target === 'WORKING_GROUP';
  // Plan de Trabajo (martes) registra Plan Trabajo Y el primer WG del martes con un solo scan.
  const isPlanTrabajo = event.stage_target === 'PLAN_TRABAJO';
  const newStage = nextStageAfterScan(guest.current_stage, event.stage_target);
  const advanced = newStage !== guest.current_stage;

  if (advanced) {
    db.prepare("UPDATE guests SET current_stage = ?, updated_at = datetime('now') WHERE id = ?")
      .run(newStage, guest.id);
    // Sellar fechas clave al alcanzar cada hito por primera vez
    const today = new Date().toISOString().slice(0, 10);
    if (newStage === 'BIT' && !guest.bit_date) {
      db.prepare(`UPDATE guests SET bit_date = ? WHERE id = ?`).run(today, guest.id);
    }
    if (newStage === 'POWER_TALK' && !guest.power_talk_date) {
      db.prepare(`UPDATE guests SET power_talk_date = ? WHERE id = ?`).run(today, guest.id);
    }
  }
  db.prepare(`
    INSERT INTO stage_history (guest_id, from_stage, to_stage, scanned_by, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(guest.id, guest.current_stage, advanced ? newStage : guest.current_stage,
         req.user.id, `${advanced ? 'Avance' : 'Re-scan'} en evento: ${event.name}`);

  // Asistencia WG: se registra si el evento es WG O si es Plan Trabajo (1-scan martes).
  let wgInfo = null;
  if (isWG || isPlanTrabajo) {
    const today = new Date();
    const att = wg.recordAttendance({ guestId: guest.id, scannedBy: req.user.id, refDate: today });
    const status = wg.calculateStatus(guest.id);
    wgInfo = {
      attended_date: att.attended_date,
      day_of_week: att.day_of_week,
      day_label: DAYS_ES[att.day_of_week],
      iso_week: att.iso_week,
      already_attended_today: !att.inserted,
      auto_from_plan_trabajo: isPlanTrabajo && !isWG,
      status,
    };
  }

  // Recalcular color tras cualquier scan (avance o re-scan a WG)
  let colorInfo = null;
  try {
    const res = colors.refreshColor(guest.id);
    if (res && res.changed) colorInfo = res;
  } catch (e) { console.error('[scan/color]', e.message); }

  // Gamificación: XP al contactador del guest (distributor_id) cuando hay avance real.
  try {
    if (advanced && newStage === 'BOM') gam.onShowScanned(guest.distributor_id, guest.id);
    if (advanced && newStage === 'BIT') gam.onBitScanned(guest.distributor_id, guest.id);
  } catch (e) { console.error('[scan/gamification]', e.message); }

  const updated = db.prepare('SELECT * FROM guests WHERE id = ?').get(guest.id);
  res.json({
    ok: true, advanced,
    guest: updated,
    previous_stage: guest.current_stage,
    new_stage: updated.current_stage,
    event,
    wg: wgInfo,
    color_changed: colorInfo,
  });
});

router.get('/scan/today-count', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM stage_history
    WHERE scanned_by = ? AND date(scanned_at) = ?
  `).get(req.user.id, today);
  res.json({ count: row.c });
});

// Próximo B.O.M activo (público — lo consume el landing para mostrar al invitado).
// El landing está fuera del flujo autenticado, así que NO usamos requireAuth aquí.
// Para que sea verdaderamente público hay que registrarlo en server.js antes del gate.
router.get('/next-bom-public', (req, res) => {
  const ev = db.prepare(`
    SELECT recurrence_days FROM events
     WHERE stage_target = 'BOM' AND active = 1 AND recurrence_type = 'weekly'
     LIMIT 1
  `).get();
  if (!ev || !ev.recurrence_days) {
    return res.status(404).json({ error: 'Sin B.O.M activo' });
  }
  const date = nextOccurrenceForWeeklyEvent(ev.recurrence_days, new Date());
  if (!date) return res.status(404).json({ error: 'Sin próxima ocurrencia' });
  const d = new Date(date + 'T00:00:00Z');
  const dayKey = DAYS[d.getUTCDay()];
  res.json({
    date,
    day_of_week: dayKey,
    day_label: DAYS_ES[dayKey],
    iso: date,
  });
});

module.exports = router;
