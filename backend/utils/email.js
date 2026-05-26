// Envío de email con Resend SDK.
// Variable requerida: RESEND_API_KEY (configurar en Railway).
// From: onboarding@resend.dev (sandbox de Resend) hasta configurar dominio propio.
const { Resend } = require('resend');

let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.RESEND_API_KEY) return null;
  client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

const FROM_ADDRESS = 'SHM <noreply@contacto.trabajaparavivir.com>';

// Diagnóstico: confirma que la API key está presente y el SDK puede instanciarse.
// (Se mantiene el nombre verifySmtp por compatibilidad con routes/auth.js.)
async function verifySmtp() {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, reason: 'RESEND_API_KEY no configurada' };
  }
  try {
    // Intenta listar dominios — endpoint barato que valida la API key.
    const r = getClient();
    const result = await r.domains.list();
    if (result.error) return { ok: false, reason: result.error.message || 'API key inválida', code: result.error.name };
    return { ok: true, provider: 'resend', from: FROM_ADDRESS, domains: (result.data?.data || []).length };
  } catch (err) {
    return { ok: false, reason: err.message, code: err.name };
  }
}

// ─────── Helper genérico ───────
async function sendViaResend({ to, subject, html, text, attachments }) {
  const r = getClient();
  if (!r) {
    console.warn(`[email] RESEND_API_KEY no configurada — omitiendo envío a ${to}`);
    return { skipped: true };
  }
  if (!html) {
    console.error(`[email] HTML vacío para ${to} (${subject}) — esto causaría email sin diseño`);
  }
  const payload = { from: FROM_ADDRESS, to, subject, html };
  if (text) payload.text = text;
  if (attachments && attachments.length) payload.attachments = attachments;
  console.log(`[email] enviando "${subject}" a ${to} — html=${html?.length || 0}B, attachments=${attachments?.length || 0}`);
  const result = await r.emails.send(payload);
  if (result.error) {
    const msg = result.error.message || JSON.stringify(result.error);
    const err = new Error(msg);
    err.code = result.error.name;
    err.response = result.error;
    throw err;
  }
  return { messageId: result.data?.id };
}

// ─────── Templates HTML ───────

function buildQrEmailHtml({ guestName }) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>SHM — Tu acceso</title></head>
<body style="margin:0;padding:0;background:#0B1B2B;font-family:Georgia,'Cormorant Garamond',serif;color:#F5EFE2;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0B1B2B;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0F2236;border:1px solid #C9A24A;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:36px 40px 8px 40px;text-align:center;">
          <div style="font-size:11px;letter-spacing:6px;color:#C9A24A;text-transform:uppercase;">SHM</div>
          <h1 style="margin:14px 0 0 0;font-family:Georgia,serif;font-weight:400;font-size:32px;color:#F5EFE2;">Tu acceso está listo</h1>
        </td></tr>
        <tr><td style="padding:8px 40px 0 40px;text-align:center;">
          <div style="height:1px;background:linear-gradient(90deg,transparent,#C9A24A,transparent);margin:18px 0;"></div>
          <p style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.7;color:#D6CDB7;margin:0;">
            ${guestName}, te damos la bienvenida. Presenta tu código QR en la entrada de cada evento para confirmar tu asistencia.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:32px 40px;">
          <table cellpadding="0" cellspacing="0" style="background:#07111C;border:1px solid #C9A24A;border-radius:12px;">
            <tr><td style="padding:26px 32px;text-align:center;">
              <div style="font-size:36px;line-height:1;color:#C9A24A;margin-bottom:14px;">▣</div>
              <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;color:#F5EFE2;font-weight:500;letter-spacing:1px;margin-bottom:8px;">
                Tu código QR está adjunto a este correo
              </div>
              <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#8FA3B8;line-height:1.6;">
                Abre el archivo <strong style="color:#D9B871;">tu-qr-acceso.png</strong> y guárdalo en tu celular. Preséntalo en la entrada del evento.
              </div>
            </td></tr>
          </table>
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
</body></html>`;
}

function buildWelcomeEmailHtml({ distributorCode, password, roleLabel, rank, loginUrl }) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>SHM — Acceso a la plataforma</title></head>
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
</body></html>`;
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

// ─────── Funciones públicas (signatures idénticas) ───────

async function sendQrEmail({ to, guestName, qrBuffer }) {
  // Gmail bloquea data: URIs en <img>. Enviamos el QR como adjunto PNG y mencionamos
  // el archivo en el HTML para que el invitado sepa abrirlo.
  const qrBase64 = Buffer.isBuffer(qrBuffer) ? qrBuffer.toString('base64') : qrBuffer;
  const html = buildQrEmailHtml({ guestName });
  return sendViaResend({
    to,
    subject: 'SHM — Tu QR de acceso',
    html,
    text: `${guestName}, te damos la bienvenida a SHM.\n\nTu código QR de acceso está adjunto a este correo (archivo: tu-qr-acceso.png). Ábrelo, guárdalo en tu celular y preséntalo en la entrada de cada evento.\n\nConserva este correo — tu QR es personal e intransferible.`,
    attachments: [{
      filename: 'tu-qr-acceso.png',
      content: qrBase64,
    }],
  });
}

async function sendWelcomeEmail({ to, distributorCode, password, roleLabel, rank }) {
  const loginUrl = process.env.PUBLIC_BASE_URL
    ? `${process.env.PUBLIC_BASE_URL}/dashboard/`
    : 'http://localhost:4000/dashboard/';
  const result = await sendViaResend({
    to,
    subject: 'SHM — Tu acceso a la plataforma',
    html: buildWelcomeEmailHtml({ distributorCode, password, roleLabel, rank, loginUrl }),
  });
  return { ...result, login_url: loginUrl };
}

async function sendPasswordResetEmail({ to, resetUrl, name }) {
  return sendViaResend({
    to,
    subject: 'SHM — Recupera tu contraseña',
    html: buildResetLinkEmailHtml({ resetUrl, name }),
  });
}

async function sendAdminResetEmail({ to, name, distributorCode, password }) {
  const loginUrl = process.env.PUBLIC_BASE_URL
    ? `${process.env.PUBLIC_BASE_URL}/dashboard/`
    : 'http://localhost:4000/dashboard/';
  const result = await sendViaResend({
    to,
    subject: 'SHM — Contraseña restablecida',
    html: buildAdminResetEmailHtml({ name, distributorCode, password, loginUrl }),
  });
  return { ...result, login_url: loginUrl };
}

module.exports = {
  sendQrEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendAdminResetEmail,
  verifySmtp,
};
