/**
 * 各页面卡片的默认配置。
 * 建库时的种子数据、以及后台「恢复默认」都以这份为准：
 *   page  页面标识（home = 首页「首页」页签，system = 首页「系统」页签，about = 关于页面）
 *   key   卡片标识，前端按它渲染对应的板块
 *   title 后台里显示的名称（system 页签的卡片会把它当前端卡片标题）
 */
module.exports = [
  // 首页 · 首页页签
  { page: 'home', key: 'topic-spotlight', title: '精选专题', sort_order: 30 },
  { page: 'home', key: 'rank-overview', title: '榜单排行', sort_order: 40 },
  { page: 'home', key: 'app-list', title: '应用搜索', sort_order: 60 },

  // 首页 · 系统页签
  { page: 'system', key: 'announcements', title: '公告', sort_order: 20, style: { span: 24, accent: 'bg-yellow' } },
  { page: 'system', key: 'apps', title: '应用', sort_order: 30, style: { span: 24, accent: 'bg-yellow' } },
  { page: 'system', key: 'friend_links', title: '友情链接', sort_order: 40, style: { span: 12, accent: 'bg-yellow' } },
  { page: 'system', key: 'group_chats', title: '群聊', sort_order: 50, style: { span: 12, accent: 'bg-green' } },

  // 关于页面
  { page: 'about', key: 'hero', title: '页面头部', sort_order: 5 },
  { page: 'about', key: 'content', title: '页面内容', sort_order: 10 },
  { page: 'about', key: 'social', title: '联系我们', sort_order: 15 },
  { page: 'about', key: 'contributors', title: '鸣谢', sort_order: 35 },
  { page: 'about', key: 'commits', title: '最近提交', sort_order: 50 },
];
