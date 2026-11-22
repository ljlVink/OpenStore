<template>
  <section class="about-hero" :style="gridVars">
    <!-- 背景纹理：GitHub 贡献图式的圆角格子，缓慢向左滚动 -->
    <div ref="gridRef" class="hero-grid" aria-hidden="true">
      <div class="hero-grid-scroll">
        <svg
          class="hero-grid-accent"
          :viewBox="`0 0 ${totalCols} ${gridRows}`"
          preserveAspectRatio="none"
        >
          <!--
            底纹和绿格必须落在同一套坐标里。
            以前底纹是「CSS mask 平铺 public/hero-grid.svg」，绿格是「另一个 SVG 按 viewBox 拉伸」——
            两条路径各自做子像素取整，在 DPR 不是 1 的设备上格子原点会对不上，
            绿块就跑到格子外面去了。现在底纹改成同一个 SVG 里的 <pattern>，
            单位就是 viewBox 的格，和绿格共享同一个变换，任何设备都对得齐。
          -->
          <defs>
            <pattern id="hero-grid-cell" width="1" height="1" patternUnits="userSpaceOnUse">
              <rect
                class="hero-grid-base-cell"
                :x="GREEN_CELL_INSET"
                :y="GREEN_CELL_INSET"
                :width="GREEN_CELL_SIZE"
                :height="GREEN_CELL_SIZE"
                :rx="GREEN_CELL_RX"
              />
            </pattern>
          </defs>
          <rect
            class="hero-grid-base"
            x="0"
            y="0"
            :width="totalCols"
            :height="gridRows"
            fill="url(#hero-grid-cell)"
          />
          <g class="hero-grid-cells">
            <rect
              v-for="cell in greenCells"
              :key="cell.key"
              :x="cell.x + GREEN_CELL_INSET"
              :y="cell.y + GREEN_CELL_INSET"
              :width="GREEN_CELL_SIZE"
              :height="GREEN_CELL_SIZE"
              :rx="GREEN_CELL_RX"
              :fill-opacity="cell.opacity"
            />
          </g>
        </svg>
      </div>
    </div>

    <div class="hero-body">
      <!--
        产品 logo：直接用站点图标 public/favicon.svg（深色 tile + 网格 + 圆环 + 蓝线 + 站名）。
        它自带 8.3% 的透明留白（视口 240、底板 20→220），所以元素尺寸要按 240/200 放大，
        底板的实际视觉边长才等于 76px。
      -->
      <img src="/favicon.svg" alt="" class="hero-logo" />

      <div class="hero-main">
        <h1 class="hero-title">OpenStore</h1>
        <p class="hero-tagline">鸿蒙应用数据探索与分析平台</p>
      </div>
    </div>

  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { GREEN_PERIOD_COLS, greenCellOpacity } from '../utils/hero-grid';

/** 期望的格子步长（实际会按卡片尺寸微调，保证行列都是整数） */
const GRID_TARGET_CELL = 14;
/** 底纹向左滚动的速度（px/秒），实际时长按滚动一个周期的距离换算 */
const GRID_DRIFT_SPEED = 5;
/** 格子内部的留白与圆角（单位是「格」） */
const GREEN_CELL_INSET = 2.5 / 14;
const GREEN_CELL_SIZE = 9 / 14;
const GREEN_CELL_RX = 2 / 14;

const gridRef = ref<HTMLElement | null>(null);
const gridSize = ref({ width: 0, height: 0 });
let resizeObserver: ResizeObserver | null = null;

/*
 * 格子自适应卡片：按卡片尺寸取整数行列，格子尺寸 = 卡片尺寸 / 行列数，
 * 于是纹理总是整列整行铺满，不会在边缘切出半格。
 * 量的是纹理层自身（内边距盒），不是卡片外框 —— 用外框量会多算 1px 边框，
 * 最后一列/行被多切一点，上下（左右）缝隙就不一样宽了。
 */
const measureGrid = () => {
  const el = gridRef.value;
  if (!el) return;
  const { width, height } = el.getBoundingClientRect();
  if (width <= 0 || height <= 0) return;
  if (width === gridSize.value.width && height === gridSize.value.height) return;
  gridSize.value = { width, height };
};

const gridCols = computed(() => Math.max(1, Math.round(gridSize.value.width / GRID_TARGET_CELL)));
const gridRows = computed(() => Math.max(1, Math.round(gridSize.value.height / GRID_TARGET_CELL)));
// 多铺一个 128 列的周期，让滚动首尾无缝衔接。
const totalCols = computed(() => gridCols.value + GREEN_PERIOD_COLS);
const drift = computed(() => (gridSize.value.width / gridCols.value) * GREEN_PERIOD_COLS);

const gridVars = computed<Record<string, string>>(() => ({
  '--grid-drift': `${drift.value}px`,
  // 按同一速度换算时长，卡片大小变化时观感一致
  '--grid-drift-duration': `${Math.max(1, Math.round(drift.value / GRID_DRIFT_SPEED))}s`
}));

// SVG 的 viewBox 也以格为单位，绿格正好落在底纹的格点上。
const greenCells = computed<{ key: string; x: number; y: number; opacity: number }[]>(() => {
  const cells: { key: string; x: number; y: number; opacity: number }[] = [];
  for (let row = 0; row < gridRows.value; row += 1) {
    for (let col = 0; col < totalCols.value; col += 1) {
      const opacity = greenCellOpacity(col, row);
      if (opacity > 0) cells.push({ key: `${col}-${row}`, x: col, y: row, opacity });
    }
  }
  return cells;
});

onMounted(() => {
  measureGrid();
  if (typeof ResizeObserver === 'undefined' || !gridRef.value) return;
  resizeObserver = new ResizeObserver(measureGrid);
  resizeObserver.observe(gridRef.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
.about-hero {
  position: relative;
  overflow: hidden;
  /* 不描边：默认那圈浅色边在深色下会显得像一条"白边" */
  border: 1px solid transparent;
  border-radius: 18px;
  padding: 26px 24px 22px;
  /*
   * 右上角只有一层很淡的主色洗色，不加单独的光斑。
   * 椭圆半径按参考图量的：横向到卡片 35% 处基本消失，纵向到卡片底部仍保留约一半，
   * 这样上下不会出现"上面偏蓝、下面偏绿"的割裂感。
   */
  background:
    radial-gradient(65% 330% at 100% 0%, color-mix(in srgb, var(--el-color-primary) 8%, transparent) 0%, transparent 60%),
    linear-gradient(180deg, var(--el-bg-color-overlay) 0%, var(--el-fill-color-lighter) 100%);
  box-shadow: var(--el-box-shadow-lighter);
}

/*
 * 背景纹理：GitHub 贡献图那种圆角格子，只铺在卡片右半边，并向左渐隐。
 *
 * 为什么用 CSS mask 而不是直接铺图片：mask 只取 alpha，颜色来自 background-color，
 * 所以底纹能跟着主题走（亮色是深格子、深色自动变浅格子），不必做两套图。
 *
 * 每个伪元素挂两层 mask 取交集（mask-composite: intersect）：
 *   第一层是格子纹理，第二层是一道从左到右的渐变 —— 交集就把纹理裁进了右侧、
 *   并且自带淡出过渡，不会糊到左边的 logo 与文字上。
 * 不支持 mask-composite 的浏览器会退化成「两层相加」= 纹理铺满整张卡，
 * 也就是退回到加渐隐之前的样子，不会崩。
 */
.hero-grid {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  /* 渐隐位置：40% 之前完全没有，到 78% 才铺满 */
  --hero-grid-fade: linear-gradient(
    to right,
    transparent 0%,
    transparent 40%,
    #000 78%,
    #000 100%
  );
  /* 渐隐放在外层：滚动的是它里面的纹理，淡出位置固定不动 */
  -webkit-mask-image: var(--hero-grid-fade);
  mask-image: var(--hero-grid-fade);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
}

/* 滚动层：比容器多出一个周期，向左平移一个周期后无缝衔接 */
.hero-grid-scroll {
  position: absolute;
  inset: 0;
  /* 多出一个周期的宽度，滚动到尽头时右侧仍有内容 */
  right: calc(-1 * var(--grid-drift, 1022px));
  animation: hero-grid-drift var(--grid-drift-duration, 200s) linear infinite;
  will-change: transform;
}

/* 底纹 + 绿格都在这一个 SVG 里（见模板），共享同一套 viewBox 坐标 */
.hero-grid-accent {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* 均匀底纹：pattern 里的一格，颜色/透明度保持原来的观感 */
.hero-grid-base {
  opacity: 0.06;
}

.hero-grid-base-cell {
  fill: var(--el-text-color-primary);
}

/* 绿色贡献格：由 greenCells 按坐标哈希生成，深浅由每格 fill-opacity 决定 */
.hero-grid-cells {
  fill: #39d353;
  opacity: 0.28;
}

/* 向左滚动一个周期（128 列），图案按周期重复，所以衔接处无缝 */
@keyframes hero-grid-drift {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(calc(-1 * var(--grid-drift, 1022px)));
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-grid-scroll {
    animation: none;
  }
}

.hero-body {
  position: relative;
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
}

/* 产品 logo：直接用 favicon.svg，尺寸按 240/200 放大以抵消自带的透明留白 */
.hero-logo {
  flex: 0 0 auto;
  width: 91px;
  height: 91px;
  /* 阴影走 drop-shadow 而不是 box-shadow：后者会按元素方框投影，
     把 SVG 那圈透明留白也投成一块方影 */
  filter: drop-shadow(0 1px 3px rgba(15, 23, 42, 0.18));
}

.hero-main {
  flex: 1 1 auto;
  min-width: 0;
}

.hero-title {
  margin: 0;
  font-size: 26px;
  line-height: 1.25;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--el-text-color-primary);
}

.hero-tagline {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

@media (max-width: 640px) {
  .about-hero {
    padding: 20px 16px;
    border-radius: 14px;
  }

  .hero-body {
    align-items: flex-start;
    gap: 14px;
  }

  .hero-logo {
    width: 70px;
    height: 70px;
  }

  .hero-title {
    font-size: 21px;
  }

}
</style>
