/*
 * 前台公开内容：推荐应用、专题详情和公告
 */
const express = require('express');
const db = require('../database.cjs');
const { getAppGalleryTopic, getAppGalleryTopics } = require('../lib/appgallery-topics.cjs');

const router = express.Router();

router.get('/api/public/apps', (req, res) => {
  db.all(`SELECT * FROM apps WHERE enabled=1 ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ items: rows });
  });
});

// 华为应用市场「探索」页当前展示的专题
router.get('/api/public/topics', async (req, res) => {
  try {
    res.json({ items: await getAppGalleryTopics() });
  } catch (error) {
    console.warn('[appgallery-topics] 专题列表查询失败：', error.message);
    res.status(502).json({ error: '无法加载华为应用市场专题列表' });
  }
});

router.get('/api/public/topics/:id', async (req, res) => {
  try {
    const topic = await getAppGalleryTopic(req.params.id);
    if (!topic) return res.status(404).json({ error: '专题不存在或已下架' });
    res.json(topic);
  } catch (error) {
    console.warn('[appgallery-topics] 专题查询失败：', req.params.id, error.message);
    res.status(502).json({ error: '无法加载华为应用市场专题' });
  }
});

// Public announcements
router.get('/api/public/announcements', (req, res) => {
  const limit = Number(req.query.limit || 20); // Increased limit to ensure we get varied categories
  db.all(
    `SELECT a.id, a.title, a.content_html, a.published_at, a.updated_at, a.category_id, c.name as category_name 
     FROM announcements a 
     LEFT JOIN announcement_categories c ON a.category_id = c.id 
     WHERE a.status='published' 
     ORDER BY a.published_at DESC, a.updated_at DESC 
     LIMIT ?`,
    [limit],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ items: rows });
    }
  );
});

module.exports = router;
