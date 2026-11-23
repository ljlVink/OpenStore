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

/** 上报当前前台路径，只供 SEO 收录队列使用（服务端不记录 IP / UA / 归属地） */
export const reportPagePath = async (path: string) => {
  try {
    await apiClient.get('/public/track', { params: { path } });
  } catch (e) {
  }
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

export default apiClient;
