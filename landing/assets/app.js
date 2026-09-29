(function () {
  const API_BASE = window.SOCIALHUB_API || 'https://web-production-5c3eb.up.railway.app';

  const form = document.getElementById('register-form');
  const errorBox = document.getElementById('error');
  const submitBtn = document.getElementById('submit-btn');
  const successPanel = document.getElementById('success');
  const qrImg = document.getElementById('qr-img');
  const qrDownload = document.getElementById('qr-download');
  const moduleBadge = document.getElementById('module-badge');
  const moduleNumberEl = document.getElementById('module-number');
  const bomBadge = document.getElementById('bom-badge');
  const bomBadgeDateEl = document.getElementById('bom-badge-date');
  document.getElementById('year').textContent = new Date().getFullYear();

  // ── Pre-fill del código si viene en la URL: ?ref=CODIGO ──
  const accessInput = document.getElementById('access_code');
  const refParam = new URLSearchParams(location.search).get('ref');
  if (refParam) {
    accessInput.value = refParam.toUpperCase();
    accessInput.readOnly = true;
    accessInput.setAttribute('aria-readonly', 'true');
    accessInput.classList.add('locked');
    // Reemplazamos el hint para indicar que el código vino del invitador
    const hintEl = accessInput.nextElementSibling;
    if (hintEl && hintEl.classList.contains('hint')) {
      hintEl.textContent = 'Código asignado por tu invitador.';
    }
  }

  // ── B.O.M (público) — ?bom=YYYY-MM-DD si el invitador ya eligió fecha
  // puntual desde Mi Perfil; si no viene, se calcula "el próximo" (igual
  // que siempre). Se guarda lo que responda el server para reusarlo en el
  // pase de entrada al confirmar el registro, sin pedirlo dos veces. ──
  const bomCard = document.getElementById('next-bom-card');
  const bomDateEl = document.getElementById('next-bom-date');
  const DAYS_ES = { monday: 'Lunes', tuesday: 'Martes', wednesday: 'Miércoles', thursday: 'Jueves', friday: 'Viernes', saturday: 'Sábado', sunday: 'Domingo' };
  const bomParam = new URLSearchParams(location.search).get('bom');
  let selectedBom = null; // se rellena si la respuesta del server es válida

  function format12h(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }
  function formatBomLabel(bom) {
    const d = new Date(bom.date + 'T00:00:00');
    const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const base = `${DAYS_ES[bom.day_of_week] || ''} ${d.getDate()} de ${monthNames[d.getMonth()]}`;
    const time = format12h(bom.event_time);
    return time ? `${base} · ${time}` : base;
  }

  const bomQuery = new URLSearchParams();
  if (refParam) bomQuery.set('ref', refParam.toUpperCase());
  if (bomParam) bomQuery.set('bom', bomParam);
  const bomUrl = `${API_BASE}/api/events/next-bom-public${bomQuery.toString() ? '?' + bomQuery.toString() : ''}`;
  fetch(bomUrl)
    .then((r) => r.ok ? r.json() : null)
    .then((bom) => {
      if (!bom || !bom.date) return;
      selectedBom = bom;
      bomDateEl.textContent = formatBomLabel(bom);
      bomCard.hidden = false;
    })
    .catch(() => { /* silencioso si falla */ });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }
  function clearError() { errorBox.hidden = true; errorBox.textContent = ''; }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const data = {
      full_name: document.getElementById('full_name').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      access_code: document.getElementById('access_code').value.trim().toUpperCase(),
    };
    // Solo se manda si el server ya confirmó que esa fecha es un B.O.M válido
    // para este invitador (selectedBom se llena en el fetch de arriba).
    if (bomParam && selectedBom) data.bom_date = selectedBom.date;

    if (!data.full_name || !data.email || !data.phone || !data.access_code) {
      showError('Por favor completa todos los campos.'); return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      showError('Ingresa un correo electrónico válido.'); return;
    }

    submitBtn.disabled = true;
    submitBtn.querySelector('.cta-text').textContent = 'Procesando...';

    try {
      const resp = await fetch(`${API_BASE}/api/guests/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'No se pudo completar el registro.');

      qrImg.src = json.qr_data_url;
      qrDownload.href = json.qr_data_url;
      if (json.module_number) {
        moduleNumberEl.textContent = json.module_number;
        moduleBadge.hidden = false;
      } else {
        moduleBadge.hidden = true;
      }
      if (data.bom_date && selectedBom) {
        bomBadgeDateEl.textContent = formatBomLabel(selectedBom);
        bomBadge.hidden = false;
      } else {
        bomBadge.hidden = true;
      }
      successPanel.hidden = false;
    } catch (err) {
      showError(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.querySelector('.cta-text').textContent = 'Recibir mi QR de acceso';
    }
  });

  // Forzar mayúsculas visualmente en código
  document.getElementById('access_code').addEventListener('input', (e) => {
    const start = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(start, start);
  });
})();
