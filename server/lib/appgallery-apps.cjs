/*
 * 应用详情：只用鸿蒙客户端接口（与真机应用市场一致），不经网页版 web-drcn（华为 WAF 会拦 Cloudflare 出口）。
 *   - 详情页 app|<appId> / package|<包名>：基础信息、当前版本、截图、支持设备、评分分布、备案号；
 *   - versionHistories|<appId>：版本历史，华为只给最近 25 个版本。
 * 字段名沿用前端已经在用的 snake_case。
 */
const { callClient, text, array } = require('./appgallery-client.cjs');

const APP_ID_RE = /^C\d{6,32}$/;
const PKG_NAME_RE = /^[a-z][\w-]*(\.[\w-]+)+$/i;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;
const MAX_IN_FLIGHT = 16;
const cache = new Map();
const inFlight = new Map();

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
// 不存在或已下架的应用：rtnCode 102「app is filtered by appInfo」
const NOT_FOUND_RTN_CODE = '102';
// 评论卡 objectInfo.bizType 即应用类型（与网页版 kindTypeId 一致）
const KIND_TYPE_NAMES = { 2: '游戏', 13: '应用' };
// 截图优先用手机版（设备码 0）
const PHONE_DEVICE_CODE = '0';

const cardsOf = (page) => array(array(page?.pages)[0]?.data?.cardlist?.layoutData);
const listRow = (card) => array(array(card?.data)[0]?.list)[0];

/** 客户端详情页 → 应用信息；页面里没有应用头部卡时返回 null */
function mapAppPage(page) {
  const cards = cardsOf(page);
  const card = (suffix) => cards.find((item) => text(item?.type).endsWith(suffix));
  const header = listRow(card('appdetailheaderunioncard'));
  const app = header?.refs_app;
  if (!text(app?.appId)) return null;

  const update = listRow(card('appdetailupdateinfocard'));
  const about = listRow(card('appdetailaboutcard'));
  const comment = array(card('fl.card.comment')?.data)[0];
  const materials = array(listRow(card('appdetailpreviewcard'))?.multipleDeviceMaterials);
  const screenshots = materials.find((item) => array(item?.deviceTypes).includes(PHONE_DEVICE_CODE)) || materials[0];
  const paid = num(app.payInfo?.payApp) !== 0;

  return {
    app_id: text(app.appId),
    name: text(app.name),
    pkg_name: text(app.packageName),
    developer_name: text(about?.developer) || text(header.developer),
    kind_name: text(app.kindName),
    kind_type_name: KIND_TYPE_NAMES[num(comment?.objectInfo?.bizType)] || '',
    icon_url: text(app.icon),
    new_screen_shots: array(screenshots?.screenShots)
      .map((shot) => ({ url: text(shot?.url), resolution: text(shot?.resolution), rotated: shot?.rotated }))
      .filter((shot) => shot.url),
    brief_desc: text(app.memo),
    description: text(listRow(card('appdetailintrocard'))?.appIntro),
    privacy_url: text(about?.appPrivacy?.privacyUrl),
    main_device_codes: [...new Set(materials.flatMap((item) => array(item?.deviceTypes)).map(String))],
    // 当前版本
    version: text(app.version),
    version_code: num(app.versionCode),
    size_bytes: num(array(header.sizeInfos)[0]?.size),
    // 付费应用的价格只在 tariffDesc 文案里（如「¥6.00」）
    price: paid ? text(app.tariffDesc).match(/\d+(?:\.\d+)?/)?.[0] || '' : '0',
    release_date: num(update?.refs_app?.releaseTimestamp),
    new_features: text(update?.appNewFeatureInfo?.appNewFeatures),
    minsdk: num(app.minSdkLevel?.ohosApiVersion),
    min_hmos_api_level: num(app.minSdkLevel?.hmosApiVersion),
    ...parseDetailPage(page)
  };
}

/** 详情页 → 评分分布 + 备案号 */
function parseDetailPage(page) {
  const out = {};
  const cards = array(array(page?.pages)[0]?.data?.cardlist?.layoutData);
  for (const card of cards) {
    const row = array(card?.data)[0];
    if (card?.type === 'fl.card.comment' && text(row?.starInfo)) {
      const star = JSON.parse(row.starInfo);
      Object.assign(out, {
        average_rating: num(star.averageRating),
        star_1_rating_count: num(star.oneStarRatingCount),
        star_2_rating_count: num(star.twoStarRatingCount),
        star_3_rating_count: num(star.threeStarRatingCount),
        star_4_rating_count: num(star.fourStarRatingCount),
        star_5_rating_count: num(star.fiveStarRatingCount),
        total_star_rating_count: num(star.totalStarRatingCount),
        only_star_count: num(star.onlyStarCount),
        full_average_rating: num(star.fullAverageRating)
      });
    }
    const recordal = array(row?.list)[0]?.appRecordalInfo;
    if (text(card?.type).endsWith('appdetailaboutcard') && recordal) {
      Object.assign(out, {
        app_recordal_info: text(recordal.appRecordalInfo) || null,
        recordal_entity_name: text(recordal.recordalEntityName) || null
      });
    }
  }
  return out;
}

function parseVersionHistory(page) {
  const versions = array(page?.pages)
    .flatMap((item) => array(item?.data?.cardlist?.layoutData))
    .flatMap((card) => array(card?.data))
    .flatMap((item) => array(item?.list))
    .flatMap((row) => array(row?.versionHistories));
  return versions.map((entry) => ({
    version: text(entry.version),
    version_code: num(entry.versionCode),
    release_date: num(entry.releaseDate),
    new_features: text(entry.featureDesc)
  }));
}

async function loadApp(id) {
  const signal = AbortSignal.timeout(12_000);
  const page = (pageId) => callClient('client.getPageDetail', { pageId, pageNum: 1, pageSize: 100 }, { signal });
  const byAppId = APP_ID_RE.test(id);

  try {
    // 按 appId 查时详情和版本历史并行；按包名查要先从详情页拿到 appId
    const [detail, knownHistory] = await Promise.all([
      page(byAppId ? `app|${id}` : `package|${id}`),
      byAppId ? page(`versionHistories|${id}`) : null
    ]);
    const info = mapAppPage(detail);
    if (!info) throw new Error('AppGallery app detail page has no app header');
    const history = knownHistory || await page(`versionHistories|${info.app_id}`);
    return { info, versions: parseVersionHistory(history) };
  } catch (error) {
    if (String(error?.rtnCode) === NOT_FOUND_RTN_CODE) return null;
    throw error;
  }
}

/** id 可以是 appId（C 开头）或包名；不存在返回 null */
async function getAppGalleryApp(id) {
  if (typeof id !== 'string' || id.length > 128 || !(APP_ID_RE.test(id) || PKG_NAME_RE.test(id))) return null;
  const cached = cache.get(id);
  if (cached?.expiresAt > Date.now()) return cached.app;
  cache.delete(id);
  if (inFlight.has(id)) return inFlight.get(id);
  if (inFlight.size >= MAX_IN_FLIGHT) throw new Error('Too many AppGallery app requests');

  const request = loadApp(id).then((app) => {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(id, { app, expiresAt: Date.now() + CACHE_TTL_MS });
    return app;
  }).finally(() => inFlight.delete(id));
  inFlight.set(id, request);
  return request;
}

module.exports = { getAppGalleryApp };
