/** 固定联系入口，公开页面与后台预览共用。 */
export const TELEGRAM_CONTACT_URL = 'https://t.me/firmwarefetcher';

/**
 * 鸣谢名单里的一位贡献者。
 * github 存的是**用户名**（不是主页地址）——头像直接由用户名拼出来，不用另存一份，
 * 换了头像前台自动就跟着变。
 */
export interface Contributor {
  github: string;
  /** 展示名；留空就用 GitHub 用户名 */
  name?: string;
}

/** 鸣谢名单默认为空，由后台自己维护 */
export const DEFAULT_CONTRIBUTORS: Contributor[] = [];

/**
 * 从「用户输入」里取出 GitHub 用户名。
 * 后台允许直接粘主页地址，也允许只写用户名，两种都要能认：
 *   https://github.com/XiaoChuangll/  → XiaoChuangll
 *   github.com/XiaoChuangll           → XiaoChuangll
 *   XiaoChuangll                      → XiaoChuangll
 */
export const githubLoginFrom = (input: string): string => {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  let value = raw;
  try {
    // 没写协议时补一个，方便把 "github.com/xxx" 也当 URL 解析
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (/(^|\.)github\.com$/i.test(url.hostname)) {
      value = url.pathname.replace(/^\/+/, '');
    }
  } catch {
    // 不是 URL，按纯用户名处理
  }
  return value.split(/[/?#]/)[0].replace(/\.git$/i, '').trim();
};

export const githubProfileUrl = (login: string) => `https://github.com/${githubLoginFrom(login)}`;

/**
 * GitHub 头像地址。
 * 用 github.com/<user>.png 这个官方重定向端点，不需要 token、也没有速率限制；
 * 尺寸给 2 倍展示尺寸，避免高分屏发虚。
 */
export const githubAvatarUrl = (login: string, size = 160) => {
  const user = githubLoginFrom(login);
  return user ? `https://github.com/${user}.png?size=${size}` : '';
};

/** 清洗后台传来的鸣谢名单：没有 GitHub 用户名的条目直接丢掉 */
export const normalizeContributors = (value: unknown): Contributor[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const raw = item as Partial<Contributor> | null;
      const github = githubLoginFrom(String(raw?.github ?? ''));
      if (!github) return null;
      const name = String(raw?.name ?? '').trim();
      return name ? { github, name } : { github };
    })
    .filter((item): item is Contributor => item !== null);
};
