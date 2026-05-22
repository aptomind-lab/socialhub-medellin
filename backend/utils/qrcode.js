const QRCode = require('qrcode');

async function generateQrDataUrl(payload) {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'H',
    margin: 1,
    width: 480,
    color: { dark: '#0B1B2B', light: '#F5EFE2' },
  });
}

async function generateQrBuffer(payload) {
  return QRCode.toBuffer(payload, {
    errorCorrectionLevel: 'H',
    margin: 1,
    width: 480,
    color: { dark: '#0B1B2B', light: '#F5EFE2' },
  });
}

module.exports = { generateQrDataUrl, generateQrBuffer };
