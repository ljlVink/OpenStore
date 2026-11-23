const express = require('express');
const { requireAuth } = require('../middleware/auth.cjs');
const { getClientIp, getClientLocation } = require('../lib/client-ip.cjs');
const { incomingRequest } = require('../lib/runtime.cjs');

const router = express.Router();
router.get('/api/diagnostics/client-ip', requireAuth, (req, res) => {
  const request = incomingRequest();
  res.json({
    resolved: getClientIp(req),
    cdnConnectingIp: request?.headers.get('CF-Connecting-IP') || null,
    location: getClientLocation(),
    country: request?.cf?.country || null,
    city: request?.cf?.city || null,
    headers: { 'cf-connecting-ip': request?.headers.get('CF-Connecting-IP') || null }
  });
});

module.exports = router;
