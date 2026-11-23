/*
 * OpenStore 上游中继，部署为阿里云 ESA 边缘函数。
 * 华为云 WAF 会拦 Cloudflare Worker 的出口（返回 501），被拦的上游请求由 Worker 签名后发到这里转发。
 *
 * 请求：<METHOD> https://<中继域名>/<上游 host>/<上游 path>?<query>
 * 认证：X-Relay-Timestamp: Unix 秒
 *       X-Relay-Signature: hex(HMAC-SHA256(RELAY_SECRET, canonical))
 *       canonical = "openstore-relay-v1\n<ts>\n<METHOD>\n<host><path><?query>\n<hex(SHA-256(body))>"
 * 时间戳与边缘时钟相差超过 60 秒即拒绝；只转发白名单里的上游 host + 路径前缀，以及白名单请求头。
 * Worker 侧的签名实现在 server/lib/appgallery-client.cjs（routeThroughRelay），两边格式必须一致。
 */
const SIGNATURE_VERSION = 'openstore-relay-v1';
const MAX_SKEW_SECONDS = 60;
const MAX_BODY_BYTES = 1024 * 1024;
// 上游 host → 允许的路径前缀
const UPSTREAMS = new Map([['web-drcn.hispace.dbankcloud.com', '/edge/']]);
const FORWARD_HEADERS = ['accept', 'content-type', 'user-agent', 'origin', 'referer', 'identity-id', 'interface-code'];

const encoder = new TextEncoder();
const toHex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
const fromHex = (value) => /^[0-9a-f]{64}$/.test(value)
  ? Uint8Array.from(value.match(/../g), (pair) => parseInt(pair, 16))
  : null;

const reject = (status, reason) => new Response(`relay: ${reason}`, {
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'x-relay-error': reason }
});

export async function handleRelay(request, secret, now = Date.now()) {
  if (!secret) return reject(500, 'secret not configured');
  const method = request.method;
  if (method !== 'GET' && method !== 'POST') return reject(405, 'method not allowed');

  const url = new URL(request.url);
  const split = url.pathname.indexOf('/', 1);
  const host = split > 0 ? url.pathname.slice(1, split) : '';
  const path = split > 0 ? url.pathname.slice(split) : '';
  const prefix = UPSTREAMS.get(host);
  if (!prefix || !path.startsWith(prefix)) return reject(403, 'upstream not allowed');

  const timestamp = request.headers.get('x-relay-timestamp') || '';
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return reject(401, 'stale timestamp');
  }
  const signature = fromHex((request.headers.get('x-relay-signature') || '').toLowerCase());
  if (!signature) return reject(401, 'bad signature');
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return reject(413, 'body too large');

  const body = method === 'POST' ? new Uint8Array(await request.arrayBuffer()) : new Uint8Array(0);
  if (body.byteLength > MAX_BODY_BYTES) return reject(413, 'body too large');

  const canonical = [
    SIGNATURE_VERSION,
    timestamp,
    method,
    `${host}${path}${url.search}`,
    toHex(await crypto.subtle.digest('SHA-256', body))
  ].join('\n');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  // subtle.verify 做常量时间比较
  if (!(await crypto.subtle.verify('HMAC', key, signature, encoder.encode(canonical)))) {
    return reject(401, 'bad signature');
  }

  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  let upstream;
  try {
    upstream = await fetch(`https://${host}${path}${url.search}`, {
      method,
      headers,
      body: method === 'POST' ? body : undefined,
      redirect: 'manual'
    });
  } catch {
    return reject(502, 'upstream fetch failed');
  }
  // 只回传正文类型，上游的 Set-Cookie、编码等头不透传
  const responseHeaders = new Headers();
  const type = upstream.headers.get('content-type');
  if (type) responseHeaders.set('content-type', type);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export default {
  fetch(request, _context, env) {
    return handleRelay(request, env?.RELAY_SECRET);
  }
};
