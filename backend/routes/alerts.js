const express = require('express');
const { requireAuth } = require('../middleware/auth');
const alerts = require('../utils/alerts');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json(alerts.allAlerts(req.user));
});

// Individual buckets útiles si el frontend quiere paginar/filtrar
router.get('/messages',  requireAuth, (req, res) => res.json({ alerts: alerts.noMessagesIn48h(req.user) }));
router.get('/bit',       requireAuth, (req, res) => res.json({ alerts: alerts.nearTwoWeeksBit(req.user) }));
router.get('/wg',        requireAuth, (req, res) => res.json({ alerts: alerts.twoWeeksWg(req.user) }));

module.exports = router;
