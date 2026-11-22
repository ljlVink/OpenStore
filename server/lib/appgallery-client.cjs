/*
 * 华为应用市场的两类匿名接口，专题和应用详情共用：
 *   - 网页版（appgallery.huawei.com 背后的 edge 接口）：先领 interface code，再带着它请求；
 *   - 鸿蒙客户端接口：不鉴权，只需要一份像样的设备信息。
 * 都是未公开的消费端接口，调用方负责缓存。
 */
const { randomBytes } = require('node:crypto');
const axios = require('axios');

const web = axios.create({
  baseURL: 'https://web-drcn.hispace.dbankcloud.com/edge',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Phone;OpenHarmony 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 ArkWeb/6.0.0.42 Mobile',
    Origin: 'https://appgallery.huawei.com',
    Referer: 'https://appgallery.huawei.com/'
  },
  timeout: 5000,
  maxRedirects: 0,
  maxContentLength: 2 * 1024 * 1024
});

const store = axios.create({
  baseURL: 'https://store-drcn.hispace.dbankcloud.com/hwmarket/harmony',
  headers: { 'Content-Type': 'application/json' },
  timeout: 5000,
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

module.exports = { openWebSession, callClient, expectOk, text, array, cardKind };
