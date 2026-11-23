/*
 * ---- 分享卡片（og / twitter meta）----
 * 微信、QQ、Twitter、Telegram 这类抓取器不执行 JS，卡片的图和文案必须在服务端就写好。
 * 规则：
 *   - 栏目页（探索 / 应用 / 专题 / 更新 / 关于…）：带网站 logo + 该栏目自己的标题、描述
 *   - 信息页（应用详情、更新详情、应用面板、专题详情）：带当前页面的资源图片（应用图标 / 专题首图）与文字
 * 栏目页只做字符串替换；信息页只有抓取器才会去查上游，应用和专题各自缓存。
 * 普通用户拿到的仍是静态壳，不增加首屏延迟。
 */
const fs = require('fs');
const path = require('path');
const { getAppGalleryTopic } = require('./appgallery-topics.cjs');
const { getAppGalleryApp } = require('./appgallery-apps.cjs');
/*
 * ---- 分享卡片（og / twitter meta）----
 * 微信、QQ、Twitter、Telegram 这类抓取器不执行 JS，卡片的图和文案必须在服务端就写好。
 * 规则：
 *   - 栏目页（探索 / 应用 / 专题 / 更新 / 关于…）：带网站 logo + 该栏目自己的标题、描述
 *   - 信息页（应用详情、更新详情、应用面板、专题详情）：带当前页面的资源图片（应用图标 / 专题首图）与文字
 * 栏目页只做字符串替换；信息页只有抓取器才会去查华为应用市场（30 分钟内存缓存），
 * 普通用户拿到的仍是静态壳，不增加首屏延迟。
 */
const SITE_ORIGIN = String(process.env.SITE_ORIGIN || 'https://next.betahub.tech').replace(/\/+$/, '');
const SITE_LOGO_URL = `${SITE_ORIGIN}/og-image.png`;
const SITE_NAME = 'CloseStore';
const SITE_DEFAULT_DESCRIPTION =
  'CloseStore 提供华为应用市场看板、鸿蒙应用看板与鸿蒙应用数据面板，支持应用探索、专题与更新动态。';

/** 栏目页：标题 / 描述用本栏目的，分享图统一用网站 logo */
const PAGE_SHARE_META = {
  // 首页分享的副标题用一句人话；SEO 描述还是那句带关键词的（只写进 name="description"）
  '/': {
    title: '鸿蒙应用市场面板',
    description: '发现最新、最热门的鸿蒙应用，探索 CloseStore 的精彩世界。',
    seoDescription: SITE_DEFAULT_DESCRIPTION
  },
  '/games': { title: '游戏', description: '浏览华为应用市场的精选游戏、分类、榜单与更新。' },
  '/apps': { title: '应用', description: '浏览华为应用市场的精选应用、分类、榜单与更新。' },
  '/app-cards': { title: '应用列表', description: '应用卡片列表。' },
  '/system-status': { title: '系统状态', description: '监控系统核心服务与接口状态。' },
  '/about': { title: '关于', description: '了解 CloseStore 的开发背景和团队信息。' }
};

/** 抓取器（含微信 / QQ / 微博等国内平台的预览抓取） */
const CRAWLER_UA_RE =
  /(bot|crawler|spider|facebookexternalhit|twitterbot|slackbot|telegrambot|whatsapp|discordbot|embedly|pinterest|quora|linkedinbot|skypeuripreview|line-poker|micromessenger|wechat|weibo|qzone|qq\/|qqbrowser|tencent|tim\/|qihoo|baiduspider|sogou|yisou|toutiao|bytespider|petalbot|applebot|googlebot|bingbot|yandex|duckduckbot|curl\/|wget\/|python-requests|go-http-client|okhttp|axios\/)/i;

const clampShareText = (text, max = 110) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
};

const escapeHtmlAttr = (value) =>
  String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 上游相对路径 / 站内相对路径 → 绝对地址（抓取器只认绝对图片地址） */
const absoluteSiteAsset = (url) => {
  if (!url) return '';
  const raw = String(url).trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw.startsWith('/') ? `${SITE_ORIGIN}${raw}` : `${SITE_ORIGIN}/${raw}`;
};

/**
 * 分享卡片优先用 PNG：上游应用图标是 webp，微信能认但 QQ / QQ 空间对 webp 支持很差，
 * 同路径把后缀换成 .png 上游 CDN 同样返回真实 PNG（已实测多枚图标），兼容性更稳。
 */
const preferPngForShare = (url) => {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return '';
  return raw.replace(/\.webp(\?.*)?$/i, '.png$1');
};

// 分享卡片缓存：抓取器打过来才查上游，同一条结果 30 分钟内不再重复请求
const shareCardCache = new Map();
const SHARE_CARD_OK_TTL_MS = 30 * 60 * 1000;
const SHARE_CARD_FAIL_TTL_MS = 5 * 60 * 1000;
const SHARE_CARD_MAX = 400;

const readShareCardCache = (key) => {
  const hit = shareCardCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    shareCardCache.delete(key);
    return undefined;
  }
  return hit.value;
};

const writeShareCardCache = (key, value) => {
  if (shareCardCache.size >= SHARE_CARD_MAX) {
    const oldest = shareCardCache.keys().next().value;
    if (oldest !== undefined) shareCardCache.delete(oldest);
  }
  shareCardCache.set(key, {
    value,
    expiresAt: Date.now() + (value ? SHARE_CARD_OK_TTL_MS : SHARE_CARD_FAIL_TTL_MS)
  });
};

/** 应用信息 → 卡片：标题是应用名称，副标题（描述）是「应用简介」（不是长「应用说明」），图是应用图标 */
const buildAppShareCard = (info) => {
  if (!info || !info.name) return null;
  const desc =
    info.brief_desc || info.briefDesc || info.short_desc || info.intro || info.description || info.kind_name || '';
  return {
    title: info.name,
    docTitle: `${SITE_NAME} | ${info.name}`,
    description: clampShareText(desc),
    image: absoluteSiteAsset(preferPngForShare(info.icon_url || info.icon || '')) || SITE_LOGO_URL
  };
};

/** 应用详情（应用 / 更新 / 面板三个入口共用） */
const fetchAppShareCard = async (appId) => {
  if (!appId) return null;
  const key = `app:${appId}`;
  const cached = readShareCardCache(key);
  if (cached !== undefined) return cached;

  let card = null;
  try {
    const app = await getAppGalleryApp(appId);
    card = app ? buildAppShareCard(app.info) : null;
    // 原始信息供结构化数据使用（评分、开发者、分类等），避免再次请求
    if (card) card.upstreamInfo = app.info;
  } catch (error) {
    console.warn('[share-card] 应用信息查询失败：', appId, error.message);
  }
  writeShareCardCache(key, card);
  return card;
};

/** 专题里没有封面图，用第一个应用的图标当资源图片 */
const fetchTopicShareCard = async (topicId) => {
  try {
    const topic = await getAppGalleryTopic(topicId);
    if (!topic) return null;
    const firstIcon = topic.apps.find((app) => app.icon_url)?.icon_url;
    return {
      title: topic.title,
      docTitle: `${SITE_NAME} | ${topic.title}`,
      description: clampShareText(topic.subtitle || topic.description),
      image: absoluteSiteAsset(preferPngForShare(firstIcon)) || SITE_LOGO_URL
    };
  } catch (error) {
    console.warn('[share-card] 专题信息查询失败：', topicId, error.message);
    return null;
  }
};

// dist/index.html 读一次缓存 60s，部署换包后最多 1 分钟生效
let shareShellCache = { html: '', at: 0 };
const readShareShell = () =>
  new Promise((resolve) => {
    if (shareShellCache.html && Date.now() - shareShellCache.at < 60000) {
      resolve(shareShellCache.html);
      return;
    }
    // 注意：本文件在 server/lib/ 下，dist 在项目根
    fs.readFile(path.join(__dirname, '../../dist/index.html'), 'utf8', (err, html) => {
      if (err) {
        resolve(shareShellCache.html || '');
        return;
      }
      shareShellCache = { html, at: Date.now() };
      resolve(html);
    });
  });

/** 把卡片信息写进 HTML 的 meta 里 */
const applyShareCardToHtml = (html, card) => {
  let out = html;
  const setTag = (attr, name, content) => {
    const value = escapeHtmlAttr(content);
    const re = new RegExp(`<meta\\s+${attr}="${name}"\\s+content="[\\s\\S]*?"\\s*\\/?>`, 'i');
    if (re.test(out)) out = out.replace(re, `<meta ${attr}="${name}" content="${value}" />`);
    else out = out.replace('</head>', `<meta ${attr}="${name}" content="${value}" />\n</head>`);
  };
  const dropTag = (attr, name) => {
    const re = new RegExp(`\\s*<meta\\s+${attr}="${name}"\\s+content="[\\s\\S]*?"\\s*\\/?>`, 'i');
    out = out.replace(re, '');
  };

  // 标签页标题统一「CloseStore | X」，卡片标题（og:title）信息页用资源名本身
  const docTitle = card.docTitle || card.title;
  if (out.includes('<title>')) out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtmlAttr(docTitle)}</title>`);
  else out = out.replace('</head>', `<title>${escapeHtmlAttr(docTitle)}</title>\n</head>`);

  const isSiteLogo = card.image === SITE_LOGO_URL;
  setTag('name', 'description', card.seoDescription || card.description);
  setTag('property', 'og:title', card.title);
  setTag('property', 'og:description', card.description);
  setTag('property', 'og:url', card.url);
  setTag('property', 'og:image', card.image);
  setTag('property', 'og:image:url', card.image);
  setTag('property', 'og:image:secure_url', card.image);
  // 网站 logo 是 630×630 PNG（写死尺寸让 QQ 认）；应用图标尺寸不一，干脆不声明
  if (isSiteLogo) {
    setTag('property', 'og:image:type', 'image/png');
    setTag('property', 'og:image:width', '630');
    setTag('property', 'og:image:height', '630');
  } else {
    dropTag('property', 'og:image:type');
    dropTag('property', 'og:image:width');
    dropTag('property', 'og:image:height');
  }
  setTag('property', 'og:image:alt', isSiteLogo ? SITE_NAME : card.title);
  setTag('name', 'twitter:card', 'summary_large_image');
  setTag('name', 'twitter:title', card.title);
  setTag('name', 'twitter:description', card.description);
  setTag('name', 'twitter:image', card.image);
  // 微信外的腾讯系（QQ / QQ 空间）读 Schema.org 微数据
  setTag('itemprop', 'name', card.title);
  setTag('itemprop', 'description', card.description);
  setTag('itemprop', 'image', card.image);
  // 老爬虫兜底：<link rel="image_src">
  const srcRe = /<link\s+rel="image_src"\s+href="[\s\S]*?"\s*\/?>/i;
  if (srcRe.test(out)) out = out.replace(srcRe, `<link rel="image_src" href="${escapeHtmlAttr(card.image)}" />`);
  else out = out.replace('</head>', `<link rel="image_src" href="${escapeHtmlAttr(card.image)}" />\n</head>`);
  return out;
};

/**
 * 写入 `<link rel="canonical">`。
 *
 * 详情页存在多种等价 URL（同一个应用可由 /apps/X、/dashboard?app_id=X、
 * /app/X 进入，还常带 ?title= 之类展示参数），不声明权威地址会被视为重复内容。
 *
 * @param {string} url 权威地址（绝对 URL）
 */
const applyCanonicalToHtml = (html, url) => {
  if (!url) return html;
  const tag = `<link rel="canonical" href="${escapeHtmlAttr(url)}" />`;
  const re = /<link\s+rel="canonical"\s+href="[\s\S]*?"\s*\/?>/i;
  if (re.test(html)) return html.replace(re, tag);
  return html.replace('</head>', `${tag}\n</head>`);
};

module.exports = { SITE_ORIGIN, SITE_LOGO_URL, SITE_NAME, SITE_DEFAULT_DESCRIPTION, PAGE_SHARE_META, CRAWLER_UA_RE, fetchTopicShareCard, fetchAppShareCard, readShareShell, applyShareCardToHtml, applyCanonicalToHtml };
