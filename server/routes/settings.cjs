/*
 * 站点与主题设置
 */
const express = require('express');
const db = require('../database.cjs');
const { requireAuth, logAction } = require('../middleware/auth.cjs');

const router = express.Router();

// Public: Get theme settings
router.get('/api/settings/theme', (req, res) => {
  db.all(`SELECT key, value FROM system_settings WHERE key LIKE 'theme_%'`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    rows.forEach(row => settings[row.key] = row.value);
    res.json(settings);
  });
});

// Admin: Get all settings
router.get('/api/admin/settings', requireAuth, (req, res) => {
  db.all(`SELECT * FROM system_settings`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    rows.forEach(row => settings[row.key] = row.value);
    res.json(settings);
  });
});

// Admin: Update settings (batch)
router.put('/api/admin/settings', requireAuth, (req, res) => {
  const settings = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  
  const keys = Object.keys(settings);
  if (keys.length === 0) return res.json({ updated: 0 });

  let errors = [];

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    keys.forEach(key => {
      db.run(
        `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) 
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`,
        [key, String(settings[key])],
        function(err) {
          if (err) errors.push(err.message);
        }
      );
    });
    db.run('COMMIT', (err) => {
      if (err) return res.status(500).json({ error: err.message });
      if (errors.length > 0) return res.status(500).json({ error: 'Partial update failed', details: errors });
      
      logAction(req.user?.username, 'update', 'system_settings', null, { keys });
      res.json({ updated: keys.length });
    });
  });
});

module.exports = router;
