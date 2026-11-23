<template>
  <div class="market-page">
    <header class="market-header">
      <h1>{{ title }}</h1>
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
            <button type="button" class="text-button" @click="openDiscover">重试</button>
          </div>
          <p v-else-if="!discoverApps.length" class="discover-state">暂无推荐应用</p>
          <div v-else class="discover-list">
            <RouterLink
              v-for="app in discoverApps"
              :key="app.app_id"
              :to="{ name: 'next-app-detail', params: { id: app.app_id }, query: { title: app.name } }"
              class="discover-item"
              @click="closeDiscover"
            >
              <el-image :src="app.icon_url" class="discover-icon" fit="cover" loading="lazy">
                <template #error><span class="icon-placeholder"><el-icon><Picture /></el-icon></span></template>
              </el-image>
              <span class="discover-text">
                <span class="discover-name">{{ app.name }}</span>
                <span class="discover-description">{{ app.brief_desc || app.kind_name }}</span>
              </span>
            </RouterLink>
          </div>
        </div>
      </div>
    </header>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { CircleClose, Picture, Search } from '@element-plus/icons-vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { getDiscoverApps, type AppGalleryBrowseTab, type AppGalleryCatalog, type AppGalleryListApp } from '../services/next-api';

const props = withDefaults(defineProps<{
  title: string;
  catalog?: AppGalleryCatalog;
  tab?: AppGalleryBrowseTab;
  query?: string;
}>(), { catalog: 'apps', query: '' });

const route = useRoute();
const router = useRouter();
const searchQuery = ref(props.query);
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

const handleSearch = () => {
  const q = searchQuery.value.trim();
  closeDiscover();
  if (!q && !props.tab) return;
  void router.push({ name: props.catalog, query: { tab: props.tab, q: q || undefined } });
};

watch([() => route.fullPath, () => props.query], () => {
  searchQuery.value = props.query;
  closeDiscover();
});
</script>

<style scoped>
.market-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: 28px;
  color: var(--el-text-color-primary);
}
.market-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.market-header h1 { margin: 0; font-size: 28px; letter-spacing: -0.5px; }
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
a:focus-visible, button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
.search-submit, .clear-search { border: 0; background: transparent; color: var(--el-text-color-secondary); }
.search-submit { padding: 8px 12px; white-space: nowrap; color: var(--el-color-primary); }
.clear-search { display: flex; padding: 4px; }
.discover-panel { position: absolute; top: calc(100% + 10px); right: 0; z-index: 20; width: min(640px, calc(100vw - 56px)); box-sizing: border-box; max-height: min(65vh, 560px); overflow-y: auto; padding: 16px; border: 1px solid var(--el-border-color-light); border-radius: 20px; background: var(--el-bg-color-overlay); box-shadow: 0 12px 32px rgb(0 0 0 / 12%); }
.discover-panel h2 { margin: 0 4px 10px; font-size: 17px; }
.discover-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 16px; }
.discover-item { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 10px 4px; border-radius: 10px; color: inherit; text-decoration: none; }
.discover-item:hover { background: var(--el-fill-color-light); }
.discover-icon { width: 44px; height: 44px; border-radius: 11px; flex-shrink: 0; }
.icon-placeholder { display: grid; place-items: center; width: 100%; height: 100%; background: var(--el-fill-color); color: var(--el-text-color-placeholder); }
.discover-text { display: flex; flex: 1; flex-direction: column; gap: 5px; min-width: 0; }
.discover-name, .discover-description { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.discover-name { font-size: 16px; font-weight: 550; }
.discover-description { color: var(--el-text-color-secondary); font-size: 12px; }
.discover-state { padding: 20px 4px; text-align: center; color: var(--el-text-color-secondary); font-size: 14px; }
.text-button { padding: 5px; border: 0; background: transparent; color: var(--el-color-primary); }
@media (max-width: 760px) {
  .market-page { padding: 20px 16px; }
  .market-header { gap: 16px; margin-bottom: 20px; }
  .market-header h1 { font-size: 24px; }
  .search-container { width: min(100%, 360px); }
  .discover-item { gap: 9px; }
  .discover-name { font-size: 15px; }
  .discover-panel { width: min(640px, calc(100vw - 32px)); }
}
@media (max-width: 540px) {
  .market-header { align-items: stretch; flex-direction: column; gap: 14px; }
  .search-container { width: 100%; }
  .discover-list { grid-template-columns: 1fr; }
}
</style>
