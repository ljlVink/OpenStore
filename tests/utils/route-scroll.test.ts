import { afterEach, describe, expect, it } from 'vitest';
import { goBackOrHome } from '../../src/utils/route-scroll';

describe('goBackOrHome', () => {
  const makeRouter = () => {
    const calls: string[] = [];
    return {
      calls,
      back: () => {
        calls.push('back');
      },
      push: (to: string) => {
        calls.push(`push:${to}`);
        return Promise.resolve();
      },
    };
  };

  afterEach(() => {
    window.history.replaceState(null, '');
  });

  it('有应用内上一页时优先后退', () => {
    window.history.replaceState({ back: '/apps' }, '');
    const router = makeRouter();
    goBackOrHome(router);
    expect(router.calls).toEqual(['back']);
  });

  it('没有上一页（直接输 URL / 刷新进来）时回首页，而不是原地不动', () => {
    window.history.replaceState({ back: null }, '');
    const router = makeRouter();
    goBackOrHome(router);
    expect(router.calls).toEqual(['push:/']);
  });

  it('可以指定兜底页面（例如更新列表）', () => {
    window.history.replaceState({ back: null }, '');
    const router = makeRouter();
    goBackOrHome(router, '/updates');
    expect(router.calls).toEqual(['push:/updates']);
  });

  it('history.state 为空时也走兜底', () => {
    window.history.replaceState(null, '');
    const router = makeRouter();
    goBackOrHome(router, '/topics');
    expect(router.calls).toEqual(['push:/topics']);
  });
});
