-- SocialHub Medellín — esquema con jerarquía de roles
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS modules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  number       INTEGER NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Una sola tabla para todos los roles. La jerarquía se modela con FKs:
--   role = 'system_leader'      → ve toda la oficina
--   role = 'module_leader'      → ve un módulo (module_id requerido)
--   role = 'productive_leader'  → ve su mesa (module_id requerido)
--   role = 'distributor'        → registra mensajes y QRs (productive_leader_id = su mesa)
CREATE TABLE IF NOT EXISTS users (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name             TEXT    NOT NULL,
  email                 TEXT    UNIQUE,
  phone                 TEXT,
  distributor_code      TEXT    NOT NULL UNIQUE,
  password_hash         TEXT,
  role                  TEXT    NOT NULL CHECK (role IN ('system_leader','module_leader','productive_leader','distributor')),
  module_id             INTEGER REFERENCES modules(id) ON DELETE SET NULL,
  productive_leader_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sponsor_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  bhip_rank             TEXT    NOT NULL DEFAULT 'Profesional',
  password_must_change  INTEGER NOT NULL DEFAULT 0,
  profile_completed     INTEGER NOT NULL DEFAULT 1,
  active                INTEGER NOT NULL DEFAULT 1,
  blocked               INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_module   ON users(module_id);
CREATE INDEX IF NOT EXISTS idx_users_team     ON users(productive_leader_id);
CREATE INDEX IF NOT EXISTS idx_users_sponsor  ON users(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_users_rank     ON users(bhip_rank);
CREATE INDEX IF NOT EXISTS idx_users_code     ON users(distributor_code);

CREATE TABLE IF NOT EXISTS guests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name       TEXT    NOT NULL,
  email           TEXT    NOT NULL,
  phone           TEXT,
  distributor_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  qr_token        TEXT    NOT NULL UNIQUE,
  current_stage   TEXT    NOT NULL DEFAULT 'REGISTRO',
  signed_at       TEXT,
  -- Sistema de colores: 'none' | 'light_green' | 'strong_green' | 'yellow' | 'orange' | 'red' | 'black'
  color           TEXT    NOT NULL DEFAULT 'none',
  color_set_at    TEXT,
  color_set_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  color_manual    INTEGER NOT NULL DEFAULT 0,
  -- Fechas clave del seguimiento
  bit_date        TEXT,
  power_talk_date TEXT,
  signed_month    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_guests_dist         ON guests(distributor_id);
CREATE INDEX IF NOT EXISTS idx_guests_stage        ON guests(current_stage);
CREATE INDEX IF NOT EXISTS idx_guests_token        ON guests(qr_token);
CREATE INDEX IF NOT EXISTS idx_guests_created      ON guests(created_at);
CREATE INDEX IF NOT EXISTS idx_guests_color        ON guests(color);
CREATE INDEX IF NOT EXISTS idx_guests_signed_month ON guests(signed_month);

CREATE TABLE IF NOT EXISTS stage_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id      INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  from_stage    TEXT,
  to_stage      TEXT    NOT NULL,
  scanned_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  scanned_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_guest ON stage_history(guest_id);
CREATE INDEX IF NOT EXISTS idx_history_date  ON stage_history(scanned_at);

-- Mensajes diarios — solo registran los distributors
CREATE TABLE IF NOT EXISTS daily_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date         TEXT    NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  books_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS password_resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT    NOT NULL UNIQUE,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pwreset_token ON password_resets(token);
CREATE INDEX IF NOT EXISTS idx_pwreset_user  ON password_resets(user_id);

CREATE INDEX IF NOT EXISTS idx_msgs_user ON daily_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_msgs_date ON daily_messages(date);

-- Eventos del calendario semanal con recurrencia
-- recurrence_type: 'weekly' (se repite los días en recurrence_days) | 'one_time'
-- recurrence_days: lista CSV de días en inglés ('monday,tuesday,...,friday'), NULL para one_time
CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  stage_target    TEXT    NOT NULL,
  date            TEXT    NOT NULL,
  recurrence_type TEXT    NOT NULL DEFAULT 'one_time',
  recurrence_days TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

-- Asistencia diaria al Working Group
-- Cada scan en un evento cuya stage_target = 'WORKING_GROUP' inserta una fila aquí.
-- iso_week formato: 'YYYY-WNN' (ISO 8601). UNIQUE(guest_id, attended_date) evita duplicados del mismo día.
CREATE TABLE IF NOT EXISTS wg_attendance (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id       INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  attended_date  TEXT    NOT NULL,
  day_of_week    TEXT    NOT NULL,
  iso_week       TEXT    NOT NULL,
  scanned_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(guest_id, attended_date)
);

CREATE INDEX IF NOT EXISTS idx_wg_guest ON wg_attendance(guest_id);
CREATE INDEX IF NOT EXISTS idx_wg_week  ON wg_attendance(iso_week);
CREATE INDEX IF NOT EXISTS idx_wg_date  ON wg_attendance(attended_date);
