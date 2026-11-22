/*
 * 内容管理：公告分类与公告。
 */
const express = require('express');
const db = require('../database.cjs');
const { requireAuth, logAction } = require('../middleware/auth.cjs');
const { broadcast } = require('../lib/realtime.cjs');

const router = express.Router();

// Announcements & Categories
router.get('/api/announcement-categories', requireAuth, (req, res) => {
  db.all(`SELECT * FROM announcement_categories ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ items: rows });
  });
});
router.post('/api/announcement-categories', requireAuth, (req, res) => {
  const { name, parent_id } = req.body;
  db.run(`INSERT INTO announcement_categories (name, parent_id) VALUES (?,?)`, [name, parent_id || null], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});
router.put('/api/announcement-categories/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { name, parent_id } = req.body;
  db.run(`UPDATE announcement_categories SET name=?, parent_id=? WHERE id=?`, [name, parent_id || null, id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changed: this.changes });
  });
});
router.delete('/api/announcement-categories/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.run(`DELETE FROM announcement_categories WHERE id=?`, [id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

router.get('/api/announcements', requireAuth, (req, res) => {
  const { status, search, category_id: categoryId, page = 1, pageSize = 10 } = req.query;
  const p = Number(page), ps = Number(pageSize);
  const offset = (p - 1) * ps;
  // 支持按状态 / 标题关键词 / 分类过滤，条件都走参数绑定
  const conditions = [];
  const filterParams = [];
  if (status) {
    conditions.push('status=?');
    filterParams.push(status);
  }
  if (search) {
    conditions.push('title LIKE ?');
    filterParams.push(`%${String(search).trim()}%`);
  }
  if (categoryId !== undefined && categoryId !== null && String(categoryId) !== '') {
    conditions.push('category_id=?');
    filterParams.push(Number(categoryId));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const params = [...filterParams, ps, offset];
  db.all(`SELECT * FROM announcements ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    db.get(`SELECT COUNT(*) AS total FROM announcements ${where}`, filterParams, (e2, c) => {
      if (e2) return res.status(500).json({ error: e2.message });
      res.json({ items: rows, total: c.total, page: p, pageSize: ps });
    });
  });
});
router.post('/api/announcements', requireAuth, (req, res) => {
  const { title, content_html, content_markdown, status = 'draft', category_id, scheduled_at } = req.body;
  db.run(`INSERT INTO announcements (title, content_html, content_markdown, status, category_id, scheduled_at) VALUES (?,?,?,?,?,?)`, [title, content_html, content_markdown || null, status, category_id || null, scheduled_at || null], function(err){
    if (err) return res.status(500).json({ error: err.message });
    logAction(req.user?.username, 'create', 'announcements', this.lastID, { title });
    res.json({ id: this.lastID });
  });
});
router.put('/api/announcements/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { title, content_html, content_markdown, status, category_id, scheduled_at } = req.body;
  db.run(`UPDATE announcements SET title=?, content_html=?, content_markdown=?, status=?, category_id=?, scheduled_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [title, content_html, content_markdown || null, status, category_id || null, scheduled_at || null, id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    logAction(req.user?.username, 'update', 'announcements', id, { title });
    res.json({ changed: this.changes });
    db.all(`SELECT id, title, content_html, published_at, updated_at FROM announcements WHERE status='published' ORDER BY published_at DESC, updated_at DESC`, [], (e2, rows) => {
      if (!e2) broadcast('announcements:update', rows);
    });
  });
});
router.delete('/api/announcements/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.run(`DELETE FROM announcements WHERE id=?`, [id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    logAction(req.user?.username, 'delete', 'announcements', id);
    res.json({ deleted: this.changes });
    db.all(`SELECT id, title, content_html, published_at, updated_at FROM announcements WHERE status='published' ORDER BY published_at DESC, updated_at DESC`, [], (e2, rows) => {
      if (!e2) broadcast('announcements:update', rows);
    });
  });
});
router.post('/api/announcements/:id/publish', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.run(`UPDATE announcements SET status='published', published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    logAction(req.user?.username, 'publish', 'announcements', id);
    res.json({ changed: this.changes });
    db.all(`SELECT id, title, content_html, published_at, updated_at FROM announcements WHERE status='published' ORDER BY published_at DESC, updated_at DESC`, [], (e2, rows) => {
      if (!e2) broadcast('announcements:update', rows);
    });
  });
});
router.post('/api/announcements/:id/offline', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.run(`UPDATE announcements SET status='offline', updated_at=CURRENT_TIMESTAMP WHERE id=?`, [id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    logAction(req.user?.username, 'offline', 'announcements', id);
    res.json({ changed: this.changes });
    db.all(`SELECT id, title, content_html, published_at, updated_at FROM announcements WHERE status='published' ORDER BY published_at DESC, updated_at DESC`, [], (e2, rows) => {
      if (!e2) broadcast('announcements:update', rows);
    });
  });
});

module.exports = router;
