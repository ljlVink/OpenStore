/*
 * 前台公开内容：推荐应用、应用列表与搜索、应用详情、专题和公告
 */
const express = require('express');
const db = require('../database.cjs');
const { getAppGalleryTopic, getAppGalleryTopics } = require('../lib/appgallery-topics.cjs');
const { getAppGalleryApp } = require('../lib/appgallery-apps.cjs');
const { getAppGalleryDiscoverApps, searchAppGallery } = require('../lib/appgallery-lists.cjs');
const { loadBlockedAppPackages } = require('../lib/blocked-apps.cjs');

const router = express.Router();

router.get('/api/public/apps', (req, res) => {
  db.all(`SELECT * FROM apps WHERE enabled=1 ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ items: rows });
  });
});

// 应用列表：华为应用市场搜索页的「发现更多」；后台屏蔽的应用不出现在列表里
router.get('/api/public/apps/discover', async (req, res) => {
  try {
    const apps = await getAppGalleryDiscoverApps();
    loadBlockedAppPackages((blocked) => {
      res.json({ items: apps.filter((app) => !blocked.has(app.pkg_name.toLowerCase())) });
    });
  } catch (error) {
    console.warn('[appgallery-lists] 发现更多查询失败：', error.message);
    res.status(502).json({ error: '无法加载华为应用市场应用列表' });
  }
});

// 搜索：实时查华为应用市场，被屏蔽的应用仍能搜到
router.get('/api/public/apps/search', async (req, res) => {
  try {
    const items = await searchAppGallery(req.query.q);
    if (!items) return res.status(400).json({ error: '搜索关键词为空或过长' });
    res.json({ items });
  } catch (error) {
    console.warn('[appgallery-lists] 搜索失败：', req.query.q, error.message);
    res.status(502).json({ error: '无法搜索华为应用市场' });
  }
});

// 应用详情 + 最近 25 个版本，实时读华为应用市场；id 为 appId 或包名
router.get('/api/public/app-detail/:id', async (req, res) => {
  try {
    const app = await getAppGalleryApp(req.params.id);
    if (!app) return res.status(404).json({ error: '应用不存在或已下架' });
    res.json(app);
  } catch (error) {
    console.warn('[appgallery-apps] 应用查询失败：', req.params.id, error.message);
    res.status(502).json({ error: '无法加载华为应用市场应用信息' });
  }
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
