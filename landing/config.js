// URL del backend.
// En el build de Vercel, scripts/inject-api-url.js sobreescribe este archivo
// completo si la env var API_URL está definida en Vercel.
// Como fallback (por si el inject no corrió), detectamos el hostname.
window.SOCIALHUB_API = (function () {
  var h = (location && location.hostname) || '';
  if (h === 'localhost' || h === '127.0.0.1' || h === '') return 'http://localhost:4000';
  return 'https://web-production-5c3eb.up.railway.app';
})();
