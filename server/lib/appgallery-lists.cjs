/*
 * 华为应用市场的应用列表（鸿蒙客户端接口，不鉴权）：
 *   - 发现更多：客户端搜索页（hotsearch）里「发现更多」卡片下的热门应用；
 *   - 搜索：客户端搜索结果页（searchApp），关键词放在 businessParam.keyword。
 * 第 2 页起走 client.getCardList，必须带上一页下发的 cookie（搜索还要再带一次关键词），
 * 否则返回空页或重复第 1 页。
 */
const { callClient, text, array, cardKind } = require('./appgallery-client.cjs');

// 搜索和「发现更多」都按平板取：和应用市场平板版展示的一致
const DEVICE = 'tablet';
const PAGE_SIZE = 25;
const DISCOVER_MAX_PAGES = 5;
// 3 页以后基本是不相关的推荐，翻得越多越慢
const SEARCH_MAX_PAGES = 3;
const DISCOVER_TTL_MS = 10 * 60 * 1000;
const SEARCH_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 200;
const SEARCH_MAX_IN_FLIGHT = 8;
const KEYWORD_MAX_LENGTH = 50;
const APP_CARD = 'normalcard.search';
const SECTION_CARD = 'subheadercard.search';
const DISCOVER_TITLE = '发现更多';

let discover = null;
let discoverRequest = null;
const searchCache = new Map();
const searchInFlight = new Map();

/** 列表条目 -> 前端用的 snake_case；卓易通代装的安卓应用（externalAppInfo）不是鸿蒙应用，丢掉 */
function addApp(apps, row) {
  const id = text(row?.appId);
  if (!/^C\d+$/.test(id) || apps.has(id) || row?.externalAppInfo?.multiPathType) return;
  const icon = text(row.icon);
  const size = Number(row.fullSize);
  apps.set(id, {
    app_id: id,
    name: text(row.name),
    pkg_name: text(row.packageName),
    icon_url: /^https:\/\//i.test(icon) ? icon : '',
    brief_desc: text(row.memo),
    kind_name: text(row.tagName),
    version: text(row.version),
    download_count_desc: text(row.downCountDesc),
    size_bytes: Number.isFinite(size) && size > 0 ? size : 0
  });
}

/** 按页取一个客户端卡片列表页；visit(cards) 返回 false 时提前停止 */
async function walkPages(firstPage, maxPages, extra, visit, signal) {
  const call = (method, params) => callClient(method, params, { device: DEVICE, signal });
  const page = await call('client.getPageDetail', { ...firstPage, pageNum: 1, pageSize: PAGE_SIZE, ...extra });
  let cardList = array(page.pages).find((item) => item?.data?.cardlist)?.data.cardlist;
  if (!Array.isArray(cardList?.layoutData)) throw new Error(`AppGallery ${firstPage.pageId} page is invalid`);

  const dataId = text(cardList.dataId);
  let cookies = array(page.setCookie);
  if (visit(cardList.layoutData) === false) return;
  for (let pageNum = 2; pageNum <= maxPages && Number(cardList.hasMore) > 0 && dataId; pageNum++) {
    const cookie = cookies.map((value) => text(value).split(';')[0]).filter(Boolean).join('; ');
    cardList = await call('client.getCardList', { dataId, pageNum, pageSize: PAGE_SIZE, cookie, ...extra });
    if (!Array.isArray(cardList.layoutData)) throw new Error(`AppGallery ${firstPage.pageId} card page is invalid`);
    if (Array.isArray(cardList.setCookie)) cookies = cardList.setCookie;
    if (visit(cardList.layoutData) === false) return;
  }
}

async function loadDiscoverApps() {
  const apps = new Map();
  let inSection = false;
  let sectionEnded = false;
  await walkPages({ pageId: 'hotsearch' }, DISCOVER_MAX_PAGES, {}, (cards) => {
    for (const card of cards) {
      const kind = cardKind(card);
      if (kind === SECTION_CARD) {
        if (inSection) sectionEnded = true;
        inSection = text(card.title || card.data?.[0]?.title) === DISCOVER_TITLE;
        if (sectionEnded) return false;
      } else if (inSection && kind === APP_CARD) {
        for (const row of array(card.data)) addApp(apps, row);
      }
    }
    return true;
  }, AbortSignal.timeout(20_000));
  if (!apps.size) throw new Error('AppGallery 发现更多 lists no apps');
  return Array.from(apps.values());
}

async function getAppGalleryDiscoverApps() {
  if (discover?.expiresAt > Date.now()) return discover.apps;
  discoverRequest ||= loadDiscoverApps().then((apps) => {
    discover = { apps, expiresAt: Date.now() + DISCOVER_TTL_MS };
    return apps;
  }).finally(() => {
    discoverRequest = null;
  });
  return discoverRequest;
}

async function loadSearch(keyword) {
  const apps = new Map();
  await walkPages(
    { pageId: 'searchApp' },
    SEARCH_MAX_PAGES,
    { businessParam: { keyword: encodeURIComponent(keyword) } },
    (cards) => {
      for (const card of cards) {
        if (cardKind(card) === APP_CARD) for (const row of array(card.data)) addApp(apps, row);
      }
      return true;
    },
    AbortSignal.timeout(20_000)
  );
  return Array.from(apps.values());
}

/** 搜索应用；keyword 为空或过长返回 null */
async function searchAppGallery(rawKeyword) {
  const keyword = typeof rawKeyword === 'string' ? rawKeyword.trim() : '';
  if (!keyword || keyword.length > KEYWORD_MAX_LENGTH) return null;

  const cached = searchCache.get(keyword);
  if (cached?.expiresAt > Date.now()) return cached.apps;
  searchCache.delete(keyword);
  if (searchInFlight.has(keyword)) return searchInFlight.get(keyword);
  if (searchInFlight.size >= SEARCH_MAX_IN_FLIGHT) throw new Error('Too many AppGallery search requests');

  const request = loadSearch(keyword).then((apps) => {
    if (searchCache.size >= SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
    searchCache.set(keyword, { apps, expiresAt: Date.now() + SEARCH_TTL_MS });
    return apps;
  }).finally(() => searchInFlight.delete(keyword));
  searchInFlight.set(keyword, request);
  return request;
}

module.exports = { getAppGalleryDiscoverApps, searchAppGallery };
