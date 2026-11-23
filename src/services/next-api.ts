import axios, { isAxiosError } from 'axios';

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

/** 华为应用市场列表条目（发现更多 / 搜索结果） */
export interface AppGalleryListApp {
  app_id: string;
  name: string;
  pkg_name: string;
  icon_url: string;
  brief_desc: string;
  kind_name: string;
  version: string;
  size_bytes: number;
}

export type AppGalleryCatalog = 'apps' | 'games';
export type AppGalleryBrowseTab = 'featured' | 'categories' | 'rankings' | 'updates';

export interface AppGalleryBrowseApp extends AppGalleryListApp {
  position?: number;
  notes?: string;
}

export type AppGalleryBrowse =
  | { kind: 'categories'; categories: Array<{ name: string; image: string }> }
  | {
      kind: 'sections';
      sections: Array<{
        title: string;
        description: string;
        items: AppGalleryBrowseApp[];
        rank?: string;
      }>;
      hasMore: boolean;
    }
  | {
      kind: 'updates';
      updates: Array<{ date: string; items: AppGalleryBrowseApp[] }>;
      hasMore: boolean;
    };

/** 原生应用市场浏览页；分类和榜单只传名称，由服务端解析。 */
export const getAppGalleryBrowse = async (params: {
  catalog: AppGalleryCatalog;
  tab: AppGalleryBrowseTab;
  category?: string;
  rank?: string;
  page?: number;
}): Promise<AppGalleryBrowse> => {
  const { data } = await axios.get<AppGalleryBrowse>('/api/public/apps/browse', { params });
  return data;
};

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
