<template>
  <div class="updates-app-detail-view" v-loading="loading">
    <div v-if="appDetail" class="detail-container">
      <div class="detail-header">
        <!-- 与「应用」页详情保持一致：分享 + 获取，两个按钮同尺寸 -->
        <el-tooltip content="复制本页链接" placement="bottom" :show-after="200">
          <el-button round class="detail-action" aria-label="分享" @click="copyLink">
            <el-icon><HarmonyShareIcon /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="打开应用商店" placement="bottom" :show-after="200">
          <el-button type="primary" round class="detail-action" @click="openAppGallery">获取</el-button>
        </el-tooltip>
      </div>

      <div class="detail-card basic-card">
        <el-image :src="appDetail.icon_url" class="app-icon" fit="cover">
          <template #error>
            <div class="image-slot">
              <el-icon><Picture /></el-icon>
            </div>
          </template>
        </el-image>
        <div class="basic-info">
          <div class="app-name">{{ appDetail.name || '—' }}</div>
          <!-- 这里「开发者 · 包名」和「应用简介」来回切换展示 -->
          <div class="app-subtitle" :title="subtitleLines[rotateIndex]">
            <transition name="subtitle-fade" mode="out-in">
              <span :key="rotateIndex">{{ subtitleLines[rotateIndex] }}</span>
            </transition>
          </div>
          <div class="basic-stats">
            <div class="stat-item">
              <div class="stat-label">评分</div>
              <div class="stat-value">{{ ratingText }}</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">下载量</div>
              <div class="stat-value">{{ downloadsText }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="metrics-grid">
        <div class="detail-card metric-card">
          <div class="metric-title">版本信息</div>
          <div class="metric-value">{{ latestVersionText }}</div>
        </div>
        <div class="detail-card metric-card">
          <div class="metric-title">更新时间</div>
          <div class="metric-value">{{ latestUpdateTimeText }}</div>
        </div>
        <div class="detail-card metric-card">
          <div class="metric-title">文件大小</div>
          <div class="metric-value">{{ latestSizeText }}</div>
        </div>
        <div class="detail-card metric-card">
          <div class="metric-title">目标SDK</div>
          <div class="metric-value">{{ latestTargetSdkText }}</div>
        </div>
      </div>

      <div class="detail-card history-card">
        <div class="history-header" @click="historyOpen = !historyOpen">
          <div class="history-title">
            <el-icon><Clock /></el-icon>
            更新历史
            <span class="history-count">({{ historyItems.length }})</span>
          </div>
          <el-icon class="history-chevron" :class="{ open: historyOpen }"><ArrowDown /></el-icon>
        </div>

        <div v-show="historyOpen" class="history-body">
          <div v-if="historyItems.length === 0" class="history-empty">暂无更新历史</div>
          <div v-else class="history-list">
            <div v-for="item in historyItems" :key="item.key" class="history-item">
              <div class="history-item-head">
                <div class="history-version">{{ item.version }}</div>
                <div class="history-date">{{ item.dateText }}</div>
              </div>
              <div class="history-desc">{{ item.description }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <el-empty v-else-if="!loading" description="未找到应用详情" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ArrowDown, Clock, Picture } from '@element-plus/icons-vue';
import HarmonyShareIcon from '../components/HarmonyShareIcon.vue';
import { getAppDetail, type AppGalleryAppInfo, type AppGalleryVersion } from '../services/next-api';
import { useLayoutStore } from '../stores/layout';
import { useActiveScope } from '../utils/page-active';
import { goBackOrHome } from '../utils/route-scroll';
import { buildAppShareMeta, clearPageShareMeta, setPageShareMeta, shareCurrentPage } from '../utils/page-share';

const route = useRoute();
const router = useRouter();
const layoutStore = useLayoutStore();

const loading = ref(false);
const historyOpen = ref(true);

const appDetail = ref<AppGalleryAppInfo | null>(null);
/** 最近 25 个版本（华为应用市场版本历史） */
const versions = ref<AppGalleryVersion[]>([]);

const appId = computed(() => String(route.params.id || '').trim());

/** 应用简介（brief_desc，短简介；不是详情里的长说明） */
const briefText = computed(() => appDetail.value?.brief_desc || '');

/** 副标题两行：开发者 · 包名 + 应用简介（有简介才轮播） */
const subtitleLines = computed(() => {
  const detail = appDetail.value;
  const who = `${detail?.developer_name || '—'} · ${detail?.pkg_name || '—'}`;
  return briefText.value ? [who, briefText.value] : [who];
});

const SUBTITLE_ROTATE_MS = 5000;
const rotateIndex = ref(0);
let subtitleTimer: number | null = null;

/** 毫秒时间戳 → "2026/9/20 18:46:06" */
const formatTimestamp = (ms: number) => (ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '—');

const ratingText = computed(() => {
  const rating = appDetail.value?.average_rating;
  return rating ? rating.toFixed(1) : '—';
});

const downloadsText = computed(() => {
  const count = appDetail.value?.download_count;
  return count ? count.toLocaleString() : '—';
});

const latestVersionText = computed(() => appDetail.value?.version || '—');

/** 当前版本的发布时间（release_date） */
const latestUpdateTimeText = computed(() => formatTimestamp(appDetail.value?.release_date || 0));

const latestSizeText = computed(() => {
  const n = appDetail.value?.size_bytes || 0;
  if (n <= 0) return '—';
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (n >= gb) return `${(n / gb).toFixed(2)} GB`;
  if (n >= mb) return `${(n / mb).toFixed(2)} MB`;
  if (n >= kb) return `${(n / kb).toFixed(2)} KB`;
  return `${n} B`;
});

const latestTargetSdkText = computed(() => (appDetail.value?.target_sdk ? String(appDetail.value.target_sdk) : '—'));

/* 华为偶尔把同一版本号发两次（重新上架），按 版本号 + 发布时间 区分 */
const historyItems = computed(() =>
  versions.value.map((entry) => ({
    key: `${entry.version}@${entry.release_date}`,
    version: entry.version,
    dateText: formatTimestamp(entry.release_date),
    description: entry.new_features
  }))
);

/** 分享本页：带应用图标 + 名称 / 开发者 / 简介，系统分享面板不支持时退回复制 */
const copyLink = () => shareCurrentPage('已复制应用分享信息');

const openAppGallery = () => {
  const pkg = appDetail.value?.pkg_name;
  const id = appDetail.value?.app_id || appId.value;
  if (pkg) {
    window.open(`https://appgallery.huawei.com/app/detail?id=${encodeURIComponent(pkg)}`, '_blank');
    return;
  }
  if (id) {
    window.open(`https://appgallery.huawei.com/app/${encodeURIComponent(id)}`, '_blank');
    return;
  }
  ElMessage.warning('无法获取应用标识');
};

const fetchDetail = async () => {
  if (!appId.value) return;
  loading.value = true;
  try {
    const app = await getAppDetail(appId.value);
    appDetail.value = app?.info ?? null;
    versions.value = app?.versions ?? [];
    if (!appDetail.value) return;

    const title = appDetail.value.name || '应用更新详情';
    // 深链接直接进来时没有上一页，兜底回更新列表
    layoutStore.setPageInfo(title, true, () => goBackOrHome(router, '/updates'));
    document.title = `OpenStore | ${title}`;
    // 分享卡片带上这个应用自己的图标和文字
    setPageShareMeta(buildAppShareMeta(appDetail.value));
  } catch (e) {
    appDetail.value = null;
    versions.value = [];
    ElMessage.error('获取应用详情失败');
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchDetail();
});

/**
 * 「开发者 · 包名」与「应用简介」来回切换的定时器。
 * 页面在 keep-alive 里切走只是挂起，不停掉的话定时器会在后台一直改 ref、反复重渲染。
 */
const startSubtitleRotate = () => {
  if (subtitleTimer !== null) return;
  subtitleTimer = window.setInterval(() => {
    if (subtitleLines.value.length > 1) {
      rotateIndex.value = (rotateIndex.value + 1) % subtitleLines.value.length;
    }
  }, SUBTITLE_ROTATE_MS);
};

const stopSubtitleRotate = () => {
  if (subtitleTimer !== null) {
    window.clearInterval(subtitleTimer);
    subtitleTimer = null;
  }
};

useActiveScope(startSubtitleRotate, stopSubtitleRotate);

onBeforeUnmount(() => {
  clearPageShareMeta();
});
</script>

<style scoped>
.updates-app-detail-view {
  padding: 20px;
  max-width: 1000px;
  margin: 0 auto;
  min-height: 80vh;
}

.detail-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

/* 分享 / 获取两个按钮同尺寸 */
.detail-header :deep(.detail-action) {
  width: 88px;
  height: 32px;
  padding: 0;
}


.detail-card {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
  padding: 16px;
}

.basic-card {
  display: flex;
  gap: 16px;
  align-items: center;
}

.app-icon {
  width: 80px;
  height: 80px;
  border-radius: 16px;
  flex: 0 0 auto;
  overflow: hidden;
}

.image-slot {
  width: 80px;
  height: 80px;
  display: flex;
  justify-content: center;
  align-items: center;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-radius: 16px;
}

.basic-info {
  flex: 1;
  min-width: 0;
}

.app-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-subtitle {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 副标题轮播时的淡入淡出 */
.subtitle-fade-enter-active,
.subtitle-fade-leave-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
}

.subtitle-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.subtitle-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.basic-stats {
  display: flex;
  gap: 16px;
  margin-top: 10px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.stat-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.metric-card {
  padding: 14px;
}

.metric-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
}

.metric-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  min-height: 20px;
}

.history-card {
  padding: 0;
  overflow: hidden;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  cursor: pointer;
  user-select: none;
}

.history-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.history-count {
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.history-chevron {
  transition: transform 0.2s ease;
  color: var(--el-text-color-secondary);
}

.history-chevron.open {
  transform: rotate(180deg);
}

.history-body {
  border-top: 1px solid var(--el-border-color-lighter);
  padding: 14px 16px 16px;
}

.history-empty {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-item {
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-blank);
}

.history-item-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 6px;
}

.history-version {
  font-size: 14px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.history-date {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex: 0 0 auto;
}

.history-desc {
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
  white-space: pre-wrap;
}

@media (max-width: 900px) {
  .metrics-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
