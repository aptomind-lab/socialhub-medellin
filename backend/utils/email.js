const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;

  // Gmail App Passwords se muestran con espacios cada 4 chars solo por estética;
  // el SMTP los rechaza con espacios. Los limpiamos.
  const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass } : undefined,
    // Timeouts cortos: si Railway bloquea SMTP, fallamos rápido en vez de colgar 3 min.
    connectionTimeout: 8000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });
  return transporter;
}

// Endpoint de diagnóstico: verifica que el SMTP responde sin enviar correo real.
async function verifySmtp() {
  const tr = getTransporter();
  if (!tr) return { ok: false, reason: 'SMTP no configurado (SMTP_HOST vacío)' };
  try {
    await tr.verify();
    return { ok: true, host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER };
  } catch (err) {
    return { ok: false, reason: err.message, code: err.code };
  }
}

function buildQrEmailHtml({ guestName, qrCid }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>SocialHub Medellín — Tu acceso</title>
</head>
<body style="margin:0;padding:0;background:#0B1B2B;font-family:Georgia,'Cormorant Garamond',serif;color:#F5EFE2;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0B1B2B;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0F2236;border:1px solid #C9A24A;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:36px 40px 8px 40px;text-align:center;">
          <div style="font-size:11px;letter-spacing:6px;color:#C9A24A;text-transform:uppercase;">SocialHub Medellín</div>
          <h1 style="margin:14px 0 0 0;font-family:Georgia,serif;font-weight:400;font-size:32px;color:#F5EFE2;">Tu acceso está listo</h1>
        </td></tr>
        <tr><td style="padding:8px 40px 0 40px;text-align:center;">
          <div style="height:1px;background:linear-gradient(90deg,transparent,#C9A24A,transparent);margin:18px 0;"></div>
          <p style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.7;color:#D6CDB7;margin:0;">
            ${guestName}, te damos la bienvenida. Presenta el siguiente código QR en la entrada de cada evento para confirmar tu asistencia.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:30px 40px;">
          <div style="background:#F5EFE2;padding:18px;border-radius:10px;display:inline-block;">
            <img src="cid:${qrCid}" alt="QR de acceso" width="240" height="240" style="display:block;">
          </div>
        </td></tr>
        <tr><td style="padding:0 40px 36px 40px;text-align:center;">
          <p style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;line-height:1.7;color:#8FA3B8;margin:0;">
            Conserva este correo. Tu QR es personal e intransferible.
          </p>
          <div style="margin-top:24px;font-size:10px;letter-spacing:4px;color:#C9A24A;text-transform:uppercase;">
            Premium · Excelencia · Compromiso
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendQrEmail({ to, guestName, qrBuffer }) {
  const tr = getTransporter();
  if (!tr) {
    console.warn('[email] SMTP no configurado — omitiendo envío real');
    return { skipped: true };
  }
  const cid = `qr-${Date.now()}@socialhub`;
  const info = await tr.sendMail({
    from: process.env.SMTP_FROM || 'SocialHub Medellín <no-reply@socialhubmedellin.com>',
    to,
    subject: 'SocialHub Medellín — Tu QR de acceso',
    html: buildQrEmailHtml({ guestName, qrCid: cid }),
    attachments: [{ filename: 'qr.png', content: qrBuffer, cid }],
  });
  return { messageId: info.messageId };
}

function buildWelcomeEmailHtml({ distributorCode, password, roleLabel, rank, loginUrl }) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>SHM — Acceso a la plataforma</title></head>
<body style="margin:0;padding:0;background:#0B1B2B;font-family:Georgia,'Cormorant Garamond',serif;color:#F5EFE2;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0B1B2B;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0F2236;border:1px solid #C9A24A;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:36px 40px 8px 40px;text-align:center;">
          <div style="font-size:11px;letter-spacing:6px;color:#C9A24A;text-transform:uppercase;">SHM</div>
          <h1 style="margin:14px 0 0 0;font-family:Georgia,serif;font-weight:400;font-size:30px;color:#F5EFE2;">Bienvenido a la plataforma</h1>
        </td></tr>
        <tr><td style="padding:8px 40px 0 40px;text-align:center;">
          <div style="height:1px;background:linear-gradient(90deg,transparent,#C9A24A,transparent);margin:18px 0;"></div>
          <p style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.7;color:#D6CDB7;margin:0;">
            Se ha creado tu acceso como <strong style="color:#D9B871;">${roleLabel}</strong>${rank ? ` · Rango <strong style="color:#D9B871;">${rank}</strong>` : ''}.
          </p>
        </td></tr>
        <tr><td style="padding:24px 40px;">
          <table cellpadding="0" cellspacing="0" width="100%" style="background:#07111C;border:1px solid rgba(201,162,74,0.25);border-radius:10px;">
            <tr><td style="padding:18px 22px;">
              <div style="font-size:10px;letter-spacing:3px;color:#8FA3B8;text-transform:uppercase;margin-bottom:6px;">ID de Distribuidor BHIP</div>
              <div style="font-family:'Courier New',monospace;font-size:18px;color:#D9B871;letter-spacing:3px;">${distributorCode}</div>
            </td></tr>
            <tr><td style="padding:0 22px 18px 22px;">
              <div style="font-size:10px;letter-spacing:3px;color:#8FA3B8;text-transform:uppercase;margin-bottom:6px;">Contraseña temporal</div>
              <div style="font-family:'Courier New',monospace;font-size:18px;color:#D9B871;letter-spacing:2px;">${password}</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 40px 24px 40px;text-align:center;">
          <a href="${loginUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(180deg,#C9A24A,#B58831);color:#0B1B2B;text-decoration:none;border-radius:10px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:500;">Ingresar a la plataforma</a>
        </td></tr>
        <tr><td style="padding:0 40px 30px 40px;">
          <p style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;line-height:1.7;color:#8FA3B8;margin:0;text-align:center;">
            En tu primer ingreso te pediremos completar tu perfil (nombre, celular) y elegir tu contraseña personal.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendWelcomeEmail({ to, distributorCode, password, roleLabel, rank }) {
  const tr = getTransporter();
  const loginUrl = process.env.PUBLIC_BASE_URL
    ? `${process.env.PUBLIC_BASE_URL}/dashboard/`
    : 'http://localhost:4000/dashboard/';
  if (!tr) {
    console.warn(`[email] SMTP no configurado — credenciales para ${distributorCode}: pwd="${password}" (no se envió email)`);
    return { skipped: true, login_url: loginUrl };
  }
  const info = await tr.sendMail({
    from: process.env.SMTP_FROM || 'SHM <no-reply@socialhubmedellin.com>',
    to,
    subject: 'SHM — Tu acceso a la plataforma',
    html: buildWelcomeEmailHtml({ distributorCode, password, roleLabel, rank, loginUrl }),
  });
  return { messageId: info.messageId, login_url: loginUrl };
}

function buildResetLinkEmailHtml({ resetUrl, name }) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>SHM — Recupera tu contraseña</title></head>
<body style="margin:0;padding:0;background:#0B1B2B;font-family:Georgia,serif;color:#F5EFE2;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0B1B2B;padding:40px 0;">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#0F2236;border:1px solid #C9A24A;border-radius:14px;">
        <tr><td style="padding:36px 40px;text-align:center;">
          <div style="font-size:11px;letter-spacing:6px;color:#C9A24A;text-transform:uppercase;">SHM</div>
          <h1 style="margin:14px 0 16px;font-weight:400;font-size:28px;color:#F5EFE2;">Recupera tu contraseña</h1>
          <p style="font-family:Arial,sans-serif;font-size:14px;color:#D6CDB7;line-height:1.6;margin:0 0 20px;">
            ${name ? `Hola ${name},<br/>` : ''}Recibimos una solicitud para restablecer tu contraseña. Toca el botón de abajo (válido 24h).
          </p>
          <a href="${resetUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(180deg,#C9A24A,#B58831);color:#0B1B2B;text-decoration:none;border-radius:10px;font-family:Arial,sans-serif;font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:500;">Restablecer contraseña</a>
          <p style="font-family:Arial,sans-serif;font-size:12px;color:#8FA3B8;margin-top:24px;">
            Si no solicitaste el cambio, ignora este correo. El enlace expira en 24 horas.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendPasswordResetEmail({ to, resetUrl, name }) {
  const tr = getTransporter();
  if (!tr) {
    console.warn(`[email] SMTP no configurado — reset link para ${to}: ${resetUrl}`);
    return { skipped: true };
  }
  const info = await tr.sendMail({
    from: process.env.SMTP_FROM || 'SHM <no-reply@socialhubmedellin.com>',
    to,
    subject: 'SHM — Recupera tu contraseña',
    html: buildResetLinkEmailHtml({ resetUrl, name }),
  });
  return { messageId: info.messageId };
}

function buildAdminResetEmailHtml({ name, distributorCode, password, loginUrl }) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>SHM — Contraseña restablecida</title></head>
<body style="margin:0;padding:0;background:#0B1B2B;font-family:Georgia,serif;color:#F5EFE2;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0B1B2B;padding:40px 0;">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#0F2236;border:1px solid #C9A24A;border-radius:14px;">
        <tr><td style="padding:36px 40px;text-align:center;">
          <div style="font-size:11px;letter-spacing:6px;color:#C9A24A;text-transform:uppercase;">SHM</div>
          <h1 style="margin:14px 0 16px;font-weight:400;font-size:28px;color:#F5EFE2;">Tu contraseña fue restablecida</h1>
          <p style="font-family:Arial,sans-serif;font-size:14px;color:#D6CDB7;line-height:1.6;margin:0 0 16px;">
            ${name ? `Hola ${name},<br/>` : ''}Un administrador restableció tu contraseña. Ingresa con esta contraseña temporal — se te pedirá cambiarla en tu siguiente login.
          </p>
          <table cellpadding="0" cellspacing="0" width="100%" style="background:#07111C;border:1px solid rgba(201,162,74,0.25);border-radius:10px;margin:18px 0;">
            <tr><td style="padding:16px 22px;">
              <div style="font-size:10px;letter-spacing:3px;color:#8FA3B8;text-transform:uppercase;margin-bottom:4px;">ID</div>
              <div style="font-family:Courier,monospace;font-size:18px;color:#D9B871;">${distributorCode}</div>
            </td></tr>
            <tr><td style="padding:0 22px 16px;">
              <div style="font-size:10px;letter-spacing:3px;color:#8FA3B8;text-transform:uppercase;margin-bottom:4px;">Contraseña temporal</div>
              <div style="font-family:Courier,monospace;font-size:18px;color:#D9B871;">${password}</div>
            </td></tr>
          </table>
          <a href="${loginUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(180deg,#C9A24A,#B58831);color:#0B1B2B;text-decoration:none;border-radius:10px;font-family:Arial,sans-serif;font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:500;">Ingresar</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendAdminResetEmail({ to, name, distributorCode, password }) {
  const tr = getTransporter();
  const loginUrl = process.env.PUBLIC_BASE_URL
    ? `${process.env.PUBLIC_BASE_URL}/dashboard/`
    : 'http://localhost:4000/dashboard/';
  if (!tr) {
    console.warn(`[email] SMTP no configurado — admin reset para ${distributorCode}: ${password}`);
    return { skipped: true, login_url: loginUrl };
  }
  const info = await tr.sendMail({
    from: process.env.SMTP_FROM || 'SHM <no-reply@socialhubmedellin.com>',
    to,
    subject: 'SHM — Contraseña restablecida',
    html: buildAdminResetEmailHtml({ name, distributorCode, password, loginUrl }),
  });
  return { messageId: info.messageId, login_url: loginUrl };
}

module.exports = { sendQrEmail, sendWelcomeEmail, sendPasswordResetEmail, sendAdminResetEmail, verifySmtp };
