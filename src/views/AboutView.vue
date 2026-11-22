<template>
  <div class="about-view">
    <AboutHero />

    <el-card class="about-card">
      <template #header>
        <span class="card-title">联系我们</span>
      </template>
      <AboutSocialLinks />
    </el-card>

    <div class="footer-info">
      <p>&copy; {{ new Date().getFullYear() }} BetaHub Tech. All rights reserved.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useLayoutStore } from '../stores/layout';
import AboutHero from '../components/AboutHero.vue';
import AboutSocialLinks from '../components/AboutSocialLinks.vue';

const layoutStore = useLayoutStore();

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

onMounted(() => {
  window.scrollTo(0, 0);
  window.addEventListener('scroll', handleScroll);
  layoutStore.setPageInfo('关于', false);
  // Initial check
  checkScrollPosition();
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
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
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

.card-title {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.footer-info {
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

@media (max-width: 720px) {
  .about-view {
    gap: 16px;
  }
}
</style>
