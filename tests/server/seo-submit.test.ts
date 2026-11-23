import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// 服务端模块是 CJS 且无类型声明，按 CJS 引入
const require = createRequire(import.meta.url);
const { normalizeUrl, enqueuePath, runDailyTick, runSubmission, saveSettings, loadConfig } = require('../../server/lib/seo-submit.cjs');

/*
 * URL、调度与写入生命周期的确定性测试，不访问数据库或搜索引擎。
 * query 依赖模拟并发原子声明；PostgreSQL SQL 由集成测试验证。
 */

const SITE = 'https://seo-test.local';

describe('SEO URL 归一化', () => {
  const norm = (p: string) => normalizeUrl(p, SITE);

  it('同一页面的不同写法归一到同一 URL', () => {
    expect(norm('/apps/com.demo/')).toBe(`${SITE}/apps/com.demo`);
    expect(norm('/topics/hello?utm_source=x&from=share')).toBe(`${SITE}/topics/hello`);
    expect(norm('/dashboard?b=2&a=1')).toBe(`${SITE}/dashboard?a=1&b=2`);
    expect(norm('/dashboard?app_id=9')).toBe(`${SITE}/dashboard?app_id=9`);
    expect(norm('/')).toBe(`${SITE}/`);
  });

  it('丢弃不影响渲染的参数，避免同一页面产生多条 URL', () => {
    // title 是页面标题的展示副本；时间戳与 el-id 是埋点/组件内部产物
    for (const noisy of [
      '/apps/C123?title=QQ邮箱',
      '/?ide_webview_request_time=1768362351837',
      '/?from=/topics',
      '/apps/C123?title=x&utm_source=wx&el-id-2212-5=app',
      '/apps/C123?_t=123&ts=456'
    ]) {
      expect(norm(noisy)).toBe(`${SITE}${noisy.split('?')[0]}`);
    }
  });

  it('保留影响页面内容的参数', () => {
    expect(norm('/apps?category=工具')).toBe(`${SITE}/apps?category=${encodeURIComponent('工具')}`);
    expect(norm('/apps?device=phone')).toBe(`${SITE}/apps?device=phone`);
    expect(norm('/updates?tab=new&filter=thisWeek&page=2')).toBe(
      `${SITE}/updates?filter=thisWeek&page=2&tab=new`
    );
  });

  it('拒绝站外地址与无页面语义的输入', () => {
    expect(norm('https://evil.com/x')).toBe('');
    expect(norm('//evil.com/x')).toBe('');
    expect(norm('')).toBe('');
    expect(norm('   ')).toBe('');
    expect(norm('apps')).toBe('');
    expect(norm('javascript:alert(1)')).toBe('');
  });

  it('过滤后台、接口、静态资源与已下线页面', () => {
    for (const bad of ['/admin/dashboard', '/api/public/apps', '/login', '/submit', '/music', '/player', '/articles', '/articles/hello', '/rank/category', '/uploads/a.png', '/favicon.ico']) {
      expect(norm(bad)).toBe('');
    }
    for (const good of ['/apps/com.foo', '/topics/t1', '/about']) {
      expect(norm(good)).not.toBe('');
    }
  });
});

describe('SEO 后台路由的中间件挂载方式', () => {
  // vitest 的 cwd 即项目根
  const routeSource = () => readFileSync('server/routes/seo.cjs', 'utf8');

  it('不得使用 router.use 声明鉴权（挂根路径时会拦截全站请求）', () => {
    // 本路由经 app.use(router) 挂在根路径，router.use 的中间件会对所有请求执行。
    // 曾因此把 /api/auth/login 一并拦成 401，导致全站无法登录。
    const code = routeSource().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/router\.use\s*\(/);
  });

  it('每条后台路由都挂了鉴权中间件', () => {
    const routes = [...routeSource().matchAll(/router\.(get|put|post)\('(\/api\/admin\/seo[^']*)',\s*([A-Za-z_$][\w$]*)/g)];
    expect(routes.length).toBeGreaterThanOrEqual(9);
    const withoutAuth = routes.filter((m) => m[3] !== 'auth').map((m) => m[2]);
    expect(withoutAuth).toEqual([]);
  });
});

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };

/** Models durable state shared by independent invocations, with no process-local scheduler state. */
const schedulerHarness = (patch: Record<string, string> = {}, previousDay = '') => {
  const now = Date.parse('2026-11-23T16:30:00Z'); // Beijing November 24, 00:30.
  const settings = {
    seo_enabled: '1',
    seo_autoSubmit: '1',
    seo_submitHour: '0',
    seo_siteUrl: SITE,
    seo_bingEnabled: '0',
    seo_indexNowEnabled: '1',
    seo_indexnow_key: 'deterministic-indexnow-key',
    seo_requestDelayMs: '0',
    ...patch
  };
  const state = { day: previousDay, lock: '', recorded: [] as unknown[], configReads: 0 };
  const result = (rows: Record<string, unknown>[] = []): QueryResult => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (sql: string, values: unknown[] = []): Promise<QueryResult> => {
    if (sql.startsWith('SELECT key, value')) {
      state.configReads += 1;
      return result(Object.entries(settings).map(([key, value]) => ({ key, value })));
    }
    if (sql.startsWith('INSERT INTO system_settings')) {
      if (values[0] === 'seo_submission_lock') {
        if (state.lock) return result();
        state.lock = String(values[1]);
        return result([{ value: state.lock }]);
      }
      if (values[0] === 'seo_last_run_day') {
        if (state.day >= String(values[1])) return result();
        state.day = String(values[1]);
        return result([{ value: state.day }]);
      }
    }
    if (sql.startsWith('UPDATE system_settings')) {
      return result(state.lock === values[1] ? [{ value: state.lock }] : []);
    }
    if (sql.startsWith('DELETE FROM system_settings')) {
      if (state.lock === values[1]) state.lock = '';
      return result();
    }
    if (sql.includes('COUNT(DISTINCT url)')) return result([{ n: 0 }]);
    if (sql.includes('SELECT id, path, normalized_url, hits')) {
      return result([{ id: 1, path: '/apps/cron', normalized_url: `${SITE}/apps/cron`, hits: 1 }]);
    }
    if (sql.startsWith('WITH recorded')) {
      state.recorded.push(values);
      return result();
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const post = vi.fn(async () => ({ status: 202, data: {} }));
  return { now, state, query, post, deps: { query, now: () => now, axios: { post } } };
};

describe('SEO 每日调度', () => {
  it('按控制器时间判断是否到点，而不是按延迟送达时间', async () => {
    const h = schedulerHarness({ seo_submitHour: '1' });
    const result = await runDailyTick({
      scheduledTime: h.now,
      deps: { ...h.deps, now: () => h.now + 2 * 3600000 }
    });
    expect(result.reason).toContain('未到');
    expect(h.state.day).toBe('');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('跨 UTC 日期使用北京时间，先持久化当日声明再提交', async () => {
    const h = schedulerHarness();
    h.post.mockImplementationOnce(async () => {
      expect(h.state.day).toBe('2026-11-24');
      expect(h.state.lock).not.toBe('');
      return { status: 202, data: {} };
    });
    const result = await runDailyTick({ scheduledTime: h.now, deps: h.deps });
    expect(result).toMatchObject({ day: '2026-11-24', source: 'scheduler', succeeded: 1, attempted: 1 });
    expect(h.state.recorded).toHaveLength(1);
    expect(h.state.lock).toBe('');
  });

  it('并发与稍后重复事件只提交一次', async () => {
    const h = schedulerHarness();
    await Promise.all([
      runDailyTick({ scheduledTime: h.now, deps: h.deps }),
      runDailyTick({ scheduledTime: h.now, deps: h.deps })
    ]);
    const duplicate = await runDailyTick({ scheduledTime: h.now, deps: h.deps });
    expect(duplicate.skipped).toBe(true);
    expect(duplicate.reason).toContain('已经执行过');
    expect(h.post).toHaveBeenCalledTimes(1);
  });

  it('不允许当日事件覆盖更新的持久化日期', async () => {
    const h = schedulerHarness({}, '2026-11-25');
    const result = await runDailyTick({ scheduledTime: h.now, deps: h.deps });
    expect(result.skipped).toBe(true);
    expect(h.state.day).toBe('2026-11-25');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('拒绝上个北京日期的延迟事件、未来事件和无效时间', async () => {
    const h = schedulerHarness();
    for (const timestamp of [h.now - 3600000, h.now + 1000, Number.NaN, 8640000000000000]) {
      const result = await runDailyTick({ scheduledTime: timestamp, deps: h.deps });
      expect(result.skipped).toBe(true);
    }
    expect(h.query).not.toHaveBeenCalled();
    expect(h.post).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([{ seo_enabled: '0' }, { seo_autoSubmit: '0' }])('关闭配置不声明日期：%j', async (patch) => {
    const h = schedulerHarness(patch);
    expect((await runDailyTick({ scheduledTime: h.now, deps: h.deps })).skipped).toBe(true);
    expect(h.state.day).toBe('');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('手动提交持有数据库锁时不消耗当日调度机会', async () => {
    const h = schedulerHarness();
    h.state.lock = 'other-invocation';
    const result = await runDailyTick({ scheduledTime: h.now, deps: h.deps });
    expect(result).toMatchObject({ skipped: true, busy: true });
    expect(h.state.day).toBe('');
    expect(h.state.lock).toBe('other-invocation');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('通道失败后保留当日声明，不重复提交并释放锁', async () => {
    const h = schedulerHarness();
    h.post.mockRejectedValueOnce(new Error('network unavailable'));
    const first = await runDailyTick({ scheduledTime: h.now, deps: h.deps });
    expect(first).toMatchObject({ failed: 1, succeeded: 0 });
    expect(h.state.lock).toBe('');
    expect(h.state.day).toBe('2026-11-24');
    await runDailyTick({ scheduledTime: h.now, deps: h.deps });
    expect(h.post).toHaveBeenCalledTimes(1);
  });

  it('手动提交不会写入每日调度声明', async () => {
    const h = schedulerHarness();
    const result = await runSubmission({ source: 'manual', deps: h.deps });
    expect(result.succeeded).toBe(1);
    expect(h.state.day).toBe('');
    expect(h.state.lock).toBe('');
  });

  it('配置读取失败不会用默认配置执行', async () => {
    const h = schedulerHarness();
    h.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(runDailyTick({ scheduledTime: h.now, deps: h.deps })).rejects.toThrow('database unavailable');
    expect(h.post).not.toHaveBeenCalled();
  });
});

describe('SEO 写入生命周期', () => {
  it('不合格路径返回已完成 Promise，不访问数据库', async () => {
    const query = vi.fn();
    await expect(enqueuePath('/api/private', SITE, { query })).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it('入队 Promise 包含完整数据库写入，可交给 waitUntil', async () => {
    let queryComplete = false;
    const query = vi.fn(async () => {
      await Promise.resolve();
      await Promise.resolve();
      queryComplete = true;
    });
    let settled = false;
    const pending = enqueuePath('/apps/demo?utm_source=test', SITE, { query }).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(queryComplete).toBe(false);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT(dedupe_key)'), [
      '/apps/demo?utm_source=test', `${SITE}/apps/demo`, `${SITE}/apps/demo`
    ]);
    await pending;
    expect(settled).toBe(true);
    expect(queryComplete).toBe(true);
  });

  it('入队数据库错误向调用者传播，便于 defer 记录', async () => {
    const query = vi.fn().mockRejectedValue(new Error('write failed'));
    await expect(enqueuePath('/apps/demo', SITE, { query })).rejects.toThrow('write failed');
  });

  it('多项配置在单个语句中原子保存', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 2 });
    expect(await saveSettings({ enabled: 0, submitHour: 8 }, { query })).toEqual({ updated: 2 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('($1, $2, CURRENT_TIMESTAMP),($3, $4, CURRENT_TIMESTAMP)'), [
      'seo_enabled', '0', 'seo_submitHour', '8'
    ]);
  });

  it('配置写入失败不会报告成功', async () => {
    const query = vi.fn().mockRejectedValue(new Error('write failed'));
    expect(await saveSettings({ enabled: 0 }, { query })).toEqual({ updated: 0, error: 'write failed' });
  });

  it('缺少 IndexNow key 时使用数据库返回的并发获胜 key', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ value: 'another-invocation-key' }], rowCount: 1 });
    const config = await loadConfig({ query });
    expect(config.indexNowKey).toBe('another-invocation-key');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
