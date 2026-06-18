(function () {
  const API = window.SOCIALHUB_API || 'https://web-production-5c3eb.up.railway.app';
  const STORAGE_TOKEN = 'sh_scanner_token';

  const $ = (id) => document.getElementById(id);
  const loginScreen = $('login-screen');
  const appScreen = $('app-screen');

  function show(screen) {
    loginScreen.classList.toggle('active', screen === 'login');
    appScreen.classList.toggle('active', screen === 'app');
  }

  let token = localStorage.getItem(STORAGE_TOKEN);
  let codeReader = null;
  let activeStream = null;
  let scanLocked = false;
  let stageLabels = {};

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await fetch(`${API}${path}`, { ...opts, headers });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);
    return data;
  }

  // -------- LOGIN --------
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('login-error');
    errEl.hidden = true;
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          distributor_code: $('login-code').value.toUpperCase(),
          password: $('login-password').value,
        }),
      });
      token = data.token;
      localStorage.setItem(STORAGE_TOKEN, token);
      await initApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  $('login-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  $('logout-btn').addEventListener('click', () => {
    stopScanning();
    localStorage.removeItem(STORAGE_TOKEN);
    token = null;
    show('login');
  });

  // -------- APP --------
  async function initApp() {
    show('app');
    try {
      const data = await api('/api/events?active_only=true');
      stageLabels = data.stage_labels || {};
      // Excluir FIRMADO si por algún motivo aparece (es un cambio manual, no un evento)
      data.events = data.events.filter((ev) => ev.stage_target !== 'FIRMADO');
      const select = $('event-select');
      select.innerHTML = '';
      data.events.forEach((ev) => {
        const opt = document.createElement('option');
        opt.value = ev.id;
        opt.dataset.stage = ev.stage_target;
        opt.dataset.date = ev.date;
        opt.textContent = `${ev.name} — ${ev.date}`;
        select.appendChild(opt);
      });
      updateEventMeta();
      await refreshCount();
    } catch (err) {
      if (err.message.includes('expirado') || err.message.includes('inválido')) {
        localStorage.removeItem(STORAGE_TOKEN); token = null; show('login');
      } else {
        alert(err.message);
      }
    }
  }

  $('event-select').addEventListener('change', updateEventMeta);
  function updateEventMeta() {
    const sel = $('event-select');
    const opt = sel.options[sel.selectedIndex];
    if (!opt) return;
    $('event-stage').textContent = stageLabels[opt.dataset.stage] || opt.dataset.stage;
    $('event-date').textContent = opt.dataset.date;
  }

  async function refreshCount() {
    try {
      const data = await api('/api/events/scan/today-count');
      $('today-count').textContent = data.count;
    } catch (e) { /* silent */ }
  }

  // -------- SCANNING --------
  $('start-btn').addEventListener('click', startScanning);
  $('stop-btn').addEventListener('click', stopScanning);

  function ensureZXing() {
    return new Promise((resolve, reject) => {
      if (window.ZXingBrowser) return resolve();
      const t0 = Date.now();
      const i = setInterval(() => {
        if (window.ZXingBrowser) { clearInterval(i); resolve(); }
        else if (Date.now() - t0 > 8000) { clearInterval(i); reject(new Error('ZXing no disponible')); }
      }, 100);
    });
  }

  async function startScanning() {
    try {
      await ensureZXing();
    } catch (e) {
      alert('No se pudo cargar el lector de QR. Revisa tu conexión.');
      return;
    }
    $('start-btn').hidden = true;
    $('stop-btn').hidden = false;
    $('scan-hint').textContent = 'Buscando código...';

    const video = $('video');
    codeReader = new ZXingBrowser.BrowserMultiFormatReader();

    try {
      const devices = await ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
      const back = devices.find((d) => /back|trasera|rear|environment/i.test(d.label)) || devices[0];
      activeStream = await codeReader.decodeFromVideoDevice(back ? back.deviceId : null, video, async (result) => {
        if (result && !scanLocked) {
          scanLocked = true;
          await processScan(result.getText());
          setTimeout(() => { scanLocked = false; }, 1200);
        }
      });
    } catch (err) {
      console.error(err);
      $('scan-hint').textContent = 'No se pudo acceder a la cámara';
      $('start-btn').hidden = false;
      $('stop-btn').hidden = true;
    }
  }

  function stopScanning() {
    if (codeReader) {
      try { codeReader.reset(); } catch (e) {}
    }
    if (activeStream && activeStream.stop) activeStream.stop();
    activeStream = null;
    $('start-btn').hidden = false;
    $('stop-btn').hidden = true;
    $('scan-hint').textContent = 'Centra el QR del invitado';
  }

  // -------- MANUAL --------
  $('manual-btn').addEventListener('click', () => {
    const pane = $('manual-pane');
    pane.hidden = !pane.hidden;
  });
  $('manual-submit').addEventListener('click', async () => {
    const v = $('manual-input').value.trim();
    if (!v) return;
    await processScan(v);
    $('manual-input').value = '';
  });

  // -------- PROCESS --------
  async function processScan(text) {
    const eventId = $('event-select').value;
    if (!eventId) { alert('Selecciona un evento primero'); return; }
    const tokenStr = String(text).trim().split('/').pop();

    // BOLETO_ABONADO: pedir monto antes de enviar el scan.
    const sel = $('event-select');
    const opt = sel.options[sel.selectedIndex];
    const stage = opt ? opt.dataset.stage : '';
    let amount = null;
    if (stage === 'BOLETO_ABONADO') {
      const raw = prompt('Monto abonado (COP):');
      if (raw === null) return; // canceló
      const parsed = parseFloat(String(raw).replace(/[^\d.]/g, ''));
      if (isNaN(parsed) || parsed <= 0) {
        alert('Monto inválido');
        return;
      }
      amount = parsed;
    }

    try {
      const result = await api('/api/events/scan', {
        method: 'POST',
        body: JSON.stringify({ event_id: parseInt(eventId, 10), qr_token: tokenStr, amount }),
      });
      showConfirm(result);
      await refreshCount();
      vibrate(80);
    } catch (err) {
      showFailure(err.message);
      vibrate([60, 80, 60]);
    }
  }

  function vibrate(pattern) {
    if (navigator.vibrate) try { navigator.vibrate(pattern); } catch(e){}
  }

  function showConfirm(result) {
    $('confirm-modal').hidden = false;

    const isWG = !!result.wg;
    const advancedOrWG = result.advanced || isWG;
    $('modal-mark').textContent = advancedOrWG ? '✓' : '↻';
    $('modal-mark').className = 'modal-mark' + (advancedOrWG ? '' : ' warn');

    if (isWG) {
      const dayDup = result.wg.already_attended_today;
      $('modal-title').textContent = dayDup ? 'Asistencia WG (ya registrada hoy)' : 'Asistencia WG registrada';
    } else {
      $('modal-title').textContent = result.advanced ? 'Etapa avanzada' : 'Re-escaneo registrado';
    }

    $('m-name').textContent = result.guest.full_name;
    $('m-partner').textContent = result.guest.distributor_name || result.guest.partner_name || '—';
    $('m-module').textContent = result.guest.module_number ? `Módulo ${result.guest.module_number}` : '—';
    $('m-prev').textContent = stageLabels[result.previous_stage] || result.previous_stage;
    $('m-new').textContent = stageLabels[result.new_stage] || result.new_stage;

    // Bloque WG
    if (isWG) {
      $('m-wg-block').hidden = false;
      $('m-wg-day').textContent = result.wg.day_label;
      $('m-wg-week').textContent = result.wg.iso_week;
      $('m-wg-weeks').textContent = result.wg.status.total_weeks;
      $('m-wg-consec').textContent = result.wg.status.max_consecutive_weeks;

      const card = $('m-wg-status-card');
      card.className = 'wg-status-card ' + result.wg.status.status;
      const icons = { green: '🟢', yellow: '🟡', red: '🔴', none: '⚪' };
      const labels = { green: 'Sólido — 2+ semanas consecutivas', yellow: 'En riesgo — completar 2da semana', red: 'Abandonó — necesita seguimiento', none: 'Primera asistencia' };
      $('m-wg-status-icon').textContent = icons[result.wg.status.status] || '⚪';
      $('m-wg-status-text').textContent = labels[result.wg.status.status] || result.wg.status.status_label;
    } else {
      $('m-wg-block').hidden = true;
    }
  }

  function showFailure(msg) {
    $('confirm-modal').hidden = false;
    $('modal-mark').textContent = '✕';
    $('modal-mark').className = 'modal-mark fail';
    $('modal-title').textContent = 'No se pudo registrar';
    $('m-name').textContent = msg;
    $('m-partner').textContent = '—';
    $('m-module').textContent = '—';
    $('m-prev').textContent = '—';
    $('m-new').textContent = '—';
  }

  $('modal-close').addEventListener('click', () => {
    $('confirm-modal').hidden = true;
  });

  // -------- BOOT --------
  if (token) {
    initApp().catch(() => {
      localStorage.removeItem(STORAGE_TOKEN); token = null; show('login');
    });
  } else {
    show('login');
  }
})();
