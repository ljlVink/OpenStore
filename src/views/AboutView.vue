<template>
  <div class="about-view">
    <!-- 页面头部：站点身份 + 作者，始终做成第一屏的主视觉 -->
    <AboutHero
      class="about-hero-item"
      :style="cardStyle('hero')"
      :site-name="aboutData.site_name"
      :tagline="aboutData.tagline"
      :version="siteVersion"
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

    <!-- 联系我们：单独的卡片（以前贴在页面头部底部，后台可单独排序 / 隐藏） -->
    <el-card v-if="socialLinks.length" class="about-card is-full" :style="cardStyle('social')">
      <template #header>
        <div class="card-header">
          <span class="card-title">联系我们</span>
        </div>
      </template>
      <AboutSocialLinks
        :links="socialLinks"
        :author-name="aboutData.author_name"
        :author-github="aboutData.author_github"
        :repo-name="repoName"
        :repo-stars="repoStars"
      />
    </el-card>

    <el-card class="about-card is-half" :style="cardStyle('author')">
      <template #header>
        <div class="card-header">
          <span class="card-title">关于作者</span>
        </div>
      </template>
      <div class="info-list">
        <div class="info-row">
          <span class="label">开发者</span>
          <span class="value">{{ aboutData.author_name || 'ChuEng' }}</span>
        </div>
        <div class="info-row">
          <span class="label">GitHub</span>
          <a
            :href="aboutData.author_github || 'https://github.com/XiaoChuangll'"
            target="_blank"
            rel="noopener"
            class="value link"
          >
            {{ getGithubUsername(aboutData.author_github) || 'XiaoChuangll' }}
            <el-icon><Link /></el-icon>
          </a>
        </div>
        <div class="info-row">
          <span class="label">仓库</span>
          <a v-if="repoName" :href="`https://github.com/${repoName}`" target="_blank" rel="noopener" class="value link">
            {{ repoName }}
            <el-icon><Link /></el-icon>
          </a>
          <span v-else class="value is-muted">未配置</span>
        </div>
        <div class="info-row">
          <span class="label">星标</span>
          <a
            v-if="repoStars !== null && repoName"
            :href="`https://github.com/${repoName}/stargazers`"
            target="_blank"
            rel="noopener"
            class="value link star-link"
          >
            <el-icon class="text-yellow-500"><StarFilled /></el-icon> {{ repoStars }}
          </a>
          <span v-else class="value is-muted">—</span>
        </div>
      </div>
    </el-card>

    <el-card class="about-card is-half" :style="cardStyle('tech-stack')">
      <template #header>
        <div class="card-header">
          <span class="card-title">技术栈</span>
        </div>
      </template>
      <div v-if="techStack.length" class="tech-stack">
        <el-tag
          v-for="tech in techStack"
          :key="tech.name"
          :type="tech.color"
          effect="light"
          size="large"
          class="tech-tag"
        >
          {{ tech.name }}
        </el-tag>
      </div>
      <p v-else class="empty-tip">暂未配置技术栈</p>
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

    <el-card class="about-card is-full" :style="cardStyle('changelogs')">
      <template #header>
        <div class="card-header is-toggle" @click="toggleChangelogs">
          <span class="card-title">
            更新日志
            <el-tag size="small" effect="light" type="primary" round>{{ latestChangelogVersion }}</el-tag>
          </span>
          <el-icon class="toggle-icon" :class="{ 'rotate-90': changelogsExpanded }"><ArrowRight /></el-icon>
        </div>
      </template>
      <el-collapse-transition>
        <div v-show="changelogsExpanded">
          <div v-loading="changelogsLoading" class="changelogs-list">
            <div v-for="item in changelogs" :key="item.id" class="changelog-item">
              <div class="changelog-info">
                <div class="changelog-title">
                  <el-tag size="small" effect="light" type="primary">{{ item.version }}</el-tag>
                  <span class="changelog-date">{{ formatTime(item.release_date) }}</span>
                </div>
                <div class="changelog-content markdown-body" v-html="getChangelogHtml(item)"></div>
              </div>
            </div>
            <p v-if="changelogsFetched && changelogs.length === 0 && !changelogsLoading" class="empty-tip">
              暂无更新日志
            </p>
          </div>
        </div>
      </el-collapse-transition>
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
      <p>Version {{ siteVersion }}</p>
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
  StarFilled,
} from '@element-plus/icons-vue';
import { getAboutPage, getPublicChangelogs, type AboutPage, type Changelog } from '../services/api';
import axios from 'axios';
import { createMarkdownRenderer } from '../utils/markdown';
import '@vueup/vue-quill/dist/vue-quill.snow.css'; // Import Quill styles for content rendering
import 'github-markdown-css/github-markdown.css';
import { getPublicSiteCards } from '../services/admin';
import { contentVersion } from '../services/content-refresh';
import { usePageActive } from '../utils/page-active';
import AboutHero from '../components/AboutHero.vue';
import AboutSocialLinks from '../components/AboutSocialLinks.vue';
import { DEFAULT_TECH_STACK, githubAvatarUrl, githubProfileUrl, normalizeContributors, normalizeSocialLinks, normalizeTechStack, type Contributor, type SocialLinkItem, type TechStackItem } from '../utils/about';

/*
 * 关于页面的卡片顺序 / 显隐由后台「首页配置 → 关于」决定：
 * 卡片都留在模板原位，用 grid order + display 调整，避免大改结构。
 * hero 是后加的卡片，老库启动时会被种子数据补上，没补上时按模板顺序落在最前面。
 */
const ABOUT_CARD_FALLBACK = ['hero', 'content', 'social', 'author', 'tech-stack', 'contributors', 'changelogs', 'commits'];

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

/**
 * 卡片是否开着：关掉的卡片只是 display:none，取数得靠这个拦掉，
 * 否则后台关掉了照样发请求。配置没拿到时按「开」处理。
 */
const isCardEnabled = (key: string) => aboutCards.value[key]?.enabled !== false;

const layoutStore = useLayoutStore();
const aboutData = ref<AboutPage>({ id: 0, version: '', author_name: '', author_avatar: '', author_github: '', github_repo: '', content_html: '', content_markdown: '' });
const commits = ref<any[]>([]);
const commitsLoading = ref(false);
const commitsExpanded = ref(false);
const repoStars = ref<number | null>(null);
const changelogs = ref<Changelog[]>([]);
const changelogsLoading = ref(false);
const changelogsExpanded = ref(false);
const changelogsFetched = ref(false);

const md = createMarkdownRenderer({ allowHtml: false, katex: false, highlight: false });

/** 技术栈：后台没配置过就用默认值，保证首屏不空 */
const techStack = computed<TechStackItem[]>(() => {
  const list = normalizeTechStack(aboutData.value.tech_stack);
  return list.length ? list : DEFAULT_TECH_STACK;
});

/** 联系我们：后台清了就退回作者的 GitHub / 仓库地址，避免 Hero 底部整块消失 */
/** 后台配置了什么就显示什么（自动项由 AboutHero 按当前配置解析） */
const socialLinks = computed<SocialLinkItem[]>(() => normalizeSocialLinks(aboutData.value.social_links));

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

const formatTime = (time?: string) => {
  if (!time) return '';
  return new Date(time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
};

const getChangelogHtml = (item: Changelog) => {
  if (item.content_html) return item.content_html;
  if (item.content_markdown) return md.render(item.content_markdown);
  return '';
};

const getChangelogTimeMs = (item: Changelog) => {
  const raw = item?.release_date || item?.created_at || 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const latestChangelog = computed(() => {
  const list = Array.isArray(changelogs.value) ? changelogs.value.slice() : [];
  list.sort((a, b) => getChangelogTimeMs(b) - getChangelogTimeMs(a));
  return list[0] || null;
});

/*
 * 首屏版本徽标和页脚共用同一个来源：优先「关于」里配置的版本，
 * 没配置才退回最新一条更新日志（更新日志每条有自己的 vX.Y.Z，不是站点版本）。
 */
const siteVersion = computed(() => {
  return aboutData.value.version || latestChangelog.value?.version || '1.0.0';
});

/** 更新日志卡片标题上的标签：用日志自己的版本号，没配才退回站点版本 */
const latestChangelogVersion = computed(() => latestChangelog.value?.version || siteVersion.value);

const fetchChangelogs = async () => {
  changelogsLoading.value = true;
  try {
    changelogs.value = await getPublicChangelogs();
  } catch (error) {
    console.error('Failed to fetch changelogs', error);
  } finally {
    changelogsFetched.value = true;
    changelogsLoading.value = false;
  }
};

const toggleChangelogs = () => {
  changelogsExpanded.value = !changelogsExpanded.value;
  if (changelogsExpanded.value && !changelogsFetched.value) {
    fetchChangelogs();
  }
};

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

const getGithubUsername = (url?: string) => {
  if (!url) return '';
  const parts = url.split('/');
  return parts[parts.length - 1] || 'GitHub';
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

const fetchRepoStars = async (repoInput: string) => {
  if (!repoInput) return;
  const repo = getRepoName(repoInput);
  try {
    const response = await axios.get(`https://api.github.com/repos/${repo}`);
    repoStars.value = response.data.stargazers_count;
  } catch (error) {
    console.error('Failed to fetch repo stars', error);
  }
};

const fetchData = async () => {
  const data = await getAboutPage();
  if (data && Object.keys(data).length > 0) {
    aboutData.value = data;
    if (data.github_repo) {
      fetchRepoStars(data.github_repo);
    }
    // Don't auto fetch commits, wait for expand
  } else {
    // Default fallback if no data in DB yet
    aboutData.value = {
      id: 0,
      content_html: `
        <h2>OpenStore - 鸿蒙应用数据面板</h2>
        <p>这是一个基于现代 Web 技术栈构建的鸿蒙应用数据探索与分析平台。</p>
        <p><strong>技术栈：</strong></p>
        <ul>
          <li><strong>前端框架：</strong>Vue 3 (Composition API)</li>
          <li><strong>开发语言：</strong>TypeScript</li>
          <li><strong>构建工具：</strong>Vite</li>
          <li><strong>UI 组件库：</strong>Element Plus</li>
          <li><strong>状态管理：</strong>Pinia</li>
          <li><strong>数据可视化：</strong>Apache ECharts</li>
          <li><strong>图标系统：</strong>Font Awesome & Element Plus Icons</li>
        </ul>
        <p><strong>核心功能：</strong></p>
        <ul>
          <li><strong>应用看板：</strong>实时监控鸿蒙应用下载量与增长趋势</li>
          <li><strong>排行榜单：</strong>多维度应用下载榜单、增长对比榜</li>
          <li><strong>数据分析：</strong>应用详情深度解析与历史数据回溯</li>
          <li><strong>探索发现：</strong>发现最新上架与热门更新的鸿蒙应用</li>
          <li><strong>投稿中心：</strong>支持用户自主提交优质应用与专题内容</li>
        </ul>
      `,
      author_name: 'ChuEng',
      author_github: 'https://github.com/XiaoChuangll',
      site_name: 'OpenStore',
      tagline: '鸿蒙应用数据探索与分析平台',
      version: '1.0.0'
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
  // 先定卡片配置，再按「开着」的卡片取数：关闭的卡片不该发请求
  await loadAboutCards();
  if (isCardEnabled('changelogs')) fetchChangelogs();
});

/** 卡片从关变开时补一次请求（配置整体换对象但值没变时不重复请求） */
watch(
  () => isCardEnabled('changelogs'),
  (changelogsOn, wasChangelogsOn) => {
    if (changelogsOn && !wasChangelogsOn && !changelogsFetched.value) fetchChangelogs();
  }
);

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
   * 两列网格：hero / 内容 / 更新日志 / 提交整宽，作者与技术栈并排。
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

/* 作者信息 */
.info-list {
  display: flex;
  flex-direction: column;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}

.info-row:first-child {
  padding-top: 0;
}

.info-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.info-row .label {
  flex: 0 0 auto;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.info-row .value {
  min-width: 0;
  font-weight: 500;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-row .value.is-muted {
  font-weight: 400;
  color: var(--el-text-color-placeholder);
}

.info-row .link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--el-color-primary);
  text-decoration: none;
}

.info-row .link:hover {
  text-decoration: underline;
}

/* 技术栈 */
.tech-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tech-tag {
  border: none;
  font-weight: 500;
  /* 撑满整行：标签按内容比例分摊剩余宽度，右端不会留下参差空白 */
  flex-grow: 1;
  justify-content: center;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
  cursor: default;
}

.tech-tag:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px -8px rgba(15, 23, 42, 0.5);
}

/* 更新日志 / 提交 */
.changelogs-list,
.commits-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.changelog-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.changelog-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.changelog-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.changelog-date {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.changelog-content {
  margin-top: 8px;
  padding: 0;
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

.text-yellow-500 {
  color: #e6a23c;
}

.star-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  text-decoration: none;
  font-weight: 500;
  color: var(--el-text-color-primary);
  transition: opacity 0.2s;
}

.star-link:hover {
  opacity: 0.8;
  text-decoration: none;
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
