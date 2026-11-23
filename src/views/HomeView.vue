<template>
  <AppMarketPage class="home-view" title="探索">
    <section class="dashboard-container">
      <ActiveIncidents />
      <ExploreTopics class="home-section" />
    </section>
  </AppMarketPage>
</template>

<script setup lang="ts">
import AppMarketPage from '../components/AppMarketPage.vue';
import ActiveIncidents from '../components/ActiveIncidents.vue';
import ExploreTopics from '../components/ExploreTopics.vue';

defineOptions({ name: 'HomeView' });
</script>

<style scoped>
.home-view :deep(.home-section) {
  margin-bottom: 20px;
}

/* 统一探索页面所有卡片的圆角样式 (16px) */
.home-view :deep(.el-card),
.home-view :deep(.incident-card),
.home-view :deep(.chart-card) {
  border-radius: 16px !important;
  overflow: hidden;
  /* 调整阴影：垂直方向偏移，负扩散半径减少左右两侧阴影 */
  box-shadow: 0 8px 12px -4px rgba(0, 0, 0, 0.08) !important;
}
</style>
