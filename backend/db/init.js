require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./index');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// ── System default ──
const sysCount = db.prepare('SELECT COUNT(*) AS c FROM systems').get().c;
if (sysCount === 0) {
  db.prepare(`INSERT INTO systems (id, nombre) VALUES (1, 'SocialHub Medellín')`).run();
  console.log('✓ System default creado: SocialHub Medellín');
}

// ── Módulos ──
const moduleCount = db.prepare('SELECT COUNT(*) AS c FROM modules').get().c;
if (moduleCount === 0) {
  const insert = db.prepare('INSERT INTO modules (number, name, system_id) VALUES (?, ?, 1)');
  db.transaction(() => {
    insert.run(3,  'Módulo 3');
    insert.run(5,  'Módulo 5');
    insert.run(6,  'Módulo 6');
    insert.run(12, 'Módulo 12');
  })();
  console.log('✓ Módulos creados (3, 5, 6, 12)');
}

// ── Usuarios ──
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const defaultPassword = process.env.DEFAULT_USER_PASSWORD || 'Sh2026!';
  const hash = bcrypt.hashSync(defaultPassword, 10);

  const SYSTEM_ID = 1;
  const insertUser = db.prepare(`
    INSERT INTO users (full_name, email, phone, distributor_code, password_hash, role, system_id, module_id, productive_leader_id, bhip_rank)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const moduleIds = {};
  db.prepare('SELECT id, number FROM modules').all().forEach((m) => { moduleIds[m.number] = m.id; });

  db.transaction(() => {
    // ─ Líderes de Sistema (Diamante Negro) ─
    // JCM es lider_supremo (cross-system, system_id=NULL). Felipe queda como system_leader.
    insertUser.run('Juan Carlos Medellín', 'juancarlos@socialhubmedellin.com', '+57 300 100 0001', '1340', hash, 'lider_supremo', null, null, null, 'Diamante Negro');
    insertUser.run('Felipe Barrios',       'felipe@socialhubmedellin.com',     '+57 300 100 0002', 'FB002',  hash, 'system_leader', SYSTEM_ID, null, null, 'Diamante Negro');

    // ─ Líderes de Módulo (uno por módulo) ─
    const ml = (name, email, phone, code, modNum) =>
      insertUser.run(name, email, phone, code, hash, 'module_leader', SYSTEM_ID, moduleIds[modNum], null, 'Profesional');

    ml('Carolina Restrepo', 'carolina.lm@socialhub.test', '+57 300 200 0003', 'M3LD01',  3);
    ml('Andrés Vélez',      'andres.lm@socialhub.test',   '+57 300 200 0005', 'M5LD01',  5);
    ml('Laura Mejía',       'laura.lm@socialhub.test',    '+57 300 200 0006', 'M6LD01',  6);
    ml('Juan Pablo Gómez',  'jpg.lm@socialhub.test',      '+57 300 200 0012', 'M12LD1',  12);

    // ─ Líderes Productivos ─ (mesa = equipo directo)
    const pl = (name, email, phone, code, modNum) => {
      const r = insertUser.run(name, email, phone, code, hash, 'productive_leader', SYSTEM_ID, moduleIds[modNum], null, 'Profesional');
      return r.lastInsertRowid;
    };
    const sofia    = pl('Sofía López',     'sofia.pl@socialhub.test',    '+57 301 300 0301', 'M3PR01',  3);
    const diego    = pl('Diego Torres',    'diego.pl@socialhub.test',    '+57 301 300 0501', 'M5PR01',  5);
    const monica   = pl('Mónica Henao',    'monica.pl@socialhub.test',   '+57 301 300 0601', 'M6PR01',  6);
    const ricardo  = pl('Ricardo Aguilar', 'ricardo.pl@socialhub.test',  '+57 301 300 1201', 'M12PR1',  12);

    // ─ Distribuidores (Profesionales Activos) ─
    const ds = (name, email, phone, code, modNum, plId) =>
      insertUser.run(name, email, phone, code, hash, 'distributor', SYSTEM_ID, moduleIds[modNum], plId, 'Profesional');

    ds('Martín Sánchez',  'martin.ds@socialhub.test',  '+57 302 400 0301', 'M3DS01',  3,  sofia);
    ds('Valentina Cano',  'valentina.ds@socialhub.test', '+57 302 400 0302', 'M3DS02',  3,  sofia);
    ds('Camilo Henríquez', 'camilo.ds@socialhub.test', '+57 302 400 0501', 'M5DS01',  5,  diego);
    ds('Isabela Ruiz',    'isabela.ds@socialhub.test', '+57 302 400 0502', 'M5DS02',  5,  diego);
    ds('Ana Galvis',      'ana.ds@socialhub.test',     '+57 302 400 0601', 'M6DS01',  6,  monica);
    ds('Sebastián Toro',  'seb.ds@socialhub.test',     '+57 302 400 1201', 'M12DS1',  12, ricardo);
  })();

  console.log(`✓ Usuarios creados con contraseña por defecto: ${defaultPassword}`);
  console.log('  ┌─────────────────────┬──────────────────┬───────────┐');
  console.log('  │ Rol                 │ Nombre           │ Código    │');
  console.log('  ├─────────────────────┼──────────────────┼───────────┤');
  const all = db.prepare('SELECT role, full_name, distributor_code FROM users ORDER BY role, id').all();
  for (const u of all) {
    const role = ({system_leader:'Líder Sistema',module_leader:'Líder Módulo',productive_leader:'Líder Productivo',distributor:'Distribuidor'})[u.role];
    console.log(`  │ ${role.padEnd(19)} │ ${u.full_name.padEnd(16)} │ ${u.distributor_code.padEnd(9)} │`);
  }
  console.log('  └─────────────────────┴──────────────────┴───────────┘');
}

// ── Eventos del calendario semanal ──
// Todos los eventos son weekly (se repiten en los recurrence_days configurados).
// FIRMADO no es un evento, es cambio de estado manual.
const eventCount = db.prepare('SELECT COUNT(*) AS c FROM events').get().c;
if (eventCount === 0) {
  const today = new Date().toISOString().slice(0, 10);
  const ev = db.prepare(`
    INSERT INTO events (name, stage_target, date, recurrence_type, recurrence_days, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);
  ev.run('B.O.M (Apertura)',         'BOM',            today, 'weekly', 'tuesday,thursday,saturday');
  ev.run('Boleto Pago',              'BOLETO_PAGO',    today, 'weekly', 'tuesday,thursday,saturday');
  ev.run('Boleto Abonado',           'BOLETO_ABONADO', today, 'weekly', 'tuesday,thursday,saturday');
  ev.run('Boleto No Pago',           'BOLETO_NO_PAGO', today, 'weekly', 'tuesday,thursday,saturday');
  ev.run('B.I.T (Sábado)',           'BIT',            today, 'weekly', 'saturday');
  ev.run('Power Talk (Lunes)',       'POWER_TALK',     today, 'weekly', 'monday');
  ev.run('Plan de Trabajo (Martes)', 'PLAN_TRABAJO',   today, 'weekly', 'tuesday');
  ev.run('Working Group',            'WORKING_GROUP',  today, 'weekly', 'monday,tuesday,wednesday,thursday,friday');
  console.log('✓ Eventos del calendario semanal creados (recurrencia automática)');
}

console.log('✓ Base de datos lista');

// Solo salimos cuando se invoca como CLI (`node db/init.js`).
// Si server.js hace require('./db/init') en BD vacía, NO debemos matar el proceso.
if (require.main === module) process.exit(0);
