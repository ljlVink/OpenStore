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

/** 应用列表：华为应用市场搜索页的「发现更多」 */
export const getDiscoverApps = async (): Promise<AppGalleryListApp[]> => {
  const { data } = await axios.get<{ items: AppGalleryListApp[] }>('/api/public/apps/discover');
  return data.items;
};

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
