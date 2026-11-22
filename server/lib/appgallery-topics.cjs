const { openWebSession, callClient, expectOk, text, array, cardKind } = require('./appgallery-client.cjs');

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

// 探索页按平板版取：和应用市场平板首页的栏目、卡片一一对应
const EXPLORE_DEVICE = 'tablet';
const EXPLORE_TTL_MS = 10 * 60 * 1000;
const TOPIC_DETAIL_ID = /^substancedetail\|([a-z0-9_-]{1,96})(?:\?|$)/i;
// 列表卡没有 detailId，专题 id 只在分享链接里（.../substance/detail?id=xxx）
const TOPIC_SHARE_ID = /[?&]id=([a-z0-9_-]{1,96})(?:&|$)/i;
// 华为卡片类型 -> 前端展示形态：story 大图卡、list 应用榜单、icons 图标墙
const EXPLORE_CARD_KINDS = {
  'subjectappbigcard.extenal': 'story',
  scenariolistcard: 'story',
  'whiteverticalslidercard.recomend': 'list',
  'appiconrollingcard.extenal': 'icons'
};
const EXPLORE_APP_LIMIT = { story: 4, list: 5, icons: 12 };
let explore = null;
let exploreRequest = null;

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
  const webPost = await openWebSession(signal);
  const post = async (path, body) => expectOk(await webPost(path, body), path);

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

const topicIdOf = (item) =>
  TOPIC_DETAIL_ID.exec(text(item?.detailId))?.[1] || TOPIC_SHARE_ID.exec(text(item?.shareInfo?.shareUrl))?.[1] || '';

function exploreApps(item, limit) {
  const apps = new Map();
  for (const row of [...array(item?.refsList_app_short), ...array(item?.refsList_app)]) {
    const id = text(row?.appId);
    const icon = text(row?.icon);
    if (!/^C\d+$/.test(id) || apps.has(id) || !/^https:\/\//i.test(icon)) continue;
    apps.set(id, { app_id: id, name: text(row.name), icon_url: icon, brief_desc: text(row.memo) });
    if (apps.size >= limit) break;
  }
  return Array.from(apps.values());
}

/** 探索页的一个栏目（「排行与佳作」等；无标题的栏目 title 为空）；seen 用来跨页去重 */
function parseExploreGroup(group, seen) {
  const cards = [];
  for (const card of array(group?.data?.[0]?.layoutData)) {
    const kind = EXPLORE_CARD_KINDS[cardKind(card)];
    if (!kind) continue;
    for (const item of array(card.data?.[0]?.list)) {
      const title = text(item?.title);
      const substanceId = topicIdOf(item);
      const key = substanceId || `${kind}:${title}`;
      if (!title || seen.has(key)) continue;
      seen.add(key);
      const image = text(item.imgUrl);
      const color = text(item.informationBarColor);
      cards.push({
        kind,
        substance_id: substanceId,
        label: text(item.name),
        title,
        subtitle: text(item.subTitle),
        image: kind === 'story' && /^https:\/\//i.test(image) ? image : '',
        color: /^#[0-9a-f]{6}$/i.test(color) ? color : '',
        apps: exploreApps(item, EXPLORE_APP_LIMIT[kind])
      });
    }
  }
  return { title: text(group?.title), cards };
}

async function loadExplore() {
  const signal = AbortSignal.timeout(20_000);
  const call = (method, params) => callClient(method, params, { device: EXPLORE_DEVICE, signal });

  const home = await call('client.getPageDetail', { pageId: 'HomePage', pageNum: 1, pageSize: 40 });
  // The default tab is 探索; tablet tabs carry no tabName, so follow the store's own selection.
  const tab = array(home.pages).find((item) => item?.data?.tab)?.data.tab;
  const pageId = text(array(tab?.list)[Number(tab?.selection) || 0]?.frame?.pageId);
  if (!pageId) throw new Error('AppGallery home page has no default tab');

  const page = await call('client.getPageDetail', { pageId, pageNum: 1, pageSize: 40 });
  let cardList = array(page.pages).find((item) => item?.data?.cardlist)?.data.cardlist;
  if (!Array.isArray(cardList?.layoutData)) throw new Error('AppGallery returned an invalid explore page');

  const sections = [];
  const seen = new Set();
  const addGroups = (groups) => {
    for (const group of groups) {
      const section = parseExploreGroup(group, seen);
      if (section.cards.length) sections.push(section);
    }
  };
  addGroups(cardList.layoutData);
  let cookies = array(page.setCookie);
  const dataId = text(cardList.dataId);
  for (let pageNum = 2; Number(cardList.hasMore) > 0; pageNum++) {
    if (!dataId || pageNum > MAX_PAGES) throw new Error('AppGallery explore pagination did not terminate');
    // pageCookie records which stories were already placed; without it every page repeats page 1.
    const cookie = cookies.map((value) => text(value).split(';')[0]).filter(Boolean).join('; ');
    cardList = await call('client.getCardList', { dataId, pageNum, pageSize: 40, cookie });
    if (!Array.isArray(cardList.layoutData)) throw new Error('AppGallery returned an invalid explore card page');
    addGroups(cardList.layoutData);
    if (Array.isArray(cardList.setCookie)) cookies = cardList.setCookie;
  }
  if (!sections.length) throw new Error('AppGallery explore page lists no topics');
  return sections;
}

/** 华为应用市场「探索」页：按栏目分组的专题卡片 */
async function getAppGalleryExplore() {
  if (explore?.expiresAt > Date.now()) return explore.sections;
  exploreRequest ||= loadExplore().then((sections) => {
    explore = { sections, expiresAt: Date.now() + EXPLORE_TTL_MS };
    return sections;
  }).finally(() => {
    exploreRequest = null;
  });
  return exploreRequest;
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

module.exports = { getAppGalleryTopic, getAppGalleryExplore };
