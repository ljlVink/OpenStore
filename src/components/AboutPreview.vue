<template>
  <!--
    关于页面的简化预览：复用前台的 AboutHero，按同样的视觉顺序铺内容。
    只做展示，不接依赖接口的最近提交交互。
  -->
  <div class="about-preview">
    <AboutHero
      :site-name="siteName"
      :tagline="tagline"
      :grid-text="gridText"
    />

    <div v-if="contentHtml" class="preview-card">
      <div class="preview-content markdown-body" v-html="contentHtml"></div>
    </div>

    <!-- 联系我们：和前台一样单独一张卡片 -->
    <div class="preview-card">
      <div class="preview-card-title">联系我们</div>
      <AboutSocialLinks />
    </div>

    <div v-if="contributors.length" class="preview-card">
      <div class="preview-card-title">鸣谢</div>
      <div class="preview-contributors">
        <span v-for="person in contributors" :key="person.github" class="preview-contributor">
          <el-image :src="githubAvatarUrl(person.github, 96)" fit="cover" class="preview-contributor-avatar">
            <template #error>
              <span class="preview-contributor-fallback">{{ (person.name || person.github).slice(0, 1).toUpperCase() }}</span>
            </template>
          </el-image>
          <span class="preview-contributor-name">{{ person.name || person.github }}</span>
        </span>
      </div>
    </div>

    <p v-if="!contentHtml && !contributors.length" class="preview-empty">
      填写左侧表单后，这里会同步显示页面效果
    </p>
  </div>
</template>

<script setup lang="ts">
import AboutHero from './AboutHero.vue';
import AboutSocialLinks from './AboutSocialLinks.vue';
import { githubAvatarUrl, type Contributor } from '../utils/about';

withDefaults(
  defineProps<{
    siteName?: string;
    tagline?: string;
    /** Hero 背景绿格要拼的文字（和前台同一份配置） */
    gridText?: string | null;
    contributors?: Contributor[];
    contentHtml?: string;
  }>(),
  { contributors: () => [] }
);
</script>

<style scoped>
.about-preview {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  border-radius: 14px;
  background-color: var(--el-bg-color-page);
  overflow: hidden;
}

.preview-card {
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background-color: var(--el-bg-color-overlay);
}

.preview-card-title {
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.preview-content {
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
}

/* 预览整体比正式页面小一号，避免在窄预览栏里显得拥挤 */
.preview-content :deep(h1) { font-size: 22px; }
.preview-content :deep(h2) { font-size: 18px; }
.preview-content :deep(h3) { font-size: 16px; }
.preview-content :deep(p) { margin: 0 0 10px; }
.preview-content :deep(ul),
.preview-content :deep(ol) { padding-left: 20px; margin: 0 0 10px; }
.preview-content :deep(img) { max-width: 100%; height: auto; border-radius: 8px; }
.preview-content :deep(a) { color: var(--el-color-primary); }

.preview-contributors {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preview-contributor {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 12px 4px 4px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 999px;
  background-color: var(--el-fill-color-lighter);
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.preview-contributor-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.preview-contributor-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background-color: var(--el-fill-color);
  font-size: 12px;
  font-weight: 600;
}

.preview-contributor-name {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-empty {
  margin: 0;
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

:deep(.markdown-body) {
  background-color: transparent !important;
  --color-canvas-default: transparent;
  --color-fg-default: var(--el-text-color-primary);
  --color-fg-muted: var(--el-text-color-secondary);
  --color-accent-fg: var(--el-color-primary);
  --color-border-default: var(--el-border-color);
  --color-border-muted: var(--el-border-color-lighter);
}
</style>
