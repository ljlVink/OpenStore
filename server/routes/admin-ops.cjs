/*
 * 后台运营接口：脚本护栏
 */
const express = require('express');
const { requireAuth, logAction } = require('../middleware/auth.cjs');
const { previewWarningPage, getPageConfig, savePageConfig, resetPageConfig, DEFAULT_PAGE_CONFIG, getAllowList, saveAllowList, listBlockRecords, clearBlockRecords, unblockIp, scriptGuardSnapshot, triggerBlock, hardBanIp, hardUnbanIp, listHardBans } = require('../lib/script-guard.cjs');
const { getClientIp } = require('../lib/client-ip.cjs');

module.exports = () => {
  const router = express.Router();

  /*
   * 脚本护栏的警告页预览：后台「运维 → 脚本拦截」面板用。
   * 纯渲染，不调用护栏中间件 —— 不计数、不进封禁表、不影响任何 IP，点多少次都安全。
   * 返回 JSON 而不是直接吐 HTML，是为了复用后台已有的 JWT 头鉴权（新窗口打开带不上 Authorization）。
   */
  router.get('/api/admin/script-guard/preview', requireAuth, (req, res) => {
    res.json({ html: previewWarningPage() });
  });

  // 警告页自定义：读 / 存 / 恢复默认（存 system_settings，保存即生效，无需重启）
  router.get('/api/admin/script-guard/page', requireAuth, (req, res) => {
    res.json({ config: getPageConfig(), defaults: DEFAULT_PAGE_CONFIG });
  });

  router.put('/api/admin/script-guard/page', requireAuth, (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    savePageConfig(req.body, (err, config) => {
      if (err) return res.status(500).json({ error: err.message });
      logAction(req.user?.username, 'update', 'script_guard_page', null, { title: config.title });
      res.json({ success: true, config });
    });
  });

  router.post('/api/admin/script-guard/page/reset', requireAuth, (req, res) => {
    resetPageConfig((err, config) => {
      if (err) return res.status(500).json({ error: err.message });
      logAction(req.user?.username, 'update', 'script_guard_page', null, { reset: true });
      res.json({ success: true, config });
    });
  });

  /* 放行名单：命中前缀的客户端不计次、不封禁（硬封禁不受影响）；只存库，为空即不放行 */
  router.get('/api/admin/script-guard/allow', requireAuth, (req, res) => {
    res.json({ list: getAllowList() });
  });

  router.put('/api/admin/script-guard/allow', requireAuth, (req, res) => {
    if (!req.body || typeof req.body.list !== 'string') {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    saveAllowList(req.body.list, (err, list) => {
      if (err) return res.status(500).json({ error: err.message });
      logAction(req.user?.username, 'update', 'script_guard_allow', null, { list });
      res.json({ success: true, list });
    });
  });

  // 拦截记录：每次触发封禁落一条；active 是当前仍在封禁期内的 IP（内存态）
  router.get('/api/admin/script-guard/blocks', requireAuth, (req, res) => {
    listBlockRecords(req.query.limit, (err, items) => {
      if (err) return res.status(500).json({ error: err.message });
      const snapshot = scriptGuardSnapshot();
      res.json({ items, active: snapshot.blocked, stats: snapshot.stats });
    });
  });

  router.delete('/api/admin/script-guard/blocks', requireAuth, (req, res) => {
    clearBlockRecords((err) => {
      if (err) return res.status(500).json({ error: err.message });
      logAction(req.user?.username, 'delete', 'script_guard_blocks', null, {});
      res.json({ success: true });
    });
  });

  // 手动解封（误伤时用）：只清内存里的封禁状态，不动已写下的记录
  router.post('/api/admin/script-guard/unblock', requireAuth, (req, res) => {
    const ip = String(req.body?.ip || '').trim();
    if (!ip) return res.status(400).json({ error: 'Missing ip' });
    const released = unblockIp(ip);
    logAction(req.user?.username, 'update', 'script_guard_unblock', null, { ip, released });
    res.json({ success: true, released });
  });

  // 一键触发真实拦截：对当前管理员 IP 真封一次（写记录 + 进封禁表），重复触发按 4 倍升级
  router.post('/api/admin/script-guard/trigger', requireAuth, (req, res) => {
    const ip = getClientIp(req);
    const result = triggerBlock(ip, { ua: req.body?.ua, path: req.body?.path });
    if (!result) return res.status(400).json({ error: '无法解析请求来源 IP' });
    logAction(req.user?.username, 'update', 'script_guard_trigger', null, {
      ip: result.ip,
      strikes: result.strikes,
      blockMs: result.blockMs
    });
    res.json(result);
  });

  // 硬封禁名单：不区分 UA，命中后该 IP 的一切请求都返回 429（后台路径例外，可进来解封）
  router.get('/api/admin/script-guard/bans', requireAuth, (req, res) => {
    res.json({ items: listHardBans() });
  });

  router.post('/api/admin/script-guard/bans', requireAuth, (req, res) => {
    const ip = String(req.body?.ip || '').trim();
    if (!ip) return res.status(400).json({ error: 'Missing ip' });
    // durationMs 不传或 0 = 永久
    const durationMs = Math.max(Number(req.body?.durationMs) || 0, 0);
    hardBanIp(ip, { reason: req.body?.reason, durationMs }, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      logAction(req.user?.username, 'update', 'script_guard_ban', null, { ip, durationMs });
      res.json({ success: true, items: listHardBans() });
    });
  });

  router.post('/api/admin/script-guard/bans/remove', requireAuth, (req, res) => {
    const ip = String(req.body?.ip || '').trim();
    if (!ip) return res.status(400).json({ error: 'Missing ip' });
    hardUnbanIp(ip, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      logAction(req.user?.username, 'delete', 'script_guard_ban', null, { ip });
      res.json({ success: true, items: listHardBans() });
    });
  });

  return router;
};
