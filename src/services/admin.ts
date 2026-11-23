import axios from 'axios';
import { useAuthStore } from '../stores/auth';

const API_URL = '/api/admin';

const api = axios.create({ baseURL: API_URL });

const rawApi = axios.create({ baseURL: API_URL });

let refreshing: Promise<string | null> | null = null;

const refreshTokenIfNeeded = async (store: ReturnType<typeof useAuthStore>) => {
  const token = store.token;
  if (!token) return null;
  const expMs = store.tokenExpMs;
  if (!expMs || expMs - Date.now() > 5 * 60 * 1000) return token;

  if (!refreshing) {
    refreshing = rawApi
      .post(
        '/auth/refresh',
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )
      .then((res) => {
        const nextToken = res?.data?.token;
        if (typeof nextToken === 'string' && nextToken.trim()) {
          store.setToken(nextToken);
          return nextToken;
        }
        store.logout();
        return null;
      })
      .catch(() => {
        store.logout();
        return null;
      })
      .finally(() => {
        refreshing = null;
      });
  }

  return refreshing;
};

api.interceptors.request.use(async (config) => {
  const store = useAuthStore();
  await refreshTokenIfNeeded(store);
  if (store.token) {
    config.headers = config.headers || {};
    (config.headers as any)['Authorization'] = `Bearer ${store.token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      const store = useAuthStore();
      store.logout();
      if (window.location.pathname.startsWith('/admin')) {
        window.location.href = '/admin/login';
      } else {
        window.location.reload();
      }
    }
    try {
      const status = (error as any)?.response?.status;
      const method = (error as any)?.config?.method?.toUpperCase();
      const baseURL = (error as any)?.config?.baseURL || '';
      const url = (error as any)?.config?.url || '';
      console.error(`[AxiosError] ${method || 'GET'} ${baseURL}${url} ${status || ''}`, (error as any)?.message || error);
    } catch {}
    return Promise.reject(error);
  }
);

import { type Incident } from './api';
export type { Incident };

// Incidents
export const getIncidents = async () => {
  const { data } = await api.get('/incidents');
  return data.items as Incident[];
};
export const createIncident = async (payload: Partial<Incident>) => {
  const { data } = await api.post('/incidents', payload);
  return data.id as number;
};
export const updateIncident = async (id: number, payload: Partial<Incident>) => {
  await api.put(`/incidents/${id}`, payload);
};
export const deleteIncident = async (id: number) => {
  await api.delete(`/incidents/${id}`);
};

// Apps
export interface AppItem {
  id: number;
  name: string;
  provider?: string | null;
  bg_url?: string | null;
  icon_url?: string | null;
  download_url?: string | null;
  enabled: number;
}

// Public endpoints
export const getPublicApps = async () => {
  const { data } = await axios.get('/api/public/apps');
  return data.items as AppItem[];
};

// Auth
export const changeAdminPassword = async (payload: { old_password: string; new_password: string }) => {
  await api.post('/auth/change-password', payload);
};

export const loginAdmin = async (payload: { username: string; password: string }) => {
  const { data } = await rawApi.post('/auth/login', payload);
  return data as { token: string };
};

// System Logs
export interface SystemLog {
  id: number;
  actor: string;
  action: string;
  entity: string;
  entity_id?: number | null;
  payload?: string | null;
  created_at: string;
}

export const getSystemLogs = async (
  page = 1,
  pageSize = 20,
  filters: { search?: string; action?: string; actor?: string } = {}
) => {
  const { data } = await api.get('/logs', { params: { page, pageSize, ...filters } });
  return data as {
    items: SystemLog[];
    total: number;
    page: number;
    pageSize: number;
    actions?: Array<{ action: string; count: number }>;
    actors?: Array<{ actor: string; count: number }>;
    today_count?: number;
  };
};

export const deleteSystemLogs = async (ids: number[], clearAll = false) => {
  await api.post('/logs/batch-delete', { ids, clearAll });
};

/* ------------------------------ 数据库管理 ------------------------------ */

export interface DatabaseTableInfo {
  name: string;
  rows: number;
  columns: number;
  indexes: number;
}

export interface DatabaseOverview {
  file: { path: string; sizeBytes: number; mtime: string | null; walBytes?: number; shmBytes?: number };
  sqlite: { version: string };
  pragmas: {
    pageSize: number;
    pageCount: number;
    freelistCount: number;
    journalMode: string;
    autoVacuum: number;
    encoding: string;
  };
  freeBytes: number;
  counts: { tables: number; indexes: number; views: number; triggers: number; totalRows: number };
  tables: DatabaseTableInfo[];
}

export const getDatabaseOverview = async () => {
  const { data } = await api.get('/database/overview');
  return data as DatabaseOverview;
};

export interface DatabaseTableData {
  table: string;
  page: number;
  pageSize: number;
  total: number;
  columns: Array<{ name: string; type: string; pk: boolean }>;
  rows: Array<Record<string, unknown>>;
}

export const getDatabaseTable = async (
  name: string,
  params: { page?: number; pageSize?: number; orderBy?: string; order?: 'asc' | 'desc'; q?: string } = {}
) => {
  const { data } = await api.get(`/database/tables/${encodeURIComponent(name)}`, { params });
  return data as DatabaseTableData;
};

export const runDatabaseMaintenance = async (action: string) => {
  const { data } = await api.post('/database/maintenance', { action });
  return data as { action: string; label: string; durationMs: number; rows: Array<Record<string, unknown>> };
};

export const runDatabaseQuery = async (sql: string) => {
  const { data } = await api.post('/database/query', { sql });
  return data as {
    durationMs: number;
    rowCount: number;
    truncated: boolean;
    columns: string[];
    rows: Array<Record<string, unknown>>;
  };
};

/** 下载数据库快照（后端用 VACUUM INTO 生成一致副本，含 WAL 里尚未合并的数据） */
export const downloadDatabaseBackup = async () => {
  const response = await api.get('/database/backup', { responseType: 'blob' });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `visitors-${stamp}.db`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

/** 警告页预览：只取示例 HTML，不拦截、不消耗配额 */
export const getScriptGuardPreview = async () => {
  const { data } = await api.get('/script-guard/preview');
  return String(data?.html || '');
};

/** 警告页文案的自定义配置（存在 system_settings 里，保存后立刻生效，不用重启） */
export interface ScriptGuardPageConfig {
  badge: string;
  title: string;
  message: string;
  tips: string[];
  contactLabel: string;
  contactUrl: string;
  showDetails: boolean;
}

export const getScriptGuardPageConfig = async () => {
  const { data } = await api.get('/script-guard/page');
  return data as { config: ScriptGuardPageConfig; defaults: ScriptGuardPageConfig };
};

export const saveScriptGuardPageConfig = async (config: ScriptGuardPageConfig) => {
  const { data } = await api.put('/script-guard/page', config);
  return data.config as ScriptGuardPageConfig;
};

export const resetScriptGuardPageConfig = async () => {
  const { data } = await api.post('/script-guard/page/reset');
  return data.config as ScriptGuardPageConfig;
};

/** 放行名单：命中 UA 前缀的客户端不计次、不封禁；名单只存库，为空即不放行 */
export const getScriptGuardAllowList = async () => {
  const { data } = await api.get('/script-guard/allow');
  return data.list as string;
};

export const saveScriptGuardAllowList = async (list: string) => {
  const { data } = await api.put('/script-guard/allow', { list });
  return data.list as string;
};

/** 一次拦截（封禁）记录 */
export interface ScriptGuardBlockRecord {
  id: number;
  ip: string;
  location: string;
  ua: string;
  path: string;
  hits: number;
  strikes: number;
  block_ms: number;
  created_at: string;
}

export interface ScriptGuardBlockList {
  items: ScriptGuardBlockRecord[];
  /** 当前仍在封禁期内的 IP（内存态，重启即清空） */
  active: Array<{ ip: string; ua: string; strikes: number; remainMs: number }>;
  stats: { scriptRequests: number; warned: number; blocked: number; strikes: number };
}

export const getScriptGuardBlocks = async (limit = 100) => {
  const { data } = await api.get('/script-guard/blocks', { params: { limit } });
  return data as ScriptGuardBlockList;
};

export const clearScriptGuardBlocks = async () => {
  await api.delete('/script-guard/blocks');
};

export const unblockScriptGuardIp = async (ip: string) => {
  const { data } = await api.post('/script-guard/unblock', { ip });
  return Boolean(data?.released);
};

export interface ScriptGuardTriggerResult {
  ip: string;
  status: number;
  strikes: number;
  blockMs: number;
  remainMs: number;
  /** 真正会发给这个 IP 的 429 页面 */
  html: string;
}

/** 一键触发真实拦截：对当前管理员 IP 真封一次，重复调用按 4 倍升级 */
export const triggerScriptGuardBlock = async (payload?: { ua?: string; path?: string }) => {
  const { data } = await api.post('/script-guard/trigger', payload || {});
  return data as ScriptGuardTriggerResult;
};

/** 硬封禁：不区分 UA，命中后该 IP 的一切请求都返回 429 */
export interface ScriptGuardHardBan {
  ip: string;
  reason: string;
  created_at: string;
  expires_at: string | null;
  permanent: boolean;
  remainMs: number;
  /** 封禁期间被挡下的请求数（内存计数，重启归零） */
  hits: number;
}

export const getScriptGuardBans = async () => {
  const { data } = await api.get('/script-guard/bans');
  return (data.items || []) as ScriptGuardHardBan[];
};

export const addScriptGuardBan = async (payload: { ip: string; reason?: string; durationMs?: number }) => {
  const { data } = await api.post('/script-guard/bans', payload);
  return (data.items || []) as ScriptGuardHardBan[];
};

export const removeScriptGuardBan = async (ip: string) => {
  const { data } = await api.post('/script-guard/bans/remove', { ip });
  return (data.items || []) as ScriptGuardHardBan[];
};

/* ---------------------------------------------------------------------------
 * SEO 收录提交
 *
 * 后端把「访客今日访问过的前台路径」攒进队列，再分批提交给必应与 IndexNow。
 * 注意 bingApiKey 是只写的：读接口永远只返回脱敏后的 bingKeyMasked。
 * ------------------------------------------------------------------------- */

export interface SeoConfig {
  enabled: number;
  autoSubmit: number;
  bingEnabled: number;
  indexNowEnabled: number;
  siteUrl: string;
  batchSize: number;
  dailyLimit: number;
  /** 每天几点（北京时间 0~23）跑自动提交，默认 0 = 每天 0 点提交前一天的 URL */
  submitHour: number;
  minHits: number;
  requestDelayMs: number;
  bingKeyMasked: string;
  bingKeyConfigured: boolean;
  indexNowKey: string;
  indexNowKeyLocation: string;
}

export interface SeoStats {
  pending: number;
  totalQueued: number;
  submittedToday: number;
  failedToday: number;
  successRecent: number;
}

export interface SeoStatus {
  config: SeoConfig;
  stats: SeoStats;
  runtime: {
    running: boolean;
    /** 最近一次自动提交的北京日期（YYYY-MM-DD） */
    lastRunDay: string | null;
    ranToday: boolean;
    /** 下一轮的说明文案，例如「明天 00:00（北京时间）」 */
    nextRunText: string;
    siteOrigin: string;
  };
}

export interface SeoPendingItem {
  id: number;
  path: string;
  url: string;
  hits: number;
}

export interface SeoSubmission {
  id: number;
  url: string;
  channel: string;
  status: string;
  http_status: number | null;
  message: string;
  batch_size: number | null;
  key_masked: string;
  created_at: string;
}

export interface SeoBatchResult {
  skipped?: boolean;
  reason?: string;
  error?: string;
  attempted: number;
  succeeded: number;
  failed: number;
  channels: { channel: string; status: string; httpStatus?: number | null; message?: string; size: number }[];
}

export const getSeoStatus = async () => {
  const { data } = await api.get('/seo/status');
  return data as SeoStatus;
};

export const getSeoPending = async (limit = 200) => {
  const { data } = await api.get('/seo/pending', { params: { limit } });
  return data as { items: SeoPendingItem[]; minHits: number; siteUrl: string };
};

export const getSeoSubmissions = async (params: { page?: number; limit?: number; status?: string; channel?: string; url?: string }) => {
  const { data } = await api.get('/seo/submissions', { params });
  return data as { total: number; page: number; limit: number; items: SeoSubmission[] };
};

export const getSeoQueue = async (limit = 100) => {
  const { data } = await api.get('/seo/queue', { params: { limit } });
  return (data.items || []) as { id: number; path: string; normalized_url: string; hits: number; last_seen: string; submit_status: string }[];
};

export const getSeoQuota = async () => {
  const { data } = await api.get('/seo/quota');
  return data as {
    available: boolean;
    message?: string;
    dailyQuota?: number;
    monthlyQuota?: number | null;
    dailyLimit?: number;
    selfLimit?: number;
  };
};

export const updateSeoConfig = async (payload: Record<string, unknown>) => {
  const { data } = await api.put('/seo/config', payload);
  return data as { updated: number; config: SeoConfig };
};

export const regenerateIndexNowKey = async () => {
  const { data } = await api.post('/seo/indexnow-key', {});
  return data as { indexNowKey: string; indexNowKeyLocation: string };
};

export const runSeoSubmit = async (limit?: number) => {
  const { data } = await api.post('/seo/submit', limit ? { limit } : {});
  return data as SeoBatchResult;
};

export const cleanupSeoQueue = async () => {
  const { data } = await api.post('/seo/queue/cleanup', {});
  return data as { deleted: number };
};
