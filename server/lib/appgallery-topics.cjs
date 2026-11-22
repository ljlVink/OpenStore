const { randomBytes } = require('node:crypto');
const axios = require('axios');

const gallery = axios.create({
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

const HEADER_CARDS = new Set([
  'subjectappbigcard.landing', 'scenariolistcard.landing',
  'whiteverticalslidercard.landing', 'appiconrollingcard.landing', 'articletitlecard'
]);
const APP_CARDS = new Set(['verticallistcard', 'singleappcard', 'substancebottomappcard', 'hosthiddenappcard']);
const MAX_PAGES = 20;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;
const MAX_IN_FLIGHT = 16;
const cache = new Map();
const inFlight = new Map();

const text = (value) => typeof value === 'string' ? value.trim() : '';
const array = (value) => Array.isArray(value) ? value : [];
const cardKind = (card) => text(card?.type).split('appgallery.').pop();

function addApp(apps, row) {
  const id = text(row?.appId);
  if (!/^C\d+$/.test(id)) return;
  const previous = apps.get(id);
  const icon = text(row.icon);
  apps.set(id, {
    app_id: id,
    name: previous?.name || text(row.name),
    pkg_name: previous?.pkg_name || text(row.packageName),
    icon_url: previous?.icon_url || (/^https:\/\//i.test(icon) ? icon : '')
  });
}

function parseCards(cards, topic, apps) {
  for (const card of cards) {
    const kind = cardKind(card);
    const header = HEADER_CARDS.has(kind);
    for (const row of array(card?.data)) {
      if (header) {
        topic.title ||= text(row?.title) || (kind === 'articletitlecard' ? text(row?.mainText) : '');
        topic.subtitle ||= text(row?.subTitle);
      }
      if (kind === 'paragraphtextcard') topic.description ||= text(row?.mainText);
      if (!header && !APP_CARDS.has(kind)) continue;

      addApp(apps, row);
      addApp(apps, row?.refs_app);
      for (const ref of array(row?.refsList_app)) addApp(apps, ref);
      for (const ref of array(row?.refsList_app_short)) addApp(apps, ref);
      for (const item of array(row?.list)) addApp(apps, item?.refs_app || item);
    }
  }
}

async function loadTopic(id) {
  const signal = AbortSignal.timeout(12_000);
  const identity = { 'Identity-Id': randomBytes(16).toString('hex') };
  const { data: interfaceCode } = await gallery.get('/webedge/getInterfaceCode', { headers: identity, signal });
  if (!text(interfaceCode)) throw new Error('AppGallery did not issue an interface code');

  const post = async (path, body) => {
    const { data } = await gallery.post(path, body, {
      headers: { ...identity, 'Interface-Code': `${interfaceCode}_${Date.now()}` },
      signal
    });
    if (String(data?.rtnCode) !== '0') throw new Error(`AppGallery ${path} rejected the request`);
    return data;
  };

  const response = await post('/harmony/page-detail', {
    pageId: `webAgSubstanceDetail|${id}`, pageNum: 1, pageSize: 100,
    clientPackage: 'com.huawei.hmsapp.appgallery', accountZone: 'CN', zone: '', locale: 'zh',
    businessParam: { animation: 0 }
  });
  const page = array(response.pages).find((item) => cardKind(item) === 'substancedetailpage');
  if (!page) throw new Error('AppGallery returned an unexpected topic page');
  let cardList = page.data?.cardlist;
  // Removed topics can return rtnCode=0 and a page shell, but no card list.
  if (!cardList) return null;
  if (!Array.isArray(cardList.layoutData)) throw new Error('AppGallery returned an invalid topic card list');

  const topic = { substance_id: id, title: '', subtitle: '', description: '' };
  const apps = new Map();
  parseCards(cardList.layoutData, topic, apps);
  const dataId = text(cardList.dataId);
  for (let pageNum = 2; Number(cardList.hasMore) > 0; pageNum++) {
    if (!dataId || pageNum > MAX_PAGES) throw new Error('AppGallery topic pagination did not terminate');
    cardList = await post('/harmony/card-list', { dataId, locale: 'zh', pageNum, pageSize: 25 });
    if (!Array.isArray(cardList.layoutData)) throw new Error('AppGallery returned an invalid topic card page');
    parseCards(cardList.layoutData, topic, apps);
  }
  topic.title ||= text(page.data?.extraData?.shareInfo?.title);
  if (!topic.title) throw new Error('AppGallery topic has no title');
  return {
    ...topic,
    apps: Array.from(apps.values(), (app) => ({ ...app, name: app.name || app.pkg_name || app.app_id }))
  };
}

async function getAppGalleryTopic(id) {
  if (typeof id !== 'string' || !/^[a-z0-9_-]{1,96}$/i.test(id)) return null;
  const cached = cache.get(id);
  if (cached?.expiresAt > Date.now()) return cached.topic;
  cache.delete(id);
  if (inFlight.has(id)) return inFlight.get(id);
  if (inFlight.size >= MAX_IN_FLIGHT) throw new Error('Too many AppGallery topic requests');

  const request = loadTopic(id).then((topic) => {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(id, { topic, expiresAt: Date.now() + CACHE_TTL_MS });
    return topic;
  }).finally(() => inFlight.delete(id));
  inFlight.set(id, request);
  return request;
}

module.exports = { getAppGalleryTopic };
