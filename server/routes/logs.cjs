/*
 * 操作日志
 */
const express = require('express');
const db = require('../database.cjs');
const { requireAuth, logAction } = require('../middleware/auth.cjs');

const router = express.Router();

router.get('/api/logs', requireAuth, (req, res) => {
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 20);
  const offset = (page - 1) * pageSize;
  const { search, action, actor } = req.query;

  // 支持按关键词 / 动作 / 操作人筛选，条件全部参数绑定
  const conditions = [];
  const filterParams = [];
  if (action) {
    conditions.push('action = ?');
    filterParams.push(String(action));
  }
  if (actor) {
    conditions.push('actor = ?');
    filterParams.push(String(actor));
  }
  if (search) {
    conditions.push('(actor LIKE ? OR action LIKE ? OR entity LIKE ? OR payload LIKE ?)');
    const like = `%${String(search).trim()}%`;
    filterParams.push(like, like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  db.all(
    `SELECT * FROM operation_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...filterParams, pageSize, offset],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      db.get(`SELECT COUNT(*) as total FROM operation_logs ${where}`, filterParams, (e2, c) => {
        if (e2) return res.status(500).json({ error: e2.message });
        // 下拉筛选用的动作/操作人清单，以及今天的操作条数
        db.all(`SELECT action, COUNT(*) AS count FROM operation_logs GROUP BY action ORDER BY count DESC LIMIT 30`, [], (e3, actions) => {
          if (e3) return res.status(500).json({ error: e3.message });
          db.all(`SELECT actor, COUNT(*) AS count FROM operation_logs GROUP BY actor ORDER BY count DESC LIMIT 30`, [], (e4, actors) => {
            if (e4) return res.status(500).json({ error: e4.message });
            db.get(
              `SELECT COUNT(*) AS count FROM operation_logs WHERE date(created_at, '+8 hours') = date('now', '+8 hours')`,
              [],
              (e5, today) => {
                if (e5) return res.status(500).json({ error: e5.message });
                res.json({
                  items: rows,
                  total: c.total,
                  page,
                  pageSize,
                  actions: actions || [],
                  actors: actors || [],
                  today_count: today?.count || 0
                });
              }
            );
          });
        });
      });
    }
  );
});

router.post('/api/logs/batch-delete', requireAuth, (req, res) => {
  const { ids, clearAll } = req.body;
  
  if (clearAll) {
    db.run(`DELETE FROM operation_logs`, [], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      logAction(req.user?.username, 'clear_logs', 'operation_logs', null);
      res.json({ deleted: this.changes });
    });
    return;
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No IDs provided' });
  }

  const placeholders = ids.map(() => '?').join(',');
  db.run(`DELETE FROM operation_logs WHERE id IN (${placeholders})`, ids, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    logAction(req.user?.username, 'delete_logs', 'operation_logs', null, { count: this.changes });
    res.json({ deleted: this.changes });
  });
});

module.exports = router;
