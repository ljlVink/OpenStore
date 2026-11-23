<template>
  <div class="admin-dashboard">
    <div class="admin-layout" :class="{ 'is-collapsed': menuCollapsed }">
      <!--
        宽屏：左侧面板式导航（分组 + 菜单项 + 底部操作）。
        窄屏：导航变成顶部栏，只列分类，点分类才展开该分类下的菜单。
        菜单项统一由 MENU_GROUPS 渲染，全部显示。
      -->
      <aside class="admin-sidebar" :class="{ 'is-collapsed': menuCollapsed, 'is-scrolled': isPageScrolled }">
      <template v-if="!isNarrow">
        <!-- 顶部品牌：logo + 站点名（logo 与顶栏同一个 mask 图案） -->
        <div class="admin-brand">
          <BrandMark class="admin-brand-logo" :size="22" />
          <span class="admin-brand-name">CloseStore</span>
        </div>

        <div class="admin-menu-wrap">
          <el-menu
            :default-active="active"
            :collapse="menuCollapsed"
            :collapse-transition="false"
            class="admin-menu"
            @select="handleSelect"
          >
            <el-menu-item-group v-for="group in MENU_GROUPS" :key="group.title" :title="group.title">
              <el-menu-item v-for="item in group.items" :key="item.key" :index="item.key">
                <el-icon><component :is="item.icon" /></el-icon>
                <template #title>{{ item.label }}</template>
              </el-menu-item>
            </el-menu-item-group>
          </el-menu>
        </div>

        <!-- 底部操作：伸缩菜单栏 -->
        <div class="nav-actions">
          <el-tooltip :content="menuCollapsed ? '展开菜单栏' : '伸缩菜单栏'" placement="top" :show-after="150">
            <button class="nav-action" type="button" @click="toggleNavCollapsed">
              <el-icon><Expand v-if="menuCollapsed" /><Fold v-else /></el-icon>
            </button>
          </el-tooltip>
        </div>
      </template>

      <!-- 窄屏顶部栏：只显示分类，点分类展开该分类下的菜单 -->
      <div v-else class="topnav">
        <div class="topnav-groups">
          <button
            v-for="group in MENU_GROUPS"
            :key="group.title"
            type="button"
            class="topnav-group"
            :class="{
              'is-active': group.title === activeGroupTitle,
              'is-open': group.title === openGroupTitle
            }"
            :aria-expanded="group.title === openGroupTitle"
            @click="toggleMobileGroup(group.title)"
          >
            <span>{{ group.title }}</span>
          </button>
        </div>

        <div v-if="openGroup" class="topnav-items">
          <button
            v-for="item in openGroup.items"
            :key="item.key"
            type="button"
            class="topnav-item"
            :class="{ 'is-active': item.key === active }"
            @click="selectTopnavItem(item.key)"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>
      </aside>

      <section class="admin-content">
        <!--
          面板标题行：与侧边栏顶部对齐，同时留出右上角位置放该面板的主操作按钮
          （视图里 .toolbar / .text-right 的按钮会被拉到这一行的右侧）
        -->
        <div class="pane-head">
          <h2 class="pane-title">{{ currentSection.title }}</h2>
          <span class="pane-hint">{{ currentSection.hint }}</span>
        </div>
        <!--
          当前面板先挂载，其余面板随后预加载并隐藏，切换时不用重新请求。
          脚本拦截按进入面板时加载，离开时卸载。
        -->
        <div class="admin-pane-stage">
          <div
            v-for="key in mountedPanes"
            :key="key"
            class="admin-pane"
            :class="{ 'is-parked': key !== active }"
            :aria-hidden="key !== active ? 'true' : undefined"
          >
            <component
              v-if="key !== 'script-guard' || key === active"
              :is="PANE_COMPONENTS[key]"
              :embedded="key === 'script-guard' ? undefined : true"
            />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, nextTick, watch, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
  import type { Component } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import { useLayoutStore } from '../../stores/layout';
  import { goBackOrHome } from '../../utils/route-scroll';
import {
  Lock,
  List,
  Coin,
  Warning,
  Promotion,
  Expand,
  Fold,
} from '@element-plus/icons-vue';

  import BrandMark from '../../components/BrandMark.vue';

  // 异步加载各面板，不阻塞后台首屏。
  const ScriptGuardView = defineAsyncComponent(() => import('./ScriptGuardView.vue'));
  const DatabaseAdminView = defineAsyncComponent(() => import('./DatabaseAdminView.vue'));
  const SystemLogsView = defineAsyncComponent(() => import('./SystemLogsView.vue'));
  const IncidentsAdminView = defineAsyncComponent(() => import('./IncidentsAdminView.vue'));
  const SeoSubmitView = defineAsyncComponent(() => import('./SeoSubmitView.vue'));

const PANE_KEYS = ['database', 'logs', 'incidents', 'seo', 'script-guard'] as const;
type PaneKey = (typeof PANE_KEYS)[number];
const DEFAULT_PANE: PaneKey = 'database';

const route = useRoute();

/*
 * 当前面板写进地址栏（?pane=xxx）：刷新、前进后退、复制链接都能回到同一个面板。
 * 没有 pane 参数或指定的面板不存在时，打开「数据管理」。
 */
const paneFromQuery = (): PaneKey => {
  return PANE_KEYS.find((key) => key === route.query.pane) ?? DEFAULT_PANE;
};

const active = ref<PaneKey>(paneFromQuery());

// 非当前面板加 is-parked 隐藏，脚本拦截除外，由模板按需挂载。
const PANE_COMPONENTS: Record<PaneKey, Component> = {
  'script-guard': ScriptGuardView,
  incidents: IncidentsAdminView,
  database: DatabaseAdminView,
  logs: SystemLogsView,
  seo: SeoSubmitView
};

// 首屏先挂载当前面板，稍后预加载其他常驻面板。
let warmUpTimer = 0;
const mountedPanes = ref<PaneKey[]>([active.value]);

const warmUpRestPanes = () => {
  const rest = PANE_KEYS.filter((key) => key !== 'script-guard' && !mountedPanes.value.includes(key));
  mountedPanes.value.push(...rest);
};

// 面板标题：侧边栏只显示名称，这里补一行标题 + 一句提示，让右侧内容有明确的落点
const SECTIONS: Record<PaneKey, { title: string; hint: string }> = {
  'script-guard': { title: '脚本拦截', hint: '拦截记录、封禁与警告页设置' },
  database: { title: '数据管理', hint: '表数据、维护、备份与只读查询' },
  logs: { title: '系统日志', hint: '后台操作记录' },
  incidents: { title: '故障维护', hint: '故障与维护公告' },
  seo: { title: 'SEO 收录', hint: '前台路径提交、IndexNow 与 sitemap' },
};

const currentSection = computed(() => SECTIONS[active.value]);

// 菜单结构（分组 + 图标），宽屏侧边栏和窄屏顶部栏共用
const MENU_GROUPS: { title: string; items: { key: PaneKey; label: string; icon: Component }[] }[] = [
  {
    title: '数据',
    items: [
      { key: 'database', label: '数据管理', icon: Coin },
      { key: 'logs', label: '系统日志', icon: List },
    ],
  },
  {
    title: '运维',
    items: [
      { key: 'incidents', label: '故障维护', icon: Warning },
      { key: 'script-guard', label: '脚本拦截', icon: Lock },
      { key: 'seo', label: 'SEO 收录', icon: Promotion },
    ],
  },
];

const NAV_COLLAPSED_KEY = 'admin.nav.collapsed';
// 伸缩菜单栏是本地偏好，存 localStorage
const isNavCollapsed = ref(localStorage.getItem(NAV_COLLAPSED_KEY) === '1');
const isNarrow = ref(window.matchMedia('(max-width: 900px)').matches);
// 窄屏是横向胶囊行，折叠态没有意义，强制展开
const menuCollapsed = computed(() => isNavCollapsed.value && !isNarrow.value);

// 窄屏顶部栏：默认收起，点分类才展开该分类下的菜单
const openGroupTitle = ref<string | null>(null);
const activeGroupTitle = computed(
  () => MENU_GROUPS.find((group) => group.items.some((item) => item.key === active.value))?.title ?? ''
);
const openGroup = computed(
  () => MENU_GROUPS.find((group) => group.title === openGroupTitle.value) ?? null
);

const toggleMobileGroup = (title: string) => {
  openGroupTitle.value = openGroupTitle.value === title ? null : title;
};

const selectTopnavItem = (key: PaneKey) => {
  handleSelect(key);
  openGroupTitle.value = null;
};

/*
  窄屏那条分类顶栏也做和全站顶栏一样的滚动联动：
  内容滚到它下面时变成一块悬浮毛玻璃（圆角 + 描边 + 投影）并带下方渐隐过渡带，
  滚动回调用 rAF 合并，避免每帧都写状态。
*/
const isPageScrolled = ref(false);
let pageScrollRaf = 0;

const syncPageScrolled = () => {
  pageScrollRaf = 0;
  isPageScrolled.value = window.scrollY > 2;
};

const handlePageScroll = () => {
  if (pageScrollRaf) return;
  pageScrollRaf = window.requestAnimationFrame(syncPageScrolled);
};

// 换页时立即挂载目标面板，并收起展开的分类。
watch(active, (key) => {
  if (!mountedPanes.value.includes(key)) mountedPanes.value.push(key);
  openGroupTitle.value = null;
});

/*
 * 切到一个面板时补一次「重新量尺寸」。
 * 被挂起的面板是 display: none，里面用 ECharts / el-table 的组件是按 0 尺寸挂载的，
 * 显示出来之后必须让它们重新读一次容器尺寸，否则图表会糊、表格列宽会错。
 * 真机上这一步还兼作一次强制重绘，避免出现「切回来是空白，点一下才出来」。
 */
/*
 * 横向溢出的表格打个标记：移动端在表格角上显示「可左右滑动」。
 * 真机（iOS Safari）既不支持自定义原生滚动条，EP 自带的滚动条又要 hover 才出现，
 * 光靠滚动条用户根本不知道右边还有列。
 */
const markScrollableTables = () => {
  const pane = document.querySelector('.admin-pane:not(.is-parked)');
  if (!pane) return;
  pane.querySelectorAll('.el-table').forEach((table) => {
    const wrap = table.querySelector<HTMLElement>('.el-scrollbar__wrap');
    const scrollable = !!wrap && wrap.scrollWidth > wrap.clientWidth + 4;
    table.classList.toggle('is-x-scrollable', scrollable);
  });
};

/** 表格是异步渲染的（数据回来才有列宽），所以量尺寸分两次：立刻一次，稍后再兜一次 */
let markTablesTimer = 0;
const scheduleMarkTables = () => {
  nextTick(() => {
    window.requestAnimationFrame(markScrollableTables);
    window.clearTimeout(markTablesTimer);
    markTablesTimer = window.setTimeout(markScrollableTables, 400);
  });
};

watch(active, () => {
  nextTick(() => {
    const pane = document.querySelector('.admin-pane:not(.is-parked)');
    if (pane) void (pane as HTMLElement).offsetHeight;
    window.dispatchEvent(new Event('resize'));
    scheduleMarkTables();
  });
});

// 展开的菜单是浮层：点空白处收起
const handleOutsideClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  if (target && target.closest('.topnav')) return;
  openGroupTitle.value = null;
};

watch(openGroupTitle, (title) => {
  if (title) document.addEventListener('click', handleOutsideClick, true);
  else document.removeEventListener('click', handleOutsideClick, true);
});

const toggleNavCollapsed = () => {
  isNavCollapsed.value = !isNavCollapsed.value;
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, isNavCollapsed.value ? '1' : '0');
  } catch {
    /* 隐私模式下写不进去，忽略 */
  }
};

const router = useRouter();
  const layoutStore = useLayoutStore();
  // 后台也是从首页进来的：优先回上一页，首页的滚动位置才会被恢复
  const goHome = () => goBackOrHome(router);

// 面板 → 地址栏：用 replace，避免每切一次都往历史里塞一条
watch(active, (key) => {
  const nextPane = key === DEFAULT_PANE ? '' : key;
  if (String(route.query.pane || '') === nextPane) return;

  const query = { ...route.query };
  if (nextPane) query.pane = nextPane;
  else delete query.pane;
  router.replace({ query });
});

// 地址栏 → 面板：前进后退或直接改 URL 时同步
watch(
  () => route.query.pane,
  () => {
    const key = paneFromQuery();
    if (key !== active.value) active.value = key;
  }
);
  
// 切换面板时回到顶部：内容区是页面级滚动，不重置的话新面板会停在半截
const scrollToTop = () => {
  nextTick(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
};

const handleSelect = (key: string) => {
  const pane = PANE_KEYS.find((pane) => pane === key);
  if (!pane || pane === active.value) return;
  active.value = pane;
  scrollToTop();
};

  const navMediaQuery = window.matchMedia('(max-width: 900px)');
  const handleNavMediaChange = (event: MediaQueryListEvent) => {
    isNarrow.value = event.matches;
  };

  onMounted(() => {
    layoutStore.setPageInfo('后台管理', true, goHome);
    navMediaQuery.addEventListener('change', handleNavMediaChange);
    window.addEventListener('resize', scheduleMarkTables);
    window.addEventListener('scroll', handlePageScroll, { passive: true });
    syncPageScrolled();
    scheduleMarkTables();
    warmUpTimer = window.setTimeout(warmUpRestPanes, 300);
  });
  
  onUnmounted(() => {
    navMediaQuery.removeEventListener('change', handleNavMediaChange);
    window.removeEventListener('resize', scheduleMarkTables);
    window.clearTimeout(markTablesTimer);
    window.clearTimeout(warmUpTimer);
    document.removeEventListener('click', handleOutsideClick, true);
    window.removeEventListener('scroll', handlePageScroll);
    if (pageScrollRaf) window.cancelAnimationFrame(pageScrollRaf);
    layoutStore.reset();
  });
  </script>

<style scoped>
.admin-dashboard {
  padding-bottom: 12px;
}

.admin-layout {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  /* 导航栏宽度：只放得下图标 + 4 个字，不留大段空白；伸缩菜单栏时只换这个变量 */
  --nav-w: 156px;
}

.admin-layout.is-collapsed {
  --nav-w: 56px;
}

.admin-sidebar {
  /*
    固定在顶栏下面：页面上下滚动时侧边栏一动不动，
    菜单比可视区高时只有侧边栏内部滚动。
  */
  position: fixed;
  /* 顶栏 60 + el-main 的 20px 上内边距：与右侧面板内容的起始位置对齐 */
  top: 80px;
  left: 20px; /* 与 el-main 的左右内边距一致 */
  width: var(--nav-w);
  height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background-color: var(--el-fill-color-light);
  transition: width 0.2s ease;
}

/* 顶部品牌 */
.admin-brand {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

/* 角标是内联 SVG 组件（BrandMark）：这里只管圆环颜色，尺寸由组件的 size 属性给 */
.admin-brand-logo {
  flex: 0 0 auto;
  color: var(--el-text-color-primary);
}

.admin-brand-name {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
}

.admin-sidebar.is-collapsed .admin-brand {
  justify-content: center;
  padding: 0;
}

.admin-sidebar.is-collapsed .admin-brand-name {
  display: none;
}

.admin-menu-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* 面板式导航的细滚动条 */
.admin-menu-wrap::-webkit-scrollbar {
  width: 6px;
}

.admin-menu-wrap::-webkit-scrollbar-thumb {
  background-color: var(--el-border-color);
  border-radius: 3px;
}

.admin-menu-wrap::-webkit-scrollbar-track {
  background-color: transparent;
}

.admin-menu {
  border-right: none;
  border-radius: 0;
  background-color: transparent;
  padding: 4px 0 8px;
  overflow: hidden;
}

/* 分组之间拉一条细分隔线，和面板导航一致 */
.admin-menu :deep(.el-menu-item-group ~ .el-menu-item-group .el-menu-item-group__title) {
  border-top: 1px solid var(--el-border-color-lighter);
}

.admin-menu :deep(.el-menu-item-group__title) {
  padding: 8px 14px 2px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
}

.admin-menu :deep(.el-menu-item) {
  height: 34px;
  line-height: 34px;
  margin: 0;
  border-radius: 0;
  border-left: 3px solid transparent;
  font-size: 13px;
  color: var(--el-text-color-regular);
  padding-left: 11px !important;
}

.admin-menu :deep(.el-menu-item:hover) {
  background-color: var(--el-fill-color);
}

.admin-menu :deep(.el-menu-item.is-active) {
  background-color: var(--el-color-primary-light-9);
  border-left-color: var(--el-color-primary);
  color: var(--el-color-primary);
  font-weight: 600;
}

/* 折叠态：只留图标 */
.admin-menu.el-menu--collapse {
  width: 100%;
}

.admin-menu.el-menu--collapse :deep(.el-menu-item-group__title) {
  display: none;
}

.admin-menu.el-menu--collapse :deep(.el-menu-item) {
  /* 左右内边距对称，图标才会和顶部 logo 在同一条中线上 */
  padding: 0 3px !important;
  justify-content: center;
}

/* 折叠后菜单项只剩一个图标：抵消 EP 内部 trigger 的左右内边距，图标才与顶部 logo 同中线 */
.admin-menu.el-menu--collapse :deep(.el-menu-item .el-menu-tooltip__trigger) {
  padding: 0;
  width: 100%;
  justify-content: center;
}

/* 底部操作：伸缩菜单栏 */
.nav-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 5px 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.nav-action {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 6px;
  background-color: transparent;
  color: var(--el-text-color-regular);
  font-size: 16px;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}

.nav-action:hover {
  background-color: var(--el-fill-color);
  color: var(--el-color-primary);
}

/* 折叠态窄，按钮居中 */
.admin-sidebar.is-collapsed .nav-actions {
  justify-content: center;
  padding: 5px 0;
}

.admin-content {
  flex: 1;
  min-width: 0;
  /* 侧边栏是 fixed 的，用左外边距把内容让开 */
  margin-left: calc(var(--nav-w) + 16px);
  /* 后台不再展示悬浮 Dock，底部只留一点呼吸空间 */
  padding-bottom: 32px;
}

/* 面板标题行：高度固定，方便把视图里的操作按钮对齐到这一行 */
.pane-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  margin-bottom: 14px;
}

.pane-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
  color: var(--el-text-color-primary);
}

.pane-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.admin-pane-stage {
  position: relative;
  min-width: 0;
}

.admin-pane {
  position: relative;
  min-width: 0;
}

/*
  非当前面板：留在 DOM（数据保持最新、切回来不用重新加载），但不占版面。
  这里以前是「挪到屏幕外 + visibility: hidden」，真机上会踩两个坑：
  1. 比当前面板高的面板照样撑大文档滚动区，页面能往下滑出一大段空白；
  2. 移动端浏览器对屏幕外的隐藏层经常不重绘，切回来后整块内容（图表、表格）
     要等用户点一下才刷出来 —— 也就是「看着没加载完整」。
  改成 display: none：同样留在 DOM、数据照旧，但不参与排版、也不产生隐藏层，
  切回来时浏览器会重新布局 + 重绘。
*/
.admin-pane.is-parked {
  display: none;
}

/* 系统设置页自带标题和内边距，嵌进侧边栏布局后要跟其它面板对齐 */
.admin-pane :deep(.admin-page) {
  padding: 0;
  max-width: none;
  margin: 0;
}

.admin-pane :deep(.admin-page > .page-header) {
  display: none;
}

/* 主题预览原来吸顶 24px，侧边栏布局下要避开 60px 的顶栏 */
.admin-pane :deep(.preview-container) {
  top: 76px;
}

.mb-4 {
  margin-bottom: 20px;
}

/*
  桌面端：视图顶部那排操作按钮（.toolbar / .text-right）原本孤零零地悬在卡片上方，
  这里把它提到面板标题行的右侧，跟标题同一行。
  -50 = 标题行高 36 + 间距 14，再 +2 让它和标题垂直居中。
*/
@media (min-width: 901px) {
  /* toolbar--tabs（应用管理的“新增应用”）不进标题行，它留在卡片页签行里 */
  .admin-pane :deep(.admin-view > .toolbar:first-child:not(.toolbar--tabs)),
  .admin-pane :deep(.admin-view > .text-right:first-child) {
    position: absolute;
    top: -48px;
    right: 0;
    z-index: 3;
    margin: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}

/* 窄屏顶部栏：分类胶囊 + 展开后的菜单（宽屏不渲染，样式先写好） */
.topnav {
  /* 不设 position：展开的菜单相对整条悬浮栏定位，间隔才是按栏底边算的 */
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.topnav-groups {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}

.topnav-groups::-webkit-scrollbar {
  display: none;
}

.topnav-group {
  /* 平均占满一整行；窄到放不下时按内容宽度撑开并横向滚动 */
  flex: 1 1 0;
  min-width: max-content;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
  background-color: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: color 0.2s, background-color 0.2s, border-color 0.2s;
}

.topnav-group:hover {
  color: var(--el-color-primary);
}

/* 当前所在分类：整颗胶囊按「选中」处理 */
.topnav-group.is-active {
  border-color: var(--el-color-primary);
  background-color: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

/* 移动端不放展开箭头：正在展开的分类只改字体，胶囊本身保持常态 */
.topnav-group.is-open {
  color: var(--el-color-primary);
  font-weight: 600;
}

/* 键盘聚焦环画在胶囊内部：不然看起来会比别的分类高出一圈，高度不齐 */
.topnav-group:focus-visible {
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: -2px;
}

.topnav-items {
  /* 展开的是菜单：贴在分类栏下面浮一层，不挤动页面内容 */
  position: absolute;
  /* 与分类栏留 8px 间隔，不要贴在一起 */
  top: calc(100% + 9px);
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background-color: var(--el-bg-color);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}

.topnav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 14px 0 11px;
  border: none;
  border-left: 3px solid transparent;
  border-radius: 0;
  background-color: transparent;
  color: var(--el-text-color-regular);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: color 0.2s, background-color 0.2s, border-color 0.2s;
}

.topnav-item:hover {
  background-color: var(--el-fill-color-light);
}

.topnav-item span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topnav-item.is-active {
  background-color: var(--el-color-primary-light-9);
  border-left-color: var(--el-color-primary);
  color: var(--el-color-primary);
  font-weight: 600;
}

.topnav-item:focus-visible {
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: -2px;
}

/* 应用管理：把“新增应用”放进卡片页签行的右侧内边距位置（宽窄屏一致） */
.admin-pane :deep(.admin-view > .toolbar--tabs) {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 3;
  height: 40px; /* 与 border-card 的页签行等高，按钮垂直居中 */
  margin: 0;
  padding-right: 12px;
  align-items: center;
  justify-content: flex-end;
}

/* 窄屏：导航变成吸在顶栏下面的分类栏 + 展开的菜单；面板按钮回到内容上方 */
@media (max-width: 900px) {
  .admin-layout {
    flex-direction: column;
    /* 列方向必须让内容区撑满宽度，否则会按 max-content 计算把页面顶宽 */
    align-items: stretch;
    gap: 12px;
  }

  .admin-content {
    width: 100%;
    margin-left: 0;
  }

  .admin-sidebar {
    /* 与全站顶栏一致的滚动联动参数：模糊半径 12–20px、过渡带高度 8–15px */
    --topnav-blur: 16px;
    --topnav-fade: 12px;
    position: sticky;
    /* 吸顶时和全站顶栏留 10px 间隙，不要贴在一起 */
    top: 70px;
    left: auto;
    width: 100%;
    height: auto;
    display: block;
    overflow: visible;
    z-index: 20;
    /* 悬浮条：左右各外扩 10px，让里面的分类胶囊依旧和下方卡片对齐 */
    margin: 0 -10px 10px;
    /* 上下内边距一致，胶囊在条里严格居中 */
    padding: 7px 10px;
    border: 1px solid transparent;
    border-radius: 12px;
    background-color: transparent;
    -webkit-backdrop-filter: blur(0px) saturate(100%);
    backdrop-filter: blur(0px) saturate(100%);
    transition:
      background-color 300ms ease-out,
      border-color 300ms ease-out,
      box-shadow 300ms ease-out,
      -webkit-backdrop-filter 300ms ease-out,
      backdrop-filter 300ms ease-out;
  }

  /* 内容滚进这条顶栏区域：变成一块悬浮毛玻璃，而不是一块方角底色把内容硬切开 */
  .admin-sidebar.is-scrolled {
    background-color: color-mix(in srgb, var(--el-bg-color) 72%, transparent);
    border-color: var(--el-border-color-lighter);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
    -webkit-backdrop-filter: blur(var(--topnav-blur)) saturate(140%);
    backdrop-filter: blur(var(--topnav-blur)) saturate(140%);
  }

  /* 顶栏下方 8–15px 的渐隐过渡带：从完全透明到轻微模糊，和内容自然衔接 */
  .admin-sidebar::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    height: var(--topnav-fade);
    pointer-events: none;
    opacity: 0;
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    -webkit-mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0));
    mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0));
    transition: opacity 300ms ease-out;
  }

  .admin-sidebar.is-scrolled::after {
    opacity: 1;
  }

  /* 不支持 backdrop-filter 的内核：退回纯色背景 */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .admin-sidebar.is-scrolled {
      background-color: var(--el-bg-color-page);
    }

    .admin-sidebar::after {
      display: none;
    }
  }

  .pane-head {
    min-height: 0;
    margin-bottom: 10px;
    gap: 8px;
  }

  .pane-title {
    font-size: 16px;
    line-height: 24px;
  }

  .pane-hint {
    display: none;
  }

  .topnav-groups {
    /* 分类胶囊上下留白由悬浮条的内边距负责，这里不要再加，否则上下不等高 */
    padding: 0;
  }

  /*
    手机端宽表格：列宽是 px 的，加起来比屏幕宽，Element Plus 默认只把横向滚动条藏起来，
    于是表头被右边裁掉、看着像「没加载完整」。这里把横向滚动条显示出来（表头会跟着滚，
    EP 自己会同步 scrollLeft），列数多的表在手机上才能滑到后面的列。
  */
  .admin-pane :deep(.el-table .el-scrollbar__wrap) {
    scrollbar-width: thin;
    -ms-overflow-style: auto;
  }

  .admin-pane :deep(.el-table .el-scrollbar__wrap)::-webkit-scrollbar {
    display: block;
    height: 6px;
    width: 6px;
  }

  .admin-pane :deep(.el-table .el-scrollbar__wrap)::-webkit-scrollbar-thumb {
    background-color: var(--el-border-color-darker);
    border-radius: 3px;
  }

  .admin-pane :deep(.el-table .el-scrollbar__wrap)::-webkit-scrollbar-track {
    background-color: transparent;
  }

  /* 真机滚动条看不见，用一枚角标说明这张表还能左右滑 */
  .admin-pane :deep(.el-table.is-x-scrollable)::after {
    content: '可左右滑动 →';
    position: absolute;
    top: 6px;
    right: 8px;
    z-index: 3;
    padding: 1px 8px;
    border-radius: 999px;
    background-color: var(--el-fill-color);
    color: var(--el-text-color-secondary);
    font-size: 11px;
    line-height: 18px;
    pointer-events: none;
  }
}
</style>
