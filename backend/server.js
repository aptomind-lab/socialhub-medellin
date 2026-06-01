require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();

// CORS: acepta uno o varios orígenes separados por coma en FRONTEND_URL.
// Si no se configura, permite cualquier origen (útil en local).
const allowedOrigins = (process.env.FRONTEND_URL || '*').split(',').map((s) => s.trim());
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('No permitido por CORS: ' + origin));
  },
  credentials: false,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/landing', express.static(path.join(__dirname, '..', 'landing')));
app.use('/dashboard', express.static(path.join(__dirname, '..', 'dashboard')));
app.use('/scanner', express.static(path.join(__dirname, '..', 'scanner')));

app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Gate de onboarding: si el cliente trae un token válido pero el usuario
// no completó el perfil o debe cambiar la pwd, bloqueamos las rutas no exentas.
// Rutas exentas: /api/auth/* (login, me, complete-profile, change-password).
// El gate NO autentica; solo verifica el token si está presente.
const jwt = require('jsonwebtoken');
const db0 = require('./db');
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || req.path.startsWith('/api/auth/')) return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(); // sin token: el handler decidirá (requireAuth o público)
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const u = db0.prepare(
      'SELECT profile_completed, password_must_change FROM users WHERE id = ?'
    ).get(payload.id);
    if (u && (!u.profile_completed || u.password_must_change)) {
      return res.status(428).json({
        error: 'Debes completar tu perfil antes de continuar',
        profile_completed: !!u.profile_completed,
        password_must_change: !!u.password_must_change,
      });
    }
  } catch (_e) { /* token inválido: dejar que el handler responda 401 */ }
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/modules', require('./routes/modules'));
app.use('/api/users', require('./routes/users'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/guests', require('./routes/guests'));
app.use('/api/events', require('./routes/events'));
app.use('/api/wg', require('./routes/wg'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/team', require('./routes/team'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/gamification', require('./routes/gamification'));
app.use('/api/rankings', require('./routes/rankings'));

app.get('/g/:token', (req, res) => {
  const db = require('./db');
  const guest = db.prepare(`SELECT g.full_name, g.current_stage FROM guests g WHERE g.qr_token = ?`).get(req.params.token);
  if (!guest) return res.status(404).send('QR inválido');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SocialHub Medellín</title>
    <style>body{margin:0;background:#0B1B2B;color:#F5EFE2;font-family:Georgia,serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;}
    .card{border:1px solid #C9A24A;border-radius:14px;padding:40px;max-width:420px;}
    h1{font-weight:400;font-size:30px;margin:0 0 14px;}
    .label{font-size:11px;letter-spacing:6px;color:#C9A24A;text-transform:uppercase;}</style>
    </head><body><div class="card">
    <div class="label">SocialHub Medellín</div>
    <h1>${guest.full_name}</h1>
    <p style="color:#8FA3B8;">Acceso confirmado</p></div></body></html>`);
});

try {
  const db = require('./db');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  let needsSeed = !tables;
  if (tables) {
    // Tabla existe pero ¿hay usuarios? Si está vacía, también sembrar.
    const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
    if (userCount === 0) needsSeed = true;
  }
  if (needsSeed) {
    console.log('Inicializando base de datos (auto-seed)...');
    require('./db/init');
  }
} catch (err) {
  console.error('Error inicializando DB:', err);
}

setInterval(() => {
  try { require('./utils/blocking').refreshAllUserBlocks(); }
  catch (e) { console.error('[block-refresh]', e.message); }
}, 15 * 60 * 1000);

// Scheduler de colores: cada hora revisa si cambió el día o el mes.
// runDailyColorRefresh es idempotente; correrla varias veces al día no hace daño.
const colorState = { lastDay: null, lastMonth: null };
function runColorScheduler() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  try {
    const colors = require('./utils/colors');
    if (colorState.lastMonth !== month) {
      const blacked = colors.applyMonthlyBlackTransition(now);
      if (blacked) console.log(`[colors] ${blacked} firmados pasados marcados NEGRO`);
      colorState.lastMonth = month;
    }
    if (colorState.lastDay !== today) {
      const changed = colors.runDailyColorRefresh(now);
      if (changed) console.log(`[colors] refresh diario: ${changed} cambios`);
      colorState.lastDay = today;
    }
  } catch (e) { console.error('[color-scheduler]', e.message); }
}
runColorScheduler();
setInterval(runColorScheduler, 60 * 60 * 1000);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✦ SocialHub Medellín API corriendo en http://localhost:${PORT}`);
});
