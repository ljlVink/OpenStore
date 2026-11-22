import axios, { type AxiosRequestConfig } from 'axios';
import { translateAppsListCall } from './upstream-compat';

interface CacheItem<T> {
  data: T;
  timestamp: number;
}

/** 应用列表的缓存时长：够新，又能挡掉重复请求 */
const LIST_TTL_MS = 45_000;

interface HmApiClientConfig {
  baseUrl: string;
  /** 可选的备用线路；留空即只走主线路，不做任何降级（默认） */
  fallbackUrl?: string;
}

/**
 * HarmonyOS 应用市场 API 客户端：本站代理优先，按路径缓存 + 并发去重。
 * 降级默认关闭（要启用配 VITE_API_FALLBACK），否则被封后前端会静默直连上游。
 */
class HmApiClient {
  private primaryBaseUrl: string;
  private fallbackUrl: string;
  private cache: Map<string, CacheItem<any>> = new Map();
  private inFlight: Map<string, Promise<any>> = new Map();

  /** 主线路最近一次失败时间；冷却期内先走备用线路，冷却结束再试主线路 */
  private primaryFailedAt = 0;
  private static readonly PRIMARY_COOLDOWN_MS = 60 * 1000;

  constructor(config: HmApiClientConfig) {
    this.primaryBaseUrl = config.baseUrl;
    // 没配备用线路时两者相同 —— getBaseCandidates 只返回一个候选，等于完全不降级
    this.fallbackUrl = String(config.fallbackUrl || '').trim() || config.baseUrl;
  }

  /** 按优先级返回本次请求要尝试的线路 */
  private getBaseCandidates(): string[] {
    if (this.primaryBaseUrl === this.fallbackUrl) return [this.primaryBaseUrl];

    const primaryCoolingDown = Date.now() - this.primaryFailedAt < HmApiClient.PRIMARY_COOLDOWN_MS;
    return primaryCoolingDown
      ? [this.fallbackUrl, this.primaryBaseUrl]
      : [this.primaryBaseUrl, this.fallbackUrl];
  }

  /** 记录主线路健康状态：成功即解除冷却，失败则开始冷却 */
  private recordPrimaryResult(baseUrl: string, ok: boolean) {
    if (baseUrl !== this.primaryBaseUrl) return;
    this.primaryFailedAt = ok ? 0 : Date.now();
  }

  /** 依次尝试候选线路，全部失败时抛出最后一个错误 */
  private async sendWithFailover<T>(
    label: string,
    send: (baseUrl: string) => Promise<{ data: T }>
  ): Promise<T> {
    const candidates = this.getBaseCandidates();
    let lastError: unknown;

    for (let i = 0; i < candidates.length; i++) {
      const baseUrl = candidates[i];
      try {
        const response = await send(baseUrl);
        this.recordPrimaryResult(baseUrl, true);
        return response.data;
      } catch (error) {
        lastError = error;
        this.recordPrimaryResult(baseUrl, false);

        const nextBaseUrl = candidates[i + 1];
        if (nextBaseUrl) {
          console.warn(`[HmApi] Request to ${baseUrl}${label} failed, trying fallback ${nextBaseUrl}...`);
        }
      }
    }

    console.error(`[HmApi] All endpoints failed for ${label}`, lastError);
    throw lastError;
  }

  private getCacheKey(path: string, params?: any): string {
    const queryString = params
      ? Object.entries(params)
          .filter(([_, v]) => v !== undefined && v !== null)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${String(v)}`)
          .join('&')
      : '';
    return `${path}?${queryString}`;
  }

  /** 缓存时长（毫秒）：应用列表 / 按条件查询的应用集 45s，其余不缓存 */
  private guessTtlMs(path: string): number {
    if (path.includes('apps/list')) return LIST_TTL_MS;
    if (path.includes('apps/query')) return LIST_TTL_MS;
    return 0; // 默认不缓存
  }

  /** 清缓存（不传参数 = 全清）；后台改内容后调用，不用干等 TTL 过期 */
  public clearCache(match?: (key: string) => boolean) {
    if (!match) {
      this.cache.clear();
      return;
    }
    for (const key of [...this.cache.keys()]) {
      if (match(key)) this.cache.delete(key);
    }
  }

  public async get<T>(path: string, params?: any, config?: AxiosRequestConfig): Promise<T> {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const cacheKey = this.getCacheKey(normalizedPath, params);
    const ttl = this.guessTtlMs(normalizedPath);

    if (ttl > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ttl) {
        return cached.data;
      }
    }

    // 同一个请求正在飞：直接复用，避免并发打上游
    if (this.inFlight.has(cacheKey)) {
      return this.inFlight.get(cacheKey) as Promise<T>;
    }

    // /apps/list/<n> 统一翻译成 /apps/query（POST），避开被上游风控的接口
    const translated = translateAppsListCall(normalizedPath, params);
    const requestPath = translated ? translated.path : normalizedPath;
    const requestPromise = this.sendWithFailover(requestPath, (baseUrl) => {
      const url = `${baseUrl}${requestPath}`;
      return translated
        ? axios.post<T>(url, translated.body, {
            ...config,
            headers: { 'Content-Type': 'application/json', ...(config?.headers || {}) }
          })
        : axios.get<T>(url, { ...config, params });
    });

    this.inFlight.set(cacheKey, requestPromise);

    try {
      const data = await requestPromise;
      if (ttl > 0) {
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
      }
      return data;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  public async post<T>(path: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    // axios 在 Content-Type=application/json 时会把 null 序列化成字面量 "null"，
    // 严格模式的 JSON 解析（包括本项目服务端的 express.json 默认 strict）会直接 400，
    // 所以这里统一把空 body 归一成 {}。
    const payload = data ?? {};

    const finalConfig = {
      ...config,
      headers: {
        'Content-Type': 'application/json',
        ...(config?.headers || {})
      }
    };

    return this.sendWithFailover(normalizedPath, (baseUrl) =>
      axios.post<T>(`${baseUrl}${normalizedPath}`, payload, finalConfig)
    );
  }
}

export const hmApi = new HmApiClient({
  baseUrl: '/api/v0', // 走本站代理
  // 备用直连，默认关闭（不配则候选线路只有 /api/v0）；填了会构建进 JS 包，不是秘密
  fallbackUrl: import.meta.env.VITE_API_FALLBACK
});
