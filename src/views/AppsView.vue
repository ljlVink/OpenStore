<template>
  <div class="apps-view">
    <div class="search-container">
      <el-input
        v-model="searchQuery"
        placeholder="搜索应用、游戏..."
        class="search-input"
        :prefix-icon="Search"
        size="large"
        maxlength="50"
        @keyup.enter="handleSearch"
      >
        <template #suffix>
          <el-icon
            v-if="searchQuery"
            class="el-input__icon el-input__clear"
            style="margin-right: 8px; cursor: pointer; color: var(--el-text-color-secondary);"
            @click="searchQuery = ''"
          >
            <CircleClose />
          </el-icon>
          <el-button class="search-btn" text @click="handleSearch">
            搜索
          </el-button>
        </template>
      </el-input>
    </div>

    <div class="apps-container">
      <div class="view-header">
        <el-button v-if="keyword" circle @click="handleBack" class="back-btn">
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
        <h2 class="view-title">{{ pageTitle }}</h2>
        <div v-if="!loading && !failed" class="view-total-badge">共 {{ appList.length }} 个应用</div>
      </div>

      <div v-if="loading" class="apps-grid">
        <div class="app-card skeleton-card" v-for="i in 12" :key="i">
          <el-skeleton animated>
            <template #template>
              <div class="skeleton-content">
                <el-skeleton-item variant="image" class="skeleton-icon" />
                <div class="skeleton-info">
                  <el-skeleton-item variant="h3" style="width: 50%; margin-bottom: 8px;" />
                  <el-skeleton-item variant="text" style="width: 80%; margin-bottom: 8px;" />
                  <div class="skeleton-meta">
                    <el-skeleton-item variant="text" style="width: 40px; height: 16px; margin-right: 8px;" />
                    <el-skeleton-item variant="text" style="width: 60px; height: 16px;" />
                  </div>
                </div>
              </div>
            </template>
          </el-skeleton>
        </div>
      </div>
      <el-empty v-else-if="failed" description="华为应用市场暂时无法访问，请稍后再试" />
      <el-empty v-else-if="appList.length === 0" description="暂无应用" />
      <div class="apps-grid" v-else>
        <AppCard
          v-for="(app, index) in appList"
          :key="app.app_id"
          :app="app"
          :rank="index + 1"
          @click="handleAppClick"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({
  name: 'AppsView'
});

import { ref, watch, computed, onActivated } from 'vue';
import { Search, CircleClose, ArrowLeft } from '@element-plus/icons-vue';
import { useRouter, useRoute } from 'vue-router';
import { getDiscoverApps, searchApps, type AppGalleryListApp } from '../services/next-api';
import AppCard from '../components/AppCard.vue';
import { usePageActive } from '../utils/page-active';

const router = useRouter();
const route = useRoute();
const pageActive = usePageActive();
const searchQuery = ref('');
const appList = ref<AppGalleryListApp[]>([]);
const loading = ref(false);
const failed = ref(false);
let requestId = 0;
/** 不在本页时被跳过的 route.query 同步：切回来要补一次 */
let routeSyncSkipped = false;

/** 当前搜索词（地址栏 ?q=），为空时展示「发现更多」 */
const keyword = computed(() => (typeof route.query.q === 'string' ? route.query.q.trim() : ''));

const pageTitle = computed(() => (keyword.value ? `"${keyword.value}" 的搜索结果` : '发现更多'));

const fetchApps = async () => {
  const current = ++requestId;
  const q = keyword.value;
  searchQuery.value = q;
  loading.value = true;
  failed.value = false;
  appList.value = [];
  try {
    const list = q ? await searchApps(q) : await getDiscoverApps();
    if (current === requestId) appList.value = list;
  } catch (error) {
    console.error('Failed to fetch apps:', error);
    if (current === requestId) failed.value = true;
  } finally {
    if (current === requestId) loading.value = false;
  }
};

const handleSearch = () => {
  const q = searchQuery.value.trim();
  if (!q) return;
  router.push({ query: { q } });
};

const handleBack = () => {
  searchQuery.value = '';

  /*
   * 从站内别处带着搜索词进来时，返回应该回到来的那个页面；
   * 应用页内部搜索产生的 /apps?q=... 历史则一步回到「发现更多」，
   * 免得返回按钮变成"一步步退回刚才搜过的词"。
   */
  const from = (window.history.state as { back?: string | null } | null)?.back || '';
  if (from && from.split('?')[0] !== '/apps') {
    router.back();
    return;
  }
  router.push({ query: {} });
};

const handleAppClick = (app: AppGalleryListApp) => {
  router.push({
    name: 'next-app-detail',
    params: { id: app.app_id },
    query: { title: app.name }
  });
};

/*
 * route.query 是全局的，离开 /apps 时它也会变、watch 跟着跑一遍取数；
 * 页面在 keep-alive 里没卸载，所以要自己判断在不在本页，跳过的那次切回来由 onActivated 补。
 */
watch(
  keyword,
  () => {
    if (!pageActive.value) {
      routeSyncSkipped = true;
      return;
    }
    routeSyncSkipped = false;
    fetchApps();
  },
  { immediate: true }
);

onActivated(() => {
  if (!routeSyncSkipped) return;
  routeSyncSkipped = false;
  fetchApps();
});
</script>

<style scoped>
.apps-view {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.search-container {
  width: 100%;
  max-width: 800px;
  margin: 10px auto 30px;
}

.search-input {
  --el-input-border-color: transparent;
  --el-input-hover-border-color: transparent;
  --el-input-focus-border-color: transparent;
}

.search-input :deep(.el-input__wrapper) {
  border-radius: 50px;
  background-color: var(--el-bg-color);
  box-shadow: none;
  border: 1px solid var(--el-border-color);
  padding-left: 20px;
  padding-right: 10px;
  transition: all 0.3s ease;
  z-index: 1;
}

.search-input :deep(.el-input__wrapper.is-focus) {
  box-shadow: none;
  border-color: var(--el-color-primary);
  z-index: 2;
}

.search-btn {
  background-color: transparent;
  border-radius: 50px;
  height: 32px;
  padding: 0 16px;
  color: var(--el-text-color-primary);
  font-weight: 600;
  font-size: 14px;
  border: none;
  box-shadow: none;
  transition: all 0.3s;
  margin-left: 5px;
}

.search-btn:hover {
  background-color: var(--el-fill-color);
  color: var(--el-color-primary);
}

.search-btn:active {
  background-color: var(--el-fill-color-darker);
  transform: translateY(0);
}

.view-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
  position: relative;
  min-height: 32px;
}

.view-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  height: 32px;
  line-height: 32px;
  text-align: center;
  white-space: nowrap;
  max-width: calc(100% - 180px);
  overflow: hidden;
  text-overflow: ellipsis;
}

.view-total-badge {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  background: linear-gradient(180deg, var(--el-bg-color) 0%, var(--el-fill-color-light) 100%);
  color: var(--el-text-color-primary);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  text-align: center;
  line-height: 32px;
  border: 1px solid var(--el-border-color);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

.back-btn {
  font-size: 18px;
  padding: 0;
  width: 32px;
  height: 32px;
  line-height: 32px;
  color: var(--el-color-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--el-color-primary-light-7);
  background-color: var(--el-color-primary-light-9);
  box-shadow: 0 4px 10px rgba(64, 158, 255, 0.12);
  transition: all 0.2s ease;
}

.back-btn:hover {
  background-color: var(--el-color-primary-light-8);
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
  box-shadow: 0 6px 14px rgba(64, 158, 255, 0.18);
  transform: translateX(-1px);
}

.back-btn:active {
  transform: translateX(0);
  box-shadow: 0 2px 6px rgba(64, 158, 255, 0.14);
}

.apps-grid {
  display: grid;
  /* 列数完全由容器宽度决定：卡片最小 240px，放不下就自动减列，够宽就自动加列。
     min(100%, 240px) 避免容器比 240px 还窄时溢出。 */
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
  column-gap: 16px;
  row-gap: 16px;
  padding-bottom: 40px;
}

.dark .search-input :deep(.el-input__wrapper) {
  background-color: var(--el-bg-color-overlay);
}

/* Skeleton Loader */
.skeleton-card {
  background: var(--el-bg-color);
  border-radius: 12px;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  height: 100%;
  box-sizing: border-box;
}

.skeleton-content {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 84px;
}

.skeleton-icon {
  width: 56px !important;
  height: 56px !important;
  border-radius: 12px;
  margin-right: 12px;
  flex-shrink: 0;
}

.skeleton-info {
  flex: 1;
  min-width: 0;
  margin-right: 8px;
}

.skeleton-meta {
  display: flex;
}

@media (min-width: 1280px) {
  .skeleton-card {
    padding: 14px;
  }

  .skeleton-icon {
    width: 60px !important;
    height: 60px !important;
  }
}

@media (max-width: 768px) {
  .view-header {
    gap: 6px;
  }

  .view-title {
    font-size: 18px;
    max-width: calc(100% - 150px);
  }

  .view-total-badge {
    height: 30px;
    padding: 0 12px;
    font-size: 12px;
    line-height: 30px;
  }

  .skeleton-card {
    padding: 10px;
    border-radius: 10px;
  }

  .skeleton-content {
    min-height: 72px;
  }

  .skeleton-icon {
    width: 48px !important;
    height: 48px !important;
    border-radius: 10px;
    margin-right: 10px;
  }

  .skeleton-info {
    margin-right: 6px;
  }
}

@media (max-width: 480px) {
  .view-header {
    min-height: 30px;
  }

  .view-title {
    max-width: calc(100% - 124px);
  }

  .view-total-badge {
    height: 28px;
    padding: 0 10px;
    font-size: 11px;
    line-height: 28px;
  }

  .skeleton-card {
    padding: 8px;
  }

  .skeleton-content {
    min-height: 64px;
  }

  .skeleton-icon {
    width: 42px !important;
    height: 42px !important;
    margin-right: 8px;
  }

  .skeleton-meta {
    gap: 6px;
  }
}
</style>
