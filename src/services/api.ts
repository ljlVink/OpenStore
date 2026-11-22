import axios from 'axios';

// Use same-origin relative base URL; Nginx/BT 反向代理到后端
const API_URL = '/api';

const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Intercept requests to add token
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
    }
    return Promise.reject(error);
  }
);

export interface Monitor {
  id: number;
  friendly_name: string;
  url: string;
  type: number;
  status: number; // 2: Up, 8: Seems Down, 9: Down, 0: Paused
  uptime_ratio: string;
  custom_uptime_ratio: string; // "100.00-99.98-99.50"
  custom_uptime_ranges?: string; // "100.00-100.00-..." (30 daily ranges)
  create_datetime: number; // Added for running time calculation
  response_times?: Array<{ datetime: number; value: number }>;
  logs?: Array<{ type: number; datetime: number; duration: number; reason: any }>;
  ssl?: {
    brand: string;
    product: string;
    expires: number;
  };
}

export interface Visitor {
  id: number;
  ip: string;
  location: string;
  device: string;
  path?: string;
  timestamp: string;
}

export interface Incident {
  id: number;
  title: string;
  content?: string;
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved' | 'scheduled';
  type: 'incident' | 'maintenance' | 'notice';
  /** 卡片图标名（Element Plus 图标名，如 WarningFilled / Tools / InfoFilled），留空按类型取默认 */
  icon?: string | null;
  start_time?: number;
  end_time?: number;
  created_at: number;
  updated_at: number;
}

export const getActiveIncidents = async (): Promise<Incident[]> => {
  try {
    const response = await apiClient.get('/public/incidents/active');
    return response.data.items || [];
  } catch (error) {
    console.error('Failed to fetch active incidents', error);
    return [];
  }
};

export const getMonitors = async (): Promise<Monitor[]> => {
  try {
    const response = await apiClient.get('/monitors');
    if (response.data.stat === 'ok') {
      return response.data.monitors;
    } else {
      throw new Error(response.data.error?.message || 'API Error');
    }
  } catch (error) {
    try {
      const status = (error as any)?.response?.status;
      const method = (error as any)?.config?.method?.toUpperCase();
      const baseURL = (error as any)?.config?.baseURL || '';
      const url = (error as any)?.config?.url || '';
      console.error(`[AxiosError] ${method || 'GET'} ${baseURL}${url} ${status || ''}`, (error as any)?.message || error);
    } catch {}
    throw error;
  }
};

export const trackVisit = async (path: string) => {
  try {
    await apiClient.get('/public/track', { params: { path } });
  } catch (e) {
  }
};

export const getVisitors = async (): Promise<Visitor[]> => {
  try {
    const response = await apiClient.get('/visitors');
    return response.data.visitors;
  } catch (error) {
    console.error('Failed to fetch visitors', error);
    return [];
  }
};

export interface VisitorStats {
  visitors: Visitor[];
  total: number;
  uniqueIp?: number;
  locationKinds?: number;
  deviceKinds?: number;
  locationStats?: Array<{ name: string; count: number }>;
  deviceStats?: Array<{ name: string; count: number }>;
}

export const getVisitorStats = async (page?: number, pageSize?: number, filters?: { location?: string; device?: string; path?: string }): Promise<VisitorStats> => {
  try {
    const params: any = {};
    if (page) params.page = page;
    if (pageSize) params.pageSize = pageSize;
    if (filters?.location) params.location = filters.location;
    if (filters?.device) params.device = filters.device;
    if (filters?.path) params.path = filters.path;

    const response = await apiClient.get('/visitors', { params });
    return response.data;
  } catch (error) {
    console.error('Failed to fetch visitor stats', error);
    return { visitors: [], total: 0 };
  }
};

export const batchDeleteVisitors = async (ids: number[]): Promise<void> => {
  await apiClient.post('/visitors/batch-delete', { ids });
};

export const getVisitorTrend = async (days: number = 30): Promise<Array<{ date: string; count: number; unique_ip: number }>> => {
  const response = await apiClient.get('/visitors/trend', { params: { days } });
  return response.data;
};

export const exportVisitors = async (): Promise<void> => {
  const response = await apiClient.get('/visitors/export', { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `visitors-${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
};

// Announcements
export interface Announcement {
  id: number;
  title: string;
  content_html?: string;
  content_markdown?: string;
  status: 'draft' | 'published' | 'offline';
  scheduled_at?: string;
  published_at?: string;
  updated_at?: string;
}
export const getAnnouncements = async (): Promise<Announcement[]> => {
  const response = await apiClient.get('/announcements');
  return response.data.items || [];
};
export const getPublicAnnouncements = async (): Promise<Announcement[]> => {
  const response = await apiClient.get('/public/announcements');
  return response.data.items || [];
};
export const createAnnouncement = async (data: Partial<Announcement>): Promise<{ id: number }> => {
  const response = await apiClient.post('/announcements', data);
  return response.data;
};
export const updateAnnouncement = async (id: number, data: Partial<Announcement>): Promise<void> => {
  await apiClient.put(`/announcements/${id}`, data);
};
export const deleteAnnouncement = async (id: number): Promise<void> => {
  await apiClient.delete(`/announcements/${id}`);
};
export const publishAnnouncement = async (id: number): Promise<void> => {
  await apiClient.post(`/announcements/${id}/publish`);
};
export const offlineAnnouncement = async (id: number): Promise<void> => {
  await apiClient.post(`/announcements/${id}/offline`);
};


// Apps
export interface AppItem {
  id: number;
  name: string;
  provider?: string;
  bg_url?: string;
  icon_url?: string;
  download_url?: string;
  enabled: number;
}
export const getPublicApps = async (): Promise<AppItem[]> => {
  const response = await apiClient.get('/public/apps');
  return response.data.items || [];
};

// Site Cards
export interface SiteCard {
  id: number;
  title: string;
  enabled: number;
  sort_order: number;
  style?: any;
}
export const getSiteCards = async (): Promise<SiteCard[]> => {
  const response = await apiClient.get('/site-cards');
  return response.data.items || [];
};
export const getPublicSiteCards = async (): Promise<SiteCard[]> => {
  const response = await apiClient.get('/public/site-cards');
  return response.data.items || [];
};
export const updateSiteCard = async (id: number, data: Partial<SiteCard>): Promise<void> => {
  await apiClient.put(`/site-cards/${id}`, data);
};

// Env Vars
export interface EnvVar {
  key: string;
  value?: string;
  secure?: boolean;
  category?: string;
  updated_at?: string;
}
export const getEnvVars = async (): Promise<Record<string, EnvVar[]>> => {
  const response = await apiClient.get('/env');
  return response.data;
};
export const setEnvVar = async (data: { key: string; value: string; secure?: boolean; category?: string }): Promise<void> => {
  await apiClient.put('/env', data);
};
export const getEnvHistory = async (key?: string): Promise<any[]> => {
  const response = await apiClient.get('/env/history', { params: { key } });
  return response.data.items;
};
// Incidents Admin
export const getIncidents = async (): Promise<Incident[]> => {
  const response = await apiClient.get('/incidents');
  return response.data.items || [];
};
export const createIncident = async (data: Partial<Incident>): Promise<{ id: number }> => {
  const response = await apiClient.post('/incidents', data);
  return response.data;
};
export const updateIncident = async (id: number, data: Partial<Incident>): Promise<void> => {
  await apiClient.put(`/incidents/${id}`, data);
};
export const deleteIncident = async (id: number): Promise<void> => {
  await apiClient.delete(`/incidents/${id}`);
};

// Auth
export const login = async (username: string, password: string): Promise<{ token: string }> => {
  const response = await apiClient.post('/auth/login', { username, password });
  return response.data;
};

// Upload
export const uploadFile = async (file: File): Promise<{ url: string }> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiClient.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};


// 专题（Substance）：华为应用市场「探索」页
export interface ShortAppInfo {
  app_id: string;
  name: string;
  pkg_name: string;
  icon_url: string;
}

export interface FullSubstanceInfo {
  substance_id: string;
  title: string;
  subtitle: string;
  description: string;
  apps: ShortAppInfo[];
}

export interface ExploreApp {
  app_id: string;
  name: string;
  icon_url: string;
  brief_desc: string;
}

/** story 大图卡、list 应用榜单、icons 图标墙；substance_id 为空时卡片不能点进专题 */
export interface ExploreCard {
  kind: 'story' | 'list' | 'icons';
  substance_id: string;
  /** 华为给专题打的栏目名，如「编辑精选」「推荐」 */
  label: string;
  title: string;
  subtitle: string;
  image: string;
  /** 大图卡底部信息栏的颜色（#rrggbb），没有时为空 */
  color: string;
  apps: ExploreApp[];
}

/** 探索页的一个栏目；title 为空的栏目不显示标题 */
export interface ExploreSection {
  title: string;
  cards: ExploreCard[];
}

export const getExplore = async (): Promise<ExploreSection[]> => {
  const { data } = await apiClient.get<{ sections: ExploreSection[] }>('/public/explore');
  return data.sections;
};

export const getTopicDetail = async (substanceId: string): Promise<FullSubstanceInfo> => {
  const { data } = await apiClient.get<FullSubstanceInfo>(`/public/topics/${encodeURIComponent(substanceId)}`);
  return data;
};

export const getThemeSettings = async (): Promise<Record<string, string>> => {
  try {
    const response = await apiClient.get('/settings/theme');
    return response.data;
  } catch (error) {
    console.error('Failed to fetch theme settings', error);
    return {};
  }
};

export default apiClient;
