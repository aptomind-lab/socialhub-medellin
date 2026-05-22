(function () {
  const API_BASE = window.SOCIALHUB_API || 'http://localhost:4000';

  const form = document.getElementById('register-form');
  const errorBox = document.getElementById('error');
  const submitBtn = document.getElementById('submit-btn');
  const successPanel = document.getElementById('success');
  const qrImg = document.getElementById('qr-img');
  const qrDownload = document.getElementById('qr-download');
  document.getElementById('year').textContent = new Date().getFullYear();

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
