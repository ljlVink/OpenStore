/*
 * SEO 收录提交：把前台真实访问过的路径提交给搜索引擎。
 *
 * 数据流：
 *   index.cjs（/api/public/track，前台路由切换时上报）→ enqueuePath()
 *     → seo_url_queue（按归一化 URL 聚合 hits / first_seen / last_seen）
 *       → runSubmission()：取数 → 归一化过滤 → 按额度分批提交
 *         → 必应 Webmaster API（主）/ IndexNow（备）
 *           → seo_submissions（提交记录）
 *
 * 两条通道：
 *   - 必应 Webmaster API：需后台生成的 API key，单请求 ≤500 条、10000 条/天，
 *     可用 GetUrlSubmissionQuota 查询剩余额度；
 *   - IndexNow：无需后台操作，靠站点托管的 key 文件验证归属，单请求 ≤10000 条，
 *     无额度查询接口，限速时返回 429。
 */
const crypto = require('crypto');
const axios = require('axios');
const { query } = require('../database.cjs');
const { SITE_ORIGIN } = require('./share-cards.cjs');
const { encrypt, decrypt } = require('./secret.cjs');
const { pushLiveLog } = require('./live-log.cjs');

/* ============================ 配置 ============================ */

const SETTING_PREFIX = 'seo_';

/** 配置默认值；后台面板的初值与此一致 */
const DEFAULT_CONFIG = {
  // 总开关。关闭后访客路径仍会入队，只是不再自动提交
  enabled: 1,
  autoSubmit: 1,
  bingEnabled: 1,
  indexNowEnabled: 1,
  // 站点根 URL，须与必应后台验证过的站点一致
  siteUrl: SITE_ORIGIN,
  // 单次请求的 URL 条数
  batchSize: 200,
  // 每日提交上限
  dailyLimit: 5000,
  // 每天几点（北京时间 0~23）执行自动提交
  submitHour: 0,
  // 单条 URL 至少被访问几次才提交
  minHits: 1,
  // 相邻两批之间的间隔，避免触发限速
  requestDelayMs: 1200
};

/** 数值型配置的取值范围 */
const NUM_RANGES = {
  batchSize: [1, 500],
  dailyLimit: [1, 10000],
  submitHour: [0, 23],
  minHits: [1, 100],
  requestDelayMs: [0, 10000]
};
const BOOL_KEYS = ['enabled', 'autoSubmit', 'bingEnabled', 'indexNowEnabled'];

const clampNumber = (value, [min, max], fallback) => {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const toBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return /^(1|true|yes|on)$/i.test(String(value).trim()) ? 1 : 0;
};

/**
 * 读取配置：system_settings 中所有 seo_ 前缀的键。
 * 返回的 plainBingKey 是明文，仅供服务端出站请求使用，对外须用 maskKey 脱敏。
 * bing_api_key 解密失败（如更换过 ENV_SECRET_KEY）时按未配置处理。
 */
const loadConfig = async (deps = {}) => {
  const sql = deps.query || query;
  const { rows } = await sql('SELECT key, value FROM system_settings WHERE key LIKE $1', [`${SETTING_PREFIX}%`]);
  const raw = {};
  for (const row of rows) raw[String(row.key).slice(SETTING_PREFIX.length)] = row.value;

  const config = { ...DEFAULT_CONFIG };
  config.siteUrl = String(raw.siteUrl || DEFAULT_CONFIG.siteUrl || SITE_ORIGIN).replace(/\/+$/, '');
  for (const key of BOOL_KEYS) config[key] = toBool(raw[key], DEFAULT_CONFIG[key]);
  for (const [key, range] of Object.entries(NUM_RANGES)) {
    config[key] = clampNumber(raw[key], range, DEFAULT_CONFIG[key]);
  }

  config.indexNowKey = String(raw.indexnow_key || '').trim();
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(config.indexNowKey)) {
    // Concurrent invocations must all use the same durable key.
    const generated = crypto.randomBytes(16).toString('hex');
    const result = await sql(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('seo_indexnow_key', $1, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = CASE WHEN system_settings.value ~ '^[a-zA-Z0-9-]{8,128}$'
                      THEN system_settings.value ELSE excluded.value END,
         updated_at = CURRENT_TIMESTAMP
       RETURNING value`,
      [generated]
    );
    config.indexNowKey = result.rows[0].value;
  }
  config.plainBingKey = decrypt(String(raw.bing_api_key || ''));
  config.bingKeyMasked = maskKey(config.plainBingKey);
  return config;
};

/**
 * 批量写入配置。
 * bing_api_key 加密后存储，传空串表示清除；其余键原样存字符串。
 * @returns {Promise<{updated: number, error?: string}>}
 */
const saveSettings = async (patch = {}, deps = {}) => {
  const entries = Object.entries(patch);
  if (!entries.length) return { updated: 0 };
  const values = [];
  const placeholders = entries.map(([key, value], index) => {
    const stored = key === 'bing_api_key' ? (value ? encrypt(String(value)) : '') : String(value ?? '');
    values.push(`${SETTING_PREFIX}${key}`, stored);
    return `($${index * 2 + 1}, $${index * 2 + 2}, CURRENT_TIMESTAMP)`;
  });
  try {
    // One statement makes the entire settings patch atomic.
    await (deps.query || query)(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ${placeholders.join(',')}
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      values
    );
    return { updated: entries.length };
  } catch (error) {
    return { updated: 0, error: error.message };
  }
};

/** 只保留末 4 位，用于界面回显与日志 */
function maskKey(plain) {
  const value = String(plain || '');
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `${'*'.repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

/** 抹掉文本中的 API key（必应协议把 key 放在 URL 查询参数里） */
const redact = (text) =>
  String(text == null ? '' : text)
    .replace(/([?&](?:apikey|key)=)[^&\s]*/gi, '$1***')
    .replace(/sampleapikey[a-z0-9]*/gi, '***')
    .slice(0, 500);

/* ====================== URL 归一化与过滤 ====================== */

/** 静态资源后缀，不进入提交队列 */
const STATIC_EXT_RE = /\.(?:js|mjs|css|map|json|xml|txt|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|eot|otf|mp3|mp4|webm|m4a|wav|ogg|zip|gz|exe|apk|hsp|pdf|csv)$/i;

/**
 * 归一化时需要丢弃的查询参数。
 *
 * 这些参数不影响页面渲染，但会让同一页面产生多个 URL，重复占用提交额度。
 * 尤其 ide_webview_request_time 这类时间戳，实测单个首页就衍生出 60+ 条 URL。
 */
const JUNK_PARAM_EXACT = new Set([
  // 页面标题的展示副本（detail 页标题本就来自数据，页面另有一份）
  'title',
  // 来源/分享类标记
  'share', 'spm', 'ref', 'referrer', 'source', 'scene', 'src',
  // 埋点时间戳
  'ide_webview_request_time', '_t', 't'
]);

const JUNK_PARAM_RE = [
  /^utm_/i,            // 投放参数
  /_request_time$/i,   // 埋点时间戳
  /^from$/i,           // 站内来源路径
  /^el-id-/i,          // Element Plus 组件内部 id
  /_(time|ts|timestamp)$/i,
  /^(time|ts|timestamp)$/i
];

/** 纯数字且长度 ≥10 的值按毫秒时间戳处理（用于清理未穷举到的缓存击穿参数） */
const isTimestampValue = (value) => /^\d{10,}$/.test(String(value || ''));

/** 该查询参数是否应在归一化时丢弃 */
const isJunkParam = (key, value) =>
  JUNK_PARAM_EXACT.has(key) || JUNK_PARAM_RE.some((re) => re.test(key)) || isTimestampValue(value);

/** 不应被收录的路径：后台、接口、静态资源、无索引价值的页面 */
const isExcludedPath = (pathname) => {
  const p = pathname.toLowerCase();
  if (p.startsWith('/admin')) return true;
  if (p.startsWith('/api')) return true;
  if (p.startsWith('/assets')) return true;
  if (p === '/login') return true;
  // 已下线的页面不应继续从历史访客路径提交收录
  if (p === '/submit' || p === '/music' || p === '/player' || p === '/articles' || p.startsWith('/articles/')) return true;
  if (p === '/rank' || p.startsWith('/rank/')) return true;
  if (STATIC_EXT_RE.test(p)) return true;
  return false;
};

/**
 * 把访客路径转换为可提交的规范 URL。
 *
 * 处理内容：丢弃无业务意义的查询参数（见 JUNK_PARAM_*）、参数按字典序排序、
 * 去掉结尾多余斜杠、拒绝站外地址与非前台路径。
 *
 * @param {string} rawPath 原始路径，可为 "/x/y" 或同源绝对地址
 * @param {string} siteUrl 站点 origin
 * @returns {string} 规范 URL；不可提交时返回空串
 */
function normalizeUrl(rawPath, siteUrl) {
  const origin = String(siteUrl || SITE_ORIGIN || '').replace(/\/+$/, '');
  if (!origin) return '';

  const raw = String(rawPath == null ? '' : rawPath).trim();
  if (!raw) return '';

  // 站点相对路径压平重复斜杠；"//" 开头是协议相对地址，一律拒绝
  const isAbsolute = /^https?:\/\//i.test(raw);
  if (!isAbsolute && !raw.startsWith('/')) return '';
  if (!isAbsolute && raw.startsWith('//')) return '';
  const candidate = isAbsolute ? raw : raw.replace(/\/{2,}/g, '/');

  let url;
  try {
    url = new URL(candidate, `${origin}/`);
  } catch {
    return '';
  }

  let siteOrigin;
  try {
    siteOrigin = new URL(origin).origin;
  } catch {
    return '';
  }
  if (url.origin !== siteOrigin) return '';

  const pathname = url.pathname.replace(/\/{2,}/g, '/') || '/';
  if (isExcludedPath(pathname)) return '';

  const keep = [];
  url.searchParams.forEach((value, key) => {
    if (isJunkParam(key, value)) return;
    keep.push([key, value]);
  });
  keep.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));

  const search = keep.length
    ? `?${keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
    : '';
  const cleanPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';

  return `${siteOrigin}${cleanPath}${search}`;
}

/* ============================ 入队 ============================ */

/**
 * 将访问路径写入提交队列。同一条归一化 URL 累加 hits 并刷新 last_seen。
 * 返回完整写入的 Promise，调用方通过 defer() 延长请求结束后的执行时间。
 *
 * @param {string} rawPath 原始路径
 * @param {string} [siteUrl] 站点 origin，省略则取 SITE_ORIGIN
 */
async function enqueuePath(rawPath, siteUrl, deps = {}) {
  const origin = String(siteUrl || SITE_ORIGIN || '').replace(/\/+$/, '');
  const url = normalizeUrl(rawPath, origin);
  if (!url) return;

  await (deps.query || query)(
    `INSERT INTO seo_url_queue (path, normalized_url, dedupe_key, hits, first_seen, last_seen, submit_status, updated_at)
     VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'pending', CURRENT_TIMESTAMP)
     ON CONFLICT(dedupe_key) DO UPDATE SET
       hits = seo_url_queue.hits + 1,
       last_seen = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP,
       normalized_url = excluded.normalized_url`,
    [String(rawPath).slice(0, 500), url, url]
  );
}

/* ========================== 提交通道 ========================== */

const BING_BATCH_MAX = 500;       // 必应单请求上限
const BING_DAILY_MAX = 10000;     // 必应每日提交上限
const INDEXNOW_BATCH_MAX = 10000; // IndexNow 单请求上限

const BING_JSON_BASE = 'https://ssl.bing.com/webmaster/api.svc/json';

/** 按 HTTP 状态码判定失败类型，retryable 为 false 表示不应重试 */
const classifyHttp = (status) => {
  if (status === 429) return { status: 'quota', retryable: true, message: '被限速（429），等待下个周期重试' };
  if (status === 403) return { status: 'retry', retryable: true, message: '鉴权失败（403），检查 API key 与站点归属' };
  if (status === 400 || status === 422) return { status: 'retry', retryable: true, message: `请求被拒绝（${status}），URL 或站点不匹配` };
  if (status >= 500) return { status: 'retry', retryable: true, message: `必应服务端错误（${status}）` };
  return { status: 'retry', retryable: true, message: `提交失败（HTTP ${status}）` };
};

/** 从必应返回的 Fault 结构中取出错误说明 */
const faultMessage = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  const fault = payload.d || payload;
  return String(
    fault.Message || fault.message || fault.ExceptionMessage || fault.ErrorMessage || ''
  ).slice(0, 300);
};

/**
 * 必应 Webmaster API：SubmitUrlBatch。
 * API key 按官方协议放在查询参数中。
 * @returns {Promise<{ok: boolean, status: string, retryable: boolean, httpStatus?: number, message: string}>}
 */
async function sendBing(urls, config, deps) {
  const plainKey = config.plainBingKey || deps.getPlainBingKey?.() || '';
  if (!plainKey) {
    return { ok: false, status: 'skipped', retryable: false, message: '未配置必应 API key' };
  }

  const api = deps.axios || axios;
  try {
    const response = await api.post(
      `${BING_JSON_BASE}/SubmitUrlbatch`,
      { siteUrl: config.siteUrl, urlList: urls },
      {
        params: { apikey: plainKey },
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        timeout: 20000,
        validateStatus: () => true
      }
    );

    const body = response.data;
    const fault = faultMessage(body);
    const httpOk = response.status >= 200 && response.status < 300;

    if (httpOk && !fault) {
      return { ok: true, status: 'success', retryable: false, httpStatus: response.status, message: '' };
    }
    if (httpOk && fault) {
      const isQuota = /quota|limit|exceed/i.test(fault);
      return {
        ok: false,
        status: isQuota ? 'quota' : 'retry',
        retryable: !isQuota,
        httpStatus: response.status,
        message: redact(fault)
      };
    }
    const verdict = classifyHttp(response.status);
    return { ...verdict, ok: false, httpStatus: response.status, message: redact(fault || verdict.message) };
  } catch (error) {
    const status = error?.response?.status;
    if (status) {
      const verdict = classifyHttp(status);
      return { ...verdict, ok: false, httpStatus: status };
    }
    return { ok: false, status: 'retry', retryable: true, message: redact(error?.code || error?.message || '网络异常') };
  }
}

/**
 * IndexNow 提交。key 文件由 index.cjs 托管在站点根目录，搜索引擎抓取后完成归属验证。
 * 站点需可公网访问，本地环境提交会返回 403。
 */
async function sendIndexNow(urls, config, deps) {
  const key = config.indexNowKey;
  if (!key) {
    return { ok: false, status: 'skipped', retryable: false, message: '未生成 IndexNow key' };
  }

  let host;
  try {
    host = new URL(config.siteUrl).host;
  } catch {
    return { ok: false, status: 'skipped', retryable: false, message: '站点 URL 不合法' };
  }

  const api = deps.axios || axios;
  try {
    const response = await api.post(
      'https://api.indexnow.org/indexnow',
      {
        host,
        key,
        keyLocation: `${config.siteUrl}/indexnow-key.txt`,
        urlList: urls
      },
      {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        timeout: 20000,
        validateStatus: () => true
      }
    );

    const status = response.status;
    if (status === 200 || status === 202) {
      return { ok: true, status: 'success', retryable: false, httpStatus: status, message: '' };
    }
    if (status === 429) {
      return { ok: false, status: 'quota', retryable: true, httpStatus: status, message: 'IndexNow 限速（429）' };
    }
    const hint =
      status === 403
        ? 'IndexNow key 文件校验失败（确认 /indexnow-key.txt 可访问）'
        : status === 422
          ? 'IndexNow 拒绝：URL host 与 key 文件不匹配'
          : `IndexNow 返回 HTTP ${status}`;
    return { ok: false, status: 'retry', retryable: status >= 500, httpStatus: status, message: hint };
  } catch (error) {
    return {
      ok: false,
      status: 'retry',
      retryable: true,
      message: redact(error?.code || error?.message || 'IndexNow 网络异常')
    };
  }
}

/**
 * 查询必应当日剩余额度。
 * @returns {Promise<{dailyQuota: number, monthlyQuota: number|null}|null>} null 表示查询不可用
 */
async function fetchBingQuota(config, deps) {
  const plainKey = config.plainBingKey || deps.getPlainBingKey?.() || '';
  if (!plainKey) return null;

  const api = deps.axios || axios;
  try {
    const response = await api.get(`${BING_JSON_BASE}/GetUrlSubmissionQuota`, {
      params: { siteUrl: config.siteUrl, apikey: plainKey },
      timeout: 15000,
      validateStatus: () => true
    });
    if (response.status < 200 || response.status >= 300) return null;
    const payload = response.data?.d ?? response.data;
    const dailyQuota = Number(payload?.DailyQuota);
    const monthlyQuota = Number(payload?.MonthlyQuota);
    if (!Number.isFinite(dailyQuota)) return null;
    return { dailyQuota, monthlyQuota: Number.isFinite(monthlyQuota) ? monthlyQuota : null };
  } catch {
    return null;
  }
}

/* ========================== 取待提交 URL ========================== */

/** 北京时间当天 00:00 对应的 UTC 时刻 */
const CN_DAY_START_SQL = "(date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')";

/** 取数窗口：最近 48 小时内有访问的 URL */
const SUBMIT_WINDOW_SQL = "CURRENT_TIMESTAMP - INTERVAL '48 hours'";

/**
 * 取出本轮待提交的 URL。
 *
 * 筛选条件：last_seen 在最近 48 小时内、hits ≥ minHits、近 4 天未成功提交过、
 * 近 4 天失败次数 < 5；结果按归一化 URL 去重。
 *
 * @returns {Promise<Array<{id: number, path: string, url: string, hits: number}>>}
 */
const selectPending = async (config, limit, deps = {}) => {
  const { rows } = await (deps.query || query)(
    `SELECT id, path, normalized_url, hits
       FROM seo_url_queue q
      WHERE q.dedupe_key IS NOT NULL AND q.dedupe_key != ''
        AND q.last_seen >= ${SUBMIT_WINDOW_SQL}
        AND q.hits >= $1
        AND NOT EXISTS (
          SELECT 1 FROM seo_submissions s WHERE s.url = q.normalized_url
            AND s.status = 'success' AND s.created_at > CURRENT_TIMESTAMP - INTERVAL '4 days'
        )
        AND (SELECT COUNT(*) FROM seo_submissions s WHERE s.url = q.normalized_url
               AND s.status != 'success' AND s.created_at > CURRENT_TIMESTAMP - INTERVAL '4 days') < 5
      ORDER BY q.last_seen DESC LIMIT $2`,
    [config.minHits, Math.max(limit * 3, 300)]
  );
  const seen = new Set();
  const picked = [];
  for (const row of rows) {
    const url = normalizeUrl(row.normalized_url, config.siteUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    picked.push({ id: row.id, path: row.path, url, hits: Number(row.hits) || 0 });
    if (picked.length >= limit) break;
  }
  return picked;
};

/** 今日成功提交的 URL 条数（按北京时间自然日） */
const countSubmittedToday = async (deps = {}) => {
  const { rows } = await (deps.query || query)(
    `SELECT COUNT(DISTINCT url)::int AS n FROM seo_submissions
      WHERE status = 'success' AND created_at >= ${CN_DAY_START_SQL}`
  );
  return Number(rows[0]?.n) || 0;
};

/** 待提交条数，筛选条件与 selectPending 一致 */
const countPending = async (config) => {
  const { rows } = await query(
    `SELECT COUNT(DISTINCT q.normalized_url)::int AS n FROM seo_url_queue q
      WHERE q.dedupe_key IS NOT NULL AND q.dedupe_key != ''
        AND q.last_seen >= ${SUBMIT_WINDOW_SQL}
        AND q.hits >= $1
        AND NOT EXISTS (
          SELECT 1 FROM seo_submissions s WHERE s.url = q.normalized_url
            AND s.status = 'success' AND s.created_at > CURRENT_TIMESTAMP - INTERVAL '4 days'
        )
        AND (SELECT COUNT(*) FROM seo_submissions s WHERE s.url = q.normalized_url
               AND s.status != 'success' AND s.created_at > CURRENT_TIMESTAMP - INTERVAL '4 days') < 5`,
    [Math.max(1, Number(config?.minHits) || 1)]
  );
  return Number(rows[0]?.n) || 0;
};

/** Persist the entire batch and its queue state in one atomic statement. */
const recordBatch = async (batch, result, channel, config, deps) => {
  const status = result.ok ? 'success' : result.status === 'skipped' ? 'skipped' : 'failed';
  await (deps.query || query)(
    `WITH recorded AS (
       INSERT INTO seo_submissions (url, queue_id, channel, status, http_status, message, batch_size, key_masked)
       SELECT item.url, item.id, $2, $3, $4, $5, $6, $7
         FROM jsonb_to_recordset($1::jsonb) AS item(id integer, url text)
       RETURNING queue_id
     )
     UPDATE seo_url_queue SET submit_status = 'submitted', updated_at = CURRENT_TIMESTAMP
      WHERE $3 = 'success' AND id IN (SELECT queue_id FROM recorded)`,
    [
      JSON.stringify(batch.map(({ id, url }) => ({ id, url }))),
      channel, status, Number.isFinite(result.httpStatus) ? result.httpStatus : null,
      redact(result.message || ''), batch.length,
      channel === 'bing' ? config.bingKeyMasked : maskKey(config.indexNowKey)
    ]
  );
};

/* ========================== 提交主流程 ========================== */

// A renewable database lease serializes manual and Cron invocations across isolates.
const RUN_LOCK_KEY = `${SETTING_PREFIX}submission_lock`;
const LOCK_ACTIVE_SQL = "updated_at > CURRENT_TIMESTAMP - INTERVAL '5 minutes'";

const acquireRunLock = async (token, sql) => {
  const result = await sql(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
       WHERE system_settings.updated_at <= CURRENT_TIMESTAMP - INTERVAL '5 minutes'
     RETURNING value`,
    [RUN_LOCK_KEY, token]
  );
  return result.rowCount > 0;
};

const renewRunLock = async (token, sql) => {
  const result = await sql(
    `UPDATE system_settings SET updated_at = CURRENT_TIMESTAMP
      WHERE key = $1 AND value = $2 AND ${LOCK_ACTIVE_SQL} RETURNING value`,
    [RUN_LOCK_KEY, token]
  );
  if (!result.rowCount) throw new Error('提交锁已过期，本轮已停止');
};

const isRunning = async () => {
  const { rows } = await query(`SELECT 1 FROM system_settings WHERE key = $1 AND ${LOCK_ACTIVE_SQL}`, [RUN_LOCK_KEY]);
  return rows.length > 0;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * 执行一轮提交。
 *
 * @param {object} [options]
 * @param {string} [options.source] 触发来源，仅用于日志
 * @param {number} [options.limit] 本轮最多提交条数，默认取配置的 dailyLimit
 * @param {object} [options.deps] 依赖注入 { axios, getPlainBingKey }，供测试使用
 * @returns {Promise<object>} 本轮汇总：queued / attempted / succeeded / failed / channels 等
 */
async function runSubmission(options = {}) {
  const deps = options.deps || {};
  const source = options.source || 'manual';

  const sql = deps.query || query;
  const token = crypto.randomBytes(16).toString('hex');
  if (!(await acquireRunLock(token, sql))) {
    return { skipped: true, busy: true, reason: '上一轮提交尚未结束' };
  }

  const startedAt = Date.now();
  const summary = {
    source,
    startedAt,
    queued: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    channels: [],
    batches: [],
    skipped: false,
    reason: '',
    remainingQuota: null
  };

  try {
    if (options.dailyDay && !(await claimRunDay(options.dailyDay, sql))) {
      return { skipped: true, reason: '今天已经执行过或已有更新的调度', day: options.dailyDay };
    }
    const config = options.config || await loadConfig(deps);
    summary.siteUrl = config.siteUrl;

    if (!config.enabled) {
      summary.skipped = true;
      summary.reason = '功能总开关已关闭';
      return summary;
    }

    const hasBing = config.bingEnabled && !!config.plainBingKey;
    const hasIndexNow = config.indexNowEnabled && !!config.indexNowKey;
    if (!hasBing && !hasIndexNow) {
      summary.skipped = true;
      summary.reason = '两条通道均不可用';
      return summary;
    }

    // 额度取「本轮上限」与「今日剩余」中的较小值
    const limit = Math.max(1, Math.floor(Number(options.limit) || config.dailyLimit));
    const submittedToday = await countSubmittedToday(deps);
    let budget = Math.min(limit, Math.max(0, config.dailyLimit - submittedToday));

    if (budget <= 0) {
      summary.skipped = true;
      summary.reason = `今日额度已用完（已提交 ${submittedToday} / 上限 ${config.dailyLimit}）`;
      return summary;
    }

    let bingRemaining = null;
    if (hasBing) {
      const quota = await fetchBingQuota(config, deps);
      summary.quota = quota;
      if (quota) {
        bingRemaining = Math.min(quota.dailyQuota, BING_DAILY_MAX);
        summary.remainingQuota = bingRemaining;
        if (bingRemaining <= 0 && !hasIndexNow) {
          summary.skipped = true;
          summary.reason = '必应今日额度为 0，且 IndexNow 不可用';
          return summary;
        }
      }
    }

    const pending = await selectPending(config, budget, deps);
    summary.queued = pending.length;
    if (!pending.length) {
      summary.skipped = true;
      summary.reason = '没有待提交的路径';
      return summary;
    }

    const batchSize = Math.min(config.batchSize, BING_BATCH_MAX);

    for (let offset = 0; offset < pending.length; offset += batchSize) {
      await renewRunLock(token, sql);
      const batch = pending.slice(offset, offset + batchSize);
      const urls = batch.map((item) => item.url);
      let result = null;
      let channel = '';

      // 必应有余量则走必应，否则退到 IndexNow
      const bingUsable = hasBing && (bingRemaining === null || bingRemaining > 0);
      if (bingUsable) {
        channel = 'bing';
        result = await sendBing(urls, config, deps);
        if (result.ok && bingRemaining !== null) {
          bingRemaining = Math.max(0, bingRemaining - urls.length);
          summary.remainingQuota = bingRemaining;
        }
        // 必应不可用时改用 IndexNow，而不是让整批失败
        if (!result.ok && hasIndexNow && (result.status === 'quota' || result.status === 'skipped')) {
          summary.channels.push({ channel: 'bing', status: result.status, message: result.message, size: urls.length });
          channel = 'indexnow';
          result = await sendIndexNow(urls, config, deps);
        }
      } else if (hasIndexNow) {
        channel = 'indexnow';
        result = await sendIndexNow(urls, config, deps);
      } else {
        result = { ok: false, status: 'skipped', message: '没有可用通道' };
        channel = 'none';
      }

      summary.attempted += batch.length;
      if (result.ok) summary.succeeded += batch.length;
      else summary.failed += batch.length;

      summary.channels.push({
        channel,
        status: result.status,
        httpStatus: result.httpStatus || null,
        message: result.message || '',
        size: urls.length
      });

      await renewRunLock(token, sql);
      await recordBatch(batch, result, channel, config, deps);

      // 不可重试的错误继续跑只会刷满失败计数，直接结束本轮
      if (!result.ok && !result.retryable) {
        summary.reason = result.message || '通道不可用，已中止本轮';
        break;
      }
      if (!result.ok && result.status === 'quota' && !hasIndexNow) {
        summary.reason = '额度耗尽，已中止本轮';
        break;
      }

      if (offset + batchSize < pending.length) await sleep(config.requestDelayMs);
    }

    summary.elapsedMs = Date.now() - startedAt;
    pushLiveLog('info', `[seo] 提交完成：成功 ${summary.succeeded} / 尝试 ${summary.attempted}`, {
      kind: 'seo',
      source,
      succeeded: summary.succeeded,
      failed: summary.failed
    });
    return summary;
  } catch (error) {
    summary.error = redact(error?.message || error);
    pushLiveLog('error', `[seo] 提交异常：${summary.error}`, { kind: 'seo', source });
    return summary;
  } finally {
    await sql('DELETE FROM system_settings WHERE key = $1 AND value = $2', [RUN_LOCK_KEY, token]);
  }
}

/* ========================== 定时任务 ========================== */

/** Controller timestamps, not isolate lifetime, determine the Beijing schedule. */
const beijingTime = (timestamp) => {
  const shifted = new Date(timestamp + 8 * 3600 * 1000);
  return { day: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
};

const readLastRunDay = async (sql = query) => {
  const { rows } = await sql('SELECT value FROM system_settings WHERE key = $1', [`${SETTING_PREFIX}last_run_day`]);
  return String(rows[0]?.value || '');
};

// ISO dates sort chronologically. Never let a duplicate or late tick move the claim backwards.
const claimRunDay = async (day, sql) => {
  const result = await sql(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
       WHERE COALESCE(system_settings.value, '') < excluded.value
     RETURNING value`,
    [`${SETTING_PREFIX}last_run_day`, day]
  );
  return result.rowCount > 0;
};

/**
 * Cloudflare scheduled() invokes and awaits this function. The durable day claim is
 * made before outbound submission, and is retained even when a channel fails.
 * A delayed event from an earlier Beijing day must not submit today's queue.
 */
async function runDailyTick({ scheduledTime = Date.now(), deps = {} } = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const timestamp = Number(scheduledTime);
  if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) {
    return { skipped: true, reason: '无效的调度时间' };
  }
  const shiftedTimestamp = timestamp + 8 * 3600 * 1000;
  if (!Number.isFinite(new Date(shiftedTimestamp).getTime())) {
    return { skipped: true, reason: '无效的调度时间' };
  }
  const { day, hour } = beijingTime(timestamp);
  if (day !== beijingTime(now).day || timestamp > now) {
    return { skipped: true, reason: '调度事件已过期或尚未到期', day };
  }
  const config = await loadConfig(deps);
  if (!config.enabled || !config.autoSubmit) {
    return { skipped: true, reason: config.enabled ? '自动提交已关闭' : '功能总开关已关闭', day };
  }
  if (hour < config.submitHour) {
    return { skipped: true, reason: `未到 ${String(config.submitHour).padStart(2, '0')}:00`, day };
  }

  const summary = await runSubmission({ source: 'scheduler', dailyDay: day, config, deps });
  pushLiveLog(
    'info',
    `[seo] ${day} 定时提交：成功 ${summary.succeeded || 0} / 尝试 ${summary.attempted || 0}${summary.reason ? `（${summary.reason}）` : ''}`,
    { kind: 'seo', source: 'scheduler', day }
  );
  return { ...summary, day };
}

/** 供后台面板展示的执行状态 */
const schedulerState = async (config) => {
  const { day, hour } = beijingTime(Date.now());
  const runDay = await readLastRunDay();
  const nextDay = runDay >= day ? '明天' : '今天';
  return {
    lastRunDay: runDay || null,
    ranToday: runDay === day,
    currentBeijingDay: day,
    currentBeijingHour: hour,
    nextRunText: `${nextDay} ${String(config.submitHour).padStart(2, '0')}:00（北京时间）`
  };
};

module.exports = {
  BING_BATCH_MAX,
  BING_DAILY_MAX,
  INDEXNOW_BATCH_MAX,
  loadConfig,
  saveSettings,
  maskKey,
  normalizeUrl,
  enqueuePath,
  selectPending,
  countPending,
  fetchBingQuota,
  runSubmission,
  runDailyTick,
  schedulerState,
  isRunning
};
