/*
 * 前台公开内容：应用卡片、应用列表与搜索、应用详情、专题
 */
const express = require('express');
const db = require('../database.cjs');
const { getAppGalleryTopic, getAppGalleryExplore } = require('../lib/appgallery-topics.cjs');
const { getAppGalleryApp } = require('../lib/appgallery-apps.cjs');
const { getAppGalleryDiscoverApps, searchAppGallery } = require('../lib/appgallery-lists.cjs');
const { getAppGalleryBrowse } = require('../lib/appgallery-browse.cjs');

const router = express.Router();
const BROWSE_TABS = ['featured', 'categories', 'rankings', 'updates'];

function isBrowseLabel(value, allowed) {
  return value === undefined || (
    allowed && typeof value === 'string' && value.length <= 80 && value.trim().length > 0
  );
}

router.get('/api/public/apps', (req, res) => {
  db.all(`SELECT id, name, provider, bg_url, icon_url, download_url, enabled, kind_name,
                 average_rating, original_id, created_at, updated_at
          FROM apps WHERE enabled=1 ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ items: rows });
  });
});

router.get('/api/public/apps/browse', async (req, res) => {
  const { catalog = 'apps', tab = 'featured', category, rank, page = '1' } = req.query;
  if ((catalog !== 'apps' && catalog !== 'games') ||
      !BROWSE_TABS.includes(tab) ||
      !isBrowseLabel(category, tab === 'categories') ||
      !isBrowseLabel(rank, tab === 'rankings') ||
      typeof page !== 'string' || !/^[1-5]$/.test(page) ||
      (page !== '1' && ((tab === 'categories' && !category) || (tab === 'rankings' && !rank)))) {
    return res.status(400).json({ error: '无效的栏目或页码' });
  }

  try {
    const content = await getAppGalleryBrowse({
      catalog,
      tab,
      category: category?.trim(),
      rank: rank?.trim(),
      page: Number(page)
    });
    if (!content) return res.status(404).json({ error: '华为应用市场未提供此分类或榜单' });
    res.json(content);
  } catch (error) {
    console.warn('[appgallery-browse] 栏目查询失败：', catalog, tab, error.message);
    res.status(502).json({ error: '无法加载华为应用市场栏目' });
  }
});

// 应用列表：华为应用市场搜索页的「发现更多」
router.get('/api/public/apps/discover', async (req, res) => {
  try {
    res.json({ items: await getAppGalleryDiscoverApps() });
  } catch (error) {
    console.warn('[appgallery-lists] 发现更多查询失败：', error.message);
    res.status(502).json({ error: '无法加载华为应用市场应用列表' });
  }
});

// 搜索：实时查华为应用市场
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

// 华为应用市场「探索」页：按栏目分组的专题卡片
router.get('/api/public/explore', async (req, res) => {
  try {
    res.json({ sections: await getAppGalleryExplore() });
  } catch (error) {
    console.warn('[appgallery-topics] 探索页查询失败：', error.message);
    res.status(502).json({ error: '无法加载华为应用市场探索页' });
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

module.exports = router;
