// 应用截图同源代理
const express = require('express');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { SCREENSHOT_PROXY_DISABLED, isAllowedScreenshotUrl, getScreenshot } = require('../lib/screenshot.cjs');

const router = express.Router();

router.get('/api/screenshot', async (req, res) => {
  if (SCREENSHOT_PROXY_DISABLED()) {
    return res.status(403).type('text/plain').send('screenshot proxy disabled');
  }

  const raw = typeof req.query.url === 'string' ? req.query.url : '';
  if (!raw) return res.status(400).type('text/plain').send('url is required');
  if (!isAllowedScreenshotUrl(raw)) return res.status(403).type('text/plain').send('url not allowed');

  try {
    const { response, cacheHit } = await getScreenshot(raw);
    res.setHeader('X-Cache', cacheHit ? 'HIT' : 'MISS');
    for (const [key, value] of response.headers) res.setHeader(key, value);
    if (req.method === 'HEAD') {
      await response.body?.cancel();
      return res.end();
    }
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    console.warn('[screenshot proxy]', error.message, raw);
    if (!res.headersSent && !res.destroyed) {
      return res.status(502).type('text/plain').send('screenshot fetch failed');
    }
  }
});
module.exports = router;
