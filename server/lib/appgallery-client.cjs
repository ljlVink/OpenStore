/*
 * 华为应用市场的两类匿名接口，专题和应用详情共用：
 *   - 网页版（appgallery.huawei.com 背后的 edge 接口）：先领 interface code，再带着它请求；
 *   - 鸿蒙客户端接口：不鉴权，只需要一份像样的设备信息。
 * 都是未公开的消费端接口，调用方负责缓存。
 */
const { createHash, createHmac, randomBytes } = require('node:crypto');
const axios = require('axios');
const { bindings } = require('./runtime.cjs');

const web = axios.create({
  baseURL: 'https://web-drcn.hispace.dbankcloud.com/edge',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Phone;OpenHarmony 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 ArkWeb/6.0.0.42 Mobile',
    Origin: 'https://appgallery.huawei.com',
    Referer: 'https://appgallery.huawei.com/'
  },
  // 经 ESA 中继是 Cloudflare → 国内 → 华为两段跨境，单次偶尔超过 5 秒；总时长由调用方的 AbortSignal 控制
  timeout: 15000,
  maxRedirects: 0,
  maxContentLength: 2 * 1024 * 1024
});

/*
 * 华为云 WAF 会拦 Cloudflare Worker 的出口（501），配置了 APPGALLERY_RELAY_URL 时网页版接口改走阿里云 ESA 中继。
 * 签名格式与 relay/esa/index.js 保持一致：
 *   canonical = "openstore-relay-v1\n<ts>\n<METHOD>\n<host><path><?query>\n<hex(SHA-256(body))>"
 */
function routeThroughRelay(config, env, now = Date.now()) {
  const relay = text(env?.APPGALLERY_RELAY_URL);
  if (!relay) return config;
  const secret = text(env.APPGALLERY_RELAY_SECRET);
  if (!secret) throw new Error('APPGALLERY_RELAY_SECRET is required when APPGALLERY_RELAY_URL is set');

  const target = new URL(axios.getUri(config));
  const method = String(config.method || 'get').toUpperCase();
  const body = config.data === undefined ? '' : typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
  const timestamp = String(Math.floor(now / 1000));
  const upstream = `${target.host}${target.pathname}${target.search}`;
  const canonical = ['openstore-relay-v1', timestamp, method, upstream, createHash('sha256').update(body).digest('hex')].join('\n');

  config.url = `${new URL(relay).origin}/${upstream}`;
  config.baseURL = undefined;
  config.params = undefined;
  if (body) {
    // 签的是这份字符串；JSON Content-Type 下 axios 会原样发送
    config.data = body;
    config.headers.set('Content-Type', 'application/json');
  }
  config.headers.set('X-Relay-Timestamp', timestamp);
  config.headers.set('X-Relay-Signature', createHmac('sha256', secret).update(canonical).digest('hex'));
  return config;
}

web.interceptors.request.use((config) => routeThroughRelay(config, bindings()));

const store = axios.create({
  baseURL: 'https://store-drcn.hispace.dbankcloud.com/hwmarket/harmony',
  headers: { 'Content-Type': 'application/json' },
  // Cloudflare 到 store-drcn 跨境，700 KB 的首页偶尔要 6 秒以上；总时长由调用方的 AbortSignal 控制
  timeout: 15000,
  maxRedirects: 0,
  maxContentLength: 4 * 1024 * 1024
});

const text = (value) => typeof value === 'string' ? value.trim() : '';
const array = (value) => Array.isArray(value) ? value : [];
const cardKind = (card) => text(card?.type).split('appgallery.').pop();

function expectOk(data, label) {
  if (String(data?.rtnCode) !== '0') throw new Error(`AppGallery ${label} rejected the request`);
  return data;
}

/** 领一个匿名身份，返回在该身份下 POST 网页版接口的函数（原样返回响应体） */
async function openWebSession(signal) {
  const identity = { 'Identity-Id': randomBytes(16).toString('hex') };
  const { data: interfaceCode } = await web.get('/webedge/getInterfaceCode', { headers: identity, signal });
  if (!text(interfaceCode)) throw new Error('AppGallery did not issue an interface code');
  return async (path, body) => {
    const { data } = await web.post(path, body, {
      headers: { ...identity, 'Interface-Code': `${interfaceCode}_${Date.now()}` },
      signal
    });
    return data;
  };
}

const clientBody = (device) => ({
  harmonyDeviceType: device,
  serviceType: 80,
  phoneType: 'SCA-AL00',
  clientPackage: 'com.huawei.hmsapp.appgallery',
  clientVersion: '7.7.1',
  clientVersionCode: '1470701300',
  accountZone: 'CN',
  locale: 'zh_Hans',
  // The real client sends '*' when anonymous; omitting it yields a different, generic feed.
  deviceId: '*',
  harmonyInfo: {
    harmonyApiLevel: 24,
    harmonyReleaseType: 'Release',
    hmosApiLevel: 60101,
    hmosReleaseType: 'Release',
    arkSupport: 1,
    arkMinVersion: 2,
    arkMaxVersion: 402653184,
    harmonyDeviceType: device
  }
});

/** 调鸿蒙客户端接口；rtnCode 不为 0 时抛错 */
async function callClient(method, params, { device = 'phone', signal } = {}) {
  const { data } = await store.post('/client', { ...clientBody(device), ...params }, { params: { method }, signal });
  return expectOk(data, method);
}

module.exports = { openWebSession, callClient, expectOk, text, array, cardKind, routeThroughRelay };
