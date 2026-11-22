<template>
  <!--
    首页/推荐只通过顶部的页签按钮切换：
    之前这里绑了左右滑动切页签，浏览列表时经常误触发，已经移除。
  -->
  <main class="home-view">
    <Teleport to="#header-teleport-target">
      <Transition name="fade-slide">
        <div v-if="isActiveHome && layoutStore.showCustomTitle" class="device-tabs header-device-tabs">
          <div 
            class="tab-glider" 
            :style="{ 
              width: 'calc(50% - 3px)',
              transform: `translateX(${homeTab === 'system' ? '100%' : '0'})`
            }"
          ></div>
          <div 
            class="device-tab" 
            :class="{ active: homeTab === 'home' }" 
            @click="homeTab = 'home'"
            :style="{ width: '50%' }"
          >
            <span class="tab-label">首页</span>
          </div>
          <div 
            class="device-tab" 
            :class="{ active: homeTab === 'system' }" 
            @click="homeTab = 'system'"
            :style="{ width: '50%' }"
          >
            <span class="tab-label">推荐</span>
          </div>
        </div>
      </Transition>
    </Teleport>

    <section class="dashboard-container">
      <div class="home-toolbar" ref="toolbarRef">
        <div class="greeting-text">{{ greeting }}</div>
        <div class="device-tabs">
          <div 
            class="tab-glider" 
            :style="{ 
              width: 'calc(50% - 6px)',
              transform: `translateX(${homeTab === 'system' ? '100%' : '0'})`
            }"
          ></div>
          <div 
            class="device-tab" 
            :class="{ active: homeTab === 'home' }" 
            @click="homeTab = 'home'"
            :style="{ width: '50%' }"
          >
            <span class="tab-label">首页</span>
          </div>
          <div 
            class="device-tab" 
            :class="{ active: homeTab === 'system' }" 
            @click="homeTab = 'system'"
            :style="{ width: '50%' }"
          >
            <span class="tab-label">推荐</span>
          </div>
        </div>
      </div>
      <ActiveIncidents />
      <!-- 用 v-show：只切换显隐，组件不重建，切回来复用数据、不重复请求 -->
      <el-row v-show="homeTab === 'system' && siteCards.length > 0" :gutter="20" class="site-cards-row">
        <el-col
          v-for="card in siteCards"
          :key="card.id"
          :span="getCardStyle(card).span"
          :xs="24"
          class="site-card-col"
        >
          <el-card class="site-card" shadow="hover">
            <template #header>
              <div class="site-card-header">
                <div class="header-left">
                  <div class="accent-bar" :class="getCardStyle(card).accent"></div>
                  <span class="card-title">{{ card.title }}</span>
                </div>
               </div>
            </template>

            <template v-if="card.key === 'announcements'">
              <div v-if="announcements.length > 0" class="announcements-list">
                <div v-for="item in announcements" :key="item.id" class="announcement-item">
                  <div class="announcement-title">{{ item.title }}</div>
                  <div class="announcement-content markdown-body" v-html="item.content_html" />
                </div>
              </div>
              <div v-else class="empty-text">暂无公告</div>
            </template>

            <template v-else-if="card.key === 'apps'">
              <div v-if="publicApps.length > 0" class="apps-list" @click="router.push({ name: 'app-cards' })">
                <template v-for="item in publicApps" :key="item.id">
                  <img
                    v-if="getAppIconUrl(item) && !failedIcons.has(item.id)"
                    :src="getAppIconUrl(item)"
                    class="app-icon"
                    :title="item.name"
                    alt=""
                    @error="onIconError(item)"
                  />
                  <div v-else class="app-icon fallback-icon" :title="item.name">
                    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
                      <path fill="currentColor" d="M511.6 76.3C264.3 76.2 64 276.4 64 523.5 64 718.9 189.3 885 363.8 946c23.5 5.9 19.9-10.8 19.9-22.2v-77.5c-135.7 15.9-141.2-73.9-150.8-88.9C215 726 171.5 718 184.5 703c30.9-15.9 62.4 4 98.9 57.9 26.4 39.1 77.9 32.5 104 26 5.7-23.5 17.9-44.5 34.7-60.8-140.6-25.2-199.2-111-199.2-213 0-49.5 16.3-95 48.3-131.7-20.4-60.5 1.9-112.3 4.9-120 58.1-5.2 118.5 41.6 123.2 45.3 33-8.9 70.7-13.6 112.9-13.6 42.4 0 80.2 4.9 113.5 13.9 11.3-8.6 67.3-48.8 121.3-43.9 2.9 7.7 24.7 58.3 5.5 118 32.4 36.8 48.9 82.7 48.9 132.3 0 102.2-59 188.1-200 212.9a127.5 127.5 0 0 1 38.1 91v112.5c.8 9 0 17.9 15 17.9 177.1-59.7 304.6-227 304.6-424.1 0-247.2-200.4-447.3-447.5-447.3z"></path>
                    </svg>
                  </div>
                </template>
              </div>
              <div v-else class="empty-text">暂无应用</div>
            </template>
          </el-card>
        </el-col>
      </el-row>

      <!-- 板块顺序 / 显示与否由后台「首页配置 → 首页」的卡片列表决定 -->
      <component
        v-for="card in visibleHomeCards"
        :is="HOME_SECTIONS[card.key]"
        :key="card.key"
        v-show="homeTab === 'home'"
        class="home-section"
        :active="card.key === 'topic-spotlight' ? homeTab === 'home' : undefined"
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, onActivated, onDeactivated, watch } from 'vue';
import type { Component } from 'vue';
import { useRouter } from 'vue-router';
import { useLayoutStore } from '../stores/layout';

defineOptions({
  name: 'HomeView'
});

import ActiveIncidents from '../components/ActiveIncidents.vue';
import TopicSpotlight from '../components/TopicSpotlight.vue';
import AppListSection from '../components/AppListSection.vue';
import {
  getPublicAnnouncements,
  getPublicApps,
  getPublicSiteCards,
  type Announcement,
  type AppItem,
  type SiteCard,
} from '../services/admin';
import { getAppIconUrl } from '../utils/app-info';
import { contentVersion } from '../services/content-refresh';
import { usePageActive } from '../utils/page-active';

const router = useRouter();
const layoutStore = useLayoutStore();
// 首页被 keep-alive 缓存：切走后 WS 广播不该把取数拉起来（见下面的 contentVersion watch）
const pageActive = usePageActive();
const toolbarRef = ref<HTMLElement | null>(null);

const greeting = ref('');

const updateGreeting = () => {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) {
    greeting.value = '尊敬的用户早上好~';
  } else if (hour >= 12 && hour < 14) {
    greeting.value = '尊敬的用户中午好~';
  } else if (hour >= 14 && hour < 18) {
    greeting.value = '尊敬的用户下午好~';
  } else {
    greeting.value = '尊敬的用户晚上好~';
  }
};

const siteCards = ref<SiteCard[]>([]);

/*
 * 首页「探索」页签的板块：顺序和显隐都来自后台「首页配置 → 首页」，
 * key 对应后台里的卡片标识，取不到配置时用下面的默认顺序兜底。
 */
const HOME_SECTIONS: Record<string, Component> = {
  'topic-spotlight': TopicSpotlight,
  'app-list': AppListSection,
};
const HOME_CARD_FALLBACK = ['topic-spotlight', 'app-list'];
type HomeCardConfig = { key: string };

const fallbackHomeCards = (): HomeCardConfig[] => HOME_CARD_FALLBACK.map((key) => ({ key }));

/*
 * 上次拿到的板块配置，只作兜底（配置接口失败时）。
 * 不能拿它先挂板块：缓存里可能还留着后台已关掉的卡片，挂上去会连数据请求一起发出去。
 */
const HOME_CARDS_CACHE_KEY = 'openstore:home-cards';

const readCachedHomeCards = (): HomeCardConfig[] => {
  try {
    const raw = localStorage.getItem(HOME_CARDS_CACHE_KEY);
    if (!raw) return fallbackHomeCards();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallbackHomeCards();
    // 过滤掉已经不认得的 key（版本升级删掉板块后残留的）
    const valid = parsed.filter((item) => item && typeof item.key === 'string' && HOME_SECTIONS[item.key]);
    return valid.length ? (valid as HomeCardConfig[]) : fallbackHomeCards();
  } catch {
    return fallbackHomeCards();
  }
};

const cacheHomeCards = (value: HomeCardConfig[]) => {
  try {
    localStorage.setItem(HOME_CARDS_CACHE_KEY, JSON.stringify(value));
  } catch {
    /* 隐私模式 / 配额满：存不下就算了，只是会退回原来的闪烁 */
  }
};

/** 配置就绪前不放板块：先挂载等于先请求 */
const homeCardsReady = ref(false);
/** 首屏渲染用的板块列表：配置没就绪就是空的 */
const visibleHomeCards = computed(() => (homeCardsReady.value ? homeCards.value : []));
/** 首屏空着不好看，配置真的拿不到时才用缓存 */
const homeCards = ref<HomeCardConfig[]>([]);

// 卡片配置重新拉取的底线：页面被 keep-alive 缓存，一分钟内切回来不重复请求；
// 后台改配置会通过 WS 广播立刻刷新（见下面的 watch）
const SITE_CONFIG_REFRESH_MS = 60_000;
let homeCardsFetchedAt = 0;
let homeCardsLoaded = false;

const loadHomeCards = async (force = false) => {
  if (!force && homeCardsLoaded && Date.now() - homeCardsFetchedAt < SITE_CONFIG_REFRESH_MS) return;
  try {
    const cards = await getPublicSiteCards('home');
    // 接口成功但一张都没启用，说明后台确实全关了，这里保持空列表
    homeCards.value = cards
      .filter((card) => HOME_SECTIONS[card.key])
      .map((card) => ({ key: card.key }));
    cacheHomeCards(homeCards.value);
  } catch {
    // 拉不到配置才退回缓存，否则可能渲染出已关闭的卡片
    homeCards.value = readCachedHomeCards();
  } finally {
    homeCardsLoaded = true;
    homeCardsFetchedAt = Date.now();
    homeCardsReady.value = true;
  }
};
const announcements = ref<Announcement[]>([]);
const publicApps = ref<AppItem[]>([]);
const homeTab = ref<'home' | 'system'>('home');
const isActiveHome = ref(true);

const failedIcons = ref(new Set<number | string>());

const onIconError = (item: AppItem) => {
  failedIcons.value.add(item.id);
};

const getCardStyle = (card: SiteCard) => {
  let parsed: any = {};
  try {
    parsed = JSON.parse(card.style || '{}');
  } catch {
    parsed = {};
  }
  const span = parsed.span === 12 ? 12 : 24;
  const accent = typeof parsed.accent === 'string' && parsed.accent.trim() ? parsed.accent.trim() : 'bg-yellow';
  return { span, accent };
};

let siteCardsFetchedAt = 0;
let siteCardsLoaded = false;
/** 上次已经拉过内容的卡片组合，用来判断要不要重新请求那批内容接口 */
let loadedContentKeys = '';

const loadSiteCards = async (force = false) => {
  if (!force && siteCardsLoaded && Date.now() - siteCardsFetchedAt < SITE_CONFIG_REFRESH_MS) return;
  try {
    siteCards.value = (await getPublicSiteCards('system'))
      .filter(({ key }) => key === 'announcements' || key === 'apps');
  } catch {
    siteCards.value = [];
    siteCardsLoaded = true;
    siteCardsFetchedAt = Date.now();
    return;
  }

  const enabledKeys = new Set(siteCards.value.map((c) => c.key));
  const contentKeys = [...enabledKeys].sort().join('|');
  siteCardsLoaded = true;
  siteCardsFetchedAt = Date.now();

  // 卡片组合没变（只是切了个路由回来），内容就沿用上次的，不再重复请求
  if (contentKeys === loadedContentKeys) return;
  loadedContentKeys = contentKeys;

  const tasks: Array<Promise<void>> = [];
  if (enabledKeys.has('announcements')) {
    tasks.push(
      getPublicAnnouncements()
        .then((items) => {
          announcements.value = items;
        })
        .catch(() => {
          announcements.value = [];
        })
    );
  }
  if (enabledKeys.has('apps')) {
    tasks.push(
      getPublicApps()
        .then((items) => {
          publicApps.value = items;
        })
        .catch(() => {
          publicApps.value = [];
        })
    );
  }

  await Promise.all(tasks);
};

let observer: IntersectionObserver | null = null;

onMounted(() => {
  isActiveHome.value = true;
  loadSiteCards();
  loadHomeCards();
  updateGreeting();

  observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting && entry.boundingClientRect.top < 60) {
        layoutStore.setCustomTitleVisible(true);
      } else {
        layoutStore.setCustomTitleVisible(false);
      }
    },
    { threshold: 0, rootMargin: '-60px 0px 0px 0px' }
  );
  
  if (toolbarRef.value) {
    observer.observe(toolbarRef.value);
  }
});

onActivated(() => {
  // Ensure header toggle only appears when HomeView is active
  isActiveHome.value = true;
  // 从后台改完卡片顺序回来时，重新取一次配置
  loadSiteCards();
  loadHomeCards();
  if (!observer && toolbarRef.value) {
    observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && entry.boundingClientRect.top < 60) {
          layoutStore.setCustomTitleVisible(true);
        } else {
          layoutStore.setCustomTitleVisible(false);
        }
      },
      { threshold: 0, rootMargin: '-60px 0px 0px 0px' }
    );
    observer.observe(toolbarRef.value);
  }
});

// 后台保存内容 → WS 广播让 contentVersion +1：作废本地节流并重新取数
watch(contentVersion, () => {
  siteCardsFetchedAt = 0;
  homeCardsFetchedAt = 0;
  // 卡片组合可能变了（比如刚开启「公告」卡片），清掉比对记录强制重拉那份内容
  loadedContentKeys = '';
  // 不在首页时先不请求：节流已经作废，切回来 onActivated 那两次取数会真的打出去
  if (!pageActive.value) return;
  loadSiteCards(true);
  loadHomeCards(true);
});

onDeactivated(() => {
  // Hide custom header when leaving HomeView
  isActiveHome.value = false;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  layoutStore.setCustomTitleVisible(false);
});

onUnmounted(() => {
  if (observer) {
    observer.disconnect();
  }
  layoutStore.setCustomTitleVisible(false);
});
</script>

<style scoped>
.home-view {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}
.home-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.greeting-text {
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.device-tabs {
  position: relative;
  display: flex;
  gap: 0;
  background: var(--el-fill-color-light);
  border-radius: 9999px;
  padding: 6px;
}
.device-tab {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  color: var(--el-text-color-secondary);
  border-radius: 9999px;
  user-select: none;
}
.device-tab.active {
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.tab-glider {
  position: absolute;
  top: 6px;
  left: 6px;
  height: calc(100% - 12px);
  background: var(--el-bg-color);
  border-radius: 9999px;
  transition: transform 0.25s ease;
  box-shadow: 0 4px 10px rgba(0,0,0,0.06);
}

.header-device-tabs {
  padding: 3px;
  background: var(--el-fill-color); /* Slightly different bg for header contrast if needed */
  transform: scale(0.85); /* Make it slightly smaller in header */
  transform-origin: center;
}

.header-device-tabs .tab-glider {
  top: 3px;
  left: 3px;
  height: calc(100% - 6px);
}

.mt-4 {
  margin-top: 20px;
}

/*
 * 板块间距统一在这里兜底：各板块原来一半用 margin-top、一半用 margin-bottom，
 * 后台任意调序时会出现两张贴死。统一补下边距，边距折叠保证不会翻倍。
 */
.home-view :deep(.home-section) {
  margin-bottom: 20px;
}

/* 统一探索页面所有卡片的圆角样式，与后台管理控制的 site-card 保持一致 (16px) */
.home-view :deep(.el-card),
.home-view :deep(.incident-card),
.home-view :deep(.chart-card) {
  border-radius: 16px !important;
  overflow: hidden;
  /* 调整阴影：垂直方向偏移，负扩散半径减少左右两侧阴影 */
  box-shadow: 0 8px 12px -4px rgba(0, 0, 0, 0.08) !important;
}

.site-cards-row {
  margin-bottom: 24px;
  align-items: stretch;
}

.site-card-col {
  margin-bottom: 16px;
  display: flex;
}

.site-card {
  border-radius: 16px;
  overflow: hidden;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.site-card :deep(.el-card__header) {
  padding: 14px 16px;
}

.site-card :deep(.el-card__body) {
  padding: 14px 16px;
  flex: 1;
}

.site-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.accent-bar {
  width: 4px;
  height: 16px;
  border-radius: 4px;
  flex: 0 0 auto;
}

/* 卡片标题左侧的 4px 标记条：只保留克制的语义色点缀 */
.bg-yellow { background-color: var(--el-color-warning); }
.bg-green { background-color: var(--el-color-success); }
.bg-blue { background-color: var(--el-color-primary); }
.bg-red { background-color: var(--el-color-danger); }
.bg-purple { background-color: var(--el-color-info); }

.card-title {
  font-weight: 700;
  color: var(--el-text-color-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.card-desc {
  color: var(--el-text-color-regular);
  line-height: 1.6;
}

.announcements-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.announcement-item {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}

.announcement-title {
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 6px;
}

.announcement-content {
  line-height: 1.7;
  color: var(--el-text-color-regular);
  font-size: 13px;
  padding: 0 !important;
  background-color: transparent !important;
  border: none !important;
  border-radius: 0 !important;
}

.apps-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  cursor: pointer;
}

.app-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  object-fit: cover;
  display: block;
  transition: all 0.25s ease;
}

.app-icon:hover {
  transform: translateY(-2px) scale(1.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.fallback-icon {
  color: var(--el-text-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--el-fill-color-light);
  padding: 6px;
  box-sizing: border-box;
}

.empty-text {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-placeholder);
  font-size: 14px;
}

@media (max-width: 768px) {
  .home-view {
    padding: 14px;
  }

  .site-cards-row {
    margin-bottom: 18px;
  }

  .site-card-col {
    margin-bottom: 12px;
  }

  .site-card :deep(.el-card__header) {
    padding: 12px 14px;
  }

  .site-card :deep(.el-card__body) {
    padding: 12px 14px;
  }
}

</style>
