/*
 * 出站 HTTP(S) 请求的统一配置：连接池、超时与体积限制。
 */
const http = require('http');
const https = require('https');

/** 只接受正数，其它（空值 / 0 / NaN / 负数）一律退回默认值 */
const positive = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const positiveInt = (value, fallback) => Math.floor(positive(value, fallback));

// —— 连接池 ——
const UPSTREAM_MAX_SOCKETS = positiveInt(process.env.UPSTREAM_MAX_SOCKETS, 32);
const UPSTREAM_MAX_FREE_SOCKETS = positiveInt(process.env.UPSTREAM_MAX_FREE_SOCKETS, 8);
const UPSTREAM_KEEPALIVE_MS = positive(process.env.UPSTREAM_KEEPALIVE_MS, 15000);

/*
 * 【临时应急】上游 HTTPS 证书过期 / 不受信时的开关：设为 1 则出站不再校验证书有效性。
 * 正常务必保持关闭 —— 关掉校验等于给所有上游请求开了中间人后门，只能等上游修复期间顶一阵，
 * 上游续签证书后把 .env 里的 UPSTREAM_TLS_INSECURE 删掉（或设 0）即可恢复。
 */
const UPSTREAM_TLS_INSECURE = /^(1|true|yes)$/i.test(String(process.env.UPSTREAM_TLS_INSECURE || '').trim());

// —— 超时 ——
/** 建连 + 等响应头（axios 的 timeout 只管到这里） */
const UPSTREAM_TIMEOUT_MS = positive(process.env.UPSTREAM_TIMEOUT_MS, 15000);
/** 兜底超时：只对没写 timeout 的 axios 请求生效 */
const AXIOS_DEFAULT_TIMEOUT_MS = positive(process.env.AXIOS_DEFAULT_TIMEOUT_MS, UPSTREAM_TIMEOUT_MS);
/** 非流式响应体积上限 */
const AXIOS_DEFAULT_MAX_CONTENT_LENGTH = positive(
  process.env.AXIOS_DEFAULT_MAX_CONTENT_LENGTH,
  32 * 1024 * 1024
);

const createAgent = (Agent) =>
  new Agent({
    keepAlive: true,
    keepAliveMsecs: UPSTREAM_KEEPALIVE_MS,
    maxSockets: UPSTREAM_MAX_SOCKETS,
    maxFreeSockets: UPSTREAM_MAX_FREE_SOCKETS,
    // 空闲的复用连接超过这个时间就关掉，别让对端和本地一直占着 socket
    timeout: UPSTREAM_KEEPALIVE_MS,
    // 仅在应急开关打开时关闭证书校验（见 UPSTREAM_TLS_INSECURE 注释）
    ...(UPSTREAM_TLS_INSECURE ? { rejectUnauthorized: false } : {})
  });

const httpAgent = createAgent(http.Agent);
const httpsAgent = createAgent(https.Agent);

if (UPSTREAM_TLS_INSECURE) {
  console.warn('[security] UPSTREAM_TLS_INSECURE=1：已关闭上游 HTTPS 证书校验');
}

/** 给 axios 补默认值；调用点显式传的 timeout / agent 优先级更高 */
const applyAxiosDefaults = (axios) => {
  const instance = axios || require('axios');
  instance.defaults.timeout = AXIOS_DEFAULT_TIMEOUT_MS;
  instance.defaults.maxContentLength = AXIOS_DEFAULT_MAX_CONTENT_LENGTH;
  instance.defaults.httpAgent = httpAgent;
  instance.defaults.httpsAgent = httpsAgent;
  return instance;
};

module.exports = { applyAxiosDefaults };
