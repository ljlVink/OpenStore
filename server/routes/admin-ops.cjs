/*
 * 后台运营接口：脚本护栏
 */
const express = require('express');
const { requireAuth, logAction } = require('../middleware/auth.cjs');
const { previewWarningPage, getPageConfig, savePageConfig, resetPageConfig, DEFAULT_PAGE_CONFIG, getAllowList, saveAllowList, listBlockRecords, clearBlockRecords, unblockIp, scriptGuardSnapshot, triggerBlock, hardBanIp, hardUnbanIp, listHardBans } = require('../lib/script-guard.cjs');
const { getClientIp } = require('../lib/client-ip.cjs');

module.exports = () => {
  const router = express.Router();

  // All state is read from PG; no isolate-local settings or ban caches.
  router.get('/api/admin/script-guard/preview', requireAuth, async (req, res) => {
    res.json({ html: await previewWarningPage() });
  });

  router.get('/api/admin/script-guard/page', requireAuth, async (req, res) => {
    res.json({ config: await getPageConfig(), defaults: DEFAULT_PAGE_CONFIG });
  });

  router.put('/api/admin/script-guard/page', requireAuth, async (req, res) => {
    if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'Invalid payload' });
    const config = await savePageConfig(req.body);
    await logAction(req.user?.username, 'update', 'script_guard_page', null, { title: config.title });
    res.json({ success: true, config });
  });

  router.post('/api/admin/script-guard/page/reset', requireAuth, async (req, res) => {
    const config = await resetPageConfig();
    await logAction(req.user?.username, 'update', 'script_guard_page', null, { reset: true });
    res.json({ success: true, config });
  });

  router.get('/api/admin/script-guard/allow', requireAuth, async (req, res) => {
    res.json({ list: await getAllowList() });
  });

  router.put('/api/admin/script-guard/allow', requireAuth, async (req, res) => {
    if (typeof req.body?.list !== 'string') return res.status(400).json({ error: 'Invalid payload' });
    const list = await saveAllowList(req.body.list);
    await logAction(req.user?.username, 'update', 'script_guard_allow', null, { list });
    res.json({ success: true, list });
  });

  router.get('/api/admin/script-guard/blocks', requireAuth, async (req, res) => {
    const [items, snapshot] = await Promise.all([listBlockRecords(req.query.limit), scriptGuardSnapshot()]);
    res.json({ items, active: snapshot.blocked, stats: snapshot.stats });
  });

  router.delete('/api/admin/script-guard/blocks', requireAuth, async (req, res) => {
    await clearBlockRecords();
    await logAction(req.user?.username, 'delete', 'script_guard_blocks', null, {});
    res.json({ success: true });
  });

  router.post('/api/admin/script-guard/unblock', requireAuth, async (req, res) => {
    const ip = String(req.body?.ip || '').trim();
    if (!ip) return res.status(400).json({ error: 'Missing ip' });
    const released = await unblockIp(ip);
    await logAction(req.user?.username, 'update', 'script_guard_unblock', null, { ip, released });
    res.json({ success: true, released });
  });

  router.post('/api/admin/script-guard/trigger', requireAuth, async (req, res) => {
    const result = await triggerBlock(getClientIp(req), { ua: req.body?.ua, path: req.body?.path });
    if (!result) return res.status(400).json({ error: '无法解析请求来源 IP' });
    await logAction(req.user?.username, 'update', 'script_guard_trigger', null, {
      ip: result.ip, strikes: result.strikes, blockMs: result.blockMs
    });
    res.json(result);
  });

  router.get('/api/admin/script-guard/bans', requireAuth, async (req, res) => {
    res.json({ items: await listHardBans() });
  });

  router.post('/api/admin/script-guard/bans', requireAuth, async (req, res) => {
    const ip = String(req.body?.ip || '').trim();
    if (!ip) return res.status(400).json({ error: 'Missing ip' });
    const durationMs = Math.max(Number(req.body?.durationMs) || 0, 0);
    try {
      await hardBanIp(ip, { reason: req.body?.reason, durationMs });
    } catch (err) {
      if (err.message === 'IP 格式不正确') return res.status(400).json({ error: err.message });
      throw err;
    }
    await logAction(req.user?.username, 'update', 'script_guard_ban', null, { ip, durationMs });
    res.json({ success: true, items: await listHardBans() });
  });

  router.post('/api/admin/script-guard/bans/remove', requireAuth, async (req, res) => {
    const ip = String(req.body?.ip || '').trim();
    if (!ip) return res.status(400).json({ error: 'Missing ip' });
    try {
      await hardUnbanIp(ip);
    } catch (err) {
      if (err.message === 'IP 格式不正确') return res.status(400).json({ error: err.message });
      throw err;
    }
    await logAction(req.user?.username, 'delete', 'script_guard_ban', null, { ip });
    res.json({ success: true, items: await listHardBans() });
  });

  return router;
};
