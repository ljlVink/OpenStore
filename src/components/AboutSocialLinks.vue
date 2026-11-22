<template>
  <div class="social-links">
    <a
      href="https://t.me/firmwarefetcher"
      target="_blank"
      rel="noopener noreferrer"
      class="social-chip"
      aria-label="Telegram"
    >
      <!-- Telegram 官方品牌图标（simple-icons，CC0） -->
      <svg class="about-social-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
        <path
          fill="currentColor"
          d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
        />
      </svg>
      <span>Telegram</span>
    </a>
  </div>
</template>

<style scoped>
.social-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/*
  无边框淡底胶囊：只靠一层浅填充区分，不再描边。
  比原来高一点（34px），图标也跟着放大，更好认、更好点。
*/
.social-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  /* 去掉描边：留一条透明边框占位，悬停时换色不会让高度抖动 */
  border: 1px solid transparent;
  background-color: var(--el-color-primary-light-9);
  font-size: 13px;
  color: var(--el-color-primary);
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease,
    transform 0.2s ease;
}

/* 图标略大于文字，视觉上和文字基线对齐 */
.about-social-svg {
  display: block;
  font-size: 17px;
  flex: 0 0 auto;
}

.social-chip:hover {
  background-color: var(--el-color-primary-light-8);
  box-shadow: 0 6px 16px -8px rgba(15, 23, 42, 0.5);
  transform: translateY(-2px);
}

/* 尊重系统的「减少动态效果」设置 */
@media (prefers-reduced-motion: reduce) {
  .social-chip {
    transition: none;
  }

  .social-chip:hover {
    transform: none;
  }
}

</style>
