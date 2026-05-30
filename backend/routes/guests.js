const express = require('express');
const rateLimit = require('express-rate-limit');
const { customAlphabet } = require('nanoid');
const db = require('../db');
const { requireAuth, requireRole, scopeUsersClause } = require('../middleware/auth');
const { refreshUserBlock, isContactorUsable, CONTACTOR_ROLES } = require('../utils/blocking');
const { generateQrDataUrl, generateQrBuffer } = require('../utils/qrcode');
const { sendQrEmail } = require('../utils/email');
const colors = require('../utils/colors');
const { nextDistributorCode } = require('../utils/usercode');
const { nextOccurrenceForWeeklyEvent } = require('../utils/calendar');
const gam = require('../utils/gamification');
const bcrypt = require('bcryptjs');

const router = express.Router();
const tokenGen = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 24);

const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, espera un momento' },
});

// PÚBLICO — usado por la landing
router.post('/register', registerLimiter, async (req, res) => {
  const { full_name, email, phone, access_code } = req.body || {};
  if (!full_name || !email || !phone || !access_code) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  // Opción B: aceptamos los 4 roles como contactadores (distributor, PL, ML, SL).
  // El campo distributor_id en guests es el "id del contactador" — no requiere que sea distributor.
  const contactor = db.prepare('SELECT * FROM users WHERE distributor_code = ?')
    .get(String(access_code).toUpperCase().trim());
  if (!contactor || !CONTACTOR_ROLES.includes(contactor.role)) {
    return res.status(400).json({ error: 'Código de acceso inválido' });
  }

  refreshUserBlock(contactor.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(contactor.id);
  const usable = isContactorUsable(fresh);
  if (!usable.ok) {
    return res.status(403).json({
      error: 'Este código de acceso no se encuentra disponible en este momento. Contacta a tu invitador.',
    });
  }

  // Próximo B.O.M activo — se asigna automáticamente al invitado.
  let bomDate = null;
  try {
    const bomEv = db.prepare(`
      SELECT recurrence_days FROM events
       WHERE stage_target = 'BOM' AND active = 1 AND recurrence_type = 'weekly' LIMIT 1
    `).get();
    if (bomEv && bomEv.recurrence_days) bomDate = nextOccurrenceForWeeklyEvent(bomEv.recurrence_days);
  } catch (e) { /* sin BOM configurado, OK */ }

  const token = tokenGen();
  const info = db.prepare(`
    INSERT INTO guests (full_name, email, phone, distributor_id, qr_token, current_stage, bom_assigned_date)
    VALUES (?, ?, ?, ?, ?, 'REGISTRO', ?)
  `).run(full_name.trim(), email.toLowerCase().trim(), phone.trim(), contactor.id, token, bomDate);

  db.prepare(`
    INSERT INTO stage_history (guest_id, from_stage, to_stage, notes)
    VALUES (?, NULL, 'REGISTRO', 'Registro inicial vía landing')
  `).run(info.lastInsertRowid);

  // Generamos el QR UNA sola vez (buffer) y de ahí derivamos el data URL.
  // Antes se generaba 2 veces (buffer para email + dataUrl para respuesta).
  const qrPayload = `${process.env.PUBLIC_BASE_URL || ''}/g/${token}`;
  let qrBuffer, qrDataUrl;
  try {
    qrBuffer = await generateQrBuffer(qrPayload);
    qrDataUrl = `data:image/png;base64,${qrBuffer.toString('base64')}`;
  } catch (err) {
    console.error('[guests/register] qr generation error:', err.message);
    // Fallback al método antiguo si el buffer falla
    qrDataUrl = await generateQrDataUrl(qrPayload);
  }

  // Respondemos YA — sin esperar al SMTP. Si email falla/timea no afecta UX del registro.
  res.status(201).json({
    ok: true,
    guest_id: info.lastInsertRowid,
    qr_data_url: qrDataUrl,
    email_sent: 'pending', // el cliente sabe que el envío va aparte
  });

  // Fire-and-forget: enviamos el email después de responder.
  // Errores quedan en el log de Railway, no afectan al usuario.
  if (qrBuffer) {
    setImmediate(() => {
      sendQrEmail({ to: email, guestName: full_name, qrBuffer })
        .then((result) => {
          if (result.skipped) console.warn('[register/email] SMTP no configurado');
          else console.log(`[register/email] enviado a ${email}: ${result.messageId}`);
        })
        .catch((err) => {
          console.error(`[register/email] FALLO a ${email}:`, err.code || '', err.message);
          if (err.response) console.error('  SMTP response:', err.response);
        });
    });
  }
});

// LISTA — filtrada por jerarquía. Joins contra users (distributor) para aplicar scope
router.get('/', requireAuth, (req, res) => {
  const { module_id, stage, distributor_id, from, to, q, color } = req.query;
  const scope = scopeUsersClause(req.user, 'u');
  let sql = `
    SELECT g.*, u.full_name AS distributor_name, u.distributor_code,
           m.number AS module_number, m.name AS module_name,
           pl.full_name AS productive_leader_name,
           CASE WHEN g.bit_date IS NOT NULL AND g.current_stage != 'FIRMADO'
                THEN CAST(julianday('now') - julianday(g.bit_date) AS INTEGER) END AS days_since_bit
    FROM guests g
    JOIN users u ON u.id = g.distributor_id
    LEFT JOIN modules m ON m.id = u.module_id
    LEFT JOIN users pl ON pl.id = u.productive_leader_id
    WHERE 1=1 ${scope.sql}
  `;
  const params = [...scope.params];
  if (module_id)      { sql += ' AND u.module_id = ?'; params.push(module_id); }
  if (stage)          { sql += ' AND g.current_stage = ?'; params.push(stage); }
  if (color)          { sql += ' AND g.color = ?'; params.push(color); }
  if (distributor_id) { sql += ' AND g.distributor_id = ?'; params.push(distributor_id); }
  if (from)           { sql += ' AND date(g.created_at) >= ?'; params.push(from); }
  if (to)             { sql += ' AND date(g.created_at) <= ?'; params.push(to); }
  if (q) {
    sql += ' AND (g.full_name LIKE ? OR g.email LIKE ? OR g.phone LIKE ?)';
    const like = `%${q}%`; params.push(like, like, like);
  }
  sql += ' ORDER BY g.created_at DESC LIMIT 500';
  res.json({ guests: db.prepare(sql).all(...params) });
});

// Lookup por correo (fallback del scanner cuando el invitado no trae el QR).
// Devuelve la coincidencia más reciente NO firmada — incluye el qr_token para
// que el frontend pueda enviarlo al endpoint /api/events/scan al confirmar.
router.get('/by-email/:email', requireAuth, (req, res) => {
  const email = String(req.params.email).toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Correo requerido' });
  const row = db.prepare(`
    SELECT g.id, g.full_name, g.email, g.qr_token, g.current_stage, g.color, g.color_manual,
           g.bit_date, g.power_talk_date, g.signed_at,
           u.id AS distributor_id, u.full_name AS distributor_name, u.distributor_code,
           m.number AS module_number
    FROM guests g
    JOIN users u ON u.id = g.distributor_id
    LEFT JOIN modules m ON m.id = u.module_id
    WHERE g.email = ?
    ORDER BY g.signed_at IS NULL DESC, g.created_at DESC
    LIMIT 1
  `).get(email);
  if (!row) return res.status(404).json({ error: 'No se encontró un seguimiento con ese correo' });
  if (row.signed_at) return res.json({ guest: row, warning: 'Este invitado ya fue firmado — el QR del proceso queda inactivo.' });
  res.json({ guest: row });
});

// Lookup por token (preview del scanner — NO registra asistencia).
// Devuelve solo lo necesario para mostrar al líder antes de confirmar el scan.
router.get('/by-token/:token', requireAuth, (req, res) => {
  const cleanedToken = String(req.params.token).trim().split('/').pop();
  const g = db.prepare(`
    SELECT g.id, g.full_name, g.email, g.current_stage, g.color, g.color_manual,
           g.bit_date, g.power_talk_date, g.signed_at,
           u.id AS distributor_id, u.full_name AS distributor_name, u.distributor_code,
           m.number AS module_number
    FROM guests g
    JOIN users u ON u.id = g.distributor_id
    LEFT JOIN modules m ON m.id = u.module_id
    WHERE g.qr_token = ?
  `).get(cleanedToken);
  if (!g) return res.status(404).json({ error: 'QR no encontrado' });
  if (g.signed_at) return res.json({ guest: g, warning: 'Este invitado ya fue firmado — el QR del proceso queda inactivo.' });
  res.json({ guest: g });
});

router.get('/:id', requireAuth, (req, res) => {
  const guest = db.prepare(`
    SELECT g.*, u.full_name AS distributor_name, u.distributor_code, u.module_id,
           m.number AS module_number
    FROM guests g
    JOIN users u ON u.id = g.distributor_id
    LEFT JOIN modules m ON m.id = u.module_id
    WHERE g.id = ?
  `).get(req.params.id);
  if (!guest) return res.status(404).json({ error: 'Invitado no encontrado' });

  const history = db.prepare(`
    SELECT h.*, u.full_name AS scanned_by_name
    FROM stage_history h
    LEFT JOIN users u ON u.id = h.scanned_by
    WHERE h.guest_id = ? ORDER BY scanned_at ASC
  `).all(guest.id);
  res.json({ guest, history });
});

router.post('/:id/advance', requireAuth, (req, res) => {
  const { to_stage, notes } = req.body || {};
  const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(req.params.id);
  if (!guest) return res.status(404).json({ error: 'Invitado no encontrado' });

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  db.prepare(`
    UPDATE guests SET current_stage = ?, updated_at = datetime('now'),
      signed_at    = CASE WHEN ? = 'FIRMADO'    THEN datetime('now') ELSE signed_at END,
      signed_month = CASE WHEN ? = 'FIRMADO'    THEN ? ELSE signed_month END,
      bit_date     = CASE WHEN ? = 'BIT'        AND bit_date IS NULL        THEN ? ELSE bit_date END,
      power_talk_date = CASE WHEN ? = 'POWER_TALK' AND power_talk_date IS NULL THEN ? ELSE power_talk_date END
    WHERE id = ?
  `).run(to_stage, to_stage, to_stage, month, to_stage, today, to_stage, today, guest.id);

  db.prepare(`
    INSERT INTO stage_history (guest_id, from_stage, to_stage, scanned_by, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(guest.id, guest.current_stage, to_stage, req.user.id, notes || null);

  try { colors.refreshColor(guest.id); } catch (e) { console.error('[advance/color]', e.message); }
  res.json({ ok: true, guest: db.prepare('SELECT * FROM guests WHERE id = ?').get(guest.id) });
});

// Firma un guest: avanza a FIRMADO, sella signed_month, crea el users row asignándolo
// a la mesa correcta según el contactador.
router.post('/:id/sign', requireAuth, (req, res) => {
  const { notes, password } = req.body || {};
  const guest = db.prepare(`
    SELECT g.*, u.id AS contactor_id, u.role AS contactor_role,
           u.productive_leader_id AS contactor_pl_id, u.module_id AS contactor_module_id,
           u.full_name AS contactor_name
    FROM guests g JOIN users u ON u.id = g.distributor_id WHERE g.id = ?
  `).get(req.params.id);
  if (!guest) return res.status(404).json({ error: 'Invitado no encontrado' });
  if (guest.current_stage === 'FIRMADO') {
    return res.status(409).json({ error: 'El invitado ya está firmado' });
  }
  if (!guest.contactor_module_id) {
    return res.status(400).json({ error: 'Contactador sin módulo asignado — no se puede firmar' });
  }

  // Email único: si ya existe, fallar con mensaje claro
  const existing = db.prepare('SELECT id, distributor_code FROM users WHERE email = ?').get(guest.email);
  if (existing) {
    return res.status(409).json({
      error: 'Ya existe un usuario con este correo',
      existing_user_id: existing.id,
      existing_code: existing.distributor_code,
    });
  }

  // Determinar mesa: si contactador es PL, su mesa; sino, la mesa a la que pertenece.
  const newPlId = guest.contactor_role === 'productive_leader'
    ? guest.contactor_id
    : guest.contactor_pl_id;

  const moduleRow = db.prepare('SELECT number FROM modules WHERE id = ?').get(guest.contactor_module_id);
  if (!moduleRow) return res.status(500).json({ error: 'Módulo del contactador no encontrado' });

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const defaultPwd = password || process.env.DEFAULT_USER_PASSWORD || 'Sh2026!';
  const hash = bcrypt.hashSync(defaultPwd, 10);

  const tx = db.transaction(() => {
    const code = nextDistributorCode(moduleRow.number);
    const info = db.prepare(`
      INSERT INTO users (full_name, email, phone, distributor_code, password_hash,
                         role, module_id, productive_leader_id, firmado_por)
      VALUES (?, ?, ?, ?, ?, 'distributor', ?, ?, ?)
    `).run(
      guest.full_name, guest.email, guest.phone, code, hash,
      guest.contactor_module_id, newPlId, guest.contactor_id
    );

    db.prepare(`
      UPDATE guests SET current_stage = 'FIRMADO', signed_at = datetime('now'),
        signed_month = ?, updated_at = datetime('now') WHERE id = ?
    `).run(month, guest.id);

    db.prepare(`
      INSERT INTO stage_history (guest_id, from_stage, to_stage, scanned_by, notes)
      VALUES (?, ?, 'FIRMADO', ?, ?)
    `).run(guest.id, guest.current_stage, req.user.id,
           `Firma — nuevo código ${code}${notes ? ' · ' + notes : ''}`);

    return { newUserId: info.lastInsertRowid, code };
  });

  const { newUserId, code } = tx();
  try { colors.refreshColor(guest.id); } catch (e) { /* no critical */ }
  try { gam.onFirmado(guest.contactor_id, guest.id); } catch (e) { console.error('[sign/gamification]', e.message); }

  const newUser = db.prepare(`
    SELECT u.*, pl.full_name AS productive_leader_name, sp.full_name AS firmado_por_name,
           m.number AS module_number
    FROM users u
    LEFT JOIN users pl ON pl.id = u.productive_leader_id
    LEFT JOIN users sp ON sp.id = u.firmado_por
    LEFT JOIN modules m ON m.id = u.module_id
    WHERE u.id = ?
  `).get(newUserId);

  res.status(201).json({
    ok: true,
    new_user: newUser,
    distributor_code: code,
    default_password: defaultPwd,
    assignment_rule: guest.contactor_role === 'productive_leader'
      ? 'Contactador es Líder Productivo → asignado directo a su mesa'
      : 'Contactador no es PL → asignado a la mesa de su Líder Productivo',
  });
});

// Override manual de color — SOLO Líder de Sistema o Líder de Módulo (de su módulo)
router.patch('/:id/color', requireAuth, requireRole('system_leader', 'module_leader'), (req, res) => {
  const { color, notes } = req.body || {};
  if (!colors.VALID_COLORS.includes(color)) {
    return res.status(400).json({ error: 'Color inválido', valid: colors.VALID_COLORS });
  }
  const guest = db.prepare(`
    SELECT g.*, u.module_id AS owner_module_id FROM guests g
    JOIN users u ON u.id = g.distributor_id WHERE g.id = ?
  `).get(req.params.id);
  if (!guest) return res.status(404).json({ error: 'Invitado no encontrado' });

  // Líder de Módulo solo puede modificar guests de su propio módulo
  if (req.user.role === 'module_leader' && guest.owner_module_id !== req.user.module_id) {
    return res.status(403).json({ error: 'Fuera de tu módulo' });
  }

  const prev = guest.color;
  colors.applyColor(guest.id, color, { setByUserId: req.user.id, isManual: true });
  db.prepare(`
    INSERT INTO stage_history (guest_id, from_stage, to_stage, scanned_by, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(guest.id, guest.current_stage, guest.current_stage, req.user.id,
         `Color manual: ${prev} → ${color}${notes ? ' · ' + notes : ''}`);

  res.json({ ok: true, previous: prev, current: color, manual: true });
});

module.exports = router;
