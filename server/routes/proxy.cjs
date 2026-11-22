/*
 * 上游代理：/api/v0 透传（浏览查询会追加屏蔽应用条件）
 */
const express = require('express');
const { createProxy } = require('../lib/proxy.cjs');
const { loadBlockedAppPackages } = require('../lib/blocked-apps.cjs');
const { isBrowseAppQuery } = require('../lib/browse-query.cjs');

const router = express.Router();

// 脚本护栏已改为 app 级全站挂载（见 server/index.cjs），这里不再单独挂，避免同一请求重复计数。

/*
 * 浏览 / 筛选类查询：把屏蔽名单作为查询条件下推给上游。
 * 分页后再过滤会导致每页少几条、total_count 也对不上；下推后每页是满的。
 * 带关键词的搜索不走这里（见 isBrowseAppQuery），被屏蔽的应用仍能搜到。
 */
router.use('/api/v0', (req, res, next) => {
  if (req.method !== 'POST' || req.path !== '/apps/query' || !isBrowseAppQuery(req.body)) {
    return next();
  }

  loadBlockedAppPackages((blocked) => {
    if (!blocked.size) return next();

    // 上游没有 not_eq，用 not_i_like 表达不等于（不带通配符即等值匹配）
    const exclusions = [...blocked].map((pkg) => ({
      key: 'pkg_name',
      value: pkg,
      op: 'not_i_like',
    }));

    const original = req.body && typeof req.body === 'object' ? req.body : {};
    // 原条件整体包一层 and，再追加排除项（上游支持嵌套 and）
    const base = Object.keys(original).length ? [original] : [];
    req.body = { and: [...base, ...exclusions] };

    next();
  });
});

// /api/v0 -> https://shenjack.top:10003/api/v0
router.use('/api/v0', createProxy(process.env.VITE_API_TARGET || 'https://shenjack.top:10003'));



module.exports = router;
