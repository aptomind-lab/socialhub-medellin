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
  console.warn('⚠ No se definió API_URL/VITE_API_URL — config.js no será sobreescrito');
}

const root = path.join(__dirname, '..');
const frontends = ['landing', 'dashboard', 'scanner'];

// Cache-busting: usar SHA del commit de Vercel (o fallback al timestamp).
// Esto invalida el caché del navegador en cada deploy sin tocar la fuente.
const VERSION = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 8) || String(Date.now());

for (const dir of frontends) {
  const configPath = path.join(root, dir, 'config.js');
  if (API_URL && fs.existsSync(configPath)) {
    const content = `// Generado automáticamente por scripts/inject-api-url.js durante el build.\n` +
                    `window.SOCIALHUB_API = '${API_URL}';\n` +
                    `window.SOCIALHUB_BUILD = '${VERSION}';\n`;
    fs.writeFileSync(configPath, content);
    console.log(`✓ ${dir}/config.js → ${API_URL}`);
  }

  // Inyectar ?v=VERSION en script/link tags de index.html para invalidar caché.
  const htmlPath = path.join(root, dir, 'index.html');
  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html
      .replace(/(href|src)="(assets\/[^"?#]+\.(?:js|css))"/g, `$1="$2?v=${VERSION}"`)
      .replace(/src="(config\.js)"/g, `src="$1?v=${VERSION}"`);
    fs.writeFileSync(htmlPath, html);
    console.log(`✓ ${dir}/index.html → cache-bust v=${VERSION}`);
  }
}

console.log(`✓ API URL inyectada (build ${VERSION})`);
