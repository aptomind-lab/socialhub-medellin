// Generador de distributor_code para profesionales recién firmados.
// Convención existente: M{modulo}DS{secuencial}, ej. M3DS01, M5DS02.
const db = require('../db');

function nextDistributorCode(moduleNumber) {
  if (!moduleNumber) throw new Error('moduleNumber requerido');
  const prefix = `M${moduleNumber}DS`;
  // Encuentra el secuencial más alto existente para ese prefijo
  const rows = db.prepare(`
    SELECT distributor_code FROM users
    WHERE distributor_code LIKE ?
  `).all(`${prefix}%`);

  let max = 0;
  for (const r of rows) {
    const tail = r.distributor_code.slice(prefix.length);
    const n = parseInt(tail, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  // Pad mínimo 2 dígitos pero crece si pasa de 99
  const next = max + 1;
  const padded = String(next).padStart(2, '0');
  return `${prefix}${padded}`;
}

module.exports = { nextDistributorCode };
