/*
 * SEO 收录提交：后台接口（/api/admin/seo/*）。
 *
 * 鉴权逐路由挂载（每条路由的第二个参数 auth），不用 router.use。
 * 本路由经 app.use(router) 挂在根路径，router.use 会成为全局中间件拦截所有请求
 * （会把 /api/auth/login 一并拦掉导致无法登录）。
 * 也不能依赖 index.cjs 的 /api/admin 闸门：本路由挂在该闸门之前，闸门不会执行。
 *
 * 返回给前端的 key 一律脱敏（maskKey）；明文仅用于服务端出站请求。
 */
const express = require('express');
const crypto = require('crypto');
const { query } = require('../database.cjs');
const { requireAuth, logAction } = require('../middleware/auth.cjs');
const seo = require('../lib/seo-submit.cjs');

/**
 * @param {object} [deps]
 * @param {Function} [deps.onConfigChange] 站点 URL 变更后的回调（清 sitemap 缓存）
 */
module.exports = ({ onConfigChange } = {}) => {
  const router = express.Router();

  /** 逐路由挂载的鉴权中间件 */
  const auth = requireAuth;

  /** 配置转前端可见形态：剔除明文 key，补充 key 是否已配置 */
  const publicConfig = (config) => ({
    enabled: config.enabled,
    autoSubmit: config.autoSubmit,
    bingEnabled: config.bingEnabled,
    indexNowEnabled: config.indexNowEnabled,
    siteUrl: config.siteUrl,
    batchSize: config.batchSize,
    dailyLimit: config.dailyLimit,
    submitHour: config.submitHour,
    minHits: config.minHits,
    requestDelayMs: config.requestDelayMs,
    bingKeyMasked: config.bingKeyMasked,
    bingKeyConfigured: !!config.plainBingKey,
    indexNowKey: config.indexNowKey,
    indexNowKeyLocation: `${config.siteUrl}/indexnow-key.txt`
  });

  /** 队列概况：队列总量、待提交、今日已提交、近 7 天成功与失败数 */
  const queueStats = async (config) => {
    const [{ rows }, pending] = await Promise.all([
      query(
        `SELECT
           (SELECT COUNT(*)::int FROM seo_url_queue) AS total,
           (SELECT COUNT(DISTINCT url)::int FROM seo_submissions
             WHERE status = 'success' AND created_at >=
               (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')) AS today,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
           COUNT(*) FILTER (WHERE status = 'success')::int AS success
         FROM seo_submissions WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'`
      ),
      seo.countPending(config)
    ]);
    const row = rows[0] || {};
    return {
      pending,
      totalQueued: Number(row.total) || 0,
      submittedToday: Number(row.today) || 0,
      failedToday: Number(row.failed) || 0,
      successRecent: Number(row.success) || 0
    };
  };

  /* ---------------------------- 读取 ---------------------------- */

  /** 配置、统计与运行状态 */
  router.get('/api/admin/seo/status', auth, async (req, res) => {
    try {
      const config = await seo.loadConfig();
      const [stats, schedule, running] = await Promise.all([queueStats(config), seo.schedulerState(config), seo.isRunning()]);

      res.json({
        config: publicConfig(config),
        stats,
        runtime: {
          running,
          lastRunDay: schedule.lastRunDay,
          ranToday: schedule.ranToday,
          nextRunText: schedule.nextRunText,
          siteOrigin: config.siteUrl
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** 下一轮将提交的 URL 明细 */
  router.get('/api/admin/seo/pending', auth, async (req, res) => {
    try {
      const config = await seo.loadConfig();
      const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 2000);
      const rows = await seo.selectPending(config, limit);
      res.json({ items: rows, minHits: config.minHits, siteUrl: config.siteUrl });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** 提交记录，支持按状态、通道、URL 筛选与分页 */
  router.get('/api/admin/seo/submissions', auth, async (req, res) => {
    try {
      const limit = Math.min(Math.max(Math.floor(Number(req.query.limit)) || 100, 1), 500);
      const page = Math.max(Math.floor(Number(req.query.page)) || 1, 1);
      const clauses = [];
      const params = [];
      for (const key of ['status', 'channel', 'url']) {
        if (!req.query[key]) continue;
        params.push(key === 'url' ? `%${String(req.query[key])}%` : String(req.query[key]));
        clauses.push(`${key} ${key === 'url' ? 'ILIKE' : '='} $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const [{ rows: totals }, { rows }] = await Promise.all([
        query(`SELECT COUNT(*)::int AS total FROM seo_submissions ${where}`, params),
        query(
          `SELECT * FROM seo_submissions ${where} ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, (page - 1) * limit]
        )
      ]);
      res.json({ total: Number(totals[0]?.total) || 0, page, limit, items: rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** 队列中最近入队的路径 */
  router.get('/api/admin/seo/queue', auth, async (req, res) => {
    try {
      const limit = Math.min(Math.max(Math.floor(Number(req.query.limit)) || 100, 1), 500);
      const { rows } = await query('SELECT * FROM seo_url_queue ORDER BY last_seen DESC LIMIT $1', [limit]);
      res.json({ items: rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** 查询必应当日剩余额度；查询不可用时返回 available:false */
  router.get('/api/admin/seo/quota', auth, async (req, res) => {
    try {
      const config = await seo.loadConfig();
      const quota = await seo.fetchBingQuota(config, {});
      if (!quota) {
        return res.json({
          available: false,
          message: config.plainBingKey ? '查询失败（网络或鉴权问题）' : '未配置必应 API key'
        });
      }
      res.json({
        available: true,
        dailyQuota: quota.dailyQuota,
        monthlyQuota: quota.monthlyQuota,
        dailyLimit: seo.BING_DAILY_MAX,
        selfLimit: config.dailyLimit
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /* ---------------------------- 写入 ---------------------------- */

  /** 保存配置。bingApiKey 传空串表示清除，不传表示保持原值 */
  router.put('/api/admin/seo/config', auth, async (req, res) => {
    const body = req.body || {};
    const patch = {};

    for (const key of ['enabled', 'autoSubmit', 'bingEnabled', 'indexNowEnabled']) {
      if (body[key] !== undefined) patch[key] = body[key] ? 1 : 0;
    }
    for (const key of ['batchSize', 'dailyLimit', 'submitHour', 'minHits', 'requestDelayMs']) {
      if (body[key] !== undefined && body[key] !== '') patch[key] = Math.floor(Number(body[key]));
    }
    if (body.siteUrl !== undefined) {
      const raw = String(body.siteUrl || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(raw)) {
        return res.status(400).json({ error: '站点 URL 必须以 http:// 或 https:// 开头' });
      }
      patch.siteUrl = raw;
    }
    if (body.bingApiKey !== undefined) patch.bing_api_key = String(body.bingApiKey || '').trim();

    if (!Object.keys(patch).length) return res.status(400).json({ error: '没有需要更新的字段' });

    const result = await seo.saveSettings(patch);
    if (result.error) return res.status(500).json({ error: result.error });

    await logAction(req.user?.username, 'update', 'seo_config', null, {
      keys: Object.keys(patch).map((k) => (k === 'bing_api_key' ? 'bing_api_key(变更)' : k))
    });

    // 站点 URL 变更后同步清掉 sitemap 缓存
    if (patch.siteUrl && typeof onConfigChange === 'function') {
      try {
        await onConfigChange();
      } catch {
        /* 清缓存失败不影响配置保存 */
      }
    }

    const config = await seo.loadConfig();
    res.json({ updated: result.updated, config: publicConfig(config) });
  });

  /** 重新生成 IndexNow key（旧 key 文件随即失效） */
  router.post('/api/admin/seo/indexnow-key', auth, async (req, res) => {
    const next = crypto.randomBytes(16).toString('hex');
    const result = await seo.saveSettings({ indexnow_key: next });
    if (result.error) return res.status(500).json({ error: result.error });

    await logAction(req.user?.username, 'rotate', 'seo_indexnow_key', null, {});
    const config = await seo.loadConfig();
    res.json({ indexNowKey: config.indexNowKey, indexNowKeyLocation: `${config.siteUrl}/indexnow-key.txt` });
  });

  /** 手动执行一轮提交；limit 可临时指定 */
  router.post('/api/admin/seo/submit', auth, async (req, res) => {
    const limit = Number(req.body?.limit);
    const summary = await seo.runSubmission({
      source: 'manual',
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined
    });
    if (summary.busy) return res.status(409).json({ error: '已有一轮提交正在进行，请稍后再试' });
    await logAction(req.user?.username, 'submit', 'seo', null, {
      attempted: summary.attempted,
      succeeded: summary.succeeded,
      skipped: !!summary.skipped,
      reason: summary.reason || summary.error || ''
    });
    res.json(summary);
  });

  /** 清理队列中已提交且不在保留期内的条目 */
  router.post('/api/admin/seo/queue/cleanup', auth, async (req, res) => {
    try {
      const { rowCount } = await query(
        `DELETE FROM seo_url_queue
          WHERE submit_status = 'submitted'
            AND normalized_url NOT IN (
              SELECT url FROM seo_submissions
               WHERE status = 'success' AND created_at > CURRENT_TIMESTAMP - INTERVAL '4 days'
            )`
      );
      await logAction(req.user?.username, 'cleanup', 'seo_queue', null, { deleted: rowCount });
      res.json({ deleted: rowCount });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
