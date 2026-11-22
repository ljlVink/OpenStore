<template>
  <div class="about-view">
    <!-- 页面头部：站点身份，始终做成第一屏的主视觉 -->
    <AboutHero
      class="about-hero-item"
      :style="cardStyle('hero')"
      :site-name="aboutData.site_name"
      :tagline="aboutData.tagline"
      :grid-text="aboutData.hero_grid_text || ''"
    />

    <el-card
      v-if="showContent"
      class="about-card is-full content-card"
      :style="cardStyle('content')"
    >
      <div
        class="about-content"
        :class="{ 'ql-editor': !aboutData.content_markdown, 'markdown-body': !!aboutData.content_markdown }"
        v-html="aboutData.content_html"
      ></div>
    </el-card>

    <!-- 联系我们：公开页面与后台预览共用固定 Telegram 入口 -->
    <el-card class="about-card is-full" :style="cardStyle('social')">
      <template #header>
        <div class="card-header">
          <span class="card-title">联系我们</span>
        </div>
      </template>
      <AboutSocialLinks />
    </el-card>

    <el-card v-if="contributors.length" class="about-card is-full" :style="cardStyle('contributors')">
      <template #header>
        <div class="card-header">
          <span class="card-title">鸣谢</span>
        </div>
      </template>
      <p class="contributors-intro">感谢以下贡献者对 OpenStore 的支持：</p>
      <div class="contributors">
        <a
          v-for="person in contributors"
          :key="person.github"
          :href="githubProfileUrl(person.github)"
          target="_blank"
          rel="noopener"
          class="contributor"
          :title="`@${person.github}`"
        >
          <el-image
            :src="githubAvatarUrl(person.github, 160)"
            fit="cover"
            class="contributor-avatar"
            loading="lazy"
          >
            <!-- 头像取不到时退回首字母，别留一个破图 -->
            <template #error>
              <span class="contributor-fallback">{{ (person.name || person.github).slice(0, 1).toUpperCase() }}</span>
            </template>
          </el-image>
          <span class="contributor-name">{{ person.name || person.github }}</span>
        </a>
      </div>
    </el-card>

    <el-card v-if="aboutData.github_repo" class="about-card is-full" :style="cardStyle('commits')">
      <template #header>
        <div class="card-header is-toggle" @click="toggleCommits">
          <span class="card-title">
            最近提交
            <span class="card-count">{{ repoName }}</span>
          </span>
          <el-icon class="toggle-icon" :class="{ 'rotate-90': commitsExpanded }"><ArrowRight /></el-icon>
        </div>
      </template>
      <el-collapse-transition>
        <div v-show="commitsExpanded">
          <div v-loading="commitsLoading" class="commits-list">
            <div v-for="commit in commits" :key="commit.sha" class="commit-item">
              <div class="commit-info">
                <div class="commit-msg" :title="commit.commit.message">{{ commit.commit.message }}</div>
                <div class="commit-meta">
                  <div class="commit-user">
                    <el-avatar :size="16" :src="commit.author?.avatar_url" v-if="commit.author?.avatar_url" />
                    <span>{{ commit.commit.author.name }}</span>
                  </div>
                  <span class="commit-time">{{ new Date(commit.commit.author.date).toLocaleString() }}</span>
                </div>
              </div>
              <a :href="commit.html_url" target="_blank" rel="noopener" class="commit-link">
                <el-icon><Link /></el-icon>
              </a>
            </div>
            <p v-if="commits.length === 0 && !commitsLoading" class="empty-tip">暂无提交记录或无法获取</p>
          </div>
        </div>
      </el-collapse-transition>
    </el-card>

    <div class="footer-info">
      <p>&copy; {{ new Date().getFullYear() }} BetaHub Tech. All rights reserved.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onActivated, onMounted, onUnmounted, ref, computed, watch } from 'vue';
import { useLayoutStore } from '../stores/layout';
import {
  Link,
  ArrowRight,
} from '@element-plus/icons-vue';
import { getAboutPage, type AboutPage } from '../services/api';
import axios from 'axios';
import '@vueup/vue-quill/dist/vue-quill.snow.css'; // Import Quill styles for content rendering
import 'github-markdown-css/github-markdown.css';
import { getPublicSiteCards } from '../services/admin';
import { contentVersion } from '../services/content-refresh';
import { usePageActive } from '../utils/page-active';
import AboutHero from '../components/AboutHero.vue';
import AboutSocialLinks from '../components/AboutSocialLinks.vue';
import { githubAvatarUrl, githubProfileUrl, normalizeContributors, type Contributor } from '../utils/about';

/*
 * 关于页面的卡片顺序 / 显隐由后台「首页配置 → 关于」决定：
 * 卡片都留在模板原位，用 grid order + display 调整，避免大改结构。
 * hero 是后加的卡片，老库启动时会被种子数据补上，没补上时按模板顺序落在最前面。
 */
const ABOUT_CARD_FALLBACK = ['hero', 'content', 'social', 'contributors', 'commits'];

/*
 * 上一次拿到的卡片配置。
 * 配置是异步取的，如果首屏先用空对象渲染，模板里的卡片会全冒出来，
 * 等接口回来才把关掉的那几张藏起来 —— 刷新时就能看见"先显示再消失"。
 * 所以把上次的结果存一份，首屏直接拿它渲染，配置回来再覆盖。
 */
const ABOUT_CARDS_CACHE_KEY = 'openstore:about-cards';

const readCachedAboutCards = (): Record<string, { enabled: boolean; order: number }> => {
  try {
    const raw = localStorage.getItem(ABOUT_CARDS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const cacheAboutCards = (value: Record<string, { enabled: boolean; order: number }>) => {
  try {
    localStorage.setItem(ABOUT_CARDS_CACHE_KEY, JSON.stringify(value));
  } catch {
    /* 隐私模式 / 配额满：存不下就算了，只是会退回原来的闪烁 */
  }
};

/** 首屏直接用上次的配置渲染，接口回来再覆盖（见上面注释） */
const aboutCards = ref<Record<string, { enabled: boolean; order: number }>>(readCachedAboutCards());

const loadAboutCards = async () => {
  const next: Record<string, { enabled: boolean; order: number }> = {};
  try {
    /*
     * 必须带上 includeDisabled：关于页的卡片是固定模板，
     * 光拿启用列表的话，被关闭的卡片就没有配置项（cardStyle 返回 {}），
     * 结果反而是照着模板顺序显示在最前面，跟后台配置相反。
     */
    const cards = await getPublicSiteCards('about', { includeDisabled: true });
    cards.forEach((card, index) => {
      if (!ABOUT_CARD_FALLBACK.includes(card.key)) return;
      next[card.key] = { enabled: !!card.enabled, order: index + 1 };
    });
  } catch {
    // 配置拉不到时按模板顺序全部显示，保证首屏不空
    ABOUT_CARD_FALLBACK.forEach((key, index) => {
      next[key] = { enabled: true, order: index + 1 };
    });
  }
  aboutCards.value = next;
  cacheAboutCards(next);
};

const cardStyle = (key: string) => {
  const config = aboutCards.value[key];
  if (!config) return {};
  // order 负责排序，display 负责显隐（未配置的卡片保持模板原顺序）
  return config.enabled
    ? { order: config.order }
    : { order: config.order, display: 'none' };
};

const layoutStore = useLayoutStore();
const aboutData = ref<AboutPage>({ id: 0, github_repo: '', content_html: '', content_markdown: '' });
const commits = ref<any[]>([]);
const commitsLoading = ref(false);
const commitsExpanded = ref(false);
const repoName = computed(() => (aboutData.value.github_repo ? getRepoName(aboutData.value.github_repo) : ''));

/** 鸣谢名单：头像按 GitHub 用户名现拼地址，后台改了名字/顺序立刻反映到前台 */
const contributors = computed<Contributor[]>(() => normalizeContributors(aboutData.value.contributors));

const showContent = computed(() => {
  const html = aboutData.value.content_html;
  if (!html) return false;
  // Check for common empty states
  if (html === '<p><br></p>') return false;
  // Check if it contains only whitespace tags
  const text = html.replace(/<[^>]*>/g, '').trim();
  // If text is empty, check for images or iframes
  if (!text && !html.includes('<img') && !html.includes('<iframe') && !html.includes('<video')) {
    return false;
  }
  return true;
});

const toggleCommits = () => {
  commitsExpanded.value = !commitsExpanded.value;
  if (commitsExpanded.value && commits.value.length === 0) {
    if (aboutData.value.github_repo) {
      fetchCommits(aboutData.value.github_repo);
    }
  }
};

const fetchCommits = async (repoInput: string) => {
  if (!repoInput) return;
  
  // Clean up repo string if it's a full URL
  let repo = repoInput;
  try {
    const urlObj = new URL(repoInput);
    if (urlObj.hostname === 'github.com') {
      repo = urlObj.pathname.substring(1); // Remove leading slash
    }
  } catch (e) {
    // Not a URL, assume it's already owner/repo format
    repo = repoInput;
  }
  
  // Remove .git suffix if present
  repo = repo.replace(/\.git$/, '');

  commitsLoading.value = true;
  try {
    const response = await axios.get(`https://api.github.com/repos/${repo}/commits?per_page=5`);
    commits.value = response.data;
  } catch (error) {
    console.error('Failed to fetch commits', error);
  } finally {
    commitsLoading.value = false;
  }
};

const getRepoName = (repoInput?: string) => {
  if (!repoInput) return '';
  let repo = repoInput;
  try {
    const urlObj = new URL(repoInput);
    if (urlObj.hostname === 'github.com') {
      repo = urlObj.pathname.substring(1);
    }
  } catch (e) {
    // Not a URL
  }
  return repo.replace(/\.git$/, '');
};

// Scroll Handler
let ticking = false;

const checkScrollPosition = () => {
  // Use window.scrollY directly for more robust detection
  // When scrolled down more than 60px (header height), switch to sticky header
  layoutStore.setHeaderState(window.scrollY > 60);
};

const handleScroll = () => {
  if (!ticking) {
    window.requestAnimationFrame(() => {
      checkScrollPosition();
      ticking = false;
    });
    ticking = true;
  }
};

const fetchData = async () => {
  const data = await getAboutPage();
  if (data && Object.keys(data).length > 0) {
    aboutData.value = data;
    // Don't auto fetch commits, wait for expand
  } else {
    // Default fallback if no data in DB yet
    aboutData.value = {
      id: 0,
      content_html: `
        <h2>OpenStore - 鸿蒙应用数据面板</h2>
        <p>这是一个基于现代 Web 技术栈构建的鸿蒙应用数据探索与分析平台。</p>
        <p><strong>核心功能：</strong></p>
        <ul>
          <li><strong>应用看板：</strong>实时监控鸿蒙应用下载量与增长趋势</li>
          <li><strong>排行榜单：</strong>多维度应用下载榜单、增长对比榜</li>
          <li><strong>数据分析：</strong>应用详情深度解析与历史数据回溯</li>
          <li><strong>探索发现：</strong>发现最新上架与热门更新的鸿蒙应用</li>
        </ul>
      `,
      site_name: 'OpenStore',
      tagline: '鸿蒙应用数据探索与分析平台'
    };
  }
};

onMounted(async () => {
  window.scrollTo(0, 0);
  window.addEventListener('scroll', handleScroll);
  layoutStore.setPageInfo('关于', false);
  // Initial check
  checkScrollPosition();
  await fetchData();
  await loadAboutCards();
});

// 后台保存「关于」内容 / 卡片配置后（WS → contentVersion +1）重新取数。
// 关于页在 keep-alive 白名单里：不在这一页时先记账、不请求，切回来再补这一次。
let syncedContentVersion = contentVersion.value;
const pageActive = usePageActive();

const reloadAboutContent = () => {
  syncedContentVersion = contentVersion.value;
  fetchData();
  loadAboutCards();
};

watch(contentVersion, () => {
  if (!pageActive.value) return;
  reloadAboutContent();
});

onActivated(() => {
  // 离开期间后台改过内容：补上那次被跳过的取数
  if (syncedContentVersion === contentVersion.value) return;
  reloadAboutContent();
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
  layoutStore.setHeaderState(false);
});
</script>

<style scoped>
.about-view {
  max-width: 960px;
  margin: 0 auto;
  /*
   * 两列网格：hero / 内容 / 提交整宽。
   * 卡片顺序仍然由后台配置的 order 决定，dense 让半宽卡片自动补上空位。
   */
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  grid-auto-flow: dense;
}

.about-view > .is-full,
.about-view > .about-hero-item {
  grid-column: 1 / -1;
}

.about-hero-item {
  margin: 0;
}

.about-card {
  border-radius: 14px;
  margin: 0;
}

.about-card :deep(.el-card__header) {
  padding: 14px 18px;
}

.about-card :deep(.el-card__body) {
  padding: 18px;
}

.content-card :deep(.el-card__body) {
  padding: 22px 24px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-header.is-toggle {
  cursor: pointer;
  user-select: none;
}

.card-title {
  display: inline-flex;
  align-items: center;
  /* 标题后面还跟着版本号标签 / 仓库名这类小挂件，靠 gap 拉开 */
  gap: 7px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.card-count {
  padding: 1px 8px;
  border-radius: 999px;
  background-color: var(--el-fill-color-light);
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.toggle-icon {
  color: var(--el-text-color-secondary);
}

.about-content {
  line-height: 1.7;
}

.about-content.ql-editor,
.about-content.markdown-body {
  padding: 0;
  overflow-y: visible;
  height: auto;
}

.empty-tip {
  margin: 0;
  padding: 16px 0;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.commits-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.commit-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.commit-item:last-child {
  border-bottom: none;
}

.commit-info {
  flex: 1;
  min-width: 0;
}

.commit-msg {
  margin-bottom: 4px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.commit-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.commit-user {
  display: flex;
  align-items: center;
  gap: 8px;
}

.commit-link {
  display: flex;
  align-items: center;
  font-size: 18px;
  color: var(--el-color-primary);
}

.commit-link:hover {
  color: var(--el-color-primary-light-3);
}

/* 鸣谢 */
.contributors-intro {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.contributors {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.contributor {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 6px 14px 6px 6px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 999px;
  background-color: var(--el-fill-color-lighter);
  text-decoration: none;
  transition: border-color 0.18s ease, background-color 0.18s ease, transform 0.18s ease;
}

.contributor:hover {
  border-color: color-mix(in srgb, var(--el-color-primary) 45%, transparent);
  background-color: var(--el-color-primary-light-9);
  transform: translateY(-1px);
}

.contributor-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex: 0 0 auto;
  border: 1px solid var(--el-border-color-lighter);
  background-color: var(--el-bg-color);
}

/* 头像挂了也要占住同样的位置，否则整行会抖 */
.contributor-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background-color: var(--el-color-primary-light-8);
  color: var(--el-color-primary);
  font-size: 14px;
  font-weight: 600;
}

.contributor-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-info {
  /* 页脚永远排在所有卡片之后 */
  order: 1000;
  grid-column: 1 / -1;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--el-border-color-light);
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 0.9rem;
}

.footer-info p {
  margin: 4px 0;
}

.rotate-90 {
  transform: rotate(90deg);
}

.toggle-icon {
  transition: transform 0.3s;
}

/* Dark Mode & Theme Adaptation */
.about-content {
  color: var(--el-text-color-primary);
}

/* Markdown Adaptation */
.markdown-body {
  background-color: transparent !important;
  color: var(--el-text-color-primary) !important;
}

:deep(.markdown-body) {
  /* Variable mapping for github-markdown-css */
  --color-canvas-default: transparent;
  --color-fg-default: var(--el-text-color-primary);
  --color-fg-muted: var(--el-text-color-secondary);
  --color-accent-fg: var(--el-color-primary);
  --color-canvas-subtle: var(--el-fill-color-light);
  --color-border-default: var(--el-border-color);
  --color-border-muted: var(--el-border-color-lighter);
  --color-neutral-muted: var(--el-fill-color-lighter);
}

:deep(.markdown-body a) {
  color: var(--el-color-primary) !important;
}

:deep(.markdown-body h1),
:deep(.markdown-body h2),
:deep(.markdown-body h3),
:deep(.markdown-body h4),
:deep(.markdown-body h5),
:deep(.markdown-body h6) {
  color: var(--el-text-color-primary) !important;
  border-bottom-color: var(--el-border-color-lighter) !important;
}

:deep(.markdown-body blockquote) {
  color: var(--el-text-color-secondary) !important;
  border-left-color: var(--el-border-color) !important;
}

:deep(.markdown-body table tr) {
  background-color: transparent !important;
  border-top-color: var(--el-border-color-lighter) !important;
}

:deep(.markdown-body table tr:nth-child(2n)) {
  background-color: var(--el-fill-color-lighter) !important;
}

:deep(.markdown-body code),
:deep(.markdown-body tt) {
  background-color: var(--el-fill-color-light) !important;
  border-radius: 4px;
}

:deep(.markdown-body pre) {
  background-color: var(--el-fill-color-light) !important;
}

/* Quill Editor Adaptation */
.ql-editor {
  color: var(--el-text-color-primary) !important;
  background-color: transparent;
}

:deep(.ql-editor p),
:deep(.ql-editor ol),
:deep(.ql-editor ul),
:deep(.ql-editor pre),
:deep(.ql-editor blockquote),
:deep(.ql-editor h1),
:deep(.ql-editor h2),
:deep(.ql-editor h3),
:deep(.ql-editor h4),
:deep(.ql-editor h5),
:deep(.ql-editor h6) {
  color: var(--el-text-color-primary) !important;
}

:deep(.ql-editor a) {
  color: var(--el-color-primary) !important;
}

:deep(.ql-editor blockquote) {
  border-left-color: var(--el-border-color) !important;
  color: var(--el-text-color-secondary) !important;
}

:deep(.ql-editor code),
:deep(.ql-editor pre) {
  background-color: var(--el-fill-color-light) !important;
  color: var(--el-text-color-primary) !important;
}

/* 窄屏：改单列，半宽卡片自然铺满 */
@media (max-width: 720px) {
  .about-view {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }

  .content-card :deep(.el-card__body) {
    padding: 18px 16px;
  }
}
</style>
