<template>
  <section class="explore-topics">
    <div v-if="loading && !sections.length" class="explore-grid" aria-hidden="true">
      <div v-for="i in 6" :key="i" class="explore-card is-skeleton"></div>
    </div>

    <el-empty v-else-if="failed && !sections.length" description="华为应用市场暂时无法访问，请稍后再试">
      <el-button round @click="load">重试</el-button>
    </el-empty>

    <div v-for="(section, index) in sections" :key="index" class="explore-section">
      <h2 v-if="section.title" class="explore-section-title">{{ section.title }}</h2>
      <div class="explore-grid">
        <template v-for="card in section.cards" :key="card.substance_id || `${card.kind}:${card.title}`">
          <!-- 榜单卡：标题点进专题，每一行点进应用 -->
          <article v-if="card.kind === 'list'" class="explore-card is-list">
            <header
              class="list-head"
              :class="{ 'is-link': card.substance_id }"
              v-bind="linkAttrs(card)"
              @click="openTopic(card)"
              @keydown.enter.prevent="openTopic(card)"
            >
              <span class="card-label">{{ card.label }}</span>
              <h3 class="card-title">
                {{ card.title }}
                <el-icon v-if="card.substance_id" class="list-more"><ArrowRight /></el-icon>
              </h3>
            </header>
            <ul class="list-apps">
              <li
                v-for="app in card.apps"
                :key="app.app_id"
                class="list-app"
                role="link"
                tabindex="0"
                @click="openApp(app)"
                @keydown.enter.prevent="openApp(app)"
              >
                <img :src="app.icon_url" alt="" loading="lazy" class="list-app-icon" />
                <div class="list-app-text">
                  <div class="list-app-name">{{ app.name }}</div>
                  <div class="list-app-desc">{{ app.brief_desc }}</div>
                </div>
              </li>
            </ul>
          </article>

          <!-- 图标墙：一组应用图标 + 标题 -->
          <article
            v-else-if="card.kind === 'icons'"
            class="explore-card is-icons"
            :class="{ 'is-link': card.substance_id }"
            v-bind="linkAttrs(card)"
            @click="openTopic(card)"
            @keydown.enter.prevent="openTopic(card)"
          >
            <div class="icons-wall">
              <img v-for="app in card.apps" :key="app.app_id" :src="app.icon_url" :alt="app.name" loading="lazy" />
            </div>
            <div class="icons-caption">
              <span class="card-label">{{ card.label }}</span>
              <h3 class="card-title">{{ card.title }}</h3>
              <p v-if="card.subtitle" class="card-subtitle">{{ card.subtitle }}</p>
            </div>
          </article>

          <!-- 大图卡：头图铺满，底部是华为给的信息栏颜色 -->
          <article
            v-else
            class="explore-card is-story"
            :class="{ 'is-link': card.substance_id, 'is-light': isLightColor(card.color) }"
            :style="{ '--story-color': card.color || '#475569' }"
            v-bind="linkAttrs(card)"
            @click="openTopic(card)"
            @keydown.enter.prevent="openTopic(card)"
          >
            <img v-if="card.image" :src="card.image" alt="" loading="lazy" class="story-image" />
            <div class="story-info">
              <span class="card-label">{{ card.label }}</span>
              <h3 class="card-title">{{ card.title }}</h3>
              <p v-if="card.subtitle" class="card-subtitle">{{ card.subtitle }}</p>
              <div v-if="card.apps.length" class="story-apps">
                <img v-for="app in card.apps" :key="app.app_id" :src="app.icon_url" :alt="app.name" loading="lazy" />
              </div>
            </div>
          </article>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRight } from '@element-plus/icons-vue';
import { getExplore, type ExploreApp, type ExploreCard, type ExploreSection } from '../services/api';

/** 首页被 keep-alive 缓存：切回来时超过这个时间才重新取（服务端同样缓存 10 分钟） */
const REFRESH_MS = 10 * 60 * 1000;

const router = useRouter();
const sections = ref<ExploreSection[]>([]);
const loading = ref(false);
const failed = ref(false);
let loadedAt = 0;

const load = async () => {
  if (loading.value) return;
  loading.value = true;
  failed.value = false;
  try {
    sections.value = await getExplore();
    loadedAt = Date.now();
  } catch (error) {
    console.error('Failed to fetch explore topics:', error);
    failed.value = true;
  } finally {
    loading.value = false;
  }
};

onMounted(load);
onActivated(() => {
  if (loadedAt && Date.now() - loadedAt > REFRESH_MS) void load();
});

/** 能点进专题的卡片才是链接（可聚焦、读屏报「链接」） */
const linkAttrs = (card: ExploreCard) => (card.substance_id ? { role: 'link', tabindex: 0 } : {});

const openTopic = (card: ExploreCard) => {
  if (!card.substance_id) return;
  router.push({ path: `/topics/${card.substance_id}`, query: { title: card.title } });
};

const openApp = (app: ExploreApp) => {
  router.push({ name: 'next-app-detail', params: { id: app.app_id }, query: { title: app.name } });
};

/** 信息栏是浅色（米黄、浅绿这类）时文字要用深色，否则看不清 */
const isLightColor = (hex: string) => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return false;
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
};
</script>

<style scoped>
.explore-section + .explore-section {
  margin-top: 28px;
}

.explore-section-title {
  margin: 0 0 12px;
  font-size: 20px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.explore-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  grid-auto-rows: 340px;
  gap: 16px;
}

/* 没有标题的栏目紧挨着上一个栏目，看起来是同一片卡片墙 */
.explore-section:not(:has(.explore-section-title)) + .explore-section:not(:has(.explore-section-title)) {
  margin-top: 16px;
}

.explore-card {
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  box-sizing: border-box;
  min-width: 0;
}

.explore-card.is-link {
  cursor: pointer;
}

.explore-card.is-link:focus-visible,
.list-head.is-link:focus-visible,
.list-app:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.card-label {
  display: block;
  font-size: 12px;
  line-height: 1.4;
  opacity: 0.8;
}

.card-title {
  margin: 2px 0 0;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.4;
  opacity: 0.85;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ---------- 大图卡 ---------- */
.is-story {
  background: var(--story-color);
  color: #fff;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.is-story.is-light {
  color: #1f2329;
}

.is-story.is-link:hover,
.is-icons.is-link:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
}

.story-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.story-info {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 48px 16px 16px;
  background: linear-gradient(to top, var(--story-color) 0%, var(--story-color) 45%, transparent 100%);
}

.story-apps {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.story-apps img {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.85);
}

/* ---------- 榜单卡 ---------- */
.is-list {
  display: flex;
  flex-direction: column;
  padding: 14px 12px 8px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-primary);
}

.list-head {
  padding: 0 6px 6px;
  border-radius: 10px;
}

.list-head .card-label {
  color: var(--el-text-color-secondary);
  opacity: 1;
}

.list-head.is-link {
  cursor: pointer;
}

.list-head.is-link:hover .card-title {
  color: var(--el-color-primary);
}

.list-head .card-title {
  display: flex;
  align-items: center;
  gap: 4px;
  transition: color 0.2s;
}

.list-more {
  font-size: 15px;
  color: var(--el-text-color-secondary);
}

.list-apps {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  margin: 0;
  padding: 0;
  list-style: none;
  min-height: 0;
}

.list-app {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.list-app:hover {
  background: var(--el-fill-color-light);
}

.list-app-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 10px;
  object-fit: cover;
}

.list-app-text {
  min-width: 0;
}

.list-app-name,
.list-app-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-app-name {
  font-size: 14px;
  font-weight: 600;
}

.list-app-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* ---------- 图标墙 ---------- */
.is-icons {
  display: flex;
  flex-direction: column;
  background: linear-gradient(160deg, var(--el-color-primary-light-9) 0%, var(--el-fill-color-light) 100%);
  border: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-primary);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.icons-wall {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, 52px);
  grid-auto-rows: 52px;
  justify-content: center;
  align-content: center;
  gap: 14px;
  padding: 20px 16px 0;
  overflow: hidden;
}

.icons-wall img {
  width: 52px;
  height: 52px;
  border-radius: 13px;
  object-fit: cover;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
}

.icons-caption {
  padding: 12px 16px 16px;
}

/* ---------- 骨架 ---------- */
.is-skeleton {
  background: var(--el-fill-color-light);
  animation: explore-pulse 1.4s ease-in-out infinite;
}

@keyframes explore-pulse {
  50% {
    opacity: 0.55;
  }
}

@media (max-width: 768px) {
  .explore-grid {
    grid-auto-rows: 320px;
    gap: 12px;
  }

  .explore-section-title {
    font-size: 18px;
  }
}
</style>
