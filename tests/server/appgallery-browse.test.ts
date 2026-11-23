import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const client = require('../../server/lib/appgallery-client.cjs');
const browsePath = require.resolve('../../server/lib/appgallery-browse.cjs');

const pages = {
  apps: '7be8792c470c4318bfc25379659b0fcb',
  featured: '6be6cf16799340ea8c999fbe7fe0f78b',
  categories: '9b02fa68964c445d92884e21cade8938',
  categoryDetail: '645d811a7d374220bc37be0b56053f23',
  rankings: 'c5df15b4235c41fbabb3d93605aa1a71',
  rankDetail: 'page_79316e6f986640909015769485e39c0b/tab_ee05d2e312d543fdb7953686c67e10be',
  updates: '2a820bc8565c442286609d5f02550dbf'
};

type NativeTab = { title: string; frame: { pageId: string } };
type NativeCard = { type: string; data: unknown[]; title?: string };

const frame = (title: string, pageId: string): NativeTab => ({ title, frame: { pageId } });
const tabs = (list: NativeTab[]) => ({ data: { tab: { selection: 0, list } } });
const card = (kind: string, data: unknown[], title?: string): NativeCard => ({ type: `appgallery.${kind}`, data, title });
const feed = (title: string, layoutData: NativeCard[], dataId = '', hasMore = 0) => ({
  data: { title, cardlist: { layoutData, dataId, hasMore } }
});
const app = (name: string, id: string, extra = {}) => ({ name, appId: id, version: '1.0', ...extra });

function startBrowse(respond: (method: string, params: Record<string, any>) => unknown) {
  vi.spyOn(client, 'callClient').mockImplementation(async (method, request) => {
    const params = request as Record<string, any>;
    switch (params.pageId) {
      case 'HomePage':
        return { pages: [tabs([frame('探索', 'home'), frame('元服务', 'atomic'), frame('应用', pages.apps)])] };
      case pages.apps:
        return { pages: [tabs([
          frame('精选', pages.featured), frame('分类', pages.categories),
          frame('排行榜', pages.rankings), frame('重磅更新', pages.updates)
        ])] };
      default:
        return respond(String(method), params);
    }
  });
  return require(browsePath).getAppGalleryBrowse;
}

afterEach(() => {
  delete require.cache[browsePath];
  vi.restoreAllMocks();
});

describe('华为应用市场栏目', () => {
  it('共享二级页的不同分类仍返回各自的应用', async () => {
    const browse = startBrowse((_method, params) => {
      if (params.pageId === pages.categories) {
        return { pages: [feed('分类', [card('categorycard', [
          { name: '工具', subTitle: '10000000', detailId: pages.categoryDetail, imgUrl: 'https://appimg-drcn.dbankcdn.com/tools.png' },
          { name: '社交', subTitle: '10000016', detailId: pages.categoryDetail, imgUrl: 'https://appimg-drcn.dbankcdn.com/social.png' }
        ])])] };
      }
      if (params.pageId === pages.categoryDetail) {
        const kind = params.businessParam?.preferenceInfo?.secKindIds?.[0];
        const name = kind === '10000000' ? '工具应用' : kind === '10000016' ? '社交应用' : '全部应用';
        return { pages: [feed('分类详情', [card('slide.list.3r.w56h56', [{ list: [app(name, 'C12345678')] }], '新鲜应用')])] };
      }
      throw new Error(`Unexpected page: ${params.pageId}`);
    });
    const tools = await browse({ tab: 'categories', category: '工具', page: 1 });
    const social = await browse({ tab: 'categories', category: '社交', page: 1 });
    expect(tools.sections[0].items[0].name).toBe('工具应用');
    expect(social.sections[0].items[0].name).toBe('社交应用');
    expect(await browse({ tab: 'categories', category: '不存在', page: 1 })).toBeNull();
  });

  it('榜单续页沿用子页会话，保持上游名次而不重复首页', async () => {
    const first = app('榜首', 'C12345678', { sortIndex: 1, downCountDesc: '千万次安装' });
    const next = app('续页', 'C12345679', { sortIndex: 41 });
    const dataId = 'cardGroup:rank-tab^cardlist';
    const browse = startBrowse((method, params) => {
      if (params.pageId === pages.rankings) {
        return { pages: [feed('排行榜', [card('vcompositecard', [{ layoutData: [
          card('vrankingcard', [{ title: '口碑榜', subtitle: '口碑排行', target: pages.rankDetail, list: [first] }])
        ] }])])] };
      }
      if (params.pageId === pages.rankDetail) {
        return {
          pages: [feed('排行榜', [], 'wrong-parent-id'), feed('好评榜', [card('normalcard', [first], '口碑榜')], dataId, 1)],
          setCookie: ['pageCookie=rank-session; Path=/']
        };
      }
      if (method === 'client.getCardList') {
        const nextPage = params.dataId === dataId && params.pageNum === 2 && params.cookie === 'pageCookie=rank-session';
        return { hasMore: 0, layoutData: [card('normalcard', [nextPage ? next : first], '口碑榜')] };
      }
      throw new Error(`Unexpected page: ${params.pageId}`);
    });
    const overview = await browse({ tab: 'rankings', page: 1 });
    const rank = overview.sections[0].rank;
    const firstPage = await browse({ tab: 'rankings', rank, page: 1 });
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.sections[0].items[0]).not.toHaveProperty('download_count_desc');
    const secondPage = await browse({ tab: 'rankings', rank, page: 2 });
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.sections[0].items[0]).toMatchObject({ name: '续页', position: 41 });
  });

  it('重磅更新以中国日期分组并保留版本说明换行', async () => {
    const browse = startBrowse(() => ({ pages: [feed('重磅更新', [card('heavyupdatecard', [{ list: [
      app('隔夜更新', 'C12345678', { releaseTimestamp: Date.UTC(2026, 10, 21, 17), newFeatures: '新功能\n修复问题' }),
      app('同日更新', 'C12345679', { releaseTimestamp: Date.UTC(2026, 10, 22, 7) }),
      app('前一天', 'C12345680', { releaseTimestamp: Date.UTC(2026, 10, 21, 12) })
    ] }])])] }));
    const result = await browse({ tab: 'updates', page: 1 });
    expect(result.updates.map((group: { date: string }) => group.date)).toEqual(['2026-11-22', '2026-11-21']);
    expect(result.updates[0].items).toMatchObject([{ name: '隔夜更新', notes: '新功能\n修复问题' }, { name: '同日更新' }]);
  });
});
