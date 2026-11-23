/*
 * 应用总览（分类 / 设备计数）的构建与缓存。
 *
 * 数据来自上游应用市场接口，接口本身有限流，所以这里做了几件事：
 *   1. 全局限流：对上游的并发 ≤ UPSTREAM_MAX_CONCURRENCY，两次发起间隔 ≥ UPSTREAM_MIN_INTERVAL_MS；
 *   2. 按「分类分组」而不是按别名查，把请求数从 71 次压到 37 次；
 *   3. 结果进内存缓存（新鲜期 30 分钟），过期后用旧数据兜底最多 24 小时；
 *   4. 进程重启时从 .cache/apps-overview.json 恢复快照，避免启动瞬间打一轮全量查询。
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { pushLiveLog } = require('./live-log.cjs');
const { UPSTREAM_USER_AGENT } = require('./config.cjs');

const HM_API_TARGET = (process.env.VITE_API_TARGET || '').replace(/\/$/, '');
// 分类/设备计数变化很慢：新鲜期 30 分钟，过期后仍可用旧数据兜底最多 24 小时
const APP_OVERVIEW_CACHE_TTL = Number(process.env.APP_OVERVIEW_CACHE_TTL_MS || 30 * 60 * 1000);
const APP_OVERVIEW_STALE_TTL = Number(process.env.APP_OVERVIEW_STALE_TTL_MS || 24 * 60 * 60 * 1000);
// 同一时刻最多向上游并发几个请求（原来分组并发 + 组内 Promise.all，峰值不受控）
const APP_OVERVIEW_CONCURRENCY = 3;
// 上游风控：同一个 UA 长期高频请求同一个接口会被封。
// UA 统一由 lib/config.cjs 提供，这里只负责全局限流（并发 + 请求间隔）。
const UPSTREAM_MAX_CONCURRENCY = Number(process.env.UPSTREAM_MAX_CONCURRENCY || 2);
const UPSTREAM_MIN_INTERVAL_MS = Number(process.env.UPSTREAM_MIN_INTERVAL_MS || 250);
// 注意：本文件在 server/lib/ 下，缓存目录仍然是 server/.cache
const APP_OVERVIEW_CACHE_DIR = path.join(__dirname, '..', '.cache');
const APP_OVERVIEW_CACHE_FILE = path.join(APP_OVERVIEW_CACHE_DIR, 'apps-overview.json');
const appOverviewCache = new Map(); // cacheKey -> { timestamp, data }
const appOverviewInflight = new Map(); // cacheKey -> Promise（同一个 key 只允许一次刷新在跑）
const APP_CATEGORY_GROUPS = [
  { label: '工具', aliases: ['工具', 'Tools'] },
  { label: '旅游', aliases: ['旅游', 'Travel'] },
  { label: '休闲益智', aliases: ['休闲益智', '休闲', '益智解谜'] },
  { label: '教育', aliases: ['教育'] },
  { label: '生活服务', aliases: ['生活服务', 'Lifestyle'] },
  { label: '商务', aliases: ['商务', 'Business'] },
  { label: '儿童', aliases: ['儿童', 'শিশু'] },
  { label: '金融理财', aliases: ['金融理财', 'Finance'] },
  { label: '新闻', aliases: ['新闻', 'News', 'Current affairs'] },
  { label: '拍摄美化', aliases: ['拍摄美化'] },
  { label: '运动健康', aliases: ['运动健康', 'Sports & health'] },
  { label: '动作射击', aliases: ['动作射击', '动作', '射击', 'Action'] },
  { label: '角色扮演', aliases: ['角色扮演'] },
  { label: '购物', aliases: ['购物', '購物'] },
  { label: '经营策略', aliases: ['经营策略', '经营建造', '策略', '模拟养成'] },
  { label: '出行导航', aliases: ['出行导航', 'Navigation', 'Навигация'] },
  { label: '社交', aliases: ['社交', '社交通讯', 'Social'] },
  { label: '汽车', aliases: ['汽车'] },
  { label: '医疗', aliases: ['医疗'] },
  { label: '体育竞速', aliases: ['体育竞速', '体育', '竞速', '竞技'] },
  { label: '棋牌桌游', aliases: ['棋牌桌游', '棋牌'] },
  { label: '资讯', aliases: ['资讯', '新闻阅读'] },
  { label: '美食', aliases: ['美食'] },
  { label: '效率', aliases: ['效率', 'Productivity'] },
  { label: '休闲娱乐', aliases: ['休闲娱乐', '影音娱乐', '影音娛樂'] },
  { label: '音乐', aliases: ['音乐'] },
  { label: '艺术与设计', aliases: ['艺术与设计'] },
  { label: '派对游戏', aliases: ['派对游戏'] },
  { label: '主题', aliases: ['主题', '主题个性'] },
  { label: '阅读与工具书', aliases: ['阅读与工具书'] },
  { label: '卡牌', aliases: ['卡牌'] },
  { label: '影视与直播', aliases: ['影视与直播'] },
  { label: '实用工具', aliases: ['实用工具', '實用工具'] },
  { label: '房产与装修', aliases: ['房产与装修', 'House & home'] },
  { label: '便捷生活', aliases: ['便捷生活'] },
  { label: '旅游住宿', aliases: ['旅游住宿', '旅遊'] },
  { label: '购物比价', aliases: ['购物比价'] }
];
const APP_DEVICE_GROUPS = [
  { key: 'phone', label: '手机', code: 0 },
  { key: 'tv', label: '智慧屏', code: 3 },
  { key: 'tablet', label: '平板', code: 4 },
  { key: 'watch', label: '手表', code: 7 },
  { key: 'pc', label: '电脑', code: 15 }
];

const runWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  });

  await Promise.all(runners);
  return results;
};

// 全局限流器：保证服务端对上游的请求不超过 UPSTREAM_MAX_CONCURRENCY 个并发，
// 且两次请求的发起间隔不小于 UPSTREAM_MIN_INTERVAL_MS，避免被判成"长期高频请求"
let upstreamActive = 0;
let upstreamLastStart = 0;
let upstreamTimer = null;
const upstreamQueue = [];

const pumpUpstreamQueue = () => {
  if (upstreamTimer || !upstreamQueue.length) return;
  if (upstreamActive >= UPSTREAM_MAX_CONCURRENCY) return;

  const wait = Math.max(0, upstreamLastStart + UPSTREAM_MIN_INTERVAL_MS - Date.now());
  if (wait > 0) {
    upstreamTimer = setTimeout(() => {
      upstreamTimer = null;
      pumpUpstreamQueue();
    }, wait);
    return;
  }

  upstreamActive += 1;
  upstreamLastStart = Date.now();
  const release = upstreamQueue.shift();
  release(() => {
    upstreamActive -= 1;
    pumpUpstreamQueue();
  });
  pumpUpstreamQueue();
};

const withUpstreamSlot = (task) =>
  new Promise((resolve, reject) => {
    upstreamQueue.push((release) => {
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(release);
    });
    pumpUpstreamQueue();
  });

const extractApiTotal = (payload) => {
  return Number(
    payload?.total ??
    payload?.total_count ??
    payload?.data?.total ??
    payload?.data?.total_count ??
    0
  );
};

/**
 * 一个分类分组的应用数：把该组的别名合成一个 OR 条件，一次查完。
 *
 * 为什么按「组」而不是按「别名」查：
 * 全局限流是「并发 ≤ 2 且两次发起间隔 ≥ 250ms」（见 UPSTREAM_MIN_INTERVAL_MS），
 * 所以一次构建的耗时基本就等于「请求条数 × 250ms」，跟单次查询多快没关系。
 *   按别名：37 组共 71 次 ≈ 19s（实测 device:0 用了 19391ms）
 *   按组：  37 次           ≈ 10s
 * 而且实测 OR 查询本身并不慢（一组 4 个别名 122ms，单别名 149ms），所以是纯赚。
 */
const fetchGroupCount = async (aliases, deviceCode) => {
  const names = (aliases || []).filter(Boolean);
  if (!names.length) return 0;

  const conditions = [
    names.length > 1
      ? { or: names.map((name) => ({ key: 'kind_name', value: name, op: 'eq' })) }
      : { key: 'kind_name', value: names[0], op: 'eq' }
  ];
  if (deviceCode !== undefined && deviceCode !== null) {
    conditions.push({ key: 'main_device_codes', value: String(deviceCode), op: 'array_contains' });
  }

  const response = await withUpstreamSlot(() =>
    axios.post(
      `${HM_API_TARGET}/api/v0/apps/query?page=0&page_size=1&detail=false`,
      { and: conditions },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UPSTREAM_USER_AGENT
        },
        timeout: 10000
      }
    )
  );

  return extractApiTotal(response?.data);
};

const fetchDeviceCount = async (deviceCode) => {
  const response = await withUpstreamSlot(() =>
    axios.post(
      `${HM_API_TARGET}/api/v0/apps/query?page=0&page_size=1&detail=false`,
      {
        and: [{ key: 'main_device_codes', value: String(deviceCode), op: 'array_contains' }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UPSTREAM_USER_AGENT
        },
        timeout: 10000
      }
    )
  );

  return extractApiTotal(response?.data);
};

// 真正打上游的逻辑：一次构建 = 全部分类别名查询 + 设备查询
const buildAppsOverview = async (deviceCode, cacheKey) => {
  const startMessage = `[apps-overview] 开始构建 ${cacheKey}：${APP_CATEGORY_GROUPS.length} 个分组查询`
    + ` + ${APP_DEVICE_GROUPS.length} 个设备查询（并发 ${APP_OVERVIEW_CONCURRENCY}）`;
  // 只走 pushLiveLog：它会同时写后台面板和终端，不再单独 console.log
  pushLiveLog('info', startMessage, { kind: 'cache' });

  const categories = await runWithConcurrency(
    APP_CATEGORY_GROUPS,
    APP_OVERVIEW_CONCURRENCY,
    async ({ label: name, aliases }) => {
      let count = 0;
      try {
        count = await fetchGroupCount(aliases, deviceCode);
      } catch (error) {
        console.warn(`[apps-overview] Failed to count group ${name} for ${cacheKey}:`, error.message);
      }
      // 列表页沿用同一组别名，确保分类应用数与筛选结果一致。
      return { name, count, aliases };
    }
  );

  const devices = await runWithConcurrency(APP_DEVICE_GROUPS, APP_OVERVIEW_CONCURRENCY, async (device) => {
    try {
      const count = await fetchDeviceCount(device.code);
      return { key: device.key, label: device.label, code: device.code, count };
    } catch (error) {
      console.warn(`[apps-overview] Failed to count device ${device.key}:`, error.message);
      return { key: device.key, label: device.label, code: device.code, count: 0 };
    }
  });

  return {
    categories: categories
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count),
    devices
  };
};

// 磁盘兜底：进程重启后先用旧快照顶住，避免启动瞬间对上游打一轮全量查询
const loadAppsOverviewCacheFromDisk = () => {
  try {
    if (!fs.existsSync(APP_OVERVIEW_CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(APP_OVERVIEW_CACHE_FILE, 'utf8'));
    const now = Date.now();
    Object.entries(raw || {}).forEach(([key, entry]) => {
      const timestamp = Number(entry?.timestamp || 0);
      if (entry?.data && now - timestamp < APP_OVERVIEW_STALE_TTL) {
        appOverviewCache.set(key, { timestamp, data: entry.data });
      }
    });
    console.log(`[apps-overview] 从磁盘恢复了 ${appOverviewCache.size} 份快照`);
  } catch (error) {
    console.warn('[apps-overview] 读取磁盘缓存失败（忽略）:', error.message);
  }
};

const persistAppsOverviewCacheToDisk = () => {
  try {
    fs.mkdirSync(APP_OVERVIEW_CACHE_DIR, { recursive: true });
    const payload = Object.fromEntries(
      [...appOverviewCache.entries()].map(([key, entry]) => [
        key,
        { timestamp: entry.timestamp, data: entry.data }
      ])
    );
    fs.writeFile(APP_OVERVIEW_CACHE_FILE, JSON.stringify(payload), () => {});
  } catch (error) {
    console.warn('[apps-overview] 写入磁盘缓存失败（忽略）:', error.message);
  }
};

// 单飞：同一个 cacheKey 同时只会有一个刷新任务在跑
const refreshAppsOverview = (cacheKey, deviceCode) => {
  const running = appOverviewInflight.get(cacheKey);
  if (running) return running;

  const startedAt = Date.now();
  const task = buildAppsOverview(deviceCode, cacheKey)
    .then((data) => {
      appOverviewCache.set(cacheKey, { timestamp: Date.now(), data });
      persistAppsOverviewCacheToDisk();
      const doneMessage = `[apps-overview] ${cacheKey} 构建完成：${data.categories.length} 个分类 / ${data.devices.length} 个设备，用时 ${Date.now() - startedAt}ms`;
      pushLiveLog('info', doneMessage, { kind: 'cache', ms: Date.now() - startedAt });
      return data;
    })
    .finally(() => {
      appOverviewInflight.delete(cacheKey);
    });

  appOverviewInflight.set(cacheKey, task);
  return task;
};

const getAppsOverview = async (cacheKey, deviceCode) => {
  const cached = appOverviewCache.get(cacheKey);
  const age = cached ? Date.now() - cached.timestamp : Infinity;

  if (cached && age < APP_OVERVIEW_CACHE_TTL) {
    return { data: cached.data, cached: true, stale: false };
  }

  // 有旧数据就先返回旧数据，后台只刷新一次：请求方不用等，也不会形成并发风暴
  if (cached && age < APP_OVERVIEW_STALE_TTL) {
    refreshAppsOverview(cacheKey, deviceCode).catch((error) => {
      console.warn(`[apps-overview] 后台刷新失败 ${cacheKey}:`, error.message);
    });
    return { data: cached.data, cached: true, stale: true };
  }

  // 冷启动：并发进来的请求共享同一个 Promise
  const data = await refreshAppsOverview(cacheKey, deviceCode);
  return { data, cached: false, stale: false };
};

loadAppsOverviewCacheFromDisk();

module.exports = { APP_OVERVIEW_CACHE_TTL, appOverviewCache, getAppsOverview, runWithConcurrency, APP_CATEGORY_GROUPS, APP_DEVICE_GROUPS };
