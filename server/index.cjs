const express = require('express');
const cors = require('cors');
const { extname } = require('node:path');
const { defer, markAssetFallback } = require('./lib/runtime.cjs');

require('./lib/upstream-http.cjs').applyAxiosDefaults();
const { pushLiveLog } = require('./lib/live-log.cjs');

const {
  SITE_ORIGIN,
  SITE_LOGO_URL,
  SITE_NAME,
  SITE_DEFAULT_DESCRIPTION,
  PAGE_SHARE_META,
  CRAWLER_UA_RE,
  fetchTopicShareCard,
  fetchAppShareCard,
  readShareShell,
  applyShareCardToHtml,
  applyCanonicalToHtml
} = require('./lib/share-cards.cjs');
const { hardBanGuard, scriptGuard } = require('./lib/script-guard.cjs');
const { requireAuth } = require('./middleware/auth.cjs');
const seoSubmit = require('./lib/seo-submit.cjs');
const { getSitemap, invalidateSitemapCache } = require('./lib/sitemap.cjs');
const { canonicalPathFor } = require('./lib/canonical.cjs');
const { applyJsonLdToHtml, buildAppJsonLd } = require('./lib/json-ld.cjs');

const app = express();

app.use(cors());

// 硬封禁放在最前面（body 解析、静态资源与 SPA 兜底之前）；名单为空时零开销
app.use(hardBanGuard);

// 兼容字面量 null 请求体：
// axios 在 Content-Type: application/json 下会把 null 序列化成字符串 "null"，
// body-parser 的 strict 模式只接受对象/数组，会直接抛 SyntaxError 返回 400，
// 将合法 JSON 中的非对象值归一成 {}，避免各写接口解构 req.body 时报错。
app.use(express.json({ strict: false }));
app.use((req, res, next) => {
  // 保留非 JSON 请求体的原样处理。
  const isJsonBody = String(req.headers['content-type'] || '').includes('application/json');
  if (isJsonBody && (req.body === null || typeof req.body !== 'object')) {
    req.body = {};
  }
  next();
});

// 只记录 /api 请求，避免静态资源刷屏
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const startedAt = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - startedAt;
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    pushLiveLog(level, `${req.method} ${req.path} → ${status} · ${ms}ms`, {
      kind: 'request',
      method: req.method,
      path: req.path,
      status,
      ms
    });
  });
  next();
});

/*
 * 脚本护栏：全站生效（静态资源与页面路由也会被挡），后台管理路径在中间件内部豁免。
 * 放在这里是为了让被拦的 /api 请求仍先记一条请求日志（上面的日志中间件），
 * 并且排在静态资源与 SPA 兜底之前，/、/apps 这类页面脚本也会撞上警告页。
 */
app.use(scriptGuard);

/** IndexNow key 文件：内容为 key 本身，搜索引擎据此验证站点归属。 */
app.get('/indexnow-key.txt', async (req, res) => {
  try {
    const config = await seoSubmit.loadConfig();
    res.type('text/plain; charset=utf-8');
    res.send(String(config.indexNowKey || '').trim());
  } catch {
    res.status(500).type('text/plain; charset=utf-8').send('indexnow key unavailable');
  }
});

/** 生成失败时由 Worker 回退到构建期静态文件。 */
app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const config = await seoSubmit.loadConfig();
    const { xml, count } = await getSitemap(config.siteUrl);
    res.type('application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.send(xml);
    if (process.env.SITEMAP_LOG === '1') console.log(`[sitemap] 输出 ${count} 条 URL`);
  } catch (error) {
    pushLiveLog('warn', `[sitemap] 动态生成失败，回退静态文件：${error.message}`, { kind: 'seo' });
    next();
  }
});

app.use(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const accept = String(req.headers.accept || '');
  if (!accept.includes('text/html')) return next();

  const rawPath = req.path || '/';
  if (/^\/(api|admin)(\/|$)/.test(rawPath)) return next();
  if (extname(rawPath)) return next();

  const cleanPath = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : '/';
  const appMatch = /^\/apps\/([^/]+)$/.exec(cleanPath);
  // 旧版应用卡片路由 /app/:id，内容与应用详情页同源
  const appCardMatch = /^\/app\/([^/]+)$/.exec(cleanPath);
  const topicMatch = /^\/topics\/([^/]+)$/.exec(cleanPath);
  const isAppDashboard = cleanPath === '/dashboard';
  const pageMeta = PAGE_SHARE_META[cleanPath];

  const appId = appMatch
    ? decodeURIComponent(appMatch[1])
    : appCardMatch
      ? decodeURIComponent(appCardMatch[1])
      : isAppDashboard
        ? String(req.query.app_id || '')
        : '';
  const topicId = topicMatch ? decodeURIComponent(topicMatch[1]) : '';

  if (!appId && !appCardMatch && !topicId && !pageMeta) return next();

  const shell = await readShareShell();
  if (!shell) return next();

  const url = `${SITE_ORIGIN}${req.originalUrl.split('#')[0]}`;
  const isCrawler = CRAWLER_UA_RE.test(String(req.headers['user-agent'] || ''));

  let card;
  if (appId) {
    const appCard = isCrawler ? await fetchAppShareCard(appId) : null;
    // 拿不到上游数据时用路径专属的兜底文案，不要退化成站点首页标题
    const fallback = appCardMatch
      ? { title: `应用卡片 - ${SITE_NAME}`, description: '查看应用卡片信息。' }
      : isAppDashboard
        ? { title: `应用数据面板 - ${SITE_NAME}`, description: '查看应用的下载、评分与版本趋势。' }
        : { title: `应用详情 - ${SITE_NAME}`, description: '查看应用详细信息、评分、版本与更新历史。' };
    card = appCard || { ...fallback, image: SITE_LOGO_URL };
  } else if (topicId) {
    const topicCard = isCrawler ? await fetchTopicShareCard(topicId) : null;
    card = topicCard || {
      title: `专题详情 - ${SITE_NAME}`,
      description: '跟随专题逛鸿蒙生态，发现值得一试的应用。',
      image: SITE_LOGO_URL
    };
  } else {
    // 栏目页：带网站 logo
    card = {
      title: `${SITE_NAME} | ${pageMeta.title}`,
      description: pageMeta.description || SITE_DEFAULT_DESCRIPTION,
      seoDescription: pageMeta.seoDescription,
      image: SITE_LOGO_URL
    };
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  /*
   * canonical：同一个应用有多个等价入口（/apps/X、/dashboard?app_id=X、/app/X），
   * 且常带 ?title= 这类展示参数，不声明权威地址会被当成重复内容。
   * 这三者统一指向 sitemap 使用的 /apps/<id>。
   */
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPathFor(cleanPath, appId)}`;
  // 结构化数据：用上游原始信息补上「这是什么、谁做的、评分多少」
  const appJsonLd = card.upstreamInfo
    ? buildAppJsonLd(card.upstreamInfo, {
        url: canonicalUrl,
        name: card.title,
        description: card.description,
        image: card.image
      })
    : null;
  const htmlWithCard = applyShareCardToHtml(shell, { ...card, url });
  res.send(applyJsonLdToHtml(applyCanonicalToHtml(htmlWithCard, canonicalUrl), appJsonLd));
});

/**
 * 前台路由切换时上报当前路径，只用于 SEO 收录队列。
 * 不记录 IP / UA / 归属地等任何访客信息；enqueuePath 内部做过滤与归一。
 */
app.get('/api/public/track', (req, res) => {
  const pagePath = typeof req.query.path === 'string' ? req.query.path : '';
  if (pagePath && !pagePath.startsWith('/admin')) defer(seoSubmit.enqueuePath(pagePath));
  res.json({ ok: true });
});

// 系统监控用的健康检查
app.get('/api/v0/charts/rating', (req, res) => {
  res.json({ status: 'ok', version: 'v0' });
});
app.use(require('./routes/admin-ops.cjs')());
app.use(require('./routes/media.cjs'));
app.use(require('./routes/database.cjs'));
app.use(require('./routes/incidents.cjs'));
app.use(require('./routes/public-content.cjs'));
app.use(require('./routes/diagnostics.cjs'));
app.use(require('./routes/logs.cjs'));
app.use(require('./routes/seo.cjs')({ onConfigChange: invalidateSitemapCache }));
app.use(require('./routes/auth.cjs'));

// 已注册的后台路由各自鉴权；未匹配的后台 API 也不暴露给匿名请求。
app.use('/api/admin', requireAuth);

// 未匹配的 API 不回退到前端页面。
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.get(/.*/, (_req, res) => {
  markAssetFallback();
  res.status(204).end();
});

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const clientError = error.status >= 400 && error.status < 500;
  if (!clientError) console.error('[request]', error);
  res.status(clientError ? error.status : 500).json({
    error: clientError ? error.message : 'Internal server error',
  });
});

module.exports = app;
