#!/usr/bin/env node
// Reemplaza config.js de cada frontend con la URL del backend.
// Se ejecuta automáticamente en cada build de Vercel.
//
// Variables aceptadas (en orden de prioridad):
//   API_URL        — preferida
//   VITE_API_URL   — compatibilidad con setups Vite
//
// En local, si no hay variable, mantiene los config.js comprometidos
// (que apuntan a http://localhost:4000).

const fs = require('fs');
const path = require('path');

const API_URL = (process.env.API_URL || process.env.VITE_API_URL || '').trim();

if (!API_URL) {
  console.warn('⚠ No se definió API_URL/VITE_API_URL — config.js queda con sus valores por defecto');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const frontends = ['landing', 'dashboard', 'scanner'];

for (const dir of frontends) {
  const configPath = path.join(root, dir, 'config.js');
  if (!fs.existsSync(configPath)) {
    console.warn(`⚠ ${dir}/config.js no encontrado, omitiendo`);
    continue;
  }
  const content = `// Generado automáticamente por scripts/inject-api-url.js durante el build.\n` +
                  `window.SOCIALHUB_API = '${API_URL}';\n`;
  fs.writeFileSync(configPath, content);
  console.log(`✓ ${dir}/config.js → ${API_URL}`);
}

console.log('✓ API URL inyectada en los tres frontends');
