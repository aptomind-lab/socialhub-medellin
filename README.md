# SocialHub Medellín

Plataforma premium de seguimiento de leads con QR para una comunidad profesional con jerarquía de roles. Incluye landing pública, scanner móvil para coordinadores, dashboard administrativo con vistas diferenciadas por rol, y backend con auto-bloqueo por inactividad.

## Estructura del repositorio

```
socialhub-medellin/
├── backend/      # API Node.js + Express + SQLite
├── landing/      # Landing pública de registro del invitado
├── scanner/      # PWA móvil para escanear QR en eventos
├── dashboard/    # Panel administrativo (vistas por rol)
└── README.md
```

## Jerarquía de roles

```
                    ┌─────────────────────┐
                    │   LÍDER DE SISTEMA  │  ← Vista global
                    │  (Juan Carlos, Felipe) │
                    └──────────┬──────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│ LÍDER MÓDULO │       │ LÍDER MÓDULO │  ...  │ LÍDER MÓDULO │
│      M3      │       │      M5      │       │     M12      │
└──────┬───────┘       └──────────────┘       └──────────────┘
       │
       ▼
┌──────────────────┐
│ LÍDER PRODUCTIVO │  ← Mesa
│   (1 por mesa)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────┐
│  PROFESIONAL ACTIVO      │  ← Distribuidor (registra mensajes,
│  (su código activa QRs)  │     comparte código con invitados)
└──────────────────────────┘
```

| Rol | Alcance | Acciones |
|---|---|---|
| **Líder de Sistema** | Toda la oficina | Ve y gestiona todos los módulos, puede comparar entre módulos |
| **Líder de Módulo** | Solo su módulo | Ve líderes productivos y distribuidores de su módulo, gestiona su equipo |
| **Líder Productivo** | Solo su mesa | KPIs específicos: mensajes/integrante, Books, Shows, B.I.T, **% Shows → B.I.T** |
| **Profesional Activo** (= Distribuidor) | Registra mensajes y comparte su código | Su código se bloquea automáticamente si no actualiza mensajes en 48h |

## Embudo de prospección

```
REGISTRO → B.O.M → BOLETO PAGO → BOLETO ABONADO → BOLETO NO PAGO
        → B.I.T (sábado) → POWER TALK (lunes) → PLAN DE TRABAJO (martes)
        → WORKING GROUP (lun–vie) → ★ PROFESIONAL FIRMADO ★
```

> **FIRMADO** no es un evento del calendario — es el resultado exitoso del proceso (inversión de **$1,825 USD**). Se marca **manualmente** desde el dashboard, sección Invitados → botón "Marcar firmado".

## KPIs principales (Líder de Sistema y Líder de Módulo)

1. **Socios Activos del mes** — registraron al menos 1 invitado a B.O.M
2. **Mensajes por Profesional Firmado** — promedio de mensajes para lograr 1 firma
3. **Conversión B.I.T → Profesional Firmado** — % de invitados que llegan a la firma

## KPIs del Líder Productivo (su mesa, semanal)

1. **Books** — invitados nuevos de la semana
2. **Shows** — los que asistieron a B.O.M
3. **B.I.T** — boletos de la mesa que llegaron a B.I.T
4. **★ % Shows → B.I.T** — el más importante (retención de la mesa)

## Sistema anti-trampa (auto-bloqueo)

- Cada **Profesional Activo** registra diariamente la cantidad de mensajes que envió.
- Si no actualiza durante **más de 48 horas**, su **código se bloquea automáticamente**.
- Mientras esté bloqueado, ningún invitado puede registrarse en la landing con su código.
- El bloqueo se recalcula cada 15 minutos y al consultar la lista de usuarios.

## Setup rápido

### 1. Backend

```bash
cd backend
cp .env.example .env       # configura SMTP y JWT_SECRET
npm install
npm run init-db            # esquema + módulos + 16 usuarios de prueba + eventos
npm start                  # API en http://localhost:4000
```

### 2. Landing, Dashboard y Scanner

El backend sirve los tres frontends estáticamente:

- Landing: http://localhost:4000/landing/
- Dashboard: http://localhost:4000/dashboard/
- Scanner: http://localhost:4000/scanner/

## Credenciales de prueba

Contraseña común: **`Sh2026!`** (configurable en `.env` con `DEFAULT_USER_PASSWORD`).

| Rol | Nombre | Código |
|---|---|---|
| **Líder de Sistema** | Juan Carlos Medellín | `JCM001` |
| **Líder de Sistema** | Felipe Barrios | `FB002` |
| **Líder de Módulo M3** | Carolina Restrepo | `M3LD01` |
| **Líder de Módulo M5** | Andrés Vélez | `M5LD01` |
| **Líder de Módulo M6** | Laura Mejía | `M6LD01` |
| **Líder de Módulo M12** | Juan Pablo Gómez | `M12LD1` |
| **Líder Productivo M3** | Sofía López | `M3PR01` |
| **Líder Productivo M5** | Diego Torres | `M5PR01` |
| **Líder Productivo M6** | Mónica Henao | `M6PR01` |
| **Líder Productivo M12** | Ricardo Aguilar | `M12PR1` |
| **Profesional Activo M3** (mesa Sofía) | Martín Sánchez | `M3DS01` |
| **Profesional Activo M3** (mesa Sofía) | Valentina Cano | `M3DS02` |
| **Profesional Activo M5** (mesa Diego) | Camilo Henríquez | `M5DS01` |
| **Profesional Activo M5** (mesa Diego) | Isabela Ruiz | `M5DS02` |
| **Profesional Activo M6** (mesa Mónica) | Ana Galvis | `M6DS01` |
| **Profesional Activo M12** (mesa Ricardo) | Sebastián Toro | `M12DS1` |

## Flujo end-to-end

1. **Líder de Sistema** crea un nuevo módulo o un nuevo Líder de Módulo desde Dashboard → Usuarios.
2. **Líder de Módulo** crea Líderes Productivos en su módulo.
3. **Líder Productivo** crea Profesionales Activos en su mesa → cada uno recibe su código único.
4. **Profesional Activo** comparte su código con invitados.
5. **Invitado** llena la landing → recibe su QR por correo (siempre que el código del profesional esté activo).
6. **Coordinador** abre el scanner, selecciona el evento (B.O.M, Boleto Pago, B.I.T, Power Talk, Plan de Trabajo, Working Group) y escanea cada QR.
7. **Profesional Activo** registra cada día sus mensajes desde el dashboard. Si pasa más de 48h sin actualizar, su código se bloquea.
8. **Líder** marca al invitado como **FIRMADO** manualmente desde Dashboard → Invitados cuando completa la inversión de $1,825 USD.

## Endpoints del API

### Autenticación
- `POST /api/auth/login` — login con `distributor_code` + `password`
- `GET /api/auth/me` — datos del usuario autenticado

### Usuarios y módulos
- `GET /api/users` — lista filtrada por rol del actor; query: `role`, `module_id`, `productive_leader_id`, `status`
- `POST /api/users` — crear (respeta jerarquía: cada rol solo crea hacia abajo)
- `PATCH /api/users/:id` — editar
- `POST /api/users/:id/regenerate-code` — nuevo código
- `DELETE /api/users/:id`
- `GET /api/modules` — lista (filtrada por scope)
- `POST /api/modules` — solo system_leader
- `PATCH /api/modules/:id` — solo system_leader
- `DELETE /api/modules/:id` — solo system_leader

### Mensajes diarios
- `POST /api/messages` — registrar conteo del día para un profesional activo
- `GET /api/messages/totals` — totales por usuario
- `GET /api/messages/user/:userId` — historial de un usuario

### Invitados (guests)
- `POST /api/guests/register` — **público**, usado por la landing
- `GET /api/guests` — lista filtrada por jerarquía
- `GET /api/guests/:id` — detalle + historial
- `POST /api/guests/:id/advance` — cambio manual de etapa (incluido FIRMADO)

### Eventos
- `GET /api/events` — todos (con `?active_only=true` solo activos)
- `POST /api/events` — solo system_leader y module_leader
- `PATCH /api/events/:id`
- `DELETE /api/events/:id` — solo system_leader
- `POST /api/events/scan` — scanner: escanea QR
- `GET /api/events/scan/today-count` — contador de escaneos del día

### Estadísticas
- `GET /api/stats/kpis` — los 3 KPIs principales (filtros: `module_id`, `month`)
- `GET /api/stats/funnel` — conteos por etapa
- `GET /api/stats/by-module` — comparación entre módulos (system_leader)
- `GET /api/stats/monthly` — serie mensual
- `GET /api/stats/comparison` — esta semana vs anterior, este mes vs anterior
- `GET /api/stats/team` — KPIs específicos del Líder Productivo (Books/Shows/BIT/% Shows→BIT)

## Branding

| Token | Valor | Uso |
|---|---|---|
| Navy 900 | `#07111C` | Fondo principal |
| Navy 800 | `#0B1B2B` | Fondo de paneles |
| Navy 700 | `#0F2236` | Tarjetas |
| Gold 500 | `#C9A24A` | Acento principal |
| Gold 400 | `#D9B871` | Texto destacado |
| Teal 500 | `#2E8B8B` | Acento secundario |
| Teal 400 | `#46B0A8` | Tags / chips |
| Ivory | `#F5EFE2` | Texto principal |

Tipografías: **Cormorant Garamond** (display) + **Jost** (UI).

## Despliegue en producción

- **Backend**: cualquier host Node (Render, Railway, Fly.io, VPS). Importante:
  - Configura `JWT_SECRET` con un valor fuerte
  - Usa SMTP real (SendGrid, Postmark, Resend) configurando `SMTP_*` en `.env`
  - Configura `PUBLIC_BASE_URL` con tu dominio para que los QR apunten correctamente
  - Persiste la carpeta `db/` (volumen montado)
  - Cambia `DEFAULT_USER_PASSWORD` antes del primer `init-db`
- **Frontends**: pueden servirse desde el mismo backend o como sitios estáticos en Vercel/Netlify/Cloudflare Pages. Ajusta `config.js` de cada uno con la URL del backend.

## Seguridad

- Todas las rutas administrativas requieren JWT (12h de expiración).
- Cada request refresca el rol/scope del usuario desde DB para revocaciones inmediatas.
- La ruta pública `/api/guests/register` está rate-limited a 10 peticiones/min por IP.
- El código del distribuidor nunca se expone al invitado en la UI; se le presenta como "Código de Acceso".
- Datos internos (módulo, distribuidor que registró, historial completo) **solo** son visibles en el dashboard según jerarquía.
- Cada acción de cambio de etapa queda en `stage_history` con el usuario que la ejecutó.
