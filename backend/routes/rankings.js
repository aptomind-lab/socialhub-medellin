// Rankings LATAM cross-system. Visibles a todo usuario autenticado.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
function monthRange(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  const from = `${yyyymm}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${yyyymm}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

// Top 10 distribuidores por FIRMAS del mes (cross-system).
router.get('/latam-signs', requireAuth, (req, res) => {
  const ym = req.query.month || currentMonth();
  const { from, to } = monthRange(ym);
  const rows = db.prepare(`
    SELECT u.id, u.full_name, u.distributor_code,
           s.nombre AS system_name,
           COUNT(h.id) AS signs
    FROM stage_history h
    JOIN guests g ON g.id = h.guest_id
    JOIN users u ON u.id = g.distributor_id
    LEFT JOIN systems s ON s.id = u.system_id
    WHERE h.to_stage = 'FIRMADO' AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
    GROUP BY u.id
    ORDER BY signs DESC, u.full_name ASC
    LIMIT 10
  `).all(from, to);
  res.json({ month: ym, metric: 'signs', rows });
});

// Top 10 distribuidores por SHOWS B.I.T del mes (cross-system).
router.get('/latam-bit', requireAuth, (req, res) => {
  const ym = req.query.month || currentMonth();
  const { from, to } = monthRange(ym);
  const rows = db.prepare(`
    SELECT u.id, u.full_name, u.distributor_code,
           s.nombre AS system_name,
           COUNT(DISTINCT h.guest_id) AS bit_shows
    FROM stage_history h
    JOIN guests g ON g.id = h.guest_id
    JOIN users u ON u.id = g.distributor_id
    LEFT JOIN systems s ON s.id = u.system_id
    WHERE h.to_stage = 'BIT' AND date(h.scanned_at, '-5 hours') BETWEEN ? AND ?
    GROUP BY u.id
    ORDER BY bit_shows DESC, u.full_name ASC
    LIMIT 10
  `).all(from, to);
  res.json({ month: ym, metric: 'bit_shows', rows });
});

module.exports = router;
