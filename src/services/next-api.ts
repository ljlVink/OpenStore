import axios, { isAxiosError } from 'axios';
import { hmApi } from './hm-api';

/** 华为应用市场的应用信息（服务端 /api/public/app-detail 实时读取，字段为 snake_case） */
export interface AppGalleryAppInfo {
  app_id: string;
  name: string;
  pkg_name: string;
  developer_name: string;
  dev_en_name: string;
  supplier: string;
  kind_name: string;
  kind_type_name: string;
  tag_name: string | null;
  icon_url: string;
  screen_shots: string[];
  new_screen_shots: Array<{ url: string; resolution?: string; rotated?: string | number }>;
  brief_desc: string;
  description: string;
  privacy_url: string;
  release_countries: string[];
  main_device_codes: string[];
  version: string;
  version_code: number;
  size_bytes: number;
  download_count: number;
  price: string;
  /** 当前版本发布时间（毫秒） */
  release_date: number;
  new_features: string;
  target_sdk: number;
  minsdk: number;
  compile_sdk_version: number;
  min_hmos_api_level: number;
  average_rating?: number;
  total_star_rating_count?: number;
  app_recordal_info?: string | null;
}

/** 一条版本记录（华为只给最近 25 个版本） */
export interface AppGalleryVersion {
  version: string;
  version_code: number;
  /** 发布时间（毫秒） */
  release_date: number;
  new_features: string;
}

export interface AppGalleryApp {
  info: AppGalleryAppInfo;
  versions: AppGalleryVersion[];
}

export interface NextAppCategory {
  id?: number;
  name: string;
  icon?: string;
  count?: number;
  color?: string;
  /** 该分类分组下的全部别名（来自后台 overview），点进分类时按整组查询 */
  aliases?: string[];
}

export interface NextDeviceCount {
  code: string;
  name: string;
  count: number;
  icon?: string;
}

interface CacheItem<T> {
  timestamp: number;
  data: T;
}

const CATEGORY_CACHE_TTL = 5 * 60 * 1000;
const categoriesCache = new Map<string, CacheItem<NextAppCategory[]>>();
let devicesCache: CacheItem<NextDeviceCount[]> | null = null;
const overviewInFlight = new Map<string, Promise<any>>();

// Keep the original device mapping so existing UI code can stay unchanged.
export const DEVICE_MAP: Record<string, number | undefined> = {
  all: undefined,
  phone: 0,
  tablet: 4,
  tv: 3,
  watch: 7,
  pc: 15
};

const normalizeListResponse = (response: any) => {
  let list: any[] = [];

  if (Array.isArray(response)) {
    list = response;
  } else if (Array.isArray(response?.data)) {
    list = response.data;
  } else if (Array.isArray(response?.items)) {
    list = response.items;
  } else if (Array.isArray(response?.data?.data)) {
    list = response.data.data;
  } else if (Array.isArray(response?.apps)) {
    list = response.apps;
  }

  return list.map((item: any) => item?.info || item);
};

const extractTotal = (response: any) => {
  return Number(
    response?.total ??
    response?.total_count ??
    response?.data?.total ??
    response?.data?.total_count ??
    0
  );
};

const getOverviewCacheKey = (device?: number) => (
  device === undefined || device === null ? 'all' : `device:${device}`
);

const fetchAppsOverview = async (device?: number) => {
  const cacheKey = getOverviewCacheKey(device);
  const cachedCategories = categoriesCache.get(cacheKey);
  const hasCachedCategories = cachedCategories && Date.now() - cachedCategories.timestamp < CATEGORY_CACHE_TTL;
  const hasCachedDevices = devicesCache && Date.now() - devicesCache.timestamp < CATEGORY_CACHE_TTL;

  if (hasCachedCategories && hasCachedDevices) {
    return {
      categories: cachedCategories?.data || [],
      devices: devicesCache?.data || []
    };
  }

  if (!overviewInFlight.has(cacheKey)) {
    overviewInFlight.set(cacheKey, axios.get('/api/public/apps/overview', {
      params: device === undefined || device === null ? undefined : { device }
    })
      .then((response) => response?.data?.data || {})
      .finally(() => {
        overviewInFlight.delete(cacheKey);
      }));
  }

  const data = await overviewInFlight.get(cacheKey);
  const categories = Array.isArray(data?.categories) ? data.categories : [];
  const devices = Array.isArray(data?.devices) ? data.devices : [];

  categoriesCache.set(cacheKey, {
    timestamp: Date.now(),
    data: categories
  });
  devicesCache = {
    timestamp: Date.now(),
    data: devices
  };

  return { categories, devices };
};

export const getCategories = async (device?: number) => {
  const cacheKey = getOverviewCacheKey(device);
  const cachedCategories = categoriesCache.get(cacheKey);

  if (cachedCategories && Date.now() - cachedCategories.timestamp < CATEGORY_CACHE_TTL) {
    return {
      data: cachedCategories.data,
      items: cachedCategories.data
    };
  }

  const overview = await fetchAppsOverview(device);
  const data = overview.categories;

  const sorted = data
    .filter((item: any) => item.count > 0)
    .sort((a: NextAppCategory, b: NextAppCategory) => (b.count || 0) - (a.count || 0));

  categoriesCache.set(cacheKey, {
    timestamp: Date.now(),
    data: sorted
  });

  return {
    data: sorted,
    items: sorted
  };
};

export const getDevices = async () => {
  if (devicesCache && Date.now() - devicesCache.timestamp < CATEGORY_CACHE_TTL) {
    return {
      data: devicesCache.data,
      items: devicesCache.data
    };
  }

  const overview = await fetchAppsOverview();
  const devices = overview.devices;

  return {
    data: devices,
    items: devices
  };
};

export const getAppsByCategory = async (
  categoryName: string,
  page = 1,
  size = 20,
  device?: number,
  aliases?: string[]
) => {
  const apiPage = Math.max(page, 1);

  /*
   * 分类卡片上的数量是该分类「别名组」的合计（休闲益智 = 休闲益智 + 休闲 + 益智解谜），
   * 所以列表也必须按整组别名查（kind_name in (...) ），否则会像以前那样
   * 卡片写 8905，点进去只列出 12 个。
   */
  const names = aliases && aliases.length ? aliases : [categoryName];
  const categoryConditions = names.map((name) => ({ key: 'kind_name', value: name, op: 'eq' }));
  const categoryExpression =
    categoryConditions.length > 1 ? { or: categoryConditions } : categoryConditions[0];

  const conditions: any[] = [categoryExpression];
  if (device !== undefined && device !== null) {
    conditions.push({ key: 'main_device_codes', value: String(device), op: 'array_contains' });
  }

  const query = new URLSearchParams({
    page: String(apiPage),
    page_size: String(size),
    detail: 'true'
  });

  const response = await hmApi.post<any>(`/apps/query?${query.toString()}`, { and: conditions });

  return {
    data: normalizeListResponse(response),
    total: extractTotal(response)
  };
};

/** 华为应用市场列表条目（发现更多 / 搜索结果） */
export interface AppGalleryListApp {
  app_id: string;
  name: string;
  pkg_name: string;
  icon_url: string;
  brief_desc: string;
  kind_name: string;
  version: string;
  /** 华为给的约数文案，如「9,253 万次安装」 */
  download_count_desc: string;
  size_bytes: number;
}

/** 华为应用市场搜索页的「发现更多」 */
export const getDiscoverApps = async (): Promise<AppGalleryListApp[]> => {
  const { data } = await axios.get<{ items: AppGalleryListApp[] }>('/api/public/apps/discover');
  return data.items;
};

/** 搜索：实时查华为应用市场，一次返回全部结果（不分页） */
export const searchApps = async (query: string): Promise<AppGalleryListApp[]> => {
  const { data } = await axios.get<{ items: AppGalleryListApp[] }>('/api/public/apps/search', {
    params: { q: query.trim() }
  });
  return data.items;
};

/** 应用详情 + 版本历史；id 为 appId 或包名，应用不存在时返回 null */
export const getAppDetail = async (id: string): Promise<AppGalleryApp | null> => {
  try {
    const { data } = await axios.get<AppGalleryApp>(`/api/public/app-detail/${encodeURIComponent(id)}`);
    return data;
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
};

export default hmApi;
