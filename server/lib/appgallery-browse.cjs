/*
 * 平板客户端「应用」四个栏目。按标题解析导航，不依赖会变化的 tab 顺序或页面 ID。
 * 翻页复用内容页的 dataId 和匿名 cookie；会话只在服务端短期缓存，不接受客户端游标。
 */
const { callClient, text, array, cardKind } = require('./appgallery-client.cjs');
const { addApp } = require('./appgallery-lists.cjs');

const TAB_TITLES = { featured: '精选', categories: '分类', rankings: '排行榜', updates: '重磅更新' };
const PAGE_SIZE = 40;
// 这是有界浏览窗口，不代表上游应用总量；末页不再向前端宣称可继续翻页。
const MAX_PAGES = 5;
const TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 64;
const MAX_IN_FLIGHT = 8;
const sessions = new Map();
let navigation = null;
let navigationRequest = null;
let inFlight = 0;

async function call(method, params) {
  if (inFlight >= MAX_IN_FLIGHT) throw new Error('Too many AppGallery browse requests');
  inFlight++;
  try {
    return await callClient(method, params, { device: 'tablet', signal: AbortSignal.timeout(20_000) });
  } finally {
    inFlight--;
  }
}

function mergeCookies(previous, received) {
  const cookies = new Map();
  for (const value of [...previous, ...array(received)]) {
    const pair = text(value).split(';')[0];
    const separator = pair.indexOf('=');
    if (separator > 0) cookies.set(pair.slice(0, separator), pair);
  }
  return Array.from(cookies.values());
}

const pageDetail = (pageId, extra = {}) => call('client.getPageDetail', {
  pageId, pageNum: 1, pageSize: PAGE_SIZE, ...extra
});
const tabsOf = (page) => array(page.pages).flatMap((item) => array(item?.data?.tab?.list));

async function getNavigation() {
  if (navigation?.expiresAt > Date.now()) return navigation.tabs;
  if (navigationRequest) return navigationRequest;
  navigationRequest = (async () => {
    const home = await pageDetail('HomePage');
    const appsId = text(tabsOf(home).find((tab) => text(tab?.title) === '应用')?.frame?.pageId);
    if (!appsId) throw new Error('AppGallery 应用 tab is missing');
    const apps = await pageDetail(appsId);
    const children = tabsOf(apps);
    const tabs = {};
    for (const [key, title] of Object.entries(TAB_TITLES)) {
      tabs[key] = text(children.find((tab) => text(tab?.title) === title)?.frame?.pageId);
      if (!tabs[key]) throw new Error(`AppGallery ${title} tab is missing`);
    }
    navigation = { tabs, expiresAt: Date.now() + TTL_MS };
    return tabs;
  })().finally(() => { navigationRequest = null; });
  return navigationRequest;
}

/** 卡片容器只沿 layoutData 下钻；广告、分类和跳转按钮不会被当成应用行。 */
function visitCards(cards, visit, depth = 0) {
  if (depth > 6) return;
  for (const card of array(cards)) {
    visit(card);
    for (const row of array(card?.data)) visitCards(row?.layoutData, visit, depth + 1);
  }
}

function appRows(rows, updates = false) {
  const apps = new Map();
  for (const row of array(rows)) {
    const before = apps.size;
    addApp(apps, row);
    if (apps.size === before) continue;
    const app = apps.get(text(row.appId));
    const position = Number(row.sortIndex);
    if (Number.isSafeInteger(position) && position > 0) app.position = position;
    if (updates) app.notes = text(row.newFeatures);
  }
  return Array.from(apps.values());
}

function parseCards(cards, tab, title, rankDetail) {
  const categories = new Map();
  const ranks = new Map();
  const sections = [];
  const updates = new Map();
  let recognized = false;
  visitCards(cards, (card) => {
    const kind = cardKind(card);
    const data = array(card?.data);
    if (tab === 'categories') {
      if (kind !== 'categorycard') return;
      recognized = true;
      for (const row of data) {
        const name = text(row?.name);
        const pageId = text(row?.detailId);
        const secKindId = text(row?.subTitle);
        if (name && pageId && secKindId) categories.set(name, {
          name, image: /^https:\/\//i.test(text(row.imgUrl)) ? text(row.imgUrl) : '', pageId, secKindId
        });
      }
      return;
    }
    if (tab === 'updates') {
      if (kind !== 'heavyupdatecard') return;
      recognized = true;
      for (const group of data) {
        for (const row of array(group?.list)) {
          const timestamp = Number(row?.releaseTimestamp);
          const date = new Date(timestamp + 8 * 60 * 60 * 1000);
          if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(date.getTime())) continue;
          const items = appRows([row], true);
          if (!items.length) continue;
          const day = date.toISOString().slice(0, 10);
          if (!updates.has(day)) updates.set(day, []);
          updates.get(day).push(items[0]);
        }
      }
      return;
    }
    if (tab === 'rankings' && !rankDetail && kind !== 'vrankingcard') return;
    const direct = appRows(data);
    if (direct.length) {
      recognized = true;
      sections.push({ title: text(card.title) || title, description: text(card.subtitle), items: direct });
    }
    for (const row of data) {
      const items = appRows(row?.list);
      if (!items.length) continue;
      recognized = true;
      const sectionTitle = text(row.title) || text(card.title) || title;
      const section = { title: sectionTitle, description: text(row.subtitle) || text(card.subtitle), items };
      if (tab === 'rankings' && !rankDetail) {
        const target = text(row.target);
        if (target) {
          section.rank = sectionTitle;
          ranks.set(sectionTitle, target);
        }
      }
      sections.push(section);
    }
  });
  if (tab === 'categories') return {
    recognized, categories, ranks,
    response: { kind: 'categories', categories: Array.from(categories.values(), ({ name, image }) => ({ name, image })) }
  };
  if (tab === 'updates') return {
    recognized, categories, ranks,
    response: { kind: 'updates', updates: Array.from(updates, ([date, items]) => ({ date, items })), hasMore: false }
  };
  return { recognized, categories, ranks, response: { kind: 'sections', sections, hasMore: false } };
}

function withMore(parsed, cardList, page) {
  if (parsed.response.kind !== 'categories') {
    parsed.response.hasMore = page < MAX_PAGES && Number(cardList.hasMore) > 0 && Boolean(text(cardList.dataId));
  }
  return parsed.response;
}

async function loadSession(tab, category, rank) {
  const tabs = await getNavigation();
  let pageId = tabs[tab];
  let title = TAB_TITLES[tab];
  let parseTab = tab;
  let extra = {};
  if (category) {
    const index = await getSession('categories', '', '');
    const entry = index.categories.get(category);
    if (!entry) return null;
    pageId = entry.pageId;
    title = entry.name;
    parseTab = 'featured';
    // 分类共用 detailId，必须把 subTitle 作为 secKindIds 传给服务端。
    extra = { businessParam: { preferenceInfo: { secKindIds: [entry.secKindId] } } };
  } else if (rank) {
    const index = await getSession('rankings', '', '');
    pageId = index.ranks.get(rank);
    if (!pageId) return null;
    title = rank;
  }
  const page = await pageDetail(pageId, extra);
  // 排行榜详情的首个 page 只是标题和分类，实际 normalcard 与翻页游标在子 page。
  for (const panel of array(page.pages)) {
    const cardList = panel?.data?.cardlist;
    if (!Array.isArray(cardList?.layoutData)) continue;
    const parsed = parseCards(cardList.layoutData, parseTab, title, Boolean(rank));
    if (!parsed.recognized) continue;
    return {
      tab: parseTab, title, rankDetail: Boolean(rank), extra,
      categories: parsed.categories, ranks: parsed.ranks,
      pages: [withMore(parsed, cardList, 1)],
      cursor: { dataId: text(cardList.dataId), hasMore: Number(cardList.hasMore) > 0, cookies: mergeCookies([], page.setCookie) },
      request: null
    };
  }
  throw new Error(`AppGallery ${title} content page is invalid`);
}

async function getSession(tab, category, rank) {
  const key = JSON.stringify([tab, category, rank]);
  const cached = sessions.get(key);
  if (cached && (cached.request || cached.expiresAt > Date.now())) return cached.request || cached.session;
  sessions.delete(key);
  if (sessions.size >= CACHE_MAX) {
    const oldest = Array.from(sessions).find(([, entry]) => !entry.request && !entry.session?.request);
    if (!oldest) throw new Error('Too many AppGallery browse sessions');
    sessions.delete(oldest[0]);
  }
  const entry = { expiresAt: 0, session: null, request: null };
  entry.request = loadSession(tab, category, rank).then((session) => {
    entry.session = session;
    entry.expiresAt = Date.now() + TTL_MS;
    if (!session) sessions.delete(key);
    return session;
  }).catch((error) => {
    sessions.delete(key);
    throw error;
  }).finally(() => { entry.request = null; });
  sessions.set(key, entry);
  return entry.request;
}

function emptyPage(session) {
  return session.tab === 'updates'
    ? { kind: 'updates', updates: [], hasMore: false }
    : { kind: 'sections', sections: [], hasMore: false };
}

async function getPage(session, page) {
  if (session.tab === 'categories') return session.pages[0];
  if (page > MAX_PAGES) return emptyPage(session);
  while (session.pages.length < page) {
    if (session.request) {
      await session.request;
      continue;
    }
    if (!session.cursor.hasMore || !session.cursor.dataId) return emptyPage(session);
    session.request = (async () => {
      const pageNum = session.pages.length + 1;
      const cookie = session.cursor.cookies.join('; ');
      const cardList = await call('client.getCardList', {
        dataId: session.cursor.dataId, pageNum, pageSize: PAGE_SIZE, cookie, ...session.extra
      });
      if (!Array.isArray(cardList.layoutData)) throw new Error('AppGallery browse card page is invalid');
      const parsed = parseCards(cardList.layoutData, session.tab, session.title, session.rankDetail);
      session.pages.push(withMore(parsed, cardList, pageNum));
      session.cursor.hasMore = Number(cardList.hasMore) > 0 && pageNum < MAX_PAGES;
      if (text(cardList.dataId)) session.cursor.dataId = text(cardList.dataId);
      session.cursor.cookies = mergeCookies(session.cursor.cookies, cardList.setCookie);
    })().finally(() => { session.request = null; });
    await session.request;
  }
  return session.pages[page - 1];
}

/** 查询参数由路由校验；只有未知分类或榜单名称返回 null。 */
async function getAppGalleryBrowse({ tab = 'featured', category = '', rank = '', page = 1 } = {}) {
  const session = await getSession(tab, category, rank);
  return session ? getPage(session, page) : null;
}

module.exports = { getAppGalleryBrowse };
