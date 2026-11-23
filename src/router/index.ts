import { createRouter, createWebHistory } from 'vue-router';
import { setupScrollMemory } from '../utils/route-scroll';

const HomeView = () => import('../views/HomeView.vue');
const LoginView = () => import('../views/LoginView.vue');
const NotFoundView = () => import('../views/NotFoundView.vue');
const AppDashboardView = () => import('../views/AppDashboardView.vue');
const NextAppDetailView = () => import('../views/NextAppDetailView.vue');
const AppCardView = () => import('../views/AppCardView.vue');
const AppsView = () => import('../views/AppsView.vue');
const AdminDashboardView = () => import('../views/admin/AdminDashboardView.vue');
const AboutView = () => import('../views/AboutView.vue');
import { useAuthStore } from '../stores/auth';
import { reportPagePath } from '../services/api';
import { applyPageMeta } from '../utils/page-share';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: {
        title: '探索',
        // 分享卡片副标题（人话版）；SEO 用的关键词描述保留在 index.html 的 name="description" 里
        description: '发现最新、最热门的鸿蒙应用，探索 CloseStore 的精彩世界。'
      }
    },
    {
      path: '/apps',
      name: 'apps',
      component: AppsView,
      meta: { title: '应用', description: '浏览CloseStore所有应用，查找你需要的工具和游戏。' }
    },
    {
      path: '/apps/:id',
      name: 'next-app-detail',
      component: NextAppDetailView,
      meta: { title: '应用详情', description: '查看应用详细信息、评分、评论和更新历史。' }
    },
    {
      path: '/app/:id',
      name: 'app-card-detail',
      component: AppCardView,
      meta: { title: '应用详情', description: '应用卡片详情页面' }
    },
    {
      path: '/app-cards',
      name: 'app-cards',
      component: AppCardView,
      meta: { title: '应用列表', description: '应用卡片列表' }
    },
    // 已分享的旧链接跳到当前对应栏目
    { path: '/updates', redirect: { name: 'apps', query: { tab: 'updates' } } },
    { path: '/updates/app/:id', redirect: (to) => `/apps/${encodeURIComponent(String(to.params.id))}` },
    { path: '/topics', redirect: '/' },
    {
      path: '/topics/:id',
      name: 'topic-detail',
      component: () => import('../views/TopicDetailView.vue'),
      meta: { title: '专题详情', description: '查看专题详细信息。' }
    },
    {
      path: '/dashboard',
      name: 'app-dashboard',
      component: AppDashboardView,
      meta: { title: '应用详情', description: '管理和查看你的应用数据仪表盘。' }
    },
    {
      path: '/system-status',
      name: 'system-status',
      component: () => import('../views/SystemStatusView.vue'),
      meta: { title: '系统状态', description: '监控系统核心服务与接口状态。' }
    },
    {
      path: '/about',
      name: 'about',
      component: AboutView,
      meta: { title: '关于', description: '了解 CloseStore 的开发背景和团队信息。' }
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { title: '登录', description: '登录CloseStore账户，享受更多个性化服务。' }
    },
    {
      path: '/admin',
      redirect: '/admin/dashboard',
    },
    {
      path: '/admin/login',
      name: 'admin-login',
      component: LoginView,
      meta: { title: '管理员登录', description: 'CloseStore管理员登录页面。' }
    },
    {
      path: '/admin/dashboard',
      name: 'admin-dashboard',
      component: AdminDashboardView,
      meta: { title: '后台管理', requiresAuth: true, description: 'CloseStore 后台管理系统，管理故障维护和站点设置。' }
    },
    {
      path: '/admin/seo',
      name: 'admin-seo',
      component: () => import('../views/admin/SeoSubmitView.vue'),
      meta: { title: 'SEO 收录', requiresAuth: true, description: '访客路径提交与 sitemap 管理' }
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: NotFoundView,
      meta: { title: '404', description: '页面未找到。' }
    },
  ],
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) {
      return savedPosition;
    }
    return { top: 0 };
  },
});

/*
 * 额外记一层"每个页面离开时滚到哪"，只有浏览器后退时恢复。
 * vue-router 自带的 savedPosition 实测经常取不到（从榜单页返回首页总是顶部），
 * 见 utils/route-scroll.ts 里的 setupScrollMemory。
 */
setupScrollMemory(router);

router.beforeEach((to) => {
  const store = useAuthStore();
  if (to.meta && (to.meta as any).requiresAuth && !store.isLoggedIn()) {
    if (to.path.startsWith('/admin')) {
      return { name: 'admin-login', query: { redirect: to.fullPath } };
    }
    return { name: 'login' };
  }
});

router.afterEach((to) => {
  /*
    标题 / 描述 / og / twitter 统一由 page-share 决定：
    栏目页（探索、应用、专题…）带网站 logo，信息页（应用、专题详情）
    带自己的资源图片和文字。
  */
  applyPageMeta({
    path: to.path,
    fullPath: to.fullPath,
    query: to.query as Record<string, any>,
    meta: to.meta as Record<string, any>,
  });
  
  // 前台路径进 SEO 收录队列（后台路径不报）
  if (!to.path.startsWith('/admin')) {
    reportPagePath(to.fullPath);
  }
});

export default router;
