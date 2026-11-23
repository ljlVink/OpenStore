/*
 * 脚本护栏：给全站（后台管理路径除外）加一层反自动化采集。
 *
 * 判定：UA 解析不出浏览器名的一律当脚本（白名单思路，不维护爬虫名单）；
 *      后台「放行名单」里的前缀直接放行，不受该判定与配额约束。
 * 处置：窗口内先给 FREE_HITS 次宽限，超限返回 429 警告页；屡犯封禁时长按 4 倍递增。
 * 挂载：app 级全站生效（含静态资源与页面路由），/api/admin、/admin、/ws 例外，
 *      否则误拦自己的出口就进不去后台解封（与硬封禁共用同一份豁免）。
 * 豁免：官方搜索/社交抓取 UA 与 SEO 元文件（robots.txt 等）放行，不影响收录与分享卡片。
 * 另有硬封禁名单（不区分 UA，见 hardBanGuard）与可后台自定义的警告页文案。
 */
const UAParser = require('ua-parser-js');
const { isIP } = require('node:net');
const { query } = require('../database.cjs');
const { bindings } = require('./runtime.cjs');
const { getClientIp, getClientLocation, normalizeIp } = require('./client-ip.cjs');
const { pushLiveLog } = require('./live-log.cjs');
const { compilePatterns, normalizeAllowUa, makeIsAllowedClient } = require('./ua-allowlist.cjs');
const { SITE_ORIGIN, SITE_NAME } = require('./share-cards.cjs');

/* ------------------------------- 配置 ------------------------------- */

const readInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const guardOptions = () => {
  const env = bindings();
  return {
    enabled: !/^(0|false|off)$/i.test(String(env.SCRIPT_GUARD_ENABLED ?? '1').trim()),
    freeHits: Math.floor(readInt(env.SCRIPT_GUARD_FREE_HITS, 20)),
    windowMs: Math.floor(readInt(env.SCRIPT_GUARD_WINDOW_MS, 10 * 60 * 1000)),
    baseBlockMs: Math.floor(readInt(env.SCRIPT_GUARD_BLOCK_MS, 15 * 60 * 1000))
  };
};
const MAX_BLOCK_MS = 24 * 60 * 60 * 1000;
const CONTACT_URL = `${SITE_ORIGIN}/about`;

/* --------------------------- 放行名单 --------------------------- */

/* 放行名单：命中的客户端不计次、不封禁（硬封禁只看 IP，不受影响）。
   只存 system_settings，没有内置默认值，未保存前为空 = 不放行任何客户端。 */
const ALLOW_KEY = 'script_guard_allow';
const getAllowList = async () => {
  const { rows } = await query('SELECT value FROM system_settings WHERE key = $1', [ALLOW_KEY]);
  return normalizeAllowUa(rows[0]?.value || '');
};

const saveAllowList = async (input) => {
  const value = normalizeAllowUa(input);
  await query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [ALLOW_KEY, value]);
  return value;
};

/** UA 解析不出浏览器名就认为是脚本；放行名单里的客户端不参与判定 */
const looksLikeScript = (ua, allow = '') => {
  const raw = String(ua || '').trim();
  if (!raw) return true;
  if (makeIsAllowedClient(compilePatterns(allow))(raw)) return false;
  try {
    const browser = new UAParser(raw).getBrowser();
    return !browser || !browser.name;
  } catch {
    return true; // 解析异常就当脚本，宁可放过浏览器也别放过爬虫
  }
};

/* --------------------------- 警告页自定义 --------------------------- */

const PAGE_CONFIG_KEY = 'script_guard_page';

/**
 * 默认文案。支持两条迷你标记（见 renderInline）：`**加粗**`、`{{site}}`。
 * 措辞别写判定依据（如「没有携带浏览器标识」），那等于告诉对方怎么绕过。
 */
const DEFAULT_PAGE_CONFIG = Object.freeze({
  badge: '429 · RATE LIMITED',
  title: '本站已限制自动化访问',
  message:
    '检测到来自该地址的**自动化访问行为**，已超出本站允许的范围。\n' +
    '为保障其他访客的正常访问，该地址已被暂时限制。',
  tips: [
    '如果你是**正常访客**：这大概率是误判，请刷新重试；仍无法访问请通过下面的入口联系我们。',
    '本站没有开放无人值守的批量采集，程序化调用请先说明用途。',
    '确有**批量获取或合作**需求：说明用途后可以单独放行。'
  ],
  contactLabel: '需要放行或想说明用途',
  contactUrl: CONTACT_URL,
  showDetails: true
});

const clampText = (value, max) =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);

/** 联系入口只允许 http(s) 或站内相对路径，避免被写成 javascript: 之类 */
const normalizeContactUrl = (value) => {
  const url = String(value ?? '').trim();
  if (!url) return DEFAULT_PAGE_CONFIG.contactUrl;
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url.slice(0, 300);
  return DEFAULT_PAGE_CONFIG.contactUrl;
};

/** 把任意输入收敛成一份合法配置：后台表单、数据库旧数据、手改 JSON 都要经过它 */
const normalizePageConfig = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const tips = Array.isArray(src.tips)
    ? src.tips.map((t) => clampText(t, 200)).filter(Boolean).slice(0, 6)
    : [];
  return {
    badge: clampText(src.badge, 40) || DEFAULT_PAGE_CONFIG.badge,
    title: clampText(src.title, 60) || DEFAULT_PAGE_CONFIG.title,
    message: clampText(src.message, 800) || DEFAULT_PAGE_CONFIG.message,
    tips: tips.length ? tips : [...DEFAULT_PAGE_CONFIG.tips],
    contactLabel: clampText(src.contactLabel, 60) || DEFAULT_PAGE_CONFIG.contactLabel,
    contactUrl: normalizeContactUrl(src.contactUrl),
    showDetails: src.showDetails === undefined ? true : !!src.showDetails
  };
};

// Read on every request: a save or ban in one isolate is effective in all others.
const getPageConfig = async () => {
  const { rows } = await query('SELECT value FROM system_settings WHERE key = $1', [PAGE_CONFIG_KEY]);
  const defaults = { ...DEFAULT_PAGE_CONFIG, contactUrl: String(bindings().SCRIPT_GUARD_CONTACT || '').trim() || CONTACT_URL };
  try {
    return normalizePageConfig(rows[0]?.value ? JSON.parse(rows[0].value) : defaults);
  } catch {
    return normalizePageConfig(defaults);
  }
};

const savePageConfig = async (input) => {
  const config = normalizePageConfig(input);
  await query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [PAGE_CONFIG_KEY, JSON.stringify(config)]);
  return config;
};

const resetPageConfig = async () => {
  await query('DELETE FROM system_settings WHERE key = $1', [PAGE_CONFIG_KEY]);
  return getPageConfig();
};

const listBlockRecords = async (limit) => {
  const n = Math.floor(Math.min(Math.max(Number(limit) || 100, 1), 500));
  const { rows } = await query('SELECT * FROM script_guard_blocks ORDER BY id DESC LIMIT $1', [n]);
  return rows;
};

const clearBlockRecords = async () => {
  await query('DELETE FROM script_guard_blocks');
};

const unblockIp = async (ip) => {
  const result = await query('DELETE FROM script_guard_state WHERE ip = $1 RETURNING ip', [normalizeIp(ip)]);
  return result.rowCount > 0;
};

/* ------------------------------ 渲染 ------------------------------ */

const esc = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 迷你标记渲染：先整体转义再套标记，所以填什么都注入不了 HTML */
const renderInline = (text) =>
  esc(text)
    .replace(/\{\{\s*site\s*\}\}/gi, `<a href="${esc(SITE_ORIGIN)}">${esc(SITE_ORIGIN)}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

/** 多行文本：换行按 <br> 渲染 */
const renderBlock = (text) => renderInline(text).replace(/\n/g, '<br>');

const humanMs = (ms) => {
  if (ms >= 3600000) return `${Math.round(ms / 3600000)} 小时`;
  if (ms >= 60000) return `${Math.round(ms / 60000)} 分钟`;
  return `${Math.max(1, Math.round(ms / 1000))} 秒`;
};

/** 警告页：纯内联样式，不依赖任何外部资源（对方可能根本不加载外链） */
const warningPage = async ({ ip, ua, path, retryAfterSec, strikes }) => {
  const cfg = await getPageConfig();

  const tipsHtml = cfg.tips.length
    ? `    <ul>\n${cfg.tips.map((t) => `      <li>${renderBlock(t)}</li>`).join('\n')}\n    </ul>`
    : '';

  const detailsHtml = cfg.showDetails
    ? `    <div class="info">
      <div><b>状态码</b><span>429 Too Many Requests${retryAfterSec ? ` · 请在 ${retryAfterSec} 秒后重试` : ''}</span></div>
      <div><b>来源 IP</b><code>${esc(ip)}</code></div>
      <div><b>请求路径</b><code>${esc(path)}</code></div>
      <div><b>你的 UA</b><code>${esc(ua) || '(空)'}</code></div>
      ${strikes ? `<div><b>违规次数</b><span>第 ${strikes} 次，限制时长会逐次翻倍</span></div>` : ''}
    </div>`
    : '';

  const contactHtml = cfg.contactUrl
    ? `    <div class="foot">
      ${renderInline(cfg.contactLabel)} → <a href="${esc(cfg.contactUrl)}" rel="noopener">${esc(cfg.contactUrl)}</a>
    </div>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(cfg.title)} · ${esc(SITE_NAME)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         padding:24px; background:#0d1117; color:#e6edf3;
         font:15px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; }
  .card { width:100%; max-width:640px; background:#161b22; border:1px solid #30363d;
          border-radius:16px; padding:32px; }
  .badge { display:inline-block; padding:2px 10px; margin-bottom:14px; border-radius:999px;
           background:rgba(248,81,73,.15); color:#ff7b72; font-size:12px; letter-spacing:.05em; }
  h1 { margin:0 0 12px; font-size:22px; }
  p { margin:0 0 14px; color:#9198a1; }
  ul { margin:0 0 14px; padding-left:20px; color:#9198a1; }
  li { margin-bottom:6px; }
  b { color:#c9d1d9; }
  code { padding:2px 6px; border-radius:6px; background:#21262d; color:#e6edf3;
         font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; word-break:break-all; }
  .info { margin:18px 0; padding:14px 16px; border-radius:10px; background:#0d1117;
          border:1px solid #21262d; font-size:13px; color:#9198a1; }
  .info div { display:flex; gap:10px; margin-bottom:6px; }
  .info div:last-child { margin-bottom:0; }
  .info b { flex:0 0 68px; color:#6e7681; font-weight:400; }
  a { color:#58a6ff; }
  .foot { margin-top:20px; padding-top:16px; border-top:1px solid #21262d; font-size:13px; color:#6e7681; }
  /*
   * 窄屏：这张页面访客在手机上是能看到的（万一误伤），所以小小屏也要能读。
   * 信息块从「标签 + 值」两栏改成上下两行，否则 UA 那条会被挤成一列字符。
   */
  @media (max-width: 480px) {
    body { padding:16px; font-size:14px; }
    .card { padding:22px 18px; border-radius:12px; }
    h1 { font-size:19px; }
    .badge { margin-bottom:10px; }
    ul { padding-left:18px; }
    .info { padding:12px 14px; }
    .info div { flex-direction:column; gap:2px; margin-bottom:10px; }
    .info b { flex:none; }
    .foot { font-size:12px; }
  }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">${esc(cfg.badge)}</span>
    <h1>${esc(cfg.title)}</h1>
    <p>
${renderBlock(cfg.message)}
    </p>
${tipsHtml}
${detailsHtml}
${contactHtml}
  </div>
</body>
</html>`;
};

const sendWarning = async (res, info) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex');
  if (info.retryAfterSec > 0) res.set('Retry-After', String(info.retryAfterSec));
  res.status(429).type('html').send(await warningPage(info));
};

/**
 * 测试按钮用的预览：只渲染示例数据（TEST-NET-3 段），不计数、不进封禁表。
 */
const previewWarningPage = () =>
  warningPage({
    ip: '203.0.113.47',
    ua: 'AppGalleryData/2.0',
    path: '/api/public/apps/browse?tab=categories',
    retryAfterSec: 900,
    strikes: 1
  });

/* The PG function locks one IP row and commits the sliding window, strikes and
 * block record together; independent Workers never race through a local cache. */
const trackRequest = async (ip, ua, path, force = false) => {
  const options = guardOptions();
  const { rows } = await query('SELECT * FROM script_guard_hit($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [ip, String(ua || '').slice(0, 200), String(path || '').slice(0, 300), getClientLocation(),
      options.freeHits, options.windowMs, options.baseBlockMs, MAX_BLOCK_MS, force]);
  const entry = rows[0];
  if (entry.new_block) {
    pushLiveLog('warn', `脚本护栏：已限制 ${ip} 请求 ${path} · 封禁 ${humanMs(Number(entry.block_ms))}`, { kind: 'system' });
  }
  return entry;
};

const triggerBlock = async (ip, { ua, path } = {}) => {
  const key = normalizeIp(ip);
  if (!isIP(key)) return null;
  const uaText = String(ua || '').trim() || 'OpenStore-Guard-SelfTest/1.0';
  const pathText = String(path || '').trim() || '/api/public/apps/browse';
  const entry = await trackRequest(key, uaText, pathText, true);
  const blockMs = Number(entry.block_ms);
  const remainMs = Number(entry.remain_ms);
  return {
    ip: key, status: 429, strikes: entry.strikes, blockMs, remainMs,
    html: await warningPage({ ip: key, ua: uaText, path: pathText, retryAfterSec: Math.ceil(remainMs / 1000), strikes: entry.strikes })
  };
};

const ADMIN_EXEMPT_RE = [/^\/api\/admin(\/|$)/, /^\/admin(\/|$)/, /^\/ws$/];

const hardBanIp = async (ip, { reason = '', durationMs = 0 } = {}) => {
  const key = normalizeIp(ip);
  if (!isIP(key)) throw new Error('IP 格式不正确');
  const duration = Number.isFinite(Number(durationMs)) ? Math.max(Number(durationMs), 0) : 0;
  const safeReason = String(reason || '').slice(0, 200);
  await query(
    `INSERT INTO script_guard_bans (ip, reason, created_at, expires_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP, CASE WHEN $3::double precision > 0 THEN clock_timestamp() + $3 * interval '1 millisecond' ELSE NULL END)
     ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason, created_at = CURRENT_TIMESTAMP, expires_at = excluded.expires_at`,
    [key, safeReason, duration]);
  pushLiveLog('warn', `脚本护栏：已硬封禁 ${key}${safeReason ? `（${safeReason}）` : ''}`, { kind: 'system' });
};

const hardUnbanIp = async (ip) => {
  const key = normalizeIp(ip);
  if (!isIP(key)) throw new Error('IP 格式不正确');
  await query('DELETE FROM script_guard_bans WHERE ip = $1', [key]);
  pushLiveLog('info', `脚本护栏：已解除硬封禁 ${key}`, { kind: 'system' });
};

const listHardBans = async () => {
  const { rows } = await query(
    `SELECT *, expires_at IS NULL AS permanent,
       CASE WHEN expires_at IS NULL THEN 0 ELSE GREATEST(0, floor(extract(epoch FROM (expires_at - clock_timestamp())) * 1000)) END AS "remainMs"
     FROM script_guard_bans WHERE expires_at IS NULL OR expires_at > clock_timestamp() ORDER BY hits DESC`);
  return rows.map(row => ({ ...row, hits: Number(row.hits), remainMs: Number(row.remainMs) }));
};

const hardBanGuard = async (req, res, next) => {
  if (ADMIN_EXEMPT_RE.some(re => re.test(req.path || ''))) return next();
  const ip = getClientIp(req);
  const { rows } = await query(
    `UPDATE script_guard_bans SET hits = hits + 1
     WHERE ip = $1 AND (expires_at IS NULL OR expires_at > clock_timestamp())
     RETURNING CASE WHEN expires_at IS NULL THEN 0 ELSE CEIL(extract(epoch FROM (expires_at - clock_timestamp()))) END AS retry_after`,
    [ip]);
  if (!rows[0]) return next();
  return sendWarning(res, { ip, ua: req.headers['user-agent'], path: req.originalUrl,
    retryAfterSec: Math.max(0, Number(rows[0].retry_after)), strikes: 0 });
};

/* ------------------------------ 中间件 ------------------------------ */

/*
 * 官方抓取豁免：搜索引擎与社交分享的官方爬虫 UA 放行，保证收录与分享卡片正常。
 * 不能直接复用 share-cards 的 CRAWLER_UA_RE —— 它把 curl/、wget/、python-requests
 * 这类通用脚本客户端也算作爬虫，而那些正是本护栏要拦的对象，这里只保留「官方」抓取。
 */
const OFFICIAL_CRAWLER_UA_RE =
  /(googlebot|bingbot|yandex|duckduckbot|baiduspider|sogou|yisou|bytespider|petalbot|applebot|facebookexternalhit|twitterbot|slackbot|telegrambot|whatsapp|discordbot|embedly|pinterest|linkedinbot|skypeuripreview|line-poker|micromessenger|wechat|weibo|qzone|tencent)/i;

// SEO / 站点元文件：按路径豁免，任何 UA 都能取到，不参与计数
const SEO_EXEMPT_PATHS = new Set(['/robots.txt', '/sitemap.xml', '/site.webmanifest']);

/** 挂在 app 级（index.cjs 里 app.use），全站生效，后台管理路径在内部豁免 */
const scriptGuard = async (req, res, next) => {
  if (!guardOptions().enabled) return next();
  if (ADMIN_EXEMPT_RE.some(re => re.test(req.path || ''))) return next();
  if (SEO_EXEMPT_PATHS.has(req.path || '')) return next();
  const ua = String(req.headers['user-agent'] || '');
  if (OFFICIAL_CRAWLER_UA_RE.test(ua)) return next();
  if (!looksLikeScript(ua, await getAllowList())) return next();
  const ip = getClientIp(req);
  const entry = await trackRequest(ip, ua, req.originalUrl);
  if (Number(entry.remain_ms) > 0 || entry.new_block) {
    return sendWarning(res, { ip, ua, path: req.originalUrl,
      retryAfterSec: Math.ceil(Number(entry.remain_ms) / 1000), strikes: entry.strikes });
  }
  next();
};

const scriptGuardSnapshot = async () => {
  const [{ rows: totals }, { rows: blocked }, allow, page] = await Promise.all([
    query(`SELECT count(*) AS tracked, COALESCE(sum(script_requests),0) AS requests,
      COALESCE(sum(warned),0) AS warned, COALESCE(sum(blocked),0) AS blocked, COALESCE(sum(strikes),0) AS strikes
      FROM script_guard_state`),
    query(`SELECT ip, ua, strikes, blocked_until - floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "remainMs"
      FROM script_guard_state WHERE blocked_until > floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint`),
    getAllowList(), getPageConfig()
  ]);
  const stats = totals[0];
  return {
    ...guardOptions(), allow, contactUrl: page.contactUrl,
    stats: { scriptRequests: Number(stats.requests), warned: Number(stats.warned),
      blocked: Number(stats.blocked), strikes: Number(stats.strikes) },
    tracked: Number(stats.tracked),
    blocked: blocked.map(row => ({ ...row, remainMs: Number(row.remainMs) }))
  };
};

module.exports = {
  scriptGuard,
  scriptGuardSnapshot,
  looksLikeScript,
  previewWarningPage,
  getPageConfig,
  savePageConfig,
  resetPageConfig,
  getAllowList,
  saveAllowList,
  listBlockRecords,
  clearBlockRecords,
  unblockIp,
  triggerBlock,
  hardBanGuard,
  hardBanIp,
  hardUnbanIp,
  listHardBans,
  DEFAULT_PAGE_CONFIG
};
