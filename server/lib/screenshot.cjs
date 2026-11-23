/*
 * Whitelisted screenshot proxy: no redirects, an eight-second deadline, a
 * six-MiB decoded-body limit, and image magic validation before Cache API writes.
 * Cached bodies belong to Cloudflare, never to a cross-request module Map.
 */
const { bindings, defer } = require('./runtime.cjs');
const SCREENSHOT_PROXY_DISABLED = () => String(bindings().SCREENSHOT_PROXY || '').toLowerCase() === 'off';
const SCREENSHOT_MAX_BYTES = 6 * 1024 * 1024;
const SCREENSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCREENSHOT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SCREENSHOT_URL_RE = /^https:\/\/([a-z0-9-]+\.)*dbankcdn\.com\/application\/screenshut[A-Za-z0-9]*\/[A-Za-z0-9._/-]*\.(jpe?g|png|webp)$/i;


const isAllowedScreenshotUrl = (raw) => {
  if (!SCREENSHOT_URL_RE.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.dbankcdn.com');
  } catch {
    return false;
  }
};

const sniffImageType = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && /^(GIF87a|GIF89a)$/.test(buffer.toString('ascii', 0, 6))) return 'image/gif';
  return null;
};

async function fetchScreenshot(raw) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let reader;
  try {
    const upstream = await fetch(raw, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': SCREENSHOT_UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (upstream.status !== 200 || !upstream.body) {
      await upstream.body?.cancel();
      throw new Error(`unexpected screenshot status: ${upstream.status}`);
    }
    const length = upstream.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > SCREENSHOT_MAX_BYTES)) {
      await upstream.body.cancel();
      throw new Error('screenshot exceeds size limit');
    }
    reader = upstream.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SCREENSHOT_MAX_BYTES) {
        await reader.cancel();
        throw new Error('screenshot exceeds size limit');
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
    const buffer = Buffer.concat(chunks, size);
    const contentType = sniffImageType(buffer);
    if (!contentType) throw new Error('upstream response is not an image');
    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Cache-Control': `public, max-age=${SCREENSHOT_TTL_MS / 1000}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } finally {
    clearTimeout(timeout);
    reader?.releaseLock();
  }
}

async function getScreenshot(raw) {
  if (!isAllowedScreenshotUrl(raw)) throw new Error('screenshot URL not allowed');
  const key = new Request(raw);
  const cache = caches.default;
  let response = await cache.match(key);
  const cacheHit = !!response;
  if (!response) {
    response = await fetchScreenshot(raw);
    defer(cache.put(key, response.clone()));
  }
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'public, max-age=86400');
  return { response: new Response(response.body, { headers }), cacheHit };
}

module.exports = { SCREENSHOT_PROXY_DISABLED, isAllowedScreenshotUrl, getScreenshot };
