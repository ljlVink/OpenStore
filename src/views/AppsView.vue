<template>
  <div class="apps-view">
    <header class="apps-header">
      <h1>{{ catalogLabel }}</h1>
      <div ref="searchContainer" class="search-container" @focusout="handleSearchFocusOut" @keydown.esc="closeDiscover">
        <form class="search-bar" role="search" @submit.prevent="handleSearch">
          <el-icon><Search /></el-icon>
          <input
            v-model="searchQuery"
            aria-label="搜索应用、游戏"
            placeholder="搜索应用、游戏…"
            maxlength="50"
            autocomplete="off"
            @focus="openDiscover"
          />
          <button v-if="searchQuery" type="button" class="clear-search" aria-label="清空搜索" @click="searchQuery = ''">
            <el-icon><CircleClose /></el-icon>
          </button>
          <button type="submit" class="search-submit">搜索</button>
        </form>
        <div v-if="discoverOpen && !searchQuery.trim()" class="discover-panel">
          <h2>发现更多</h2>
          <p v-if="discoverLoading" class="discover-state" role="status">正在加载…</p>
          <div v-else-if="discoverFailed" class="discover-state" role="alert">
            <p>暂时无法加载发现更多</p>
            <button class="text-button" @click="openDiscover">重试</button>
          </div>
          <p v-else-if="!discoverApps.length" class="discover-state">暂无推荐应用</p>
          <div v-else class="discover-list">
            <RouterLink
              v-for="app in discoverApps"
              :key="app.app_id"
              :to="appLocation(app)"
              class="app-row discover-item"
              @click="closeDiscover"
            >
              <el-image :src="app.icon_url" class="app-icon" fit="cover" loading="lazy">
                <template #error><span class="icon-placeholder"><el-icon><Picture /></el-icon></span></template>
              </el-image>
              <span class="app-text">
                <span class="app-name">{{ app.name }}</span>
                <span class="app-description">{{ app.brief_desc || app.kind_name }}</span>
              </span>
            </RouterLink>
          </div>
        </div>
      </div>
    </header>

    <nav class="browse-tabs" :aria-label="`${catalogLabel}浏览`">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.key"
        :to="{ path: browsePath, query: { tab: tab.key } }"
        :class="['browse-tab', { active: activeTab === tab.key }]"
        :aria-current="activeTab === tab.key ? 'page' : undefined"
      >
        <el-icon><component :is="tab.icon" /></el-icon>
        <span>{{ tab.label }}</span>
      </RouterLink>
    </nav>

    <div v-if="isFiltered" class="view-heading">
      <button class="back-button" aria-label="返回" @click="handleBack"><el-icon><ArrowLeft /></el-icon></button>
      <h2>{{ pageTitle }}</h2>
    </div>

    <main class="browse-content" :aria-busy="loading">
      <div v-if="loading" class="page-state" role="status">
        <el-icon class="is-loading"><Loading /></el-icon>
        <p>正在加载{{ isSearch ? '搜索结果' : catalogLabel }}…</p>
      </div>
      <div v-else-if="errorMessage" class="page-state" role="alert">
        <el-icon><Warning /></el-icon>
        <h2>{{ errorMessage }}</h2>
        <p>请稍后重试，或切换其他栏目浏览。</p>
        <button class="pill-button" @click="loadPage">重新加载</button>
      </div>
      <el-empty v-else-if="isEmpty" :description="isSearch ? '没有找到相关应用，试试其他关键词' : `暂无${catalogLabel}内容`" />

      <section v-else-if="isSearch" class="app-section" aria-label="搜索结果">
        <div class="app-grid">
          <RouterLink v-for="app in searchResults" :key="app.app_id" :to="appLocation(app)" class="app-row">
            <el-image :src="app.icon_url" class="app-icon" fit="cover" loading="lazy">
              <template #error><span class="icon-placeholder"><el-icon><Picture /></el-icon></span></template>
            </el-image>
            <span class="app-text">
              <span class="app-name">{{ app.name }}</span>
              <span class="app-description">{{ app.brief_desc || app.kind_name }}</span>
            </span>
            <span class="detail-label">查看</span>
          </RouterLink>
        </div>
      </section>

      <div v-else-if="browse?.kind === 'categories'" class="categories-grid">
        <RouterLink
          v-for="(category, index) in browse.categories"
          :key="category.name"
          :to="{ path: browsePath, query: { tab: 'categories', category: category.name } }"
          class="category-card"
          :style="{ backgroundColor: categoryColors[index % categoryColors.length] }"
        >
          <img v-if="category.image" :src="category.image" class="category-image" alt="" loading="lazy" @error="hideCategoryImage" />
          <span>{{ category.name }}</span>
        </RouterLink>
      </div>

      <div v-else-if="browse?.kind === 'sections'" class="sections">
        <section v-for="(section, index) in browse.sections" :key="`${section.title}-${index}`" class="app-section">
          <header class="section-heading">
            <div>
              <h2>{{ section.title }}</h2>
              <p v-if="section.description">{{ section.description }}</p>
            </div>
            <RouterLink
              v-if="section.rank"
              :to="{ path: browsePath, query: { tab: 'rankings', rank: section.rank } }"
              class="see-all"
            >查看全部 <el-icon><ArrowRight /></el-icon></RouterLink>
          </header>
          <p v-if="!section.items.length" class="section-empty">暂无应用</p>
          <div v-else class="app-grid">
            <RouterLink v-for="app in section.items" :key="app.app_id" :to="appLocation(app)" class="app-row">
              <span v-if="app.position !== undefined" :class="['rank-position', { 'top-position': app.position <= 3 }]">{{ app.position }}</span>
              <el-image :src="app.icon_url" class="app-icon" fit="cover" loading="lazy">
                <template #error><span class="icon-placeholder"><el-icon><Picture /></el-icon></span></template>
              </el-image>
              <span class="app-text">
                <span class="app-name">{{ app.name }}</span>
                <span class="app-description">{{ app.brief_desc || app.kind_name }}</span>
              </span>
              <span class="detail-label">查看</span>
            </RouterLink>
          </div>
        </section>
      </div>

      <div v-else-if="browse?.kind === 'updates'" class="update-groups">
        <section v-for="group in browse.updates" :key="group.date" class="update-group">
          <h2><time :datetime="group.date">{{ formatUpdateDate(group.date) }}推出</time></h2>
          <div class="updates-grid">
            <article v-for="app in group.items" :key="app.app_id" class="update-card">
              <RouterLink :to="appLocation(app)" class="app-row update-header">
                <el-image :src="app.icon_url" class="app-icon" fit="cover" loading="lazy">
                  <template #error><span class="icon-placeholder"><el-icon><Picture /></el-icon></span></template>
                </el-image>
                <span class="app-text">
                  <span class="app-name">{{ app.name }}</span>
                  <span v-if="app.version" class="app-description">版本 {{ app.version }}</span>
                </span>
                <span class="detail-label">查看</span>
              </RouterLink>
              <p class="release-notes">{{ app.notes || '暂无版本更新说明' }}</p>
            </article>
          </div>
        </section>
      </div>

      <nav v-if="!loading && !errorMessage && !isSearch && (currentPage > 1 || hasMore)" class="pagination" aria-label="应用翻页">
        <RouterLink v-if="currentPage > 1" :to="pageLocation(currentPage - 1)" class="pill-button">上一页</RouterLink>
        <span v-else class="pill-button disabled" aria-disabled="true">上一页</span>
        <span role="status" aria-live="polite">第 {{ currentPage }} 页</span>
        <RouterLink v-if="hasMore" :to="pageLocation(currentPage + 1)" class="pill-button">下一页</RouterLink>
        <span v-else class="pill-button disabled" aria-disabled="true">已到最后一页</span>
      </nav>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, ref, watch } from 'vue';
import { isAxiosError } from 'axios';
import { ArrowLeft, ArrowRight, CircleClose, Grid, Loading, Picture, Refresh, Search, Star, Trophy, Warning } from '@element-plus/icons-vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  getAppGalleryBrowse, getDiscoverApps, searchApps,
  type AppGalleryBrowse, type AppGalleryBrowseTab, type AppGalleryCatalog, type AppGalleryListApp
} from '../services/next-api';
import { usePageActive } from '../utils/page-active';

defineOptions({ name: 'AppsView' });
const { catalog } = defineProps<{ catalog: AppGalleryCatalog }>();
const browsePath = computed(() => `/${catalog}`);
const catalogLabel = computed(() => catalog === 'games' ? '游戏' : '应用');

const route = useRoute();
const router = useRouter();
const pageActive = usePageActive();
const tabs = [
  { key: 'featured', label: '精选', icon: Star },
  { key: 'categories', label: '分类', icon: Grid },
  { key: 'rankings', label: '排行榜', icon: Trophy },
  { key: 'updates', label: '重磅更新', icon: Refresh }
] as const;
const categoryColors = ['#22bf7b', '#537bf2', '#f37594', '#f4bc39', '#16afd1'];
const hideCategoryImage = (event: Event) => {
  (event.currentTarget as HTMLImageElement).hidden = true;
};
const queryText = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const searchTerm = computed(() => queryText(route.query.q));
const categoryName = computed(() => queryText(route.query.category));
const rankName = computed(() => queryText(route.query.rank));
const isSearch = computed(() => Boolean(searchTerm.value));
const activeTab = computed<AppGalleryBrowseTab>(() => {
  if (!isSearch.value && categoryName.value) return 'categories';
  if (!isSearch.value && rankName.value) return 'rankings';
  return tabs.find(tab => tab.key === route.query.tab)?.key || 'featured';
});
const currentPage = computed(() => {
  const value = queryText(route.query.page);
  const page = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(page) && page > 0 ? page : 1;
});
const isFiltered = computed(() => isSearch.value || Boolean(categoryName.value || rankName.value));
const pageTitle = computed(() => isSearch.value ? `“${searchTerm.value}”的搜索结果` : categoryName.value || rankName.value);
const searchQuery = ref('');
const searchResults = ref<AppGalleryListApp[]>([]);
const browse = ref<AppGalleryBrowse | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const hasMore = computed(() => browse.value !== null && browse.value.kind !== 'categories' && browse.value.hasMore);
const isEmpty = computed(() => {
  if (isSearch.value) return searchResults.value.length === 0;
  if (!browse.value) return true;
  if (browse.value.kind === 'categories') return browse.value.categories.length === 0;
  if (browse.value.kind === 'sections') return !browse.value.sections.some(section => section.items.length);
  return !browse.value.updates.some(group => group.items.length);
});
let requestId = 0;
let loadedLocation = '';

const appLocation = (app: AppGalleryListApp) => ({
  name: 'next-app-detail',
  params: { id: app.app_id },
  query: { title: app.name }
});
const pageLocation = (page: number) => ({
  path: browsePath.value,
  query: { ...route.query, page: page === 1 ? undefined : String(page) }
});
const formatUpdateDate = (date: string) => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return parts ? `${Number(parts[2])}月${Number(parts[3])}日` : date;
};

const loadPage = async () => {
  const id = ++requestId;
  loadedLocation = route.fullPath;
  searchQuery.value = searchTerm.value;
  discoverOpen.value = false;
  loading.value = true;
  errorMessage.value = '';
  browse.value = null;
  searchResults.value = [];
  try {
    if (isSearch.value) {
      const items = await searchApps(searchTerm.value);
      if (id === requestId) searchResults.value = items;
    } else {
      const data = await getAppGalleryBrowse({
        catalog,
        tab: activeTab.value,
        category: categoryName.value || undefined,
        rank: categoryName.value ? undefined : rankName.value || undefined,
        page: currentPage.value
      });
      if (id === requestId) browse.value = data;
    }
  } catch (error) {
    if (id === requestId) {
      errorMessage.value = isAxiosError(error) && error.response?.status === 404
        ? '未找到这个分类或榜单'
        : '暂时无法访问华为应用市场';
    }
  } finally {
    if (id === requestId) loading.value = false;
  }
};

const handleSearch = () => {
  closeDiscover();
  void router.push({
    path: browsePath.value,
    query: { tab: activeTab.value, ...(searchQuery.value.trim() ? { q: searchQuery.value.trim() } : {}) }
  });
};
const handleBack = () => {
  const from = (window.history.state as { back?: string } | null)?.back || '';
  if (from && from.split('?')[0] !== browsePath.value) {
    router.back();
  } else {
    void router.push({ path: browsePath.value, query: { tab: activeTab.value } });
  }
};

const searchContainer = ref<HTMLElement | null>(null);
const discoverOpen = ref(false);
const discoverApps = ref<AppGalleryListApp[]>([]);
const discoverLoading = ref(false);
const discoverFailed = ref(false);
const openDiscover = async () => {
  discoverOpen.value = true;
  if (discoverApps.value.length || discoverLoading.value) return;
  discoverLoading.value = true;
  discoverFailed.value = false;
  try {
    discoverApps.value = await getDiscoverApps();
  } catch {
    discoverFailed.value = true;
  } finally {
    discoverLoading.value = false;
  }
};
const closeDiscover = () => { discoverOpen.value = false; };
const handleSearchFocusOut = (event: FocusEvent) => {
  if (!(event.relatedTarget instanceof Node) || !searchContainer.value?.contains(event.relatedTarget)) closeDiscover();
};

watch(
  () => route.fullPath,
  () => {
    if (!pageActive.value || route.path !== browsePath.value) {
      ++requestId;
      loadedLocation = '';
      closeDiscover();
      return;
    }
    void loadPage();
  },
  { immediate: true }
);
onActivated(() => {
  if (route.path === browsePath.value && loadedLocation !== route.fullPath) void loadPage();
});
</script>

<style scoped>
.apps-view {
  max-width: 1440px;
  margin: 0 auto;
  padding: 28px;
  color: var(--el-text-color-primary);
}
.apps-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.apps-header h1 { margin: 0; font-size: 28px; letter-spacing: -0.5px; }
.search-container { position: relative; width: min(100%, 440px); }
.search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px 5px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 999px;
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
}
.search-bar:focus-within { border-color: var(--el-color-primary); }
.search-bar input { min-width: 0; width: 100%; border: 0; outline: none; background: transparent; color: var(--el-text-color-primary); font: inherit; font-size: 14px; }
.search-bar input::placeholder { color: var(--el-text-color-placeholder); }
button { font: inherit; cursor: pointer; }
.search-submit, .clear-search { border: 0; background: transparent; color: var(--el-text-color-secondary); }
.search-submit { padding: 8px 12px; white-space: nowrap; color: var(--el-color-primary); }
.clear-search { display: flex; padding: 4px; }
.browse-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; max-width: 880px; margin: 0 auto 28px; }
.browse-tab { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 11px 8px; border-radius: 999px; background: var(--el-bg-color); color: var(--el-text-color-regular); font-size: 14px; white-space: nowrap; text-decoration: none; transition: background-color 0.15s; }
.browse-tab.active { background: var(--el-text-color-primary); color: var(--el-bg-color); font-weight: 600; }
.browse-tab:not(.active):hover { background: var(--el-fill-color); }
a:focus-visible, button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
.view-heading { display: flex; align-items: center; gap: 14px; margin: 0 0 20px; }
.view-heading h2 { min-width: 0; margin: 0; font-size: 22px; overflow-wrap: anywhere; }
.back-button { display: grid; place-items: center; flex-shrink: 0; width: 36px; height: 36px; border: 0; border-radius: 50%; color: var(--el-text-color-primary); background: var(--el-bg-color); }
.categories-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; }
.category-card { position: relative; display: flex; align-items: center; width: 100%; min-width: 0; min-height: 96px; aspect-ratio: 2.5; overflow: hidden; border-radius: 17px; color: #fff; text-decoration: none; transition: transform 0.15s; }
.category-card:hover { transform: translateY(-2px); }
.category-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.category-card > span { position: relative; max-width: 65%; padding: 14px; font-weight: 600; font-size: 16px; text-shadow: 0 1px 4px rgb(0 0 0 / 12%); }
.sections { display: grid; gap: 18px; }
.app-section { padding: 20px 16px 10px; border-radius: 20px; background: var(--el-bg-color); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 4px 10px; }
.section-heading h2, .update-group h2 { margin: 0; font-size: 22px; font-weight: 650; }
.section-heading p { margin: 5px 0 0; color: var(--el-text-color-secondary); font-size: 13px; }
.see-all { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; color: var(--el-text-color-secondary); font-size: 13px; text-decoration: none; }
.see-all:hover { color: var(--el-color-primary); }
.app-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 28px; }
.app-row { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 13px 4px; border-radius: 10px; color: inherit; text-decoration: none; }
.app-grid > .app-row { border-bottom: 1px solid var(--el-border-color-extra-light); }
.app-row:hover { background: var(--el-fill-color-light); }
.app-icon { width: 52px; height: 52px; border-radius: 13px; flex-shrink: 0; }
.icon-placeholder { display: grid; place-items: center; width: 100%; height: 100%; background: var(--el-fill-color); color: var(--el-text-color-placeholder); }
.app-text { display: flex; flex: 1; flex-direction: column; gap: 5px; min-width: 0; }
.app-name, .app-description { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.app-name { font-size: 16px; font-weight: 550; }
.app-description { color: var(--el-text-color-secondary); font-size: 12px; }
.detail-label { flex-shrink: 0; padding: 5px 14px; border-radius: 999px; color: var(--el-color-primary); background: var(--el-fill-color-light); font-size: 13px; font-weight: 600; }
.rank-position { width: 24px; text-align: center; flex-shrink: 0; font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; color: var(--el-text-color-secondary); }
.top-position { color: var(--el-text-color-primary); }
.section-empty { padding: 20px; color: var(--el-text-color-secondary); text-align: center; }
.update-groups { display: grid; gap: 32px; }
.update-group h2 { margin-bottom: 12px; }
.updates-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.update-card { min-width: 0; padding: 16px; border-radius: 20px; background: var(--el-bg-color); }
.update-header { padding: 0; }
.release-notes { margin: 16px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--el-text-color-regular); font-size: 14px; line-height: 1.65; }
.page-state { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 280px; padding: 28px; text-align: center; color: var(--el-text-color-secondary); }
.page-state > .el-icon { font-size: 28px; }
.page-state h2 { margin: 16px 0 0; font-size: 20px; color: var(--el-text-color-primary); }
.page-state p { margin: 14px 0; }
.pagination { display: flex; align-items: center; justify-content: center; gap: 20px; margin: 30px 0 12px; font-size: 14px; color: var(--el-text-color-secondary); }
.pill-button { display: inline-block; border: 1px solid var(--el-border-color-light); border-radius: 999px; padding: 9px 18px; background: var(--el-bg-color); color: var(--el-color-primary); text-decoration: none; font-size: 14px; }
.pill-button:not(.disabled):hover { background: var(--el-fill-color); }
.pill-button.disabled { color: var(--el-text-color-disabled); }
.discover-panel { position: absolute; top: calc(100% + 10px); right: 0; z-index: 20; width: min(640px, calc(100vw - 56px)); box-sizing: border-box; max-height: min(65vh, 560px); overflow-y: auto; padding: 16px; border: 1px solid var(--el-border-color-light); border-radius: 20px; background: var(--el-bg-color-overlay); box-shadow: 0 12px 32px rgb(0 0 0 / 12%); }
.discover-panel h2 { margin: 0 4px 10px; font-size: 17px; }
.discover-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 16px; }
.discover-item { padding: 10px 4px; }
.discover-item .app-icon { width: 44px; height: 44px; border-radius: 11px; }
.discover-state { padding: 20px 4px; text-align: center; color: var(--el-text-color-secondary); font-size: 14px; }
.text-button { padding: 5px; border: 0; background: transparent; color: var(--el-color-primary); }
@media (max-width: 1150px) {
  .categories-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .app-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; }
}
@media (max-width: 760px) {
  .apps-view { padding: 20px 16px; }
  .apps-header { gap: 16px; margin-bottom: 20px; }
  .apps-header h1 { font-size: 24px; }
  .search-container { width: min(100%, 360px); }
  .browse-tabs { gap: 8px; margin-bottom: 22px; }
  .browse-tab { font-size: 13px; gap: 5px; padding: 10px 4px; }
  .categories-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .category-card { min-height: 85px; border-radius: 13px; }
  .category-card > span { padding: 10px; font-size: 14px; }
  .app-section { padding: 16px 12px 6px; }
  .section-heading h2, .update-group h2 { font-size: 20px; }
  .app-grid { column-gap: 16px; }
  .app-row { gap: 9px; }
  .app-icon { width: 46px; height: 46px; border-radius: 12px; }
  .app-name { font-size: 15px; }
  .detail-label { padding: 5px 10px; }
  .rank-position { width: 20px; }
  .updates-grid { grid-template-columns: 1fr; }
  .discover-panel { width: min(640px, calc(100vw - 32px)); }
}
@media (max-width: 540px) {
  .apps-header { align-items: stretch; flex-direction: column; gap: 14px; }
  .search-container { width: 100%; }
  .browse-tab { padding-inline: 2px; }
  .browse-tab .el-icon { display: none; }
  .categories-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .category-card { min-height: 88px; }
  .app-grid, .discover-list { grid-template-columns: 1fr; }
  .app-section { border-radius: 16px; }
  .view-heading h2 { font-size: 20px; }
  .pagination { gap: 10px; font-size: 13px; }
  .pill-button { padding: 9px 13px; font-size: 13px; }
}
</style>
