const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./database.cjs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// 出站请求统一配置（连接池 / 超时 / 并发闸门），须在 dotenv 之后加载
require('./lib/upstream-http.cjs').applyAxiosDefaults();

// 拆分出去的内部模块（注意：必须在 dotenv.config 之后加载，它们会读 process.env）
const { pushLiveLog } = require('./lib/live-log.cjs');

/*
 * 进程级兜底：未捕获异常 / 未处理的 Promise rejection 默认直接退出进程，
 * 在 pm2 下就是「服务反复重启」。这里记完整堆栈并让进程继续跑，
 * 避免一条请求或一个定时器的异常把整个服务带走。
 */
const reportFatal = (label, err) => {
  const detail = err && err.stack ? err.stack : String(err);
  console.error(`[${label}]`, detail);
  try {
    pushLiveLog('error', `${label}: ${detail.split('\n')[0]}`);
  } catch {
    /* 日志模块本身出问题时不再套一层 */
  }
};

process.on('unhandledRejection', (reason) => reportFatal('unhandledRejection', reason));
process.on('uncaughtException', (err) => reportFatal('uncaughtException', err));
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
const { attachWebSocket } = require('./lib/realtime.cjs');
const { hardBanGuard, scriptGuard } = require('./lib/script-guard.cjs');
const { JWT_SECRET, requireAuth } = require('./middleware/auth.cjs');
const { TRUST_PROXY_HOPS, PORT } = require('./lib/config.cjs');
const { uploadsDir, UPLOAD_FORCE_DOWNLOAD_EXT } = require('./lib/uploads.cjs');
const seoSubmit = require('./lib/seo-submit.cjs');
const { getSitemap, invalidateSitemapCache } = require('./lib/sitemap.cjs');
const { canonicalPathFor } = require('./lib/canonical.cjs');
const { applyJsonLdToHtml, buildAppJsonLd } = require('./lib/json-ld.cjs');

const app = express();
app.set('trust proxy', TRUST_PROXY_HOPS);

app.use(cors());

// 硬封禁放在最前面（body 解析、静态资源与 SPA 兜底之前）；名单为空时零开销
app.use(hardBanGuard);

// 兼容字面量 null 请求体：
// axios 在 Content-Type: application/json 下会把 null 序列化成字符串 "null"，
// body-parser 的 strict 模式只接受对象/数组，会直接抛 SyntaxError 返回 400，
// 请求会在到达 /api/v0 代理之前就被拒掉。这里放宽 strict，
// 并把非对象的 body 归一成 {}，既兼容这类客户端，也避免下游解构 req.body 时报错。
app.use(express.json({ strict: false }));
app.use((req, res, next) => {
  // 只处理 JSON 请求体，避免影响 multipart 等其它类型的请求
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

// Ensure /uploads is served correctly before SPA fallback
/*
 * /uploads 必须保持匿名可读（公开内容中的图片等需要正常展示），
 * 但加了三点硬化，避免上传的文件在你的域名下被当成页面执行：
 *   1. nosniff：不让浏览器猜类型；
 *   2. html/svg/xml/js 这类能执行脚本的扩展名一律强制下载，不作为页面打开；
 *   3. 关掉目录索引。
 */
app.use(
  '/uploads',
  (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (UPLOAD_FORCE_DOWNLOAD_EXT.test(path.extname(req.path || ''))) {
      res.setHeader('Content-Disposition', 'attachment');
    }
    next();
  },
  express.static(uploadsDir, { index: false, dotfiles: 'ignore' })
);

/** IndexNow key 文件：内容为 key 本身，搜索引擎据此验证站点归属。须排在 express.static 之前 */
app.get('/indexnow-key.txt', async (req, res) => {
  try {
    const config = await seoSubmit.loadConfig();
    res.type('text/plain; charset=utf-8');
    res.send(String(config.indexNowKey || '').trim());
  } catch {
    res.status(500).type('text/plain; charset=utf-8').send('indexnow key unavailable');
  }
});

/** 动态 sitemap.xml：含应用详情页，须排在 express.static 之前以覆盖构建期文件。生成失败时回退静态文件 */
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
  if (/^\/(api|uploads|admin)(\/|$)/.test(rawPath)) return next();
  if (path.extname(rawPath)) return next();

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

// 静态资源排在 /uploads 之后，否则 /uploads 会被 SPA 兜底或这里的静态中间件截走
app.use(express.static(path.join(__dirname, '../dist')));

/**
 * 前台路由切换时上报当前路径，只用于 SEO 收录队列。
 * 不记录 IP / UA / 归属地等任何访客信息；enqueuePath 内部做过滤与归一。
 */
app.get('/api/public/track', (req, res) => {
  const pagePath = typeof req.query.path === 'string' ? req.query.path : '';
  if (pagePath && !pagePath.startsWith('/admin')) seoSubmit.enqueuePath(pagePath);
  res.json({ ok: true });
});

// 系统监控用的健康检查
app.get('/api/v0/charts/rating', (req, res) => {
  res.json({ status: 'ok', version: 'v0' });
});
/*
 * ---- 路由挂载 ----
 * 顺序就是匹配顺序，必须与拆分前各段路由在原文件里的先后保持一致
 * （例如 /api/v0 相关的中间件要排在通用路由前面）。
 * 每个 router 内部写的都是完整路径，所以统一挂在根路径上。
 *
 * 注意：本文件不在这里面注册任何业务路由，全部在 server/routes/ 下。
 */
/*
 * 挂载时顺手记一笔，启动后打印「哪个模块挂了多少条路由」的摘要。
 * 拆成多个文件之后，光看目录不好确认有没有漏挂，这段输出就是给这个用的。
 */
const mountedRouters = [];
const mountRouter = (name, router) => {
  mountedRouters.push({ name, router });
  app.use(router);
};

mountRouter('admin-ops', require('./routes/admin-ops.cjs')()); // 应用总览 / 脚本护栏
mountRouter('proxy', require('./routes/proxy.cjs'));          // 上游代理：/api/v0 透传
mountRouter('media', require('./routes/media.cjs'));          // 应用截图同源代理、文件上传、上传目录
mountRouter('database', require('./routes/database.cjs'));    // 数据库管理
mountRouter('incidents', require('./routes/incidents.cjs'));  // 服务事故 / 维护公告
mountRouter('public-content', require('./routes/public-content.cjs')); // 前台公开内容：应用、专题
mountRouter('diagnostics', require('./routes/diagnostics.cjs'));   // 客户端 IP 诊断
mountRouter('logs', require('./routes/logs.cjs'));           // 操作日志
/*
 * SEO 收录提交（/api/admin/seo/*）。
 *
 * 必须挂在下面 `/api/admin` 闸门之前：闸门自身不响应，只是改写 req.url 后二次分发，
 * 业务路由要在它之前才能匹配到完整路径。挂在闸门之后会因前缀被重复补写而自我重入，
 * 直至 RangeError: Maximum call stack size exceeded。
 * 代价是闸门拦不到本路由，故鉴权在路由内部声明（routes/seo.cjs）。
 */
mountRouter('seo', require('./routes/seo.cjs')({ onConfigChange: invalidateSitemapCache }));

/** 统计一个 router 里注册的路由条数 */
const countRouterRoutes = (router) => (router.stack || []).filter((layer) => layer.route).length;

/** 递归统计挂在 app 上的全部路由（含各子 router），用来核对总数 */
const countAppRoutes = (stack) =>
  (stack || []).reduce((sum, layer) => {
    if (layer.route) return sum + 1;
    const handle = layer.handle;
    return sum + (handle && Array.isArray(handle.stack) ? countAppRoutes(handle.stack) : 0);
  }, 0);

/*
 * 启动摘要。拆成多文件之后，光看目录不好确认有没有哪个模块漏挂，
 * 这段输出一眼就能看出来：条数对不对、入口直连的是哪几条。
 */
const printStartupSummary = () => {
  const perRouter = mountedRouters.map(({ name, router }) => ({ name, count: countRouterRoutes(router) }));
  const inRouters = perRouter.reduce((sum, item) => sum + item.count, 0);
  const total = countAppRoutes(app.router && app.router.stack);

  console.log(`[startup] 端口 ${PORT} · 代理信任跳数 ${TRUST_PROXY_HOPS} · Node ${process.version} · PID ${process.pid}`);
  console.log(`[startup] 共 ${total} 条路由 = ${perRouter.length} 个路由模块（${inRouters} 条）+ 入口直连 ${total - inRouters} 条`);
  const width = Math.max(...perRouter.map((r) => r.name.length));
  for (const { name, count } of perRouter) {
    console.log(`[startup]   ${name.padEnd(width)}  ${String(count).padStart(3)} 条`);
  }
};

// Upgrade HTTP -> WS
const server = require('http').createServer(app);
attachWebSocket(server, { jwtSecret: JWT_SECRET });

server.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  printStartupSummary();

  /*
   * SEO 收录提交的定时任务：每 60 秒检查一次是否到达配置的提交时刻（submitHour），
   * 因此改配置无需重启进程。总开关或自动提交关闭时不做任何出站请求。
   */
  seoSubmit.startScheduler();
  console.log('[startup] SEO 收录提交定时任务已启动（可在后台「SEO 收录」面板调整频率或关闭）');
});


// Seed admin user
db.get(`SELECT id FROM users WHERE username=?`, ['admin'], (err, row) => {
  if (err) console.error(err);
  const configuredPwd = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!row) {
    // 没有配置密码时不要再回退到 'admin123' 这种公开的默认口令：
    // 首次初始化改成生成随机密码并打印到启动日志，至少不是人人皆知的密码。
    if (!configuredPwd) {
      const generated = crypto.randomBytes(12).toString('base64url');
      console.warn('[security] 未配置 ADMIN_PASSWORD，已为 admin 生成随机初始密码（仅本次启动打印）：');
      console.warn(`[security] admin 初始密码: ${generated}`);
      console.warn('[security] 请在 .env 里设置 ADMIN_PASSWORD 后重启服务，以替换初始密码。');
      db.run(`INSERT INTO users (username, password_hash, role) VALUES (?,?,?)`, ['admin', bcrypt.hashSync(generated, 10), 'admin']);
    } else {
      db.run(`INSERT INTO users (username, password_hash, role) VALUES (?,?,?)`, ['admin', bcrypt.hashSync(configuredPwd, 10), 'admin']);
    }
  } else if (configuredPwd) {
    db.run(`UPDATE users SET password_hash=? WHERE id=?`, [bcrypt.hashSync(configuredPwd, 10), row.id]);
  }
});

// 登录相关接口（原文件里就排在定时任务 / 建管理员账号之后）
mountRouter('auth', require('./routes/auth.cjs'));            // 登录 / 刷新 token / 改密码

/*
 * /api/admin 的兜底鉴权闸门：处理未被前面业务路由接住的 /api/admin 请求。
 *
 * 仅作兜底 —— 排在它前面的业务路由会先响应，闸门不会执行，
 * 因此对外的后台路由（如 seo）各自在路由内声明 requireAuth。
 *
 * req.url 只补回 /api：app.use 已剥掉 /api/admin。若补全 /api/admin，
 * 二次分发时 router 会再剥一次同一前缀，导致自我重入至栈溢出。
 */
app.use('/api/admin', (req, res, next) => {
  if (req.url.startsWith('/auth/')) return next();
  return requireAuth(req, res, () => {
    req.url = `/api${req.url}`;
    app.handle(req, res, next);
  });
});

// 未匹配的 API 不回退到前端页面。
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// SPA Fallback - Must be last
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});
  
