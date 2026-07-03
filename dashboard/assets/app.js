(function () {
  const API = window.SOCIALHUB_API || 'https://web-production-5c3eb.up.railway.app';
  const STORAGE_TOKEN = 'sh_dashboard_token';

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  let token = localStorage.getItem(STORAGE_TOKEN);
  let me = null;
  let cachedModules = [];
  let cachedDistributors = [];
  let cachedProductiveLeaders = [];
  let stageLabels = {};
  let scannableStages = [];
  let charts = {};

  // ============ API ============
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await fetch(`${API}${path}`, { ...opts, headers });
    const text = await resp.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) {}
    if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);
    return data;
  }

  // ============ AUTH ============
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
      token = data.token; me = data.user;
      localStorage.setItem(STORAGE_TOKEN, token);
      await boot();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  $('login-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  $('logout-btn').addEventListener('click', logout);
  if ($('inactive-logout')) $('inactive-logout').addEventListener('click', logout);
  function logout() {
    localStorage.removeItem(STORAGE_TOKEN); token = null; me = null;
    document.body.classList.remove('inactive-user');
    showScreen('login');
  }
  function showScreen(name) {
    ['login','app','onboarding','forgot','reset'].forEach((n) => {
      const el = $(n + '-screen');
      if (el) el.classList.toggle('active', name === n);
    });
  }

  // ============ FORGOT / RESET PASSWORD ============
  const forgotLink = $('forgot-link'), fgBack = $('fg-back');
  if (forgotLink) forgotLink.addEventListener('click', (e) => { e.preventDefault(); showScreen('forgot'); });
  if (fgBack)    fgBack.addEventListener('click', (e) => { e.preventDefault(); showScreen('login'); });
  if ($('forgot-form')) {
    $('forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fb = $('fg-feedback'); fb.hidden = true;
      try {
        await api('/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ distributor_code: $('fg-code').value.trim().toUpperCase() }),
        });
        fb.textContent = '✓ Si el ID está registrado, recibirás un correo en breve.';
        fb.hidden = false;
        $('fg-code').value = '';
      } catch (err) {
        fb.textContent = err.message; fb.hidden = false;
      }
    });
  }
  if ($('reset-form')) {
    $('reset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('rs-error'); err.hidden = true;
      const p1 = $('rs-pwd').value, p2 = $('rs-pwd2').value;
      if (p1 !== p2) { err.textContent = 'Las contraseñas no coinciden'; err.hidden = false; return; }
      const token = (location.hash.match(/#reset=([^&]+)/) || [])[1];
      if (!token) { err.textContent = 'Token no encontrado en URL'; err.hidden = false; return; }
      try {
        await api('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ token, new_password: p1 }),
        });
        location.hash = '';
        alert('✓ Contraseña actualizada. Ingresa con tus nuevas credenciales.');
        showScreen('login');
      } catch (e2) { err.textContent = e2.message; err.hidden = false; }
    });
  }

  // ============ ONBOARDING (primer login) ============
  const BHIP_RANKS = [
    'Profesional', 'Bronce', 'Plata', 'Oro', 'Platino', 'Zafiro',
    'Rubí', 'Esmeralda', 'Diamante', 'Diamante Azul', 'Diamante Negro',
  ];

  if ($('onboarding-form')) {
    $('onboarding-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('onb-error'); err.hidden = true;
      const p1 = $('onb-pwd').value, p2 = $('onb-pwd2').value;
      if (p1 !== p2) {
        err.textContent = 'Las contraseñas no coinciden';
        err.hidden = false; return;
      }
      try {
        await api('/api/auth/complete-profile', {
          method: 'POST',
          body: JSON.stringify({
            full_name: $('onb-name').value.trim(),
            phone: $('onb-phone').value.trim(),
            new_password: p1,
          }),
        });
        await boot(); // reentra al flujo normal
      } catch (e) {
        err.textContent = e.message; err.hidden = false;
      }
    });
  }

  // ============ NAV ============
  $$('.nav-item').forEach((el) => {
    el.addEventListener('click', () => {
      const view = el.dataset.view;
      $$('.nav-item').forEach((n) => n.classList.toggle('active', n === el));
      $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
      loadView(view);
      document.body.classList.remove('menu-open'); // cerrar drawer al navegar
    });
  });

  // Hamburger (mobile)
  const menuToggle = $('menu-toggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => document.body.classList.toggle('menu-open'));
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('menu-open')) return;
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar.contains(e.target) && e.target !== menuToggle) {
        document.body.classList.remove('menu-open');
      }
    });
  }

  function loadView(v) {
    if (v === 'overview')   loadOverview();
    if (v === 'alerts')     loadAlerts();
    if (v === 'comparison') loadComparison();
    if (v === 'funnel')     loadFunnel();
    if (v === 'team')       loadTeam();
    if (v === 'wg')         loadWG();
    if (v === 'modules')    loadModules();
    if (v === 'users')      loadUsers();
    if (v === 'guests')     loadGuests();
    if (v === 'messages')   loadMessages();
    if (v === 'events')     loadEvents();
    if (v === 'profile')    loadProfile();
    if (v === 'scanner')    loadScanner();
    if (v !== 'scanner')    stopScanning();
    if (v === 'logros')     loadLogros();
    if (v === 'latam')      loadLatam();
    if (v === 'promociones') loadPromotions();
  }

  // ============ PROMOCIONES ============
  async function loadPromotions() {
    try {
      const data = await api('/api/promotions');
      const cycleEl = $('promo-cycle-range');
      if (!data.cycle) {
        if (cycleEl) cycleEl.textContent = 'Sin ciclo vigente';
        $('promo-top').innerHTML = '<tr><td colspan="6" class="muted">Sin ciclo vigente.</td></tr>';
        return;
      }
      if (cycleEl) cycleEl.textContent = `Ciclo: ${data.cycle.start_date} → ${data.cycle.end_date}`;
      const dateInput = $('promo-date');
      if (dateInput) {
        dateInput.min = data.cycle.start_date;
        dateInput.max = data.cycle.end_date;
        if (!dateInput.value) {
          const todayCO = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
          const clamped = todayCO < data.cycle.start_date ? data.cycle.start_date
                         : (todayCO > data.cycle.end_date ? data.cycle.end_date : todayCO);
          dateInput.value = clamped;
        }
      }

      const rows = data.top || [];
      $('promo-top').innerHTML = rows.length
        ? rows.map((r, i) => {
            const rank = i + 1;
            const tag = rank <= 5
              ? '<span class="tag mvp">👑 MVP</span>'
              : rank <= 30 ? '<span class="tag vip">VIP</span>' : '';
            const isMe = r.user_id === me.id;
            return `<tr${isMe ? ' style="background:rgba(201,162,74,0.08);"' : ''}>
              <td><strong>${rank}</strong></td>
              <td>${tag}</td>
              <td>${r.full_name}${isMe ? ' <span class="muted" style="font-size:11px;">(yo)</span>' : ''}</td>
              <td>${r.order_number}</td>
              <td><strong style="color:var(--gold-400);">${r.bv_personal}</strong></td>
              <td class="muted" style="font-size:12px;">${r.date}</td>
            </tr>`;
          }).join('')
        : '<tr><td colspan="6" class="muted">Sin registros en este ciclo. ¡Sé el primero!</td></tr>';

      const mine = data.my || [];
      if (mine.length) {
        const totalBV = mine.reduce((s, r) => s + (r.bv_personal || 0), 0);
        $('promo-mine').textContent = `Ya registraste ${mine.length} orden(es) este ciclo · Total BV: ${totalBV}.`;
      } else {
        $('promo-mine').textContent = '';
      }
    } catch (err) { handleErr(err); }
  }

  if ($('promo-form')) {
    $('promo-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/promotions', {
          method: 'POST',
          body: JSON.stringify({
            bv_personal: parseInt($('promo-bv').value, 10) || 0,
            order_number: $('promo-order').value.trim(),
            date: $('promo-date').value,
          }),
        });
        $('promo-bv').value = '';
        $('promo-order').value = '';
        loadPromotions();
      } catch (err) { alert(err.message); }
    });
  }

  // ============ TOP 10 LATAM ============
  async function loadLatam() {
    try {
      const [signs, bit] = await Promise.all([
        api('/api/rankings/latam-signs'),
        api('/api/rankings/latam-bit'),
      ]);
      $('latam-signs').innerHTML = renderLatamRows(signs.rows, 'signs');
      $('latam-bit').innerHTML   = renderLatamRows(bit.rows,   'bit_shows');
    } catch (err) { handleErr(err); }
  }
  function renderLatamRows(rows, metric) {
    if (!rows || !rows.length) return '<li class="muted">Sin datos del mes aún.</li>';
    return rows.map((r, i) => {
      const medal = ['🥇','🥈','🥉'][i] || `${i + 1}.`;
      const sys = r.system_name ? ` <span class="muted" style="font-size:11px;">· ${r.system_name}</span>` : '';
      return `<li>
        <span class="rank-place">${medal}</span>
        <span class="rank-name">${r.full_name}${sys}</span>
        <span class="rank-xp">${r[metric]}</span>
      </li>`;
    }).join('');
  }

  // ============ GAMIFICACIÓN ============
  async function loadLogros() {
    try {
      const [me_, week, month] = await Promise.all([
        api('/api/gamification/me'),
        api('/api/gamification/rankings/week'),
        api('/api/gamification/rankings/month'),
      ]);
      $('g-streak').textContent   = me_.streak.current_streak;
      $('g-longest').textContent  = me_.streak.longest_streak;
      $('g-xp').textContent       = me_.xp_total;
      $('g-streak-msg').textContent = streakMessage(me_.streak.current_streak);

      $('g-achievements').innerHTML = me_.achievements.map((a) => `
        <div class="achievement ${a.unlocked ? 'unlocked' : 'locked'}">
          <div class="achievement-icon">${a.icon}</div>
          <div class="achievement-label">${a.label}</div>
          <div class="achievement-desc">${a.desc}</div>
          ${a.unlocked ? `<div class="achievement-unlocked-at">Desbloqueado ${String(a.unlocked_at).slice(0, 10)}</div>` : '<div class="achievement-locked-tag">Por desbloquear</div>'}
        </div>
      `).join('');

      $('rank-week').innerHTML  = renderRanking(week.rows, me.id);
      $('rank-month').innerHTML = renderRanking(month.rows, me.id);
    } catch (err) { handleErr(err); }
  }

  function streakMessage(n) {
    if (n === 0) return 'Comienza tu racha 💪';
    if (n === 1) return '¡Buen comienzo!';
    if (n < 7)   return `Llevas ${n} días — no la rompas 🔥`;
    if (n < 30)  return `¡${n} días! Estás imparable`;
    return `${n} días — eres una máquina ⭐`;
  }

  function renderRanking(rows, meId) {
    if (!rows || !rows.length) return '<li class="muted">Aún sin actividad — sé el primero 🚀</li>';
    return rows.slice(0, 5).map((r, i) => {
      const medal = ['🥇','🥈','🥉'][i] || `${i + 1}.`;
      const self = r.id === meId ? '<span class="muted" style="font-size:11px;"> (tú)</span>' : '';
      return `<li>
        <span class="rank-place">${medal}</span>
        <span class="rank-name">${r.full_name}${self}</span>
        <span class="rank-xp">${r.xp} XP</span>
      </li>`;
    }).join('');
  }

  async function refreshStreakBadge() {
    try {
      const d = await api('/api/gamification/me');
      const badge = $('streak-badge');
      if (badge && d.streak.current_streak > 0) {
        $('streak-count').textContent = d.streak.current_streak;
        badge.hidden = false;
      }
    } catch (e) { /* silent */ }
  }

  function loadProfile() {
    const rows = [
      ['ID BHIP', me.distributor_code],
      ['Nombre', me.full_name],
      ['Correo', me.email || '—'],
      ['Celular', me.phone || '—'],
      ['Rol', me.role_label],
      ['Rango BHIP', me.bhip_rank || '—'],
      ['Sistema', me.system_name || '—'],
      ['Módulo', me.module_number ? `Módulo ${me.module_number}` : '—'],
      ['Mesa', me.team_leader_name || '—'],
    ];
    $('profile-info').innerHTML = rows.map(([k, v]) => `
      <div class="profile-row">
        <span class="profile-label">${k}</span>
        <span class="profile-value">${v}</span>
      </div>
    `).join('');

    // Mi link de registro
    const refInput = $('ref-link');
    if (refInput && me.distributor_code) {
      const landingBase = 'https://socialhub-medellin.vercel.app/landing/';
      refInput.value = `${landingBase}?ref=${encodeURIComponent(me.distributor_code)}`;
    }

    // Calendario de actividad — mes actual por defecto
    const monthInput = $('cal-month');
    if (monthInput && !monthInput.value) {
      const now = new Date();
      monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    loadActivityCalendar();
  }

  async function loadActivityCalendar() {
    const month = $('cal-month').value;
    if (!month) return;
    try {
      const d = await api(`/api/activity/calendar?month=${encodeURIComponent(month)}`);
      $('cal-summary').innerHTML = `
        <span><strong>${d.totals.active_days}</strong>/${d.days.length} días activos</span>
        <span style="margin-left:18px;color:var(--muted);">Consistencia: <strong style="color:var(--gold-400);">${d.consistency_pct}%</strong></span>
        <span style="margin-left:18px;color:var(--muted);">Prom. msgs/día: <strong>${d.averages.messages}</strong></span>
        <span style="margin-left:14px;color:var(--muted);">Prom. books/día: <strong>${d.averages.books}</strong></span>
      `;
      $('cal-grid').innerHTML = d.days.map(renderCalDay).join('');
    } catch (err) { handleErr(err); }
  }

  function renderCalDay(d) {
    const total = d.messages + d.books * 10 + d.tiktok_minutes / 5 + d.tiktok_leads * 8;
    let cls = 'cal-zero';
    if (total > 0 && total < 30) cls = 'cal-low';
    else if (total >= 30 && total < 100) cls = 'cal-mid';
    else if (total >= 100) cls = 'cal-high';
    const tooltip = `${d.date} · ${d.messages} msgs · ${d.books} books · ${d.tiktok_minutes}min TT · ${d.tiktok_leads} leads`;
    return `<div class="cal-day-cell ${cls}" title="${tooltip}"><span class="cal-day-num">${d.day}</span></div>`;
  }

  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'cal-month') loadActivityCalendar();
  });

  if ($('copy-ref-link')) {
    $('copy-ref-link').addEventListener('click', async () => {
      const fb = $('ref-link-feedback');
      const link = $('ref-link').value;
      try {
        await navigator.clipboard.writeText(link);
        fb.textContent = '✓ Link copiado al portapapeles';
        fb.hidden = false;
      } catch (e) {
        // Fallback para navegadores viejos / contextos no seguros
        $('ref-link').select();
        document.execCommand('copy');
        fb.textContent = '✓ Link copiado';
        fb.hidden = false;
      }
      setTimeout(() => { fb.hidden = true; }, 2500);
    });
  }

  if ($('pwd-form')) {
    $('pwd-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fb = $('pwd-feedback');
      fb.hidden = true; fb.style.borderColor = ''; fb.style.color = '';
      const n1 = $('pwd-new').value, n2 = $('pwd-new2').value;
      if (n1 !== n2) {
        fb.textContent = 'Las contraseñas nuevas no coinciden.';
        fb.hidden = false; fb.style.color = '#FFB0B5';
        return;
      }
      try {
        await api('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({
            current_password: $('pwd-current').value,
            new_password: n1,
          }),
        });
        fb.textContent = '✓ Contraseña actualizada.';
        fb.hidden = false;
        $('pwd-form').reset();
      } catch (e) {
        fb.textContent = e.message; fb.hidden = false;
        fb.style.color = '#FFB0B5';
      }
    });
  }

  // ============ COLOR HELPERS ============
  const COLOR_LABELS = {
    none: 'Sin color', light_green: 'Verde claro', strong_green: 'Verde fuerte',
    yellow: 'Amarillo', orange: 'Naranja', red: 'Rojo', black: 'Negro',
  };
  function colorChip(color, locked) {
    const c = color || 'none';
    return `<span class="color-chip ${c} ${locked ? 'locked' : ''}" title="${locked ? 'Manual (Líder de Módulo)' : 'Automático'}">${COLOR_LABELS[c]}</span>`;
  }
  function canEditColor() {
    return me && (me.role === 'system_leader' || me.role === 'module_leader');
  }
  function canEditStage() {
    return me && (me.role === 'lider_supremo' || me.role === 'system_leader' || me.role === 'module_leader');
  }
  // SQLite guarda datetime('now') en UTC sin marcador de zona ('YYYY-MM-DD HH:MM:SS').
  // Lo parseamos como UTC y mostramos en hora local del navegador.
  function fmtLocal(s) {
    if (!s) return '—';
    const iso = String(s).includes('T') ? String(s) : String(s).replace(' ', 'T');
    const withZ = iso.endsWith('Z') ? iso : iso + 'Z';
    const d = new Date(withZ);
    if (isNaN(d.getTime())) return String(s).slice(0, 16);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function bitCell(g) {
    if (!g.bit_date) return '<span class="muted" style="font-size:11px;">—</span>';
    const days = g.days_since_bit;
    if (g.current_stage === 'FIRMADO') return `<span class="muted" style="font-size:11px;">${g.bit_date}</span>`;
    if (days == null) return `<span class="muted" style="font-size:11px;">${g.bit_date}</span>`;
    const cls = days >= 14 ? 'red' : (days >= 11 ? 'gold' : 'gray');
    return `<span class="tag ${cls}" title="${g.bit_date}">${days}d</span>`;
  }

  // Mantengo hook global por si algún select dispara recarga (ej. filtro módulo)
  window._shApplyFilters = function () {
    const active = $$('.view.active')[0];
    if (active) loadView(active.dataset.view);
  };

  function getFilters() {
    return {
      module_id: $('filter-module').value || undefined,
    };
  }
  function qs(params) {
    const e = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
    return e.length ? '?' + e.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
  }

  // ============ OVERVIEW ============
  async function loadOverview() {
    const f = getFilters();
    try {
      const [kpis, monthly, byMod] = await Promise.all([
        api('/api/stats/kpis' + qs(f)),
        api('/api/stats/monthly' + qs({ module_id: f.module_id })),
        me.role === 'system_leader' ? api('/api/stats/by-module' + qs({ month: f.month })) : Promise.resolve({ modules: [] }),
      ]);
      $('kpi-active').textContent = kpis.kpis.active_partners;
      $('kpi-msgs').textContent = kpis.kpis.messages_per_active ?? kpis.kpis.messages_per_signed ?? '—';
      $('kpi-conv').textContent = (kpis.kpis.bit_to_signed_pct ?? 0) + '%';
      drawMonthly(monthly.monthly);
      if (me.role === 'system_leader') {
        $('modules-panel').hidden = false;
        drawByModule(byMod.modules);
      } else {
        $('modules-panel').hidden = true;
      }
    } catch (err) { handleErr(err); }
  }

  function drawMonthly(rows) {
    const ctx = $('chart-monthly').getContext('2d');
    if (charts.monthly) charts.monthly.destroy();
    charts.monthly = new Chart(ctx, {
      type: 'line',
      data: {
        labels: rows.map((r) => (r.day || r.month || '').slice(8) || (r.day || r.month)),
        datasets: [
          { label: 'Invitados', data: rows.map((r) => r.guests), borderColor: '#46B0A8', backgroundColor: 'rgba(70, 176, 168, 0.10)', tension: 0.3, fill: true, borderWidth: 2 },
          { label: 'Firmados', data: rows.map((r) => r.signed), borderColor: '#D9B871', backgroundColor: 'rgba(217, 184, 113, 0.10)', tension: 0.3, fill: true, borderWidth: 2 },
        ],
      },
      options: chartOpts(),
    });
  }
  function drawByModule(rows) {
    const ctx = $('chart-modules').getContext('2d');
    if (charts.byModule) charts.byModule.destroy();
    charts.byModule = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: rows.map((r) => `M${r.number}`),
        datasets: [
          { label: 'Invitados', data: rows.map((r) => r.total_guests), backgroundColor: 'rgba(70, 176, 168, 0.7)', borderRadius: 6 },
          { label: 'Firmados', data: rows.map((r) => r.total_signed), backgroundColor: 'rgba(217, 184, 113, 0.85)', borderRadius: 6 },
        ],
      },
      options: chartOpts(),
    });
  }
  function chartOpts() {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#E8DFC9', font: { family: 'Jost', size: 12 } } } },
      scales: {
        x: { ticks: { color: '#8FA3B8' }, grid: { color: 'rgba(245,239,226,0.05)' } },
        y: { ticks: { color: '#8FA3B8' }, grid: { color: 'rgba(245,239,226,0.05)' }, beginAtZero: true },
      },
    };
  }

  // ============ COMPARACIÓN ============
  async function loadComparison() {
    const f = getFilters();
    const data = await api('/api/stats/comparison' + qs({ module_id: f.module_id }));
    $('cmp-weekly').innerHTML = renderComparison(data.weekly, 'semana');
    $('cmp-monthly').innerHTML = renderComparison(data.monthly, 'mes');
  }
  function renderComparison(group, periodLabel) {
    const metrics = [
      ['guests', 'Invitados nuevos'],
      ['signed', 'Profesionales Firmados'],
      ['bit', 'Asistencia B.I.T'],
      ['messages', 'Mensajes enviados'],
    ];
    return metrics.map(([key, label]) => {
      const cur = group.current[key], prev = group.previous[key];
      const delta = prev === 0 ? (cur > 0 ? '∞' : '0') : `${Math.round(((cur - prev) / prev) * 100)}%`;
      const dir = cur > prev ? 'up' : (cur < prev ? 'down' : 'flat');
      const arrow = dir === 'up' ? '↑' : (dir === 'down' ? '↓' : '→');
      return `
        <div class="cmp-stat">
          <div class="cmp-label">${label}</div>
          <div class="cmp-vals">
            <span class="cmp-previous">${periodLabel} anterior: ${prev}</span>
            <span class="cmp-current">${cur}</span>
            <span class="cmp-delta ${dir}">${arrow} ${delta}</span>
          </div>
        </div>`;
    }).join('');
  }

  // ============ FUNNEL ============
  async function loadFunnel() {
    const mode = $('funnel-mode') ? $('funnel-mode').value : 'month';
    const fFrom = $('funnel-from'), fTo = $('funnel-to');
    const rangeWrap = $('funnel-date-range');
    const bitSel = $('funnel-bit-date');
    const fmt = (d) => d.toISOString().slice(0, 10);

    // Toggle controles: en Ciclo B.I.T se usa el selector por fecha, no un rango.
    if (rangeWrap) rangeWrap.style.display = mode === 'bit_cycle' ? 'none' : '';
    if (bitSel)    bitSel.style.display    = mode === 'bit_cycle' ? '' : 'none';

    if (mode === 'bit_cycle') {
      return loadBitCycleMode();
    }

    // Auto-rellenar fechas según modo (a menos que sea 'custom').
    if (mode !== 'custom') {
      const now = new Date();
      if (mode === 'week') {
        const dow = now.getUTCDay(); // 0=Dom
        const monday = new Date(now); monday.setUTCDate(now.getUTCDate() - ((dow + 6) % 7));
        const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
        fFrom.value = fmt(monday); fTo.value = fmt(sunday);
      } else {
        // month: usamos el mes actual como base
        const y = now.getUTCFullYear(), m = now.getUTCMonth();
        fFrom.value = fmt(new Date(Date.UTC(y, m, 1)));
        fTo.value   = fmt(new Date(Date.UTC(y, m + 1, 0)));
      }
    } else if (!fFrom.value || !fTo.value) {
      const now = new Date();
      const y = now.getUTCFullYear(), m = now.getUTCMonth();
      fFrom.value = fmt(new Date(Date.UTC(y, m, 1)));
      fTo.value   = fmt(new Date(Date.UTC(y, m + 1, 0)));
    }

    const rangeParams = { from: fFrom.value, to: fTo.value };
    window._shFunnelRange = rangeParams;

    const data = await api('/api/stats/funnel' + qs({ ...getFilters(), ...rangeParams }));
    const max = Math.max(...data.funnel.map((s) => s.count), 1);

    // Inputs: mensajes y TikTok leads → books (rama de entrada al embudo).
    const inp = data.inputs || {};
    const inputsHtml = inp.messages || inp.tiktok_leads ? `
      <div class="funnel-inputs">
        <div class="overline">Entradas al embudo</div>
        <div class="funnel-inputs-grid">
          <div class="funnel-input-card">
            <div class="funnel-input-label">Mensajes (Tipo A)</div>
            <div class="funnel-input-count">${inp.messages?.count ?? 0}</div>
            <div class="funnel-input-conv">→ <strong>${inp.messages?.books ?? 0} books</strong></div>
            <div class="funnel-convo ${(inp.messages?.to_books_pct || 0) >= 5 ? 'good' : (inp.messages?.to_books_pct || 0) >= 1 ? 'mid' : 'low'}">${inp.messages?.to_books_pct ?? 0}%</div>
          </div>
          <div class="funnel-input-card tiktok">
            <div class="funnel-input-label">TikTok leads (Tipo B)</div>
            <div class="funnel-input-count">${inp.tiktok_leads?.count ?? 0}</div>
            <div class="funnel-input-conv">→ <strong>${inp.tiktok_leads?.books ?? 0} books</strong></div>
            <div class="funnel-convo ${(inp.tiktok_leads?.to_books_pct || 0) >= 25 ? 'good' : (inp.tiktok_leads?.to_books_pct || 0) >= 10 ? 'mid' : 'low'}">${inp.tiktok_leads?.to_books_pct ?? 0}%</div>
          </div>
        </div>
      </div>
    ` : '';

    const funnelHtml = data.funnel.map((s) => {
      const convo = s.conversion_from_previous_pct;
      const convoHtml = convo == null ? ''
        : `<div class="funnel-convo ${convo >= 50 ? 'good' : convo >= 25 ? 'mid' : 'low'}" title="Conversión desde la etapa anterior">${convo}%</div>`;
      const widthPct = (s.count / max) * 100;
      // BOLETOS: barra segmentada en 3 sub-stages (excluye NoInteresado del visual).
      let barHtml;
      if (s.stage === 'BOLETOS' && s.breakdown) {
        const total = (s.breakdown.BOLETO_PAGO || 0) + (s.breakdown.BOLETO_ABONADO || 0) + (s.breakdown.BOLETO_NO_PAGO || 0);
        const segPago    = total ? (s.breakdown.BOLETO_PAGO / total) * 100 : 0;
        const segAbon    = total ? (s.breakdown.BOLETO_ABONADO / total) * 100 : 0;
        const segNoPago  = total ? (s.breakdown.BOLETO_NO_PAGO / total) * 100 : 0;
        const ni = s.breakdown.BOLETO_NO_INTERESADO || 0;
        barHtml = `<div class="funnel-bar" style="display:flex;overflow:hidden;width:${widthPct}%;">
          <div title="Pago: ${s.breakdown.BOLETO_PAGO || 0}" style="background:#4FE3A0;width:${segPago}%;"></div>
          <div title="Abonado: ${s.breakdown.BOLETO_ABONADO || 0}" style="background:var(--gold-500);width:${segAbon}%;"></div>
          <div title="No Pago: ${s.breakdown.BOLETO_NO_PAGO || 0}" style="background:#FF8B95;width:${segNoPago}%;"></div>
        </div>`;
        const niTag = ni ? `<span class="muted" style="margin-left:8px;font-size:11px;">+${ni} No Interesado</span>` : '';
        return `
          <div class="funnel-row" data-stage="BOLETOS" style="cursor:pointer;">
            <div class="funnel-label">${s.label}${niTag}</div>
            ${barHtml}
            <div class="funnel-count">${s.count}</div>
            ${convoHtml}
          </div>
        `;
      }
      return `
        <div class="funnel-row" data-stage="${s.stage}" style="cursor:pointer;">
          <div class="funnel-label">${s.label}</div>
          <div class="funnel-bar"><div class="funnel-fill" style="width:${widthPct}%"></div></div>
          <div class="funnel-count">${s.count}</div>
          ${convoHtml}
        </div>
      `;
    }).join('');

    // WG sessions: 9 barras (WG1..WG9). WG1 incluye PT del día (via wg_session=1).
    const wgs = data.wg_sessions || {};
    const wgMax = Math.max(...Object.values(wgs), 1);
    const wgHtml = `
      <div class="overline" style="margin-top:18px;">Working Group · sesiones consecutivas</div>
      ${[1,2,3,4,5,6,7,8,9].map((n) => {
        const c = wgs[`WG${n}`] || 0;
        const w = (c / wgMax) * 100;
        return `<div class="funnel-row" data-stage="WG${n}" style="cursor:pointer;">
          <div class="funnel-label">WG${n}${n === 1 ? ' <span class="muted" style="font-size:10px;">+ PT</span>' : ''}</div>
          <div class="funnel-bar"><div class="funnel-fill" style="width:${w}%;background:linear-gradient(90deg,#7AC1FF,#4FE3A0);"></div></div>
          <div class="funnel-count">${c}</div>
        </div>`;
      }).join('')}`;

    $('funnel-list').innerHTML = inputsHtml + funnelHtml + wgHtml;

    // Click en cualquier barra → modal con la lista de invitados de esa etapa en el rango.
    $('funnel-list').querySelectorAll('.funnel-row[data-stage]').forEach((row) => {
      row.addEventListener('click', () => openFunnelStageModal(row.dataset.stage));
    });
  }

  const STAGE_LABEL_FRONT = {
    REGISTRO:'Book', BOM:'Show B.O.M', BOLETOS:'Boletos', BIT:'B.I.T',
    POWER_TALK:'Power Talk', PLAN_TRABAJO:'Plan de Trabajo', FIRMADO:'Profesional Firmado',
    BOLETO_PAGO:'Pago', BOLETO_ABONADO:'Abonado', BOLETO_NO_PAGO:'No Pago', BOLETO_NO_INTERESADO:'No Interesado',
    WG1:'Working Group · Sesión 1', WG2:'Working Group · Sesión 2', WG3:'Working Group · Sesión 3',
    WG4:'Working Group · Sesión 4', WG5:'Working Group · Sesión 5', WG6:'Working Group · Sesión 6',
    WG7:'Working Group · Sesión 7', WG8:'Working Group · Sesión 8', WG9:'Working Group · Sesión 9',
  };

  async function openFunnelStageModal(stage) {
    const range = window._shFunnelRange || {};
    if (!range.from || !range.to) return alert('Rango de fechas no definido.');
    openModal(`${STAGE_LABEL_FRONT[stage] || stage} · ${range.from} → ${range.to}`, '<div class="muted">Cargando...</div>');
    try {
      // Pasamos los mismos filtros activos del embudo para que la lista sea consistente.
      const filters = getFilters();
      const qsParams = qs({ stage, from: range.from, to: range.to, ...filters });
      const r = await api(`/api/stats/funnel/guests${qsParams}`);
      window._shFunnelModal = { stage, guests: r.guests || [], range };
      renderFunnelStageModal();
    } catch (e) {
      $('modal-body').innerHTML = `<div class="modal-body"><div class="error">${e.message}</div></div>`;
    }
  }

  // Renderiza el modal aplicando el filtro de sub-estado actual.
  // Estado en window._shFunnelModal: { stage, guests, range, subFilter }.
  function renderFunnelStageModal() {
    const st = window._shFunnelModal;
    if (!st) return;
    const isBoletos = st.stage === 'BOLETOS';
    const sub = st.subFilter || 'ALL';
    const filtered = isBoletos && sub !== 'ALL'
      ? st.guests.filter((g) => g.scan_stage === sub)
      : st.guests;

    const chips = isBoletos ? (() => {
      const counts = { ALL: st.guests.length, BOLETO_PAGO: 0, BOLETO_ABONADO: 0, BOLETO_NO_PAGO: 0, BOLETO_NO_INTERESADO: 0 };
      st.guests.forEach((g) => { counts[g.scan_stage] = (counts[g.scan_stage] || 0) + 1; });
      const opts = [
        ['ALL', 'Todos', 'gray'],
        ['BOLETO_PAGO', 'Pago', 'green'],
        ['BOLETO_ABONADO', 'Abonado', 'gold'],
        ['BOLETO_NO_PAGO', 'No Pago', 'red'],
        ['BOLETO_NO_INTERESADO', 'No Interesado', 'gray'],
      ];
      return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
        ${opts.map(([key, label]) =>
          `<button class="ghost-btn fm-chip" data-sub="${key}" style="${sub === key ? 'background:var(--gold-500);color:var(--navy-900);' : ''}font-size:11px;padding:4px 10px;">${label} <strong>${counts[key] || 0}</strong></button>`
        ).join('')}
      </div>`;
    })() : '';

    const rows = filtered.map((g) => {
      const subTag = isBoletos
        ? `<span class="tag ${g.scan_stage === 'BOLETO_PAGO' ? 'green' : g.scan_stage === 'BOLETO_ABONADO' ? 'gold' : g.scan_stage === 'BOLETO_NO_PAGO' ? 'red' : 'gray'}">${STAGE_LABEL_FRONT[g.scan_stage] || g.scan_stage}</span>` : '';
      const amt = (g.scan_stage === 'BOLETO_ABONADO' && g.amount != null) ? `<strong style="color:var(--gold-400);">$${g.amount}</strong>` : '';
      return `<tr>
        <td><strong>${g.full_name}</strong><div class="muted" style="font-size:11px;">${g.email || ''}</div></td>
        <td class="muted" style="font-size:12px;">${g.phone || '—'}</td>
        <td>${g.distributor_name || '—'}</td>
        <td>${subTag}</td>
        <td>${amt}</td>
        <td class="muted" style="font-size:11px;">${fmtLocal(g.scanned_at)}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">Sin invitados.</td></tr>';

    $('modal-body').innerHTML = `<div class="modal-body" style="max-height:70vh;overflow:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px;flex-wrap:wrap;">
        <div class="muted" style="font-size:12px;">${filtered.length} de ${st.guests.length} invitado(s)</div>
        <button class="ghost-btn" id="fm-export" style="font-size:11px;">Exportar CSV</button>
      </div>
      ${chips}
      <div class="table-wrap" style="overflow-x:auto;max-width:100%;"><table class="table">
        <thead><tr><th>Invitado</th><th>Teléfono</th><th>Distribuidor</th><th>Sub-etapa</th><th>Monto</th><th>Escaneado</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;

    $('modal-body').querySelectorAll('.fm-chip').forEach((b) => {
      b.addEventListener('click', () => {
        window._shFunnelModal.subFilter = b.dataset.sub;
        renderFunnelStageModal();
      });
    });
    const exportBtn = $('fm-export');
    if (exportBtn) exportBtn.addEventListener('click', () => exportFunnelModalCsv(filtered, st.stage));
  }

  // ============ CICLO B.I.T ============
  // Selector de B.I.T específico por fecha. Popula el dropdown y delega en loadBitCycle
  // con el mismo día como rango (from=to=fecha elegida) para acotar el cohort exactamente
  // a los invitados de ese B.I.T.
  function formatBitDateLabel(iso) {
    const [y, m, d] = String(iso).split('-').map((n) => parseInt(n, 10));
    const monthShort = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][m - 1] || '';
    return `${String(d).padStart(2, '0')} ${monthShort} ${y}`;
  }

  async function loadBitCycleMode() {
    const bitSel = $('funnel-bit-date');
    if (!bitSel) return;
    // Recarga la lista de fechas B.I.T disponibles (respetando el filtro de módulo del topbar).
    let dates = [];
    try {
      const r = await api('/api/stats/funnel/bit-dates' + qs(getFilters()));
      dates = r.dates || [];
    } catch (e) {
      $('funnel-list').innerHTML = `<div class="error">${e.message}</div>`;
      return;
    }
    if (!dates.length) {
      bitSel.innerHTML = '<option value="">Sin B.I.T disponibles</option>';
      $('funnel-list').innerHTML = '<div class="muted">No hay B.I.T registrados en tu scope.</div>';
      return;
    }
    // Preservar la selección previa si sigue vigente, sino elegir el B.I.T más reciente.
    const prev = bitSel.value;
    bitSel.innerHTML = dates
      .map((d) => `<option value="${d.date}">B.I.T — ${formatBitDateLabel(d.date)} (${d.count})</option>`)
      .join('');
    if (prev && dates.some((d) => d.date === prev)) bitSel.value = prev;
    const chosen = bitSel.value;
    const range = { from: chosen, to: chosen };
    window._shFunnelRange = range;
    return loadBitCycle(range);
  }

  // Cohort: invitados que llegaron a BIT dentro del rango. Traza recorrido hasta Firmado o inactivo.
  async function loadBitCycle(range) {
    const STAGE_LBL = { REGISTRO:'Book', BOM:'Show B.O.M', BIT:'B.I.T', POWER_TALK:'Power Talk',
      PLAN_TRABAJO:'Plan de Trabajo', FIRMADO:'Firmado',
      BOLETO_PAGO:'Boleto Pago', BOLETO_ABONADO:'Boleto Abonado', BOLETO_NO_PAGO:'Boleto No Pago',
      BOLETO_NO_INTERESADO:'Boleto No Interesado' };
    $('funnel-list').innerHTML = '<div class="muted">Cargando ciclo B.I.T...</div>';
    try {
      const data = await api('/api/stats/funnel/bit-cycle' + qs({ ...getFilters(), ...range }));
      const pct = data.stage_pct || {};
      const sc = data.stage_counts || {};
      const stuck = data.stuck_counts || {};
      const total = data.total || 0;

      // Barras de cohort: cuántos de los que llegaron a BIT continuaron.
      const rangeTxt = range.from === range.to
        ? `del B.I.T del ${formatBitDateLabel(range.from)}`
        : `cuyo B.I.T ocurrió entre ${range.from} y ${range.to}`;
      const cohortBars = `
        <div class="overline">Ciclo B.I.T · ${total} invitado(s)</div>
        <div class="hint" style="margin-bottom:10px;">Cohorte: invitados ${rangeTxt}. Inactivo = 3 días hábiles sin escaneo y no firmado.</div>
        ${['BIT','POWER_TALK','PLAN_TRABAJO','FIRMADO'].map((s) => {
          const c = sc[s] || 0;
          const p = pct[s] || 0;
          const w = total ? (c / total) * 100 : 0;
          return `<div class="funnel-row">
            <div class="funnel-label">${STAGE_LBL[s]}</div>
            <div class="funnel-bar"><div class="funnel-fill" style="width:${w}%"></div></div>
            <div class="funnel-count">${c}</div>
            <div class="funnel-convo ${p >= 50 ? 'good' : p >= 25 ? 'mid' : 'low'}">${p}%</div>
          </div>`;
        }).join('')}
        <div class="funnel-row" style="border-top:1px solid var(--line);margin-top:8px;padding-top:8px;">
          <div class="funnel-label" style="color:#FF8B95;">Inactivos</div>
          <div class="funnel-bar"><div class="funnel-fill" style="width:${total ? (sc.INACTIVE/total)*100 : 0}%;background:#FF8B95;"></div></div>
          <div class="funnel-count">${sc.INACTIVE || 0}</div>
          <div class="funnel-convo low">${pct.INACTIVE || 0}%</div>
        </div>
      `;

      // Tabla de cohort
      const rows = (data.cohort || []).map((g) => {
        const lastScan = fmtLocal(g.last_scan_at);
        const statusTag = g.current_stage === 'FIRMADO'
          ? '<span class="tag green">✦ Firmado</span>'
          : g.inactive
            ? `<span class="tag red">Inactivo · ${STAGE_LBL[g.stuck_at] || g.stuck_at || '—'}</span>`
            : `<span class="tag gold">En curso · ${STAGE_LBL[g.current_stage] || g.current_stage}</span>`;
        return `<tr>
          <td><strong>${g.full_name}</strong><div class="muted" style="font-size:11px;">${g.email || ''}</div></td>
          <td>${g.distributor_name || '—'}</td>
          <td>${g.module_number ? `M${g.module_number}` : '—'}</td>
          <td class="muted" style="font-size:11px;">${g.bit_date || '—'}</td>
          <td class="muted" style="font-size:11px;">${g.power_talk_date || '—'}</td>
          <td class="muted" style="font-size:11px;">${g.plan_trabajo_date || '—'}</td>
          <td class="muted" style="font-size:11px;">${g.signed_at ? String(g.signed_at).slice(0,10) : '—'}</td>
          <td class="muted" style="font-size:11px;">${lastScan}</td>
          <td>${statusTag}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="9" class="muted">Sin invitados en este ciclo.</td></tr>';

      // Resumen de "se quedaron en"
      const stuckEntries = Object.entries(stuck).sort((a, b) => b[1] - a[1]);
      const stuckHtml = stuckEntries.length ? `
        <div class="overline" style="margin-top:18px;">Inactivos · etapa donde se quedaron</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${stuckEntries.map(([s, c]) => `<span class="tag red">${STAGE_LBL[s] || s}: <strong>${c}</strong></span>`).join('')}
        </div>` : '';

      $('funnel-list').innerHTML = `
        ${cohortBars}
        ${stuckHtml}
        <div class="table-wrap" style="margin-top:18px;overflow-x:auto;"><table class="table">
          <thead><tr><th>Invitado</th><th>Distribuidor</th><th>Mód</th><th>B.I.T</th><th>P.Talk</th><th>P.Trabajo</th><th>Firmado</th><th>Último escaneo</th><th>Estado</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      `;
    } catch (e) {
      $('funnel-list').innerHTML = `<div class="error">${e.message}</div>`;
    }
  }

  function exportFunnelModalCsv(rows, stage) {
    const header = ['Invitado','Email','Telefono','Distribuidor','SubEtapa','Monto','Escaneado'];
    const data = rows.map((g) => [
      g.full_name, g.email || '', g.phone || '', g.distributor_name || '',
      STAGE_LABEL_FRONT[g.scan_stage] || g.scan_stage || '',
      (g.scan_stage === 'BOLETO_ABONADO' && g.amount != null) ? g.amount : '',
      fmtLocal(g.scanned_at),
    ]);
    const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [header, ...data].map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `embudo-${stage}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  }

  // ============ TEAM (vista detallada por rol) ============
  async function loadTeam() {
    try {
      const data = await api('/api/team/role-breakdown');
      const root = $('team-content');
      $('team-title').textContent = ({
        systems:            'Comparación entre sistemas',
        modules:            'Comparación entre módulos',
        productive_leaders: `Líderes Productivos · Módulo ${me.module_number}`,
        mesa:               `Mi mesa · ${me.full_name}`,
        self:               'Mi actividad',
      })[data.kind] || 'Mi equipo';

      if (data.kind === 'self') {
        root.innerHTML = renderSelfView(data);
        return;
      }
      root.innerHTML = renderBreakdownView(data);
    } catch (err) { handleErr(err); }
  }

  function renderBreakdownView(data) {
    const totals = data.totals;
    const kpisHtml = totals ? `
      <div class="kpi-grid">
        <article class="kpi"><div class="overline">Mensajes semana</div><div class="kpi-label">Total mesa</div><div class="kpi-value">${totals.messages_week}</div></article>
        <article class="kpi"><div class="overline">Books semana</div><div class="kpi-label">Total mesa</div><div class="kpi-value">${totals.books_week}</div></article>
        <article class="kpi"><div class="overline">B.I.T semana</div><div class="kpi-label">Boletos B.I.T</div><div class="kpi-value">${totals.bit_week}</div></article>
        <article class="kpi" style="border-color:var(--gold-500);">
          <div class="overline">★ Show → B.I.T</div>
          <div class="kpi-label">% conversión clave</div>
          <div class="kpi-value">${totals.shows_to_bit_pct}%</div>
        </article>
      </div>
    ` : '';

    const headers = ({
      systems:            ['Sistema', 'Mensajes mes', 'Books mes', 'B.I.T mes', 'Firmados', '% B.I.T → Firma', ''],
      modules:            ['Módulo', 'Mensajes mes', 'Books mes', 'B.I.T mes', 'Firmados', '% B.I.T → Firma'],
      productive_leaders: ['Líder Productivo', 'Hoy', 'Semana', 'Mes', 'Books mes', 'B.I.T sem', 'Firmados', '% Conv.'],
      mesa:               ['Profesional', 'Hoy', 'Sem', 'Mes', 'Books sem', 'Shows sem', 'B.I.T sem', '% Conv.', 'Estado'],
    })[data.kind];

    const rowHtml = data.rows.map((r) => {
      if (data.kind === 'systems' || data.kind === 'modules') {
        const deleteCell = data.kind === 'systems' && me.role === 'lider_supremo'
          ? `<td><button class="ghost-btn" data-action="delete-system" data-id="${r.id}" data-name="${r.label.replace(/"/g,'&quot;')}" style="color:#FF8B95;border-color:rgba(220,90,100,0.3);">Eliminar</button></td>`
          : (data.kind === 'systems' ? '<td></td>' : '');
        return `<tr>
          <td><strong>${r.label}</strong><div class="muted" style="font-size:11px;">${r.sublabel}</div></td>
          <td>${r.messages_month}</td>
          <td>${r.books_month}</td>
          <td>${r.bit_month}</td>
          <td><strong>${r.signed_month}</strong></td>
          <td><span class="funnel-convo ${r.conversion_pct >= 50 ? 'good' : r.conversion_pct >= 25 ? 'mid' : 'low'}">${r.conversion_pct}%</span></td>
          ${deleteCell}
        </tr>`;
      }
      if (data.kind === 'productive_leaders') {
        return `<tr>
          <td><strong>${r.label}</strong><div class="muted" style="font-size:11px;">${r.sublabel}</div></td>
          <td>${r.messages_today}</td>
          <td>${r.messages_week}</td>
          <td>${r.messages_month}</td>
          <td>${r.books_month}</td>
          <td>${r.bit_week}</td>
          <td><strong>${r.signed_month}</strong></td>
          <td><span class="funnel-convo ${r.conversion_pct >= 50 ? 'good' : r.conversion_pct >= 25 ? 'mid' : 'low'}">${r.conversion_pct}%</span></td>
        </tr>`;
      }
      // mesa
      const status = r.alert_no_messages_48h
        ? '<span class="tag red">⚠ 48h+</span>'
        : '<span class="tag green">Activo</span>';
      return `<tr>
        <td><strong>${r.label}</strong><div class="muted" style="font-size:11px;">${r.sublabel}</div></td>
        <td>${r.messages_today}</td>
        <td>${r.messages_week}</td>
        <td>${r.messages_month}</td>
        <td>${r.books_week}</td>
        <td>${r.shows_week}</td>
        <td><strong>${r.bit_week}</strong></td>
        <td><span class="funnel-convo ${r.conversion_pct >= 50 ? 'good' : r.conversion_pct >= 25 ? 'mid' : 'low'}">${r.conversion_pct}%</span></td>
        <td>${status}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="${headers.length}" class="muted">Sin datos.</td></tr>`;

    return `
      ${kpisHtml}
      <article class="panel">
        <header class="panel-head"><h3>Detalle</h3></header>
        <div class="table-wrap"><table class="table">
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${rowHtml}</tbody>
        </table></div>
      </article>
    `;
  }

  function renderSelfView(data) {
    const s = data.self;
    return `
      <div class="kpi-grid">
        <article class="kpi"><div class="overline">Mensajes hoy</div><div class="kpi-label">Tu actividad</div><div class="kpi-value">${s.messages_today}</div></article>
        <article class="kpi"><div class="overline">Mensajes semana</div><div class="kpi-label">Últimos 7 días</div><div class="kpi-value">${s.messages_week}</div></article>
        <article class="kpi"><div class="overline">Books mes</div><div class="kpi-label">Total mes</div><div class="kpi-value">${s.books_month}</div></article>
        <article class="kpi" style="border-color:var(--gold-500);">
          <div class="overline">★ Msgs → Book</div>
          <div class="kpi-label">% conversión personal</div>
          <div class="kpi-value">${s.books_to_message_pct}%</div>
        </article>
      </div>
      <article class="panel">
        <header class="panel-head"><h3>Mis seguimientos</h3></header>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Invitado</th><th>Etapa</th><th>Color</th><th>B.I.T</th></tr></thead>
          <tbody>${(data.guests || []).map((g) => `
            <tr>
              <td><strong>${g.full_name}</strong></td>
              <td><span class="tag gold">${stageLabels[g.current_stage] || g.current_stage}</span></td>
              <td>${colorChip(g.color)}</td>
              <td>${g.bit_date || '<span class="muted">—</span>'}</td>
            </tr>
          `).join('') || '<tr><td colspan="4" class="muted">Sin seguimientos.</td></tr>'}</tbody>
        </table></div>
      </article>
    `;
  }

  // ============ WORKING GROUP ============
  const WG_BADGE = {
    green:  { icon: '🟢', label: 'Sólido',          tag: 'green' },
    yellow: { icon: '🟡', label: 'En riesgo',       tag: 'gold' },
    red:    { icon: '🔴', label: 'Abandonó',        tag: 'red' },
    none:   { icon: '⚪', label: 'No ha asistido', tag: 'gray' },
  };

  async function loadWG() {
    try {
      const filter = $('wg-filter').value || '';
      const data = await api('/api/wg/calendar' + qs({ filter: filter || undefined, module_id: getFilters().module_id }));
      $('wg-solid').textContent = data.summary.solid;
      $('wg-irregular').textContent = data.summary.irregular;
      $('wg-orange').textContent = data.summary.orange;

      if (!data.guests.length) {
        $('wg-calendar').innerHTML = '<div class="wg-empty">Sin seguimientos que coincidan con el filtro.</div>';
        return;
      }

      $('wg-calendar').innerHTML = data.guests.map(renderWGCard).join('');
    } catch (err) { handleErr(err); }
  }

  function renderWGCard(g) {
    const weeksHtml = (g.weeks || []).map((w) => `
      <div class="wg-week">
        <div class="wg-week-label">Semana ${w.week_number} ${w.week_complete ? '✦' : ''}${w.week_finished && !w.week_complete ? ' · ' + w.missed_count + ' falta(s)' : ''}</div>
        <div class="wg-day-row">${w.days.map(renderDay).join('')}</div>
      </div>
    `).join('') || '<div class="muted" style="font-size:12px;">Aún sin asistencias.</div>';

    const meta = [
      `<span>${g.distributor_name}${g.module_number ? ' · M' + g.module_number : ''}</span>`,
      g.bit_date ? `<span>B.I.T: <strong>${g.bit_date}</strong></span>` : '',
      g.consecutive_full_weeks ? `<span>Semanas consec.: <strong>${g.consecutive_full_weeks}</strong></span>` : '',
    ].filter(Boolean).join('');

    return `
      <div class="wg-card">
        <header class="wg-card-head">
          <div>
            <h4>${g.full_name}</h4>
            <div class="wg-card-meta" style="margin-top:6px;">${meta}</div>
          </div>
          ${colorChip(g.color, g.color_manual)}
        </header>
        ${weeksHtml}
      </div>
    `;
  }

  const DAY_SHORT = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  function renderDay(d) {
    const cls = d.is_future ? 'future' : (d.attended ? 'attended' : 'missed');
    const icon = d.is_future ? '—' : (d.attended ? '✅' : '❌');
    return `<span class="wg-day ${cls}" title="${d.date}">
      <span class="wg-day-name">${DAY_SHORT[d.day]}</span>
      <span>${icon}</span>
    </span>`;
  }

  $('wg-filter').addEventListener('change', loadWG);

  // ============ MODULES ============
  async function loadModules() {
    const data = await api('/api/modules');
    cachedModules = data.modules;
    populateModuleFilter();
    const canManage = me.role === 'lider_supremo' || me.role === 'system_leader';
    const showSystemCol = me.role === 'lider_supremo';
    const sysTh = $('modules-sys-th'); if (sysTh) sysTh.hidden = !showSystemCol;
    // Filtro topbar: si hay módulo seleccionado, mostrar solo ese módulo en la tabla.
    const topbarModule = getFilters().module_id;
    const visibleModules = topbarModule
      ? data.modules.filter((m) => String(m.id) === String(topbarModule))
      : data.modules;
    $('modules-tbody').innerHTML = visibleModules.map((m) => {
      const sysCell = showSystemCol ? `<td><span class="muted" style="font-size:12px;">${m.system_name || '—'}</span></td>` : '';
      const editBtn = me.role === 'lider_supremo'
        ? `<button class="ghost-btn" data-action="edit-mod" data-id="${m.id}" data-number="${m.number}" data-name="${m.name.replace(/"/g, '&quot;')}" data-system-id="${m.system_id || ''}">Editar</button>`
        : '';
      const actions = canManage ? `
        ${editBtn}
        <button class="ghost-btn" data-action="toggle-mod" data-id="${m.id}" data-active="${m.active}" style="margin-left:6px;">${m.active ? 'Desactivar' : 'Reactivar'}</button>
        <button class="ghost-btn" data-action="delete-mod" data-id="${m.id}" data-name="${m.name.replace(/"/g, '&quot;')}" style="margin-left:6px;color:#FF8B95;border-color:rgba(220,90,100,0.3);">Eliminar</button>
      ` : '';
      return `
        <tr>
          <td><strong style="color:var(--gold-400);">M${m.number}</strong></td>
          <td>${m.name}</td>
          ${sysCell}
          <td>${m.member_count}</td>
          <td><span class="tag ${m.active ? 'green' : 'gray'}">${m.active ? 'Activo' : 'Inactivo'}</span></td>
          <td>${actions}</td>
        </tr>
      `;
    }).join('');
    $('modules-tbody').querySelectorAll('[data-action=toggle-mod]').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          await api(`/api/modules/${b.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ active: b.dataset.active !== '1' }) });
          loadModules();
        } catch (e) { alert(e.message); }
      });
    });
    $('modules-tbody').querySelectorAll('[data-action=edit-mod]').forEach((b) => {
      b.addEventListener('click', () => openEditModuleModal(b.dataset));
    });
    $('modules-tbody').querySelectorAll('[data-action=delete-mod]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar el módulo "${b.dataset.name}"? Esta acción no se puede deshacer.`)) return;
        try {
          await api(`/api/modules/${b.dataset.id}`, { method: 'DELETE' });
          loadModules();
        } catch (e) { alert(e.message); }
      });
    });
  }

  function populateModuleFilter() {
    const sel = $('filter-module');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Todos los módulos</option>' +
      cachedModules.map((m) => `<option value="${m.id}">M${m.number} — ${m.name}</option>`).join('');
    if (cur) sel.value = cur;
    // Si no es system_leader, ocultar el filtro (siempre filtra a su módulo)
    $('filter-module-wrap').style.display = me.role === 'system_leader' ? '' : 'none';
  }

  $('new-module').addEventListener('click', async () => {
    let systemPicker = '';
    if (me.role === 'lider_supremo') {
      await fetchSystems();
      systemPicker = `<div class="field"><label>Sistema</label><select id="new-mod-system">${systemsOptions()}</select></div>`;
    }
    openModal('Nuevo módulo', `
      <div class="field"><label>Número</label><input type="number" inputmode="numeric" id="new-mod-number" /></div>
      <div class="field"><label>Nombre</label><input type="text" id="new-mod-name" /></div>
      ${systemPicker}
      <button class="primary" id="save-module">Crear</button>
    `);
    $('save-module').addEventListener('click', async () => {
      try {
        const body = {
          number: parseInt($('new-mod-number').value, 10),
          name: $('new-mod-name').value,
        };
        if (me.role === 'lider_supremo' && $('new-mod-system')) {
          body.system_id = parseInt($('new-mod-system').value, 10) || null;
        }
        await api('/api/modules', { method: 'POST', body: JSON.stringify(body) });
        closeModal(); loadModules();
      } catch (err) { alert(err.message); }
    });
  });

  // ============ EDICIÓN MANUAL (lider_supremo) ============
  // Carga TODOS los sistemas (no solo los que ya tienen módulos).
  let cachedSystems = [];
  async function fetchSystems() {
    try { const r = await api('/api/systems'); cachedSystems = r.systems || []; }
    catch (e) { cachedSystems = []; }
    return cachedSystems;
  }
  function systemsOptions(selectedId) {
    return cachedSystems.map((s) =>
      `<option value="${s.id}" ${String(s.id) === String(selectedId) ? 'selected' : ''}>${s.nombre}</option>`
    ).join('');
  }

  async function openEditModuleModal(d) {
    await fetchSystems();
    const sysOpts = systemsOptions(d.systemId);
    openModal(`Editar módulo M${d.number}`, `
      <div class="field"><label>Nombre</label><input type="text" id="em-name" value="${d.name}" /></div>
      <div class="field"><label>Sistema</label><select id="em-system">${sysOpts}</select></div>
      <p class="hint" style="margin: 0 0 14px;">Cambiar el sistema mueve este módulo a otra oficina. Los usuarios del módulo se quedan donde están.</p>
      <button class="primary" id="em-save">Guardar cambios</button>
    `);
    $('em-save').addEventListener('click', async () => {
      try {
        await api(`/api/modules/${d.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: $('em-name').value.trim(),
            system_id: parseInt($('em-system').value, 10) || null,
          }),
        });
        closeModal(); loadModules();
      } catch (e) { alert(e.message); }
    });
  }

  async function openEditUserModal(u) {
    await fetchSystems();
    const ROLES_FOR_EDIT = ['lider_supremo','system_leader','module_leader','productive_leader','distributor'];
    const ROLE_LABEL = { lider_supremo:'Líder Supremo', system_leader:'Líder de Sistema', module_leader:'Líder de Módulo', productive_leader:'Líder Productivo', distributor:'Profesional Activo' };
    const roleOpts = ROLES_FOR_EDIT.map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('');
    const sysOpts = systemsOptions(u.system_id);
    const modOpts = cachedModules.map((m) =>
      `<option value="${m.id}" ${m.id === u.module_id ? 'selected' : ''}>M${m.number} — ${m.name}${m.system_name ? ' · ' + m.system_name : ''}</option>`
    ).join('');
    const plOpts = cachedProductiveLeaders.map((p) =>
      `<option value="${p.id}" ${p.id === u.productive_leader_id ? 'selected' : ''}>${p.full_name}</option>`
    ).join('');

    openModal(`Editar usuario — ${u.full_name}`, `
      <div class="field"><label>Nombre completo</label><input type="text" id="eu-name" value="${(u.full_name || '').replace(/"/g, '&quot;')}" /></div>
      <div class="field"><label>Correo</label><input type="email" id="eu-email" value="${u.email || ''}" /></div>
      <div class="field"><label>Celular</label><input type="text" id="eu-phone" value="${u.phone || ''}" /></div>
      <div class="field"><label>Rol</label><select id="eu-role">${roleOpts}</select></div>
      <div class="field"><label>Sistema</label><select id="eu-system"><option value="">(ninguno — cross-system)</option>${sysOpts}</select></div>
      <div class="field"><label>Módulo</label><select id="eu-module"><option value="">(ninguno)</option>${modOpts}</select></div>
      <div class="field"><label>Líder Productivo (mesa)</label><select id="eu-pl"><option value="">(ninguno)</option>${plOpts}</select></div>
      <p class="hint" style="margin: 0 0 14px;">Cambios manuales — usa con cuidado. Mover entre sistemas/módulos rompe relaciones con su downline.</p>
      <button class="primary" id="eu-save">Guardar cambios</button>
    `);
    $('eu-save').addEventListener('click', async () => {
      try {
        await api(`/api/users/${u.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            full_name: $('eu-name').value.trim(),
            email: $('eu-email').value.trim() || null,
            phone: $('eu-phone').value.trim() || null,
            role: $('eu-role').value,
            system_id: parseInt($('eu-system').value, 10) || null,
            module_id: parseInt($('eu-module').value, 10) || null,
            productive_leader_id: parseInt($('eu-pl').value, 10) || null,
          }),
        });
        closeModal(); loadUsers();
      } catch (e) { alert(e.message); }
    });
  }

  // ============ USERS ============
  async function loadCachedUsers() {
    const all = await api('/api/users');
    const users = all.users;
    cachedDistributors = users.filter((u) => u.role === 'distributor');
    cachedProductiveLeaders = users.filter((u) => u.role === 'productive_leader');
  }

  const ROLE_LABEL = {
    lider_supremo: 'Líder Supremo',
    system_leader: 'Líder de Sistema',
    module_leader: 'Líder de Módulo',
    productive_leader: 'Líder Productivo',
    distributor: 'Profesional',
  };
  function canEditRoleOf(target) {
    if (!me || target.id === me.id) return false;
    if (me.role === 'lider_supremo') return true;
    if (me.role === 'system_leader') {
      if (target.role === 'lider_supremo') return false;
      return target.system_id === me.system_id;
    }
    return false;
  }
  function assignableRoles() {
    if (me?.role === 'lider_supremo') {
      return ['lider_supremo','system_leader','module_leader','productive_leader','distributor'];
    }
    if (me?.role === 'system_leader') {
      return ['module_leader','productive_leader','distributor'];
    }
    return [];
  }
  function openRoleEditor(span) {
    const id = span.dataset.id;
    const current = span.dataset.role;
    const moduleId = span.dataset.moduleId || '';
    const userName = span.dataset.name || '';
    const opts = assignableRoles()
      .map((r) => `<option value="${r}"${r === current ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`)
      .join('');
    const sel = document.createElement('select');
    sel.className = 'role-inline-select';
    sel.innerHTML = opts;
    span.replaceWith(sel);
    sel.focus();
    let done = false;
    const finish = async (commit) => {
      if (done) return; done = true;
      if (commit && sel.value !== current) {
        const newRole = sel.value;
        // Profesional requiere un segundo paso: elegir líder de mesa.
        if (newRole === 'distributor') {
          await openLeaderPickerForDistributor(id, userName, moduleId);
          return;
        }
        try {
          await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role: newRole }) });
        } catch (err) { alert(err.message); }
      }
      loadUsers();
    };
    sel.addEventListener('change', () => finish(true));
    sel.addEventListener('blur', () => finish(false));
    sel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
  }

  // Segundo paso del cambio de rol a Profesional: pedir líder de mesa.
  // Si el target tiene módulo, se filtran PLs de ese módulo; si no, se listan
  // todos los visibles para el actor (scope ya aplicado por el backend).
  async function openLeaderPickerForDistributor(userId, userName, moduleId) {
    let pls;
    try {
      const params = { role: 'productive_leader' };
      if (moduleId) params.module_id = moduleId;
      pls = (await api('/api/users' + qs(params))).users;
    } catch (err) { alert(err.message); return loadUsers(); }

    if (!pls.length) {
      alert('No hay Líderes Productivos disponibles' + (moduleId ? ' en el módulo del usuario.' : '.'));
      return loadUsers();
    }

    const opts = pls.map((pl) => {
      const modTag = pl.module_number ? ' · M' + pl.module_number : '';
      return `<option value="${pl.id}" data-module="${pl.module_id || ''}">${pl.full_name}${modTag}</option>`;
    }).join('');

    openModal('Asignar líder de mesa', `
      <div class="field"><label>Profesional</label><div class="muted">${userName || '—'}</div></div>
      <div class="field"><label>¿Quién es su líder de mesa?</label><select id="rd-pl">${opts}</select></div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="primary" id="save-leader" style="flex:1;">Guardar</button>
        <button class="ghost-btn" id="cancel-leader" type="button">Cancelar</button>
      </div>
    `);

    $('save-leader').addEventListener('click', async () => {
      const plSel = $('rd-pl');
      const plId = parseInt(plSel.value, 10) || null;
      if (!plId) return alert('Selecciona un líder de mesa');
      const plModuleId = plSel.selectedOptions[0]?.dataset.module
        ? parseInt(plSel.selectedOptions[0].dataset.module, 10)
        : null;
      const body = { role: 'distributor', productive_leader_id: plId };
      // Sincroniza el módulo del usuario con el del PL elegido para mantener
      // la jerarquía consistente (un Profesional pertenece al módulo de su mesa).
      if (plModuleId) body.module_id = plModuleId;
      try {
        await api(`/api/users/${userId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        closeModal();
        loadUsers();
      } catch (err) { alert(err.message); }
    });
    $('cancel-leader').addEventListener('click', () => { closeModal(); loadUsers(); });
  }

  async function loadUsers() {
    if (!cachedModules.length) await loadModules();
    const role = $('users-role-filter').value;
    const data = await api('/api/users' + qs({ role, module_id: getFilters().module_id }));
    cachedDistributors = data.users.filter((u) => u.role === 'distributor');
    cachedProductiveLeaders = data.users.filter((u) => u.role === 'productive_leader');

    $('users-tbody').innerHTML = data.users.map((u) => {
      const blocked = u.blocked;
      const last = u.last_message_at ? hoursSince(u.last_message_at) : null;
      const lastTxt = u.role === 'distributor'
        ? (last == null ? 'Sin registros' : `hace ${formatHours(last)}`)
        : '—';
      const pendingTag = !u.profile_completed
        ? '<span class="tag gold" title="Aún no ha completado su perfil">⌛ Pendiente</span>'
        : (!u.active
            ? '<span class="tag" style="background:rgba(255,59,77,0.18);color:#FF6B7A;border-color:rgba(255,59,77,0.4);">⏸ Desactivado</span>'
            : (blocked ? '<span class="tag red">Bloqueado</span>'
                : '<span class="tag green">Activo</span>'));
      return `
        <tr>
          <td><strong>${u.full_name}</strong>${u.email ? `<div class="muted" style="font-size:12px;">${u.email}</div>` : ''}</td>
          <td>${canEditRoleOf(u)
            ? `<span class="tag gold role-edit" data-id="${u.id}" data-role="${u.role}" data-module-id="${u.module_id || ''}" data-system-id="${u.system_id || ''}" data-name="${u.full_name.replace(/"/g, '&quot;')}" title="Click para cambiar el rol" style="cursor:pointer;">${u.role_label} ▾</span>`
            : `<span class="tag gold">${u.role_label}</span>`}</td>
          <td>${u.bhip_rank ? `<span class="tag" style="background:rgba(46,139,139,0.18);color:var(--teal-400);border-color:rgba(70,176,168,0.3);">${u.bhip_rank}</span>` : '—'}</td>
          <td>${u.module_number ? `M${u.module_number}` : '—'}</td>
          <td>${u.productive_leader_name || '—'}</td>
          <td><span class="code-pill">${u.distributor_code}</span></td>
          <td><span class="${blocked ? 'tag red' : ''}">${lastTxt}</span></td>
          <td>${pendingTag}</td>
          <td>${me.role === 'lider_supremo' ? `<button class="ghost-btn" data-action="edit-user" data-id="${u.id}" style="margin-right:6px;">Editar</button>` : ''}${(me.role === 'lider_supremo' || me.role === 'system_leader' || me.role === 'module_leader')
            ? `<button class="ghost-btn" data-action="edit-rank" data-id="${u.id}" data-rank="${u.bhip_rank || ''}">Rango</button>
               <button class="ghost-btn" data-action="reset-pwd" data-id="${u.id}" data-name="${u.full_name.replace(/"/g, '&quot;')}" data-email="${u.email || ''}" style="margin-left:6px;">Reset pwd</button>
               ${(me.role === 'lider_supremo' || me.role === 'system_leader') && u.id !== me.id && u.role !== 'lider_supremo' ? `<button class="ghost-btn" data-action="toggle-active" data-id="${u.id}" data-active="${u.active ? 1 : 0}" data-name="${u.full_name.replace(/"/g, '&quot;')}" style="margin-left:6px;${u.active ? 'color:#FFB347;border-color:rgba(255,179,71,0.35);' : 'color:var(--teal-400);border-color:rgba(70,176,168,0.35);'}">${u.active ? 'Desactivar' : 'Activar'}</button>` : ''}
               ${(me.role === 'lider_supremo' || me.role === 'system_leader') && u.id !== me.id ? `<button class="ghost-btn" data-action="delete-user" data-id="${u.id}" data-name="${u.full_name.replace(/"/g, '&quot;')}" style="margin-left:6px;color:#FF8B95;border-color:rgba(220,90,100,0.3);">Eliminar</button>` : ''}`
            : ''}</td>
        </tr>
      `;
    }).join('');
    $('users-tbody').querySelectorAll('.role-edit').forEach((s) => {
      s.addEventListener('click', () => openRoleEditor(s));
    });
    $('users-tbody').querySelectorAll('[data-action=edit-user]').forEach((b) => {
      b.addEventListener('click', async () => {
        const r = await api(`/api/users/${b.dataset.id}`);
        openEditUserModal(r.user);
      });
    });
    $('users-tbody').querySelectorAll('[data-action=edit-rank]').forEach((b) => {
      b.addEventListener('click', () => openRankModal(b.dataset.id, b.dataset.rank));
    });
    $('users-tbody').querySelectorAll('[data-action=reset-pwd]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!b.dataset.email) return alert('Este usuario no tiene correo registrado.');
        if (!confirm(`Restablecer la contraseña de ${b.dataset.name}? Se enviará una contraseña temporal a ${b.dataset.email} y se le obligará a cambiarla en su próximo login.`)) return;
        try {
          const r = await api(`/api/users/${b.dataset.id}/reset-password`, { method: 'POST' });
          if (r.email_sent) alert(`✓ Correo enviado a ${b.dataset.email}`);
          else alert(`⚠ SMTP no configurado. Contraseña temporal: ${r.temporary_password}`);
        } catch (err) { alert(err.message); }
      });
    });
    $('users-tbody').querySelectorAll('[data-action=delete-user]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar PERMANENTEMENTE a ${b.dataset.name}? Esta acción no se puede deshacer.`)) return;
        try {
          await api(`/api/users/${b.dataset.id}`, { method: 'DELETE' });
          loadUsers();
        } catch (err) { alert(err.message); }
      });
    });
    $('users-tbody').querySelectorAll('[data-action=toggle-active]').forEach((b) => {
      b.addEventListener('click', async () => {
        const isActive = b.dataset.active === '1';
        const msg = isActive
          ? `¿Desactivar temporalmente a ${b.dataset.name}? Podrá ver el dashboard pero no interactuar con él hasta que lo reactives.`
          : `¿Reactivar a ${b.dataset.name}?`;
        if (!confirm(msg)) return;
        try {
          await api(`/api/users/${b.dataset.id}/toggle-active`, { method: 'PATCH' });
          loadUsers();
        } catch (err) { alert(err.message); }
      });
    });
    $('users-tbody').querySelectorAll('[data-action=regen-code]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('¿Regenerar el código? El código actual dejará de funcionar.')) return;
        const r = await api(`/api/users/${b.dataset.id}/regenerate-code`, { method: 'POST' });
        alert(`Nuevo código: ${r.distributor_code}`);
        loadUsers();
      });
    });
  }

  $('users-role-filter').addEventListener('change', loadUsers);

  $('new-user').addEventListener('click', async () => {
    if (!cachedModules.length) await loadModules();
    if (!cachedProductiveLeaders.length) await loadCachedUsers();

    const allowedRoles = ({
      lider_supremo: ['lider_supremo', 'system_leader', 'module_leader', 'productive_leader', 'distributor'],
      system_leader: ['module_leader', 'productive_leader', 'distributor'],
      module_leader: ['productive_leader', 'distributor'],
    })[me.role] || [];
    if (!allowedRoles.length) return alert('No tienes permiso para crear usuarios.');

    const ROLE_LABELS_MAP = { lider_supremo:'Líder Supremo', system_leader:'Líder de Sistema', module_leader:'Líder de Módulo', productive_leader:'Líder Productivo', distributor:'Profesional Activo' };
    const roleOpts = allowedRoles.map((r) => `<option value="${r}">${ROLE_LABELS_MAP[r]}</option>`).join('');
    const rankOpts = BHIP_RANKS.map((r) => `<option value="${r}" ${r==='Profesional'?'selected':''}>${r}</option>`).join('');
    const moduleOpts = cachedModules.map((m) => `<option value="${m.id}">M${m.number} — ${m.name}</option>`).join('');

    openModal('Nuevo usuario', `
      <div class="field"><label>ID de Distribuidor BHIP</label><input id="nu-code" type="text" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:2px;" placeholder="Ej. 1340" required /></div>
      <div class="field"><label>Correo electrónico</label><input id="nu-email" type="email" placeholder="correo@dominio.com" required /></div>
      <div class="field"><label>Rol</label><select id="nu-role">${roleOpts}</select></div>
      <div class="field"><label>Rango BHIP</label><select id="nu-rank">${rankOpts}</select></div>
      <div class="field" id="nu-system-name-wrap" style="display:none;">
        <label>Nombre del sistema (oficina)</label>
        <input id="nu-system-name" type="text" placeholder="Ej. SocialHub Medellín" />
        <div class="hint">Si el sistema ya existe, se reutiliza. Si no, se crea uno nuevo.</div>
      </div>
      <div class="field" id="nu-module-wrap"><label>Módulo</label><select id="nu-module">${moduleOpts}</select></div>
      <div class="field" id="nu-pl-wrap" style="display:none;"><label>Mesa (Líder Productivo)</label><select id="nu-pl"></select></div>
      <p class="hint" style="margin: 0 0 14px;">El sistema generará una contraseña temporal y enviará al usuario un correo con sus credenciales. En su primer ingreso deberá completar nombre, celular y elegir su contraseña personal.</p>
      <button class="primary" id="save-user">Crear y enviar invitación</button>
    `);

    function refreshFields() {
      const role = $('nu-role').value;
      const modId = $('nu-module').value;
      $('nu-pl-wrap').style.display = role === 'distributor' ? '' : 'none';
      const pls = cachedProductiveLeaders.filter((p) => !modId || p.module_id == modId);
      $('nu-pl').innerHTML = pls.length ? pls.map((p) => `<option value="${p.id}">${p.full_name}</option>`).join('') : '<option value="">— sin líder productivo —</option>';
      $('nu-module-wrap').style.display = (role === 'system_leader' || role === 'lider_supremo') ? 'none' : '';
      // Campo "nombre del sistema" solo si actor es lider_supremo creando un SL
      const ssWrap = $('nu-system-name-wrap');
      if (ssWrap) ssWrap.style.display = (me.role === 'lider_supremo' && role === 'system_leader') ? '' : 'none';
    }
    refreshFields();
    $('nu-role').addEventListener('change', refreshFields);
    $('nu-module').addEventListener('change', refreshFields);

    $('save-user').addEventListener('click', async () => {
      try {
        const role = $('nu-role').value;
        const body = {
          distributor_code: $('nu-code').value.trim(),
          email: $('nu-email').value.trim(),
          role,
          bhip_rank: $('nu-rank').value,
          module_id: (role === 'system_leader' || role === 'lider_supremo') ? null : ($('nu-module').value || null),
          productive_leader_id: role === 'distributor' ? ($('nu-pl').value || null) : null,
        };
        // system_name solo cuando lider_supremo crea un SL
        if (me.role === 'lider_supremo' && role === 'system_leader') {
          const sn = ($('nu-system-name') || {}).value || '';
          if (sn.trim()) body.system_name = sn.trim();
        }
        const r = await api('/api/users', { method: 'POST', body: JSON.stringify(body) });
        closeModal();
        const warn = (r.warnings || []).length ? `\n\n⚠ ${r.warnings.join('\n')}` : '';
        if (r.email_sent) {
          alert(`✓ Usuario creado.\n\nID: ${r.user.distributor_code}\nRol: ${r.user.role_label}\nRango: ${r.user.bhip_rank}\n\nSe envió correo de bienvenida con la contraseña temporal a ${r.user.email}.${warn}`);
        } else {
          alert(`✓ Usuario creado.\n\nID: ${r.user.distributor_code}\nRol: ${r.user.role_label}\nRango: ${r.user.bhip_rank}\n\n⚠ SMTP no configurado — entrega manualmente:\nContraseña temporal: ${r.initial_password}${warn}`);
        }
        loadUsers();
      } catch (err) { alert(err.message); }
    });
  });

  function openRankModal(userId, currentRank) {
    const opts = BHIP_RANKS.map((r) => `<option value="${r}" ${r === currentRank ? 'selected' : ''}>${r}</option>`).join('');
    openModal('Cambiar rango BHIP', `
      <div class="field"><label>Rango actual</label><div class="muted">${currentRank || '—'}</div></div>
      <div class="field"><label>Nuevo rango</label><select id="rk-new">${opts}</select></div>
      <button class="primary" id="save-rank">Guardar</button>
    `);
    $('save-rank').addEventListener('click', async () => {
      try {
        await api(`/api/users/${userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ bhip_rank: $('rk-new').value }),
        });
        closeModal(); loadUsers();
      } catch (err) { alert(err.message); }
    });
  }

  function hoursSince(s) { return (Date.now() - new Date(String(s).replace(' ', 'T') + 'Z').getTime()) / 36e5; }
  function formatHours(h) {
    if (h < 1) return `${Math.round(h * 60)} min`;
    if (h < 24) return `${Math.round(h)} h`;
    return `${Math.round(h / 24)} d`;
  }

  // ============ GUESTS ============
  // Inyecta botón "Exportar CSV" en el panel de invitados (una sola vez).
  function ensureGuestsExportButton() {
    if (document.getElementById('guests-export-btn')) return;
    const search = document.getElementById('guest-search');
    if (!search) return;
    const btn = document.createElement('button');
    btn.id = 'guests-export-btn';
    btn.className = 'primary sm';
    btn.type = 'button';
    btn.textContent = '⬇ Exportar CSV';
    btn.style.marginLeft = '10px';
    btn.addEventListener('click', exportGuestsCsv);
    search.parentNode.insertBefore(btn, search.nextSibling);
  }

  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n;]/.test(s) ? `"${s}"` : s;
  }

  function exportGuestsCsv() {
    const guests = window._shGuestsSnapshot || [];
    if (!guests.length) { alert('Sin invitados que exportar.'); return; }
    const headers = ['Invitado','Correo','Teléfono','Distribuidor','Código distribuidor','Módulo','Etapa','Color','B.I.T','Power Talk','Firmado mes','Registrado','Último escaneo'];
    const rows = guests.map((g) => [
      g.full_name, g.email, g.phone, g.distributor_name, g.distributor_code,
      g.module_number ? `M${g.module_number}` : '',
      stageLabels[g.current_stage] || g.current_stage,
      g.color || '',
      g.bit_date || '',
      g.power_talk_date || '',
      g.signed_month || '',
      (g.created_at || '').slice(0, 10),
      fmtLocal(g.last_scan_at),
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
    // BOM para que Excel reconozca UTF-8.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `invitados-${ts}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function weekRangeISO() {
    const now = new Date();
    const dow = (now.getUTCDay() + 6) % 7; // L=0
    const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
    return { from: mon.toISOString().slice(0,10), to: sun.toISOString().slice(0,10) };
  }

  let _guestsFiltersPrepared = false;
  async function prepareGuestsFilters() {
    if (_guestsFiltersPrepared) return;
    const sysSel = $('guests-system-filter');
    const modSel = $('guests-module-filter');
    if (me.role === 'lider_supremo') {
      if (sysSel) {
        try {
          const r = await api('/api/systems');
          sysSel.innerHTML = '<option value="">Todos los sistemas</option>' +
            (r.systems || []).map((s) => `<option value="${s.id}">${s.nombre}</option>`).join('');
          sysSel.style.display = '';
        } catch (e) { /* silent */ }
      }
    }
    if (me.role === 'lider_supremo' || me.role === 'system_leader') {
      if (modSel) {
        try {
          const r = await api('/api/modules');
          modSel.innerHTML = '<option value="">Todos los módulos</option>' +
            (r.modules || []).map((m) => `<option value="${m.id}">M${m.number} — ${m.name}${m.system_name ? ' · ' + m.system_name : ''}</option>`).join('');
          modSel.style.display = '';
        } catch (e) { /* silent */ }
      }
    }
    _guestsFiltersPrepared = true;
  }

  async function loadGuests(query = '') {
    await prepareGuestsFilters();
    const f = getFilters();
    const colorFilter = $('guests-color-filter') ? $('guests-color-filter').value : '';
    const stageFilter = $('guests-stage-filter') ? $('guests-stage-filter').value : '';
    const sysFilter   = $('guests-system-filter') ? $('guests-system-filter').value : '';
    const modFilter   = $('guests-module-filter') ? $('guests-module-filter').value : '';
    // Defaults de filtros fecha: semana actual si los inputs están vacíos.
    const sf = $('guests-scan-from'), st = $('guests-scan-to');
    if (sf && st && !sf.value && !st.value) {
      const w = weekRangeISO(); sf.value = w.from; st.value = w.to;
    }
    const scanFrom = sf ? sf.value : '';
    const scanTo   = st ? st.value : '';
    const boletoSub = $('guests-boleto-filter') ? $('guests-boleto-filter').value : '';
    // Filtro de módulo: el dropdown propio de la sección (si está) gana sobre el topbar.
    const effectiveModule = modFilter || f.module_id || undefined;
    const [data, wgList] = await Promise.all([
      api('/api/guests' + qs({ ...f, q: query, color: colorFilter || undefined, stage: stageFilter || undefined, scan_from: scanFrom || undefined, scan_to: scanTo || undefined, system_id: sysFilter || undefined, module_id: effectiveModule, boleto_sub: boletoSub || undefined })),
      api('/api/wg/guests'),
    ]);
    const wgByGuest = {};
    wgList.guests.forEach((wg) => { wgByGuest[wg.id] = wg.wg; });

    // Guardamos snapshot para exportar CSV con los datos visibles.
    window._shGuestsSnapshot = data.guests;
    ensureGuestsExportButton();

    $('guests-tbody').innerHTML = data.guests.length ? data.guests.map((g) => {
      const isSigned = g.current_stage === 'FIRMADO';
      const editable = !isSigned && canEditStage();
      const stageInner = isSigned
        ? `<span class="tag green">✦ ${stageLabels[g.current_stage] || g.current_stage}</span>`
        : `<span class="tag gold" ${editable ? 'style="cursor:pointer;text-decoration:underline dotted;" title="Click para cambiar etapa"' : ''}>${stageLabels[g.current_stage] || g.current_stage}</span>`;
      const stageTag = editable
        ? `<span data-action="edit-stage" data-id="${g.id}" data-name="${g.full_name.replace(/"/g, '&quot;')}" data-stage="${g.current_stage}">${stageInner}</span>`
        : stageInner;
      const wgInfo = wgByGuest[g.id] || { status: 'none' };
      const wgBadge = WG_BADGE[wgInfo.status] || WG_BADGE.none;
      const wgCell = (!wgInfo.status || wgInfo.status === 'none')
        ? `<span class="muted" style="font-size:11px;">—</span>`
        : `<span class="tag ${wgBadge.tag}" title="${wgInfo.total_weeks || 0} sem · máx consec: ${wgInfo.max_consecutive_weeks || 0}">${wgBadge.icon} ${wgBadge.label}</span>`;

      let actions = '';
      if (isSigned) {
        actions = `<span class="muted" style="font-size:11px;">Ya firmado</span>`;
      } else {
        actions = `<button class="ghost-btn" data-action="mark-signed" data-id="${g.id}" data-name="${g.full_name.replace(/"/g, '&quot;')}">Firmar</button>`;
      }
      if (canEditColor()) {
        actions += ` <button class="ghost-btn" data-action="edit-color" data-id="${g.id}" data-name="${g.full_name.replace(/"/g, '&quot;')}" data-color="${g.color || 'none'}" style="margin-left:6px;">Color</button>`;
      }

      const lastScan = fmtLocal(g.last_scan_at);
      // Celda Boleto: sub-estado + monto si Abonado.
      const BOLETO_CLS = { BOLETO_PAGO:'green', BOLETO_ABONADO:'gold', BOLETO_NO_PAGO:'red', BOLETO_NO_INTERESADO:'gray' };
      const BOLETO_TXT = { BOLETO_PAGO:'Pago', BOLETO_ABONADO:'Abonado', BOLETO_NO_PAGO:'No Pago', BOLETO_NO_INTERESADO:'No Interesado' };
      const boletoCell = g.boleto_sub_stage
        ? `<span class="tag ${BOLETO_CLS[g.boleto_sub_stage] || 'gray'}" style="font-size:10px;">${BOLETO_TXT[g.boleto_sub_stage] || '—'}</span>${g.boleto_sub_stage === 'BOLETO_ABONADO' && g.boleto_amount != null ? ` <strong style="font-size:11px;color:var(--gold-400);">$${g.boleto_amount}</strong>` : ''}`
        : `<span class="muted" style="font-size:11px;">—</span>`;
      return `
        <tr data-action="show-history" data-id="${g.id}" data-name="${g.full_name.replace(/"/g, '&quot;')}" style="cursor:pointer;">
          <td><strong>${g.full_name}</strong><div class="muted" style="font-size:12px;">${g.email || '—'}</div></td>
          <td><span class="muted" style="font-size:12px;">${g.phone || '—'}</span></td>
          <td>${g.distributor_name}</td>
          <td>${g.module_number ? `M${g.module_number}` : '—'}</td>
          <td onclick="if(event.target.closest('[data-action=edit-stage]'))event.stopPropagation();">${stageTag}</td>
          <td>${boletoCell}</td>
          <td>${colorChip(g.color, g.color_manual)}</td>
          <td class="muted" style="font-size:12px;">${(g.created_at || '').slice(0, 10)}</td>
          <td class="muted" style="font-size:12px;">${lastScan}</td>
          <td>${bitCell(g)}</td>
          <td>${wgCell}</td>
          <td onclick="event.stopPropagation();">${actions}</td>
        </tr>
      `;
    }).join('') : '<tr><td colspan="12" class="muted">Sin invitados en el rango seleccionado.</td></tr>';

    $('guests-tbody').querySelectorAll('[data-action=mark-signed]').forEach((b) => {
      b.addEventListener('click', () => openSignModal(b.dataset.id, b.dataset.name));
    });
    $('guests-tbody').querySelectorAll('[data-action=edit-color]').forEach((b) => {
      b.addEventListener('click', () => openColorModal(b.dataset.id, b.dataset.name, b.dataset.color));
    });
    $('guests-tbody').querySelectorAll('[data-action=show-history]').forEach((tr) => {
      tr.addEventListener('click', () => openGuestHistoryModal(tr.dataset.id, tr.dataset.name));
    });
    $('guests-tbody').querySelectorAll('[data-action=edit-stage]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openEditStageModal(el.dataset.id, el.dataset.name, el.dataset.stage);
      });
    });
  }

  // Modal de edición manual de etapa (lider_supremo / system_leader / module_leader).
  function openEditStageModal(guestId, guestName, currentStage) {
    const EDITABLE = ['REGISTRO','BOM','BOLETO_PAGO','BOLETO_ABONADO','BOLETO_NO_PAGO','BOLETO_NO_INTERESADO','BIT','POWER_TALK','PLAN_TRABAJO'];
    const opts = EDITABLE.map((s) => `<option value="${s}" ${s===currentStage?'selected':''}>${stageLabels[s] || s}</option>`).join('');
    openModal('Cambiar etapa', `
      <div class="field"><label>Invitado</label><input type="text" value="${guestName}" disabled /></div>
      <div class="field"><label>Nueva etapa</label><select id="es-stage">${opts}</select></div>
      <div class="field"><label>Notas (opcional)</label><input type="text" id="es-notes" placeholder="Motivo del cambio" /></div>
      <p class="hint" style="margin:0 0 18px;">Este cambio se registra en el historial como un escaneo manual con la fecha/hora actual.</p>
      <div style="display:flex;gap:10px;align-items:center;">
        <button class="primary" id="confirm-edit-stage">Guardar etapa</button>
        <button class="ghost-btn" id="confirm-delete-guest" style="color:#FF8B95;border-color:#FF8B95;">Eliminar invitado</button>
      </div>
    `);
    $('confirm-edit-stage').addEventListener('click', async () => {
      try {
        await api(`/api/guests/${guestId}/stage`, {
          method: 'PATCH',
          body: JSON.stringify({ to_stage: $('es-stage').value, notes: $('es-notes').value || null }),
        });
        closeModal();
        loadGuests($('guest-search').value);
      } catch (e) {
        alert('Error: ' + e.message);
      }
    });
    $('confirm-delete-guest').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar a "${guestName}"? Se borrará el invitado y todo su historial de escaneos. Esta acción no se puede deshacer.`)) return;
      try {
        await api(`/api/guests/${guestId}`, { method: 'DELETE' });
        closeModal();
        loadGuests($('guest-search').value);
      } catch (e) {
        alert('Error: ' + e.message);
      }
    });
  }

  // Modal con historial de escaneos del invitado.
  async function openGuestHistoryModal(guestId, guestName) {
    openModal(`Historial de ${guestName}`, '<div class="muted">Cargando...</div>');
    try {
      const r = await api(`/api/guests/${guestId}`);
      const rows = (r.history || []).map((h) => {
        const date = fmtLocal(h.scanned_at);
        const event = h.event_name || (h.notes || '—');
        const from = stageLabels[h.from_stage] || h.from_stage || '—';
        const to   = stageLabels[h.to_stage]   || h.to_stage   || '—';
        const arrow = h.from_stage && h.from_stage !== h.to_stage ? ` <span class="muted">${from} →</span> ` : ' ';
        return `<tr>
          <td class="muted" style="font-size:12px;">${date}</td>
          <td>${event}</td>
          <td>${arrow}<strong>${to}</strong></td>
        </tr>`;
      }).join('') || '<tr><td colspan="3" class="muted">Sin escaneos registrados.</td></tr>';
      $('modal-body').innerHTML = `<div class="modal-body">
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Fecha</th><th>Evento</th><th>Etapa</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
    } catch (e) {
      $('modal-body').innerHTML = `<div class="modal-body"><div class="error">${e.message}</div></div>`;
    }
  }

  function openSignModal(guestId, guestName) {
    openModal('Firmar Profesional', `
      <div class="field"><label>Invitado</label><input type="text" value="${guestName}" disabled /></div>
      <div class="field"><label>Contraseña inicial (opcional)</label><input type="text" id="sign-password" placeholder="Por defecto: Sh2026!" /></div>
      <div class="field"><label>Notas (opcional)</label><input type="text" id="sign-notes" placeholder="Ej. Inversión $1,825 USD confirmada" /></div>
      <p class="hint" style="margin: 0 0 18px;">Esto crea automáticamente el usuario del nuevo profesional, asignándolo a la mesa correcta según las reglas del sistema, y le genera un código de distribuidor.</p>
      <button class="primary" id="confirm-sign">Confirmar firma</button>
    `);
    $('confirm-sign').addEventListener('click', async () => {
      try {
        const r = await api(`/api/guests/${guestId}/sign`, {
          method: 'POST',
          body: JSON.stringify({
            notes: $('sign-notes').value || null,
            password: $('sign-password').value || null,
          }),
        });
        closeModal();
        alert(`✓ ${guestName} firmado.\n\nCódigo: ${r.distributor_code}\nContraseña: ${r.default_password}\nMesa: ${r.new_user.productive_leader_name || '—'}\n\n${r.assignment_rule}`);
        loadGuests($('guest-search').value);
        refreshAlertBadge();
      } catch (err) { alert(err.message); }
    });
  }

  function openColorModal(guestId, guestName, currentColor) {
    const opts = ['none', 'light_green', 'strong_green', 'yellow', 'orange', 'red', 'black']
      .map((c) => `<option value="${c}" ${c === currentColor ? 'selected' : ''}>${COLOR_LABELS[c]}</option>`).join('');
    openModal('Cambiar color del seguimiento', `
      <div class="field"><label>Invitado</label><input type="text" value="${guestName}" disabled /></div>
      <div class="field"><label>Color actual</label><div>${colorChip(currentColor, true)}</div></div>
      <div class="field"><label>Nuevo color</label><select id="cc-color">${opts}</select></div>
      <div class="field"><label>Motivo (opcional)</label><input type="text" id="cc-notes" placeholder="Ej. Recuperación tras conversación 1:1" /></div>
      <p class="hint" style="margin: 0 0 18px;">El override manual queda registrado con tu nombre y bloquea recálculos automáticos (excepto la transición a NEGRO por cierre de mes).</p>
      <button class="primary" id="confirm-color">Aplicar color</button>
    `);
    $('confirm-color').addEventListener('click', async () => {
      try {
        await api(`/api/guests/${guestId}/color`, {
          method: 'PATCH',
          body: JSON.stringify({ color: $('cc-color').value, notes: $('cc-notes').value || null }),
        });
        closeModal();
        loadGuests($('guest-search').value);
        refreshAlertBadge();
      } catch (err) { alert(err.message); }
    });
  }

  let searchTimer;
  $('guest-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadGuests(e.target.value), 250);
  });
  // Listeners de filtros de la vista Invitados (color + fechas)
  document.addEventListener('change', (e) => {
    if (!e.target) return;
    if (['guests-color-filter','guests-stage-filter','guests-boleto-filter','guests-scan-from','guests-scan-to','guests-system-filter','guests-module-filter'].includes(e.target.id)) {
      loadGuests($('guest-search').value);
    }
  });
  // Listeners filtros del embudo: modo (semana/mes/ciclo BIT) + fechas custom.
  document.addEventListener('change', (e) => {
    if (!e.target) return;
    if (e.target.id === 'funnel-mode' || e.target.id === 'funnel-from' || e.target.id === 'funnel-to') loadFunnel();
    if (e.target.id === 'funnel-bit-date') loadBitCycleMode();
  });

  document.addEventListener('click', async (e) => {
    if (!e.target) return;
    // Eliminar sistema desde Mi equipo
    if (e.target.dataset && e.target.dataset.action === 'delete-system') {
      const id = e.target.dataset.id;
      const name = e.target.dataset.name;
      const msg = `¿Eliminar el sistema "${name}"?\n\nLos usuarios, módulos y eventos asignados quedarán SIN sistema (system_id=NULL). Esta acción no se puede deshacer.`;
      if (!confirm(msg)) return;
      try {
        const r = await api(`/api/systems/${id}`, { method: 'DELETE' });
        alert(`✓ Eliminado "${r.deleted}".\nHuérfanos: ${r.orphaned.users} usuarios, ${r.orphaned.modules} módulos, ${r.orphaned.events} eventos.`);
        loadTeam();
      } catch (err) { alert(err.message); }
      return;
    }
    if (e.target.id === 'guests-scan-clear') {
      $('guests-scan-from').value = ''; $('guests-scan-to').value = '';
      loadGuests($('guest-search').value);
    }
  });

  // ============ MESSAGES (registro diario universal) ============
  const ROLE_SHORT = { lider_supremo: 'Líder Supremo', system_leader: 'Líder Sistema', module_leader: 'Líder Módulo', productive_leader: 'Líder Productivo', distributor: 'Profesional Activo' };

  async function loadMessages() {
    // Lista de usuarios visibles para el actor: respeta scope (SL todos, ML su módulo,
    // PL su mesa+sí mismo, distributor solo él). El backend ya aplica scopeUsersClause.
    const usersResp = await api('/api/users');
    const visibleUsers = usersResp.users.filter((u) => u.active);
    visibleUsers.sort((a, b) => {
      if (a.id === me.id) return -1;
      if (b.id === me.id) return 1;
      return a.full_name.localeCompare(b.full_name);
    });

    const sel = $('msg-user');
    sel.innerHTML = visibleUsers.length
      ? visibleUsers.map((u) => {
          const me_tag = u.id === me.id ? ' (yo)' : '';
          const mod = u.module_number ? ` · M${u.module_number}` : '';
          return `<option value="${u.id}">${u.full_name}${me_tag} — ${ROLE_SHORT[u.role] || u.role}${mod}</option>`;
        }).join('')
      : '<option value="">— sin usuarios visibles —</option>';

    // Por defecto: el usuario actual
    sel.value = String(me.id);

    // Fecha por defecto en hora Colombia (UTC-5), no UTC, para que después
    // de las 7pm Colombia no salte al día siguiente.
    $('msg-date').value = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
    await prefillMessageForm();

    const data = await api('/api/messages/totals' + qs(getFilters()));
    $('msg-totals').innerHTML = data.totals.length
      ? data.totals.map((r) => `
          <tr>
            <td>${r.full_name}${r.user_id === me.id ? ' <span class="muted" style="font-size:11px;">(yo)</span>' : ''}</td>
            <td><span class="muted" style="font-size:11px;">${ROLE_SHORT[r.role] || r.role}</span></td>
            <td>${r.module_number ? `M${r.module_number}` : '—'}</td>
            <td><strong>${r.total_messages}</strong></td>
            <td>${r.total_messages_leads || 0}</td>
            <td><strong style="color:var(--teal-400);">${r.total_books || 0}</strong></td>
            <td>${r.total_tiktok_minutes || 0}</td>
            <td>${r.total_tiktok_leads || 0}</td>
            <td><strong style="color:#FF6B95;">${r.total_tiktok_books || 0}</strong></td>
            <td>${r.days_logged}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="10" class="muted">Sin registros aún.</td></tr>';
  }

  // Resetea inputs y muestra los totales acumulados del usuario+fecha en el hint.
  // Cada submisión es un delta que el backend suma al acumulado del día.
  async function prefillMessageForm() {
    const uid = parseInt($('msg-user').value, 10);
    const date = $('msg-date').value;
    $('msg-count').value = '';
    $('msg-books').value = 0;
    if ($('msg-leads'))  $('msg-leads').value  = 0;
    if ($('tt-minutes')) $('tt-minutes').value = '';
    if ($('tt-leads'))   $('tt-leads').value   = 0;
    if ($('tt-books'))   $('tt-books').value   = 0;
    const msgHint = $('msg-existing');
    const ttHint  = $('tt-existing');
    if (msgHint) msgHint.textContent = '';
    if (ttHint)  ttHint.textContent  = '';
    if (!uid || !date) return;
    try {
      const r = await api(`/api/messages/user/${uid}`);
      const found = (r.messages || []).find((m) => m.date === date);
      if (!found) return;
      if (msgHint) {
        const m = found.messages || found.count || 0;
        const b = found.books || found.books_count || 0;
        const l = found.messages_leads || 0;
        msgHint.textContent = `Ya registrado ese día: ${m} msgs · ${l} leads · ${b} books. Lo que guardes ahora se suma.`;
      }
      if (ttHint) {
        const tm = found.tiktok_minutes || 0;
        const tl = found.tiktok_leads || 0;
        const tb = found.tiktok_books || 0;
        ttHint.textContent = `Ya registrado ese día: ${tm} min · ${tl} leads · ${tb} books. Lo que guardes ahora se suma.`;
      }
    } catch (e) { /* silent */ }
  }
  document.addEventListener('change', (e) => {
    if (e.target && (e.target.id === 'msg-user' || e.target.id === 'msg-date')) prefillMessageForm();
  });

  $('msg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          user_id: parseInt($('msg-user').value, 10),
          date: $('msg-date').value,
          messages: parseInt($('msg-count').value, 10) || 0,
          books: parseInt($('msg-books').value, 10) || 0,
          messages_leads: parseInt(($('msg-leads')||{}).value, 10) || 0,
        }),
      });
      await loadMessages();
    } catch (err) { alert(err.message); }
  });

  // Form TikTok Live — suma a los campos tiktok_*; mensajes/books quedan intactos.
  if ($('tiktok-form')) {
    $('tiktok-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/messages', {
          method: 'POST',
          body: JSON.stringify({
            user_id: parseInt($('msg-user').value, 10),
            date: $('msg-date').value,
            tiktok_minutes: parseInt($('tt-minutes').value, 10) || 0,
            tiktok_leads:   parseInt($('tt-leads').value, 10) || 0,
            tiktok_books:   parseInt(($('tt-books')||{}).value, 10) || 0,
          }),
        });
        await loadMessages();
      } catch (err) { alert(err.message); }
    });
  }

  // ============ EVENTS ============
  async function loadEvents() {
    const data = await api('/api/events');
    stageLabels = data.stage_labels || stageLabels;
    scannableStages = data.scannable_stages || [];
    $('events-tbody').innerHTML = data.events.map((ev) => {
      const recurrence = ev.recurrence_type === 'weekly' && ev.recurrence_days
        ? `<span class="tag gold">↻ ${ev.recurrence_days_label || ev.recurrence_days}</span>`
        : `<span class="tag gray">Una vez · ${ev.date}</span>`;
      return `
        <tr class="${ev.active ? '' : 'row-inactive'}">
          <td><strong>${ev.name}</strong></td>
          <td><span class="tag ${ev.active ? 'gold' : 'gray'}">${stageLabels[ev.stage_target] || ev.stage_target}</span></td>
          <td>${recurrence}</td>
          <td><span class="tag ${ev.active ? 'green' : 'gray'}">${ev.active ? 'Activo' : 'Inactivo'}</span></td>
          <td>
            <button class="ghost-btn" data-action="edit-event" data-id="${ev.id}">Editar</button>
            <button class="ghost-btn" style="margin-left:6px;" data-action="toggle-event" data-id="${ev.id}" data-active="${ev.active}">${ev.active ? 'Desactivar' : 'Reactivar'}</button>
            ${ev.active || me.role !== 'system_leader' ? '' : `<button class="ghost-btn" style="margin-left:6px;color:#FF8B95;border-color:rgba(220,90,100,0.3);" data-action="delete-event" data-id="${ev.id}" data-name="${ev.name.replace(/"/g, '&quot;')}">Eliminar</button>`}
          </td>
        </tr>
      `;
    }).join('');
    $('events-tbody').querySelectorAll('[data-action=toggle-event]').forEach((b) => {
      b.addEventListener('click', async () => {
        await api(`/api/events/${b.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ active: b.dataset.active !== '1' }) });
        loadEvents();
      });
    });
    $('events-tbody').querySelectorAll('[data-action=delete-event]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar permanentemente "${b.dataset.name}"?`)) return;
        await api(`/api/events/${b.dataset.id}`, { method: 'DELETE' });
        loadEvents();
      });
    });
    $('events-tbody').querySelectorAll('[data-action=edit-event]').forEach((b) => {
      b.addEventListener('click', () => openEventEditor(data.events.find((x) => x.id == b.dataset.id)));
    });
  }

  const DAYS_OPTIONS = [
    { val: 'monday', label: 'Lunes' },
    { val: 'tuesday', label: 'Martes' },
    { val: 'wednesday', label: 'Miércoles' },
    { val: 'thursday', label: 'Jueves' },
    { val: 'friday', label: 'Viernes' },
    { val: 'saturday', label: 'Sábado' },
    { val: 'sunday', label: 'Domingo' },
  ];

  function openEventEditor(ev) {
    const isEdit = !!ev;
    const stages = scannableStages.map((s) =>
      `<option value="${s}" ${ev && ev.stage_target === s ? 'selected' : ''}>${stageLabels[s]}</option>`
    ).join('');
    const recDays = ev && ev.recurrence_days ? ev.recurrence_days.split(',') : [];
    const dayCheckboxes = DAYS_OPTIONS.map((d) =>
      `<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ivory-soft);text-transform:none;letter-spacing:normal;margin:4px 0;">
        <input type="checkbox" name="rec-day" value="${d.val}" ${recDays.includes(d.val) ? 'checked' : ''} style="width:auto;margin:0;" /> ${d.label}
      </label>`).join('');

    openModal(isEdit ? 'Editar evento' : 'Nuevo evento', `
      <div class="field"><label>Nombre</label><input id="ne-name" value="${ev ? ev.name.replace(/"/g, '&quot;') : ''}" /></div>
      <div class="field"><label>Etapa objetivo</label><select id="ne-stage">${stages}</select></div>
      <div class="field"><label>Tipo</label>
        <select id="ne-type">
          <option value="weekly" ${!ev || ev.recurrence_type === 'weekly' ? 'selected' : ''}>Recurrente semanal</option>
          <option value="one_time" ${ev && ev.recurrence_type === 'one_time' ? 'selected' : ''}>Una vez</option>
        </select>
      </div>
      <div class="field" id="ne-rec-days-wrap"><label>Días de la semana</label>
        <div style="background:rgba(7,17,28,0.4);padding:10px 14px;border-radius:8px;border:1px solid var(--line);">${dayCheckboxes}</div>
      </div>
      <div class="field" id="ne-date-wrap"><label>Fecha (referencia)</label><input id="ne-date" type="date" value="${ev ? ev.date : ''}" /></div>
      <div class="field" id="ne-wgs-wrap" style="display:none;"><label>Sesión WG (1-9, opcional)</label>
        <input id="ne-wgs" type="number" min="1" max="9" placeholder="Ej. 1 para PT/WG1, 2 para WG2..." value="${ev && ev.wg_session ? ev.wg_session : ''}" />
        <div class="hint" style="margin-top:4px;">WG1 incluye automáticamente los escaneos de Plan de Trabajo del mismo día.</div>
      </div>
      <p class="hint" style="margin: 0 0 14px;">FIRMADO no aparece — es un cambio manual desde Invitados.</p>
      <button class="primary" id="save-event">${isEdit ? 'Guardar cambios' : 'Crear'}</button>
    `);

    function syncWgsField() {
      const stg = $('ne-stage').value;
      $('ne-wgs-wrap').style.display = (stg === 'WORKING_GROUP' || stg === 'PLAN_TRABAJO') ? '' : 'none';
    }
    syncWgsField();
    $('ne-stage').addEventListener('change', syncWgsField);

    if (!ev) $('ne-date').valueAsDate = new Date();

    function syncTypeFields() {
      const type = $('ne-type').value;
      $('ne-rec-days-wrap').style.display = type === 'weekly' ? '' : 'none';
    }
    syncTypeFields();
    $('ne-type').addEventListener('change', syncTypeFields);

    $('save-event').addEventListener('click', async () => {
      try {
        const days = Array.from(document.querySelectorAll('input[name=rec-day]:checked')).map((c) => c.value);
        const stg = $('ne-stage').value;
        const wgsRaw = $('ne-wgs') ? $('ne-wgs').value : '';
        const body = {
          name: $('ne-name').value,
          stage_target: stg,
          date: $('ne-date').value,
          recurrence_type: $('ne-type').value,
          recurrence_days: $('ne-type').value === 'weekly' ? (days.join(',') || null) : null,
          wg_session: (stg === 'WORKING_GROUP' || stg === 'PLAN_TRABAJO') && wgsRaw ? parseInt(wgsRaw, 10) : null,
        };
        if (isEdit) {
          await api(`/api/events/${ev.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        } else {
          await api('/api/events', { method: 'POST', body: JSON.stringify(body) });
        }
        closeModal(); loadEvents();
      } catch (err) { alert(err.message); }
    });
  }

  $('new-event').addEventListener('click', () => openEventEditor(null));

  // ============ ALERTS ============
  const ALERT_BUCKETS = ['no_messages_48h', 'near_two_weeks_bit', 'two_weeks_wg'];

  async function loadAlerts() {
    try {
      const data = await api('/api/alerts');
      ALERT_BUCKETS.forEach((b) => {
        const items = data.alerts.filter((a) => a.type === b);
        $(`ac-${b}`).textContent = items.length;
        $(`al-${b}`).innerHTML = items.length
          ? items.map(renderAlertItem).join('')
          : '<div class="alert-empty">Sin alertas en este bucket.</div>';
      });
      updateAlertBadge(data.total);
    } catch (err) { handleErr(err); }
  }

  function renderAlertItem(a) {
    const since = a.since
      ? `<span class="alert-since">desde ${String(a.since).slice(0, 16)}</span>`
      : '';
    return `<div class="alert-item">${a.message}${since}</div>`;
  }

  async function refreshAlertBadge() {
    try {
      const data = await api('/api/alerts');
      updateAlertBadge(data.total);
    } catch (e) { /* silent */ }
  }
  function updateAlertBadge(n) {
    const el = $('alerts-badge');
    if (!el) return;
    el.textContent = n;
    el.hidden = !n;
  }

  // ============ SCANNER (integrado al dashboard) ============
  let scCodeReader = null;
  let scActiveStream = null;
  let scLocked = false;
  const scRecent = []; // sesión actual
  let scPending = null; // guest previewed, esperando confirmación

  const DAY_KEYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

  async function loadScanner() {
    try {
      // Todos los eventos activos. Marcamos cuáles ocurren hoy.
      const data = await api('/api/events?active_only=true');
      const events = (data.events || []).filter((e) => e.stage_target !== 'FIRMADO');
      const sel = $('sc-event');
      if (!events.length) {
        sel.innerHTML = '<option value="">— sin eventos activos —</option>';
        $('sc-event-stage').textContent = '—';
        $('sc-event-date').textContent = '';
      } else {
        const todayKey = DAY_KEYS[new Date().getDay()];
        const isToday = (ev) => {
          if (ev.recurrence_type === 'weekly' && ev.recurrence_days) {
            return ev.recurrence_days.split(',').map((s) => s.trim().toLowerCase()).includes(todayKey);
          }
          return ev.date === new Date().toISOString().slice(0, 10);
        };
        // Ordena: primero los de hoy, después el resto
        events.sort((a, b) => Number(isToday(b)) - Number(isToday(a)));
        sel.innerHTML = events.map((ev) => {
          const today = isToday(ev);
          const recurLabel = ev.recurrence_days_label || (ev.recurrence_type === 'one_time' ? ev.date : '');
          const flag = today ? ' · 🟢 HOY' : '';
          return `<option value="${ev.id}" data-stage="${ev.stage_target}" data-recur="${recurLabel}" data-today="${today ? '1' : '0'}">${ev.name} — ${recurLabel}${flag}</option>`;
        }).join('');
        // Selecciona el primero de hoy si lo hay
        const firstToday = events.find(isToday);
        if (firstToday) sel.value = String(firstToday.id);
        updateScannerEventMeta();
      }
      await refreshScannerCount();
      renderRecent();
    } catch (err) { handleErr(err); }
  }

  function updateScannerEventMeta() {
    const sel = $('sc-event');
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.dataset.stage) return;
    $('sc-event-stage').textContent = stageLabels[opt.dataset.stage] || opt.dataset.stage;
    $('sc-event-date').textContent = opt.dataset.today === '1'
      ? `Hoy · ${opt.dataset.recur || ''}`
      : opt.dataset.recur || '';
  }

  async function refreshScannerCount() {
    try {
      const data = await api('/api/events/scan/today-count');
      $('sc-today-count').textContent = data.count;
    } catch (e) { /* silent */ }
  }

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
    if (!$('sc-event').value) {
      alert('Selecciona un evento primero.');
      return;
    }
    $('sc-start').hidden = true;
    $('sc-stop').hidden = false;
    $('sc-hint').textContent = 'Centra el QR del invitado';

    const video = $('sc-video');
    scCodeReader = new ZXingBrowser.BrowserMultiFormatReader();
    try {
      const devices = await ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
      const back = devices.find((d) => /back|trasera|rear|environment/i.test(d.label)) || devices[0];
      scActiveStream = await scCodeReader.decodeFromVideoDevice(back ? back.deviceId : null, video, async (result) => {
        if (result && !scLocked) {
          scLocked = true;
          await previewScan(result.getText());
          setTimeout(() => { scLocked = false; }, 1500);
        }
      });
    } catch (err) {
      console.error(err);
      $('sc-hint').textContent = 'No se pudo acceder a la cámara';
      $('sc-start').hidden = false;
      $('sc-stop').hidden = true;
    }
  }

  function stopScanning() {
    if (scCodeReader) { try { scCodeReader.reset(); } catch (e) {} }
    if (scActiveStream && scActiveStream.stop) scActiveStream.stop();
    scActiveStream = null;
    scCodeReader = null;
    const startBtn = $('sc-start'), stopBtn = $('sc-stop'), hint = $('sc-hint');
    if (startBtn) startBtn.hidden = false;
    if (stopBtn) stopBtn.hidden = true;
    if (hint) hint.textContent = 'Toca "Activar cámara"';
  }

  // PASO 1a: leer el token de un QR escaneado.
  async function previewScan(text) {
    const cleaned = String(text).trim().split('/').pop();
    try {
      const r = await api(`/api/guests/by-token/${encodeURIComponent(cleaned)}`);
      scPending = { token: cleaned, guest: r.guest, warning: r.warning, source: 'qr' };
      renderPreview();
      if (navigator.vibrate) try { navigator.vibrate(50); } catch(e){}
    } catch (err) {
      showScanError('QR inválido', err.message);
    }
  }

  // PASO 1b: fallback — buscar invitado por correo (cuando no trae el QR).
  async function previewByEmail(email) {
    const cleaned = String(email).trim().toLowerCase();
    if (!cleaned || !cleaned.includes('@')) {
      showScanError('Correo inválido', 'Ingresa un correo electrónico completo.');
      return;
    }
    try {
      const r = await api(`/api/guests/by-email/${encodeURIComponent(cleaned)}`);
      scPending = { token: r.guest.qr_token, guest: r.guest, warning: r.warning, source: 'email' };
      renderPreview();
    } catch (err) {
      showScanError('No encontrado', err.message);
    }
  }

  function showScanError(title, msg) {
    scPending = null;
    $('sc-preview').hidden = false;
    $('sc-preview').innerHTML = `<div class="scanner-preview error">
      <div class="scanner-preview-title">${title}</div>
      <div class="muted" style="font-size:13px;">${msg}</div>
    </div>`;
  }

  function renderPreview() {
    if (!scPending) { $('sc-preview').hidden = true; return; }
    const g = scPending.guest;
    const stageLabel = stageLabels[g.current_stage] || g.current_stage;
    $('sc-preview').hidden = false;
    const sourceTag = scPending.source === 'email'
      ? '<span class="tag gold" style="margin-left:8px;font-size:10px;">Buscado por correo</span>' : '';
    // BOLETO_ABONADO: muestra campo de monto inline en el preview.
    const selEv = $('sc-event');
    const optEv = selEv ? selEv.options[selEv.selectedIndex] : null;
    const evStage = optEv ? optEv.dataset.stage : '';
    const amountField = evStage === 'BOLETO_ABONADO' ? `
      <div class="field" style="margin:12px 0;">
        <label for="sc-amount" style="display:block;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--gold-400);margin-bottom:6px;">Monto abonado (COP)</label>
        <input type="number" inputmode="decimal" id="sc-amount" placeholder="Ej. 50000" step="1000" min="1" autocomplete="off" />
      </div>` : '';
    $('sc-preview').innerHTML = `
      <div class="scanner-preview">
        <div class="scanner-preview-title">${g.full_name}${sourceTag}</div>
        <div class="scanner-preview-meta">
          <span><strong>Etapa actual:</strong> ${stageLabel}</span>
          <span><strong>Color:</strong> ${colorChip(g.color, g.color_manual)}</span>
          <span><strong>Contactado por:</strong> ${g.distributor_name} (${g.distributor_code})</span>
          ${g.module_number ? `<span><strong>Módulo:</strong> M${g.module_number}</span>` : ''}
          ${g.bit_date ? `<span><strong>B.I.T:</strong> ${g.bit_date}</span>` : ''}
        </div>
        ${scPending.warning ? `<div class="hint" style="margin:12px 0;">⚠ ${scPending.warning}</div>` : ''}
        ${amountField}
        <div class="scanner-preview-actions">
          <button class="primary" id="sc-confirm">✓ Confirmar asistencia</button>
          <button class="ghost-btn" id="sc-cancel">Cancelar</button>
        </div>
      </div>
    `;
    if (evStage === 'BOLETO_ABONADO') setTimeout(() => { try { $('sc-amount').focus(); } catch(e){} }, 50);
    $('sc-confirm').addEventListener('click', confirmScan);
    $('sc-cancel').addEventListener('click', () => {
      scPending = null;
      $('sc-preview').hidden = true;
    });
  }

  // PASO 2: confirmar — POST /api/events/scan
  async function confirmScan() {
    if (!scPending) return;
    const eventId = $('sc-event').value;
    if (!eventId) { alert('Selecciona un evento primero.'); return; }
    const sel = $('sc-event');
    const opt = sel.options[sel.selectedIndex];
    const evStage = opt ? opt.dataset.stage : '';
    let amount = null;
    if (evStage === 'BOLETO_ABONADO') {
      const raw = ($('sc-amount') || {}).value;
      const parsed = parseFloat(String(raw || '').replace(/[^\d.]/g, ''));
      if (isNaN(parsed) || parsed <= 0) {
        alert('Ingresa el monto abonado antes de confirmar.');
        try { $('sc-amount').focus(); } catch(e){}
        return;
      }
      amount = parsed;
    }
    const btn = $('sc-confirm');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const result = await api('/api/events/scan', {
        method: 'POST',
        body: JSON.stringify({ event_id: parseInt(eventId, 10), qr_token: scPending.token, amount }),
      });
      scRecent.unshift({
        time: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        name: result.guest.full_name,
        event_name: result.event.name,
        advanced: result.advanced,
        wg: !!result.wg,
        from_stage: stageLabels[result.previous_stage] || result.previous_stage,
        to_stage: stageLabels[result.new_stage] || result.new_stage,
      });
      if (scRecent.length > 20) scRecent.length = 20;
      scPending = null;
      $('sc-preview').hidden = true;
      await refreshScannerCount();
      renderRecent();
      refreshAlertBadge();
      if (navigator.vibrate) try { navigator.vibrate(80); } catch(e){}
    } catch (err) {
      alert(err.message);
      btn.disabled = false; btn.textContent = '✓ Confirmar asistencia';
    }
  }

  function renderRecent() {
    const el = $('sc-recent');
    if (!el) return;
    if (!scRecent.length) {
      el.innerHTML = '<div class="muted" style="font-size:13px;padding:14px 0;">Aún no escaneas a nadie en esta sesión.</div>';
      return;
    }
    el.innerHTML = scRecent.map((r) => {
      const transition = r.advanced
        ? `<strong>${r.name}:</strong> ${r.from_stage} → <strong style="color:var(--gold-400);">${r.to_stage}</strong>`
        : r.wg
          ? `<strong>${r.name}</strong> · WG registrado`
          : `<strong>${r.name}</strong>`;
      return `
      <div class="scanner-recent-row">
        <span class="scanner-recent-time">${r.time}</span>
        <div>
          <div>${transition}</div>
          <div class="muted" style="font-size:11px;">${r.event_name}</div>
        </div>
      </div>
    `;
    }).join('');
  }

  // Listeners — usamos delegación porque los elementos existen al cargar
  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'sc-event') updateScannerEventMeta();
  });
  document.addEventListener('click', (e) => {
    if (!e.target) return;
    if (e.target.id === 'sc-start') startScanning();
    if (e.target.id === 'sc-stop')  stopScanning();
    if (e.target.id === 'sc-manual-toggle') $('sc-manual-pane').hidden = !$('sc-manual-pane').hidden;
    if (e.target.id === 'sc-manual-submit') {
      const v = $('sc-manual-input').value.trim();
      if (v) { previewByEmail(v); $('sc-manual-input').value = ''; }
    }
  });

  // ============ MODAL ============
  function openModal(title, html) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = `<div class="modal-body">${html}</div>`;
    $('modal').hidden = false;
  }
  function closeModal() { $('modal').hidden = true; }
  $('modal-close').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  function handleErr(err) {
    if (err.message.toLowerCase().includes('token') || err.message.toLowerCase().includes('autent')) return logout();
    console.error(err);
    alert(err.message);
  }

  // ============ BOOT ============
  async function boot() {
    try {
      const meResp = await api('/api/auth/me');
      me = meResp.user;

      // Si el perfil no está completo o se forzó cambio de pwd → onboarding
      if (!me.profile_completed || me.password_must_change) {
        showScreen('onboarding');
        return;
      }

      $('me-name').textContent = me.full_name;
      $('me-role').textContent = me.role_label;
      $('me-scope').textContent = me.module_number
        ? `Módulo ${me.module_number}${me.bhip_rank ? ' · ' + me.bhip_rank : ''}`
        : (me.role === 'system_leader' ? `Vista global${me.bhip_rank ? ' · ' + me.bhip_rank : ''}` : me.bhip_rank || '');
      $('user-code').textContent = me.distributor_code;

      // Desactivación temporal: el usuario puede ver el dashboard pero un
      // overlay rojo bloquea cualquier interacción.
      document.body.classList.toggle('inactive-user', !me.active);

      // Mostrar nav-items según rol
      $$('.nav-item[data-roles]').forEach((el) => {
        const allowed = el.dataset.roles.split(',');
        el.classList.toggle('visible', allowed.includes(me.role));
      });
      // Si el rol no es productive_leader/module_leader/system_leader, quitar la vista de team
      // pero distributor no llega aquí (no tiene login normalmente)

      const eventsData = await api('/api/events');
      stageLabels = eventsData.stage_labels;
      scannableStages = eventsData.scannable_stages;

      await loadModules();
      showScreen('app');
      loadOverview();
      refreshAlertBadge();
      refreshStreakBadge();
      // Auto-refresh del badge cada 60s
      if (window._shBadgeTimer) clearInterval(window._shBadgeTimer);
      window._shBadgeTimer = setInterval(refreshAlertBadge, 60 * 1000);
    } catch (err) { logout(); }
  }

  // Si el usuario llegó por un link de reset, mostrar pantalla aunque haya sesión
  if (location.hash && location.hash.startsWith('#reset=')) {
    showScreen('reset');
  } else if (token) {
    boot();
  } else {
    showScreen('login');
  }

})();
