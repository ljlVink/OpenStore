/*
 * 应用详情：直接读华为应用市场。
 *   - webedge/appinfo：应用信息 + 当前版本（大小、SDK、发布时间…）；
 *   - 客户端详情页 app|<appId>：评分分布（fl.card.comment 的 starInfo）和备案号；
 *     网页版 webAgAppDetail 经 ESA 中继（国内出口）会返回 rtnCode 102「app is filtered by appInfo」，所以走客户端接口；
 *   - 客户端 versionHistories|<appId>：版本历史，华为只给最近 25 个版本。
 * 字段名沿用前端已经在用的 snake_case（与原市场数据上游一致）。
 */
const { openWebSession, callClient, text, array } = require('./appgallery-client.cjs');

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
const flag = (value) => value === true || num(value) !== 0;

function mapAppInfo(raw) {
  return {
    app_id: text(raw.appId),
    alliance_app_id: text(raw.allianceAppId),
    name: text(raw.name),
    pkg_name: text(raw.pkgName),
    dev_id: text(raw.devId),
    developer_name: text(raw.developerName),
    dev_en_name: text(raw.devEnName) || text(raw.developerName),
    supplier: text(raw.supplier),
    kind_id: num(raw.kindId),
    kind_name: text(raw.kindName),
    tag_name: text(raw.tagName) || null,
    kind_type_id: num(raw.kindTypeId),
    kind_type_name: text(raw.kindTypeName),
    icon_url: text(raw.icon),
    screen_shots: array(raw.screenShots),
    new_screen_shots: array(raw.newScreenShots),
    brief_desc: text(raw.briefDes),
    description: text(raw.description),
    privacy_url: text(raw.privacyUrl),
    ctype: num(raw.ctype),
    is_pay: String(raw.isPay) === '1',
    iap: flag(raw.iap),
    hms: flag(raw.hms),
    release_countries: array(raw.releaseCountries),
    main_device_codes: array(raw.mainDeviceCodes),
    // 当前版本
    version: text(raw.version),
    version_code: num(raw.versionCode),
    size_bytes: num(raw.size),
    sha256: text(raw.sha256),
    info_score: num(raw.hot),
    info_rate_count: num(raw.rateNum),
    price: text(raw.price) || '0',
    release_date: num(raw.releaseDate),
    new_features: text(raw.newFeatures),
    upgrade_msg: text(raw.upgradeMsg),
    target_sdk: num(raw.targetSdk),
    minsdk: num(raw.minsdk),
    compile_sdk_version: num(raw.compileSdkVersion),
    min_hmos_api_level: num(raw.minHmosApiLevel),
    api_release_type: text(raw.apiReleaseType)
  };
}

/** 网页版详情页 → 评分分布 + 备案号 */
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
  const post = await openWebSession(signal);
  const raw = await post('/webedge/appinfo', {
    [APP_ID_RE.test(id) ? 'appId' : 'pkgName']: id,
    locale: 'zh_CN',
    countryCode: 'CN',
    orderApp: 1
  });
  // 不存在的应用返回空串
  const appId = text(raw?.appId);
  if (!appId) return null;

  const [detail, history] = await Promise.all([
    callClient('client.getPageDetail', { pageId: `app|${appId}`, pageNum: 1, pageSize: 100 }, { signal }),
    callClient('client.getPageDetail', { pageId: `versionHistories|${appId}`, pageNum: 1, pageSize: 100 }, { signal })
  ]);

  return {
    info: { ...mapAppInfo(raw), ...parseDetailPage(detail) },
    versions: parseVersionHistory(history)
  };
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
