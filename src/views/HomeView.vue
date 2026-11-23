<template>
  <main class="home-view">
    <section class="dashboard-container">
      <div class="home-toolbar">
        <div class="greeting-text">{{ greeting }}</div>
      </div>
      <ActiveIncidents />
      <ExploreTopics class="home-section" />
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

defineOptions({
  name: 'HomeView'
});

import ActiveIncidents from '../components/ActiveIncidents.vue';
import ExploreTopics from '../components/ExploreTopics.vue';

const greeting = ref('');

const updateGreeting = () => {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) {
    greeting.value = '尊敬的用户早上好~';
  } else if (hour >= 12 && hour < 14) {
    greeting.value = '尊敬的用户中午好~';
  } else if (hour >= 14 && hour < 18) {
    greeting.value = '尊敬的用户下午好~';
  } else {
    greeting.value = '尊敬的用户晚上好~';
  }
};

onMounted(updateGreeting);
</script>

<style scoped>
.home-view {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}
.home-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.greeting-text {
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

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

@media (max-width: 768px) {
  .home-view {
    padding: 14px;
  }
}
</style>
