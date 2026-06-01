// Migración 008 — Rol lider_supremo + tabla systems + columna users.system_id.
// SQLite no permite ALTER de CHECK constraint: recreamos la tabla users en una
// transacción (TEMP table → drop → rename + recrear índices).
require('dotenv').config();
const db = require('../index');

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
function tableExists(name) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

console.log('► Migración 008: lider_supremo + systems + system_id');

db.transaction(() => {
  // 1. Tabla systems + sembrar default.
  if (!tableExists('systems')) {
    db.exec(`
      CREATE TABLE systems (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre      TEXT    NOT NULL UNIQUE,
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.prepare(`INSERT INTO systems (id, nombre) VALUES (1, 'SocialHub Medellín')`).run();
    console.log('  + tabla systems + default "SocialHub Medellín"');
  }

  // 2. Recrear users con nuevo CHECK + columna system_id.
  //    Verificamos primero si ya tiene system_id (idempotente).
  if (columnExists('users', 'system_id')) {
    console.log('  · users.system_id ya existe — saltando recreación');
    return;
  }

  // Apagamos FKs durante el rename para evitar cascadas indeseadas.
  db.exec(`PRAGMA foreign_keys = OFF`);

  // Esquema nuevo (alineado al schema.sql actual + system_id + CHECK ampliado).
  db.exec(`
    CREATE TABLE users_new (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name             TEXT    NOT NULL,
      email                 TEXT    UNIQUE,
      phone                 TEXT,
      distributor_code      TEXT    NOT NULL UNIQUE,
      password_hash         TEXT,
      role                  TEXT    NOT NULL CHECK (role IN ('lider_supremo','system_leader','module_leader','productive_leader','distributor')),
      system_id             INTEGER REFERENCES systems(id) ON DELETE SET NULL,
      module_id             INTEGER REFERENCES modules(id) ON DELETE SET NULL,
      productive_leader_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      firmado_por           INTEGER REFERENCES users(id) ON DELETE SET NULL,
      bhip_rank             TEXT    NOT NULL DEFAULT 'Profesional',
      password_must_change  INTEGER NOT NULL DEFAULT 0,
      profile_completed     INTEGER NOT NULL DEFAULT 1,
      active                INTEGER NOT NULL DEFAULT 1,
      blocked               INTEGER NOT NULL DEFAULT 0,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Backfill: TODOS los usuarios existentes al system 1.
  db.exec(`
    INSERT INTO users_new (
      id, full_name, email, phone, distributor_code, password_hash, role,
      system_id, module_id, productive_leader_id, firmado_por,
      bhip_rank, password_must_change, profile_completed, active, blocked, created_at
    )
    SELECT
      id, full_name, email, phone, distributor_code, password_hash, role,
      1 AS system_id, module_id, productive_leader_id, firmado_por,
      bhip_rank, password_must_change, profile_completed, active, blocked, created_at
    FROM users
  `);

  db.exec(`DROP TABLE users`);
  db.exec(`ALTER TABLE users_new RENAME TO users`);

  // Recrear índices.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_role         ON users(role)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_module       ON users(module_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_team         ON users(productive_leader_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_firmado_por  ON users(firmado_por)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_rank         ON users(bhip_rank)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_code         ON users(distributor_code)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_system_id    ON users(system_id)`);

  db.exec(`PRAGMA foreign_keys = ON`);
  console.log('  ↻ users recreado con CHECK ampliado + system_id (todos en system 1)');
})();

console.log('✓ Migración 008 completada');
if (require.main === module) process.exit(0);
