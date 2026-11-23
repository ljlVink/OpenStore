/*
 * 华为应用市场的鸿蒙客户端接口（与真机应用市场相同）：不鉴权，只需要一份像样的设备信息。
 * 网页版 web-drcn 接口会被华为云 WAF 拦掉 Cloudflare 出口（501），这里不再使用。
 * 都是未公开的消费端接口，调用方负责缓存。
 */
const axios = require('axios');

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
  if (String(data?.rtnCode) !== '0') {
    throw Object.assign(new Error(`AppGallery ${label} rejected the request`), { rtnCode: data?.rtnCode });
  }
  return data;
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

module.exports = { callClient, text, array, cardKind };
