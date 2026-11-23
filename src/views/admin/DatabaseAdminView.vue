<template>
  <div class="admin-view database-admin">
    <AdminPageHeader :embedded="embedded" title="数据管理" />

    <div class="stat-grid" v-loading="loadingOverview">
      <div class="stat-card">
        <div class="stat-label">PostgreSQL 数据库</div>
        <div class="stat-value">{{ overview?.postgres.name || '—' }}</div>
        <div class="stat-hint">PostgreSQL {{ overview?.postgres.version || '—' }} · Neon</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">数据库大小</div>
        <div class="stat-value">{{ formatBytes(overview?.postgres.sizeBytes) }}</div>
        <div class="stat-hint">PostgreSQL 报告的数据库磁盘占用</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">数据表</div>
        <div class="stat-value">{{ overview?.counts.tables ?? '—' }}</div>
        <div class="stat-hint">索引 {{ overview?.counts.indexes ?? '—' }} · 视图 {{ overview?.counts.views ?? '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">总行数</div>
        <div class="stat-value">{{ formatNumber(overview?.counts.totalRows) }}</div>
        <div class="stat-hint">public schema 中数据表的精确行数</div>
      </div>
    </div>

    <el-card class="mb-4" shadow="never">
      <div class="card-header">
        <h3>数据表</h3>
        <div class="toolbar">
          <el-input v-model="tableFilter" size="small" placeholder="筛选表名" clearable style="width: 180px" />
          <el-button size="small" :loading="loadingOverview" @click="loadOverview">刷新</el-button>
        </div>
      </div>
      <el-table :data="filteredTables" v-loading="loadingOverview" @row-click="openTable">
        <el-table-column prop="name" label="表名" min-width="160" show-overflow-tooltip />
        <el-table-column prop="rows" label="行数" min-width="100" align="right">
          <template #default="{ row }">{{ formatNumber(row.rows) }}</template>
        </el-table-column>
        <el-table-column prop="columns" label="列" min-width="70" align="right" />
        <el-table-column prop="indexes" label="索引" min-width="70" align="right" />
        <el-table-column label="操作" min-width="100" align="right">
          <template #default="{ row }">
            <el-button size="small" @click.stop="openTable(row)">浏览</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <div class="card-header">
        <h3>SQL 查询</h3>
        <span class="muted">数据库强制只读事务：单条 SELECT / WITH，5 秒超时，最多 500 行</span>
      </div>
      <el-input
        v-model="sql"
        type="textarea"
        :rows="4"
        spellcheck="false"
        placeholder="SELECT * FROM operation_logs ORDER BY id DESC LIMIT 20"
      />
      <div class="toolbar mt-2">
        <el-button type="primary" :loading="runningSql" @click="runQuery">执行</el-button>
        <el-button @click="sql = ''">清空</el-button>
        <span v-if="queryMeta" class="muted">
          {{ queryMeta.rowCount }} 行 · {{ queryMeta.durationMs }}ms<template v-if="queryMeta.truncated">（已截断）</template>
        </span>
      </div>
      <el-table v-if="queryColumns.length" :data="queryRows" class="mt-2" max-height="420">
        <el-table-column
          v-for="col in queryColumns"
          :key="col"
          :prop="col"
          :label="col"
          min-width="140"
        >
          <template #default="{ row }">
            <span class="cell-text" :title="hoverPreview(row[col])">{{ formatCell(row[col]) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 表数据浏览 -->
    <el-drawer v-model="showTable" :title="tableData?.table || '表数据'" :size="isMobile ? '100%' : '860px'" destroy-on-close>
      <div class="toolbar toolbar--wrap drawer-toolbar">
        <el-input
          v-model="tableQuery.q"
          size="small"
          placeholder="搜索（文本列）"
          clearable
          style="width: 220px"
          @keyup.enter="reloadTable(1)"
        />
        <el-button size="small" type="primary" @click="reloadTable(1)">搜索</el-button>
        <el-button size="small" :loading="loadingTable" @click="reloadTable(tableData?.page || 1)">刷新</el-button>
        <!-- 列多到放不下时给一句提示：滚动条收起来了，但很多人不知道还能左右滑 -->
        <span v-if="tableNeedsXScroll" class="scroll-hint muted">← 可左右滑动，共 {{ tableColCount }} 列</span>
      </div>
      <!-- 表的容器宽度要用 ResizeObserver 量出来：列宽按它摊，常见的 7~8 列表格就能一屏放下，不出横向滚动条 -->
      <div ref="tableAreaRef" class="table-area">
        <el-table
          :data="tableData?.rows || []"
          v-loading="loadingTable"
          size="small"
          max-height="62vh"
          @sort-change="onSortChange"
        >
        <el-table-column
          v-for="col in tableData?.columns || []"
          :key="col.name"
          :prop="col.name"
          :label="col.pk ? col.name + ' 🔑' : col.name"
          :min-width="columnMinWidth"
          sortable="custom"
        >
          <!-- 不用 show-overflow-tooltip：它会把整格内容原样弹出来，
               像 content_html 这种长文一悬停就糊满整屏。这里自己画省略号 + 短短一段预览 -->
          <template #default="{ row }">
            <span class="cell-text" :title="hoverPreview(row[col.name])">{{ formatCell(row[col.name]) }}</span>
          </template>
        </el-table-column>
        </el-table>
      </div>
      <div class="table-pager mt-3">
        <span class="muted">共 {{ formatNumber(tableData?.total || 0) }} 条</span>
        <el-select
          v-model="tableQuery.pageSize"
          size="small"
          class="pager-size"
          @change="onSizeChange(tableQuery.pageSize)"
        >
          <el-option v-for="size in pageSizeOptions" :key="size" :label="size + ' 条/页'" :value="size" />
        </el-select>
        <!-- 宽屏用完整分页；窄屏只留 首页 / 上一页 / 跳页 / 下一页 / 尾页，避免页码条被挤爆 -->
        <el-pagination
          v-if="!isMobile"
          small
          background
          layout="prev, pager, next"
          :total="tableData?.total || 0"
          :current-page="tableData?.page || 1"
          :page-size="tableData?.pageSize || 50"
          @current-change="reloadTable"
        />
        <div v-else class="pager-mobile">
          <el-button size="small" :disabled="(tableData?.page || 1) <= 1" @click="reloadTable(1)">首页</el-button>
          <el-pagination
            small
            layout="prev, jumper, next"
            :total="tableData?.total || 0"
            :current-page="tableData?.page || 1"
            :page-size="tableData?.pageSize || 50"
            @current-change="reloadTable"
          />
          <el-button size="small" :disabled="(tableData?.page || 1) >= totalPages" @click="reloadTable(totalPages)">尾页</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import AdminPageHeader from '../../components/admin/AdminPageHeader.vue';
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import {
  getDatabaseOverview,
  getDatabaseTable,
  runDatabaseQuery,
  type DatabaseOverview,
  type DatabaseTableData
} from '../../services/admin';

const props = defineProps<{ embedded?: boolean }>();
const embedded = props.embedded === true;

const isMobile = ref(window.innerWidth <= 768);
const onResize = () => { isMobile.value = window.innerWidth <= 768; };
window.addEventListener('resize', onResize);

const pageSizeOptions = [20, 50, 100, 200];

const overview = ref<DatabaseOverview | null>(null);
const loadingOverview = ref(false);
const tableFilter = ref('');

const filteredTables = computed(() => {
  const kw = tableFilter.value.trim().toLowerCase();
  const list = overview.value?.tables || [];
  return kw ? list.filter((t) => t.name.toLowerCase().includes(kw)) : list;
});

const formatNumber = (value?: number) =>
  typeof value === 'number' ? value.toLocaleString('zh-CN') : '—';

const formatBytes = (bytes?: number) => {
  if (typeof bytes !== 'number' || bytes < 0 || Number.isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

const describeError = (e: any, fallback: string) =>
  e?.response?.data?.error || fallback;

// 单元格：NULL 和对象单独处理，否则大字段（如 payload 里塞的 JSON）会糊成一团
const formatCell = (value: unknown) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/**
 * 悬停预览只给一小段。
 * content_html 这类字段动辄几千字，原样挂上去一悬停就盖满屏幕，
 * 截到 80 字足够看出"这格大概是啥"，要看全文去 SQL 台查。
 */
const HOVER_PREVIEW_LENGTH = 80;
const hoverPreview = (value: unknown) => {
  const text = formatCell(value).replace(/\s+/g, ' ').trim();
  return text.length > HOVER_PREVIEW_LENGTH ? `${text.slice(0, HOVER_PREVIEW_LENGTH)}…` : text;
};

const loadOverview = async () => {
  loadingOverview.value = true;
  try {
    overview.value = await getDatabaseOverview();
  } catch (e: any) {
    ElMessage.error(describeError(e, '读取数据库信息失败'));
  } finally {
    loadingOverview.value = false;
  }
};
onMounted(loadOverview);
onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  tableAreaObserver?.disconnect();
  tableAreaObserver = null;
});


/* ------------------------------ 表数据浏览 ------------------------------ */

const showTable = ref(false);
const tableData = ref<DatabaseTableData | null>(null);
const loadingTable = ref(false);
const totalPages = computed(() =>
  Math.max(1, Math.ceil((tableData.value?.total || 0) / (tableData.value?.pageSize || 50)))
);

/*
 * 列宽按抽屉里实际可用的宽度摊。
 * 之前每列写死 min-width 140px，7 列 = 980px，抽屉只有 ~690px —— 表格底部就多出一条
 * 横向滚动条，加上右侧纵向滚动条，一眼看过去"好几个滚动条"。
 * 现在按宽度平分（下限 96px），常见的 7~8 列表格正好铺满、不出现横向滚动；
 * 列特别多的表（十几列）才照旧横向滚动。
 */
const tableAreaRef = ref<HTMLElement | null>(null);
const tableAreaWidth = ref(0);
let tableAreaObserver: ResizeObserver | null = null;
const columnMinWidth = computed(() => {
  const colCount = tableData.value?.columns.length || 0;
  if (!colCount) return 140;
  const available = tableAreaWidth.value || (isMobile.value ? window.innerWidth : 860) - 48;
  return Math.max(96, Math.min(160, Math.floor(available / colCount) - 4));
});

const tableColCount = computed(() => tableData.value?.columns.length || 0);
/** 列宽下限铺不下时说明要横向滚动（滚动条藏起来了，用文案提示） */
const tableNeedsXScroll = computed(() => {
  const available = tableAreaWidth.value || 0;
  return available > 0 && tableColCount.value * columnMinWidth.value > available + 2;
});

const observeTableArea = () => {
  tableAreaObserver?.disconnect();
  tableAreaObserver = null;
  if (!tableAreaRef.value) return;
  tableAreaWidth.value = tableAreaRef.value.clientWidth;
  if (typeof ResizeObserver === 'undefined') return;
  tableAreaObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect?.width;
    if (width) tableAreaWidth.value = width;
  });
  tableAreaObserver.observe(tableAreaRef.value);
};

// 抽屉是 destroy-on-close，内容每次打开都重建，所以打开后再挂观察器
watch(showTable, async (open) => {
  if (!open) {
    tableAreaObserver?.disconnect();
    tableAreaObserver = null;
    return;
  }
  await nextTick();
  observeTableArea();
});
const tableQuery = ref<{ page: number; pageSize: number; orderBy: string; order: 'asc' | 'desc'; q: string }>({
  page: 1,
  pageSize: 50,
  orderBy: '',
  order: 'asc',
  q: ''
});

const openTable = (row: { name: string }) => {
  tableQuery.value = { page: 1, pageSize: 50, orderBy: '', order: 'asc', q: '' };
  showTable.value = true;
  void loadTable(row.name);
};

const loadTable = async (name: string, page = tableQuery.value.page) => {
  loadingTable.value = true;
  try {
    tableData.value = await getDatabaseTable(name, {
      page,
      pageSize: tableQuery.value.pageSize,
      orderBy: tableQuery.value.orderBy || undefined,
      order: tableQuery.value.order,
      q: tableQuery.value.q || undefined
    });
    tableQuery.value.page = page;
  } catch (e: any) {
    ElMessage.error(describeError(e, '读取表数据失败'));
  } finally {
    loadingTable.value = false;
  }
};

const reloadTable = (page: number) => {
  if (tableData.value) void loadTable(tableData.value.table, page);
};

const onSizeChange = (size: number) => {
  tableQuery.value.pageSize = size;
  reloadTable(1);
};

const onSortChange = ({ prop, order }: { prop: string; order: string | null }) => {
  tableQuery.value.orderBy = order ? prop : '';
  tableQuery.value.order = order === 'descending' ? 'desc' : 'asc';
  reloadTable(1);
};

/* -------------------------------- SQL 查询 -------------------------------- */

const sql = ref('SELECT * FROM operation_logs ORDER BY id DESC LIMIT 20');
const runningSql = ref(false);
const queryRows = ref<Array<Record<string, unknown>>>([]);
const queryColumns = ref<string[]>([]);
const queryMeta = ref<{ rowCount: number; durationMs: number; truncated: boolean } | null>(null);

const runQuery = async () => {
  if (!sql.value.trim()) return;
  runningSql.value = true;
  try {
    const result = await runDatabaseQuery(sql.value);
    queryRows.value = result.rows;
    queryColumns.value = result.columns;
    queryMeta.value = { rowCount: result.rowCount, durationMs: result.durationMs, truncated: result.truncated };
  } catch (e: any) {
    queryRows.value = [];
    queryColumns.value = [];
    queryMeta.value = null;
    ElMessage.error(describeError(e, '查询失败'));
  } finally {
    runningSql.value = false;
  }
};
</script>

<style scoped>
.mb-4 { margin-bottom: 20px; }
.mt-2 { margin-top: 12px; }
.mt-3 { margin-top: 16px; }
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.toolbar--wrap { flex-wrap: wrap; }
.card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.card-header h3 { margin: 0; font-size: 15px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }

.stat-grid {
  display: grid;
  /* 四个卡片一行放下（窄到放不下时自动折行，不会挤成一团） */
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.stat-card {
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background-color: var(--el-fill-color-lighter);
}
.stat-label { font-size: 12px; color: var(--el-text-color-secondary); }
.stat-value { margin: 6px 0 4px; font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.stat-hint { font-size: 11px; color: var(--el-text-color-placeholder); }

/*
 * 按钮加载时不许动。
 *
 * el-button 的 :loading 会把一个转圈图标 **插进文字前面**，按钮因此变宽 20px
 * （实测 166px → 186px），同一排后面的按钮全体右移、加载结束又弹回来 —— 就是
 * 「点一下整排都动一下」的原因。
 * 这里把那个图标改成脱离文档流的底部进度条：不占宽度、不挤文字，
 * 加载中的半透明遮罩（EP 自带的 .is-loading::before）继续保留，一眼能看出在跑。
 */
.database-admin :deep(.el-button.is-loading > .el-icon.is-loading) {
  position: absolute;
  top: auto;
  right: 0;
  bottom: 0;
  left: 0;
  width: auto;
  height: 2px;
  margin: 0;
  border-radius: 2px;
  background-color: currentcolor;
  opacity: 0.45;
  animation: db-btn-progress 1.1s ease-in-out infinite;
  transform-origin: left center;
}

/* 图标本体不画，只借它这个元素画进度条 */
.database-admin :deep(.el-button.is-loading > .el-icon.is-loading > svg) {
  display: none;
}

/* EP 会给「图标后面的文字」加 margin-left，图标一走位这个 margin 也得撤掉 */
.database-admin :deep(.el-button.is-loading > .el-icon.is-loading + span) {
  margin-left: 0;
}

@keyframes db-btn-progress {
  0% { transform: scaleX(0.08); }
  50% { transform: scaleX(1); }
  100% { transform: scaleX(0.08); }
}

/* 抽屉里的分页：宽屏一行放得下，窄屏用 首页/跳页/尾页 的紧凑版 */
.drawer-toolbar { margin-bottom: 14px; }
.scroll-hint { margin-left: auto; white-space: nowrap; }

.table-area { width: 100%; }

/* 单元格自己画省略号（替代 show-overflow-tooltip 的自动省略） */
.cell-text {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/*
 * 关掉手机浏览器的「自动放大字号」（Chrome 的 font boosting / Safari 的 text autosizing）。
 *
 * 这些表动辄十几列、总宽上千像素，远超手机屏幕宽度；
 * 手机浏览器看到"比屏幕宽的文字块"就会自己把字号放大，而且是**按块**算的，
 * 于是同一张表里有的格子大、有的正常 —— 电脑上完全看不出来（桌面浏览器不做这件事）。
 *
 * 注意：这不是数据里带的样式。单元格内容一律按纯文本渲染（用 {{ }} 转义、没有 v-html），
 * content_html 里的 <h1> 之类只是被当文字打出来（截图里能看到尖括号本身就是证据）。
 */
.database-admin :deep(.el-table) {
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
}

/*
 * 表格右上角那枚「可左右滑动 →」是外层后台给所有窄屏表格加的角标，
 * 和抽屉工具栏里那条提示重复了，这里只保留工具栏那一条。
 */
.database-admin :deep(.el-drawer .el-table)::after,
.database-admin :deep(.el-drawer .el-table.is-x-scrollable)::after {
  content: none;
}

/*
 * 抽屉里的表改用"悬浮滚动条"，不再常驻两条原生滚动条。
 *
 * 背景：窄屏时外层后台会给表格加常驻原生滚动条（6px），它要占 10px 布局宽度；
 * 而 Element Plus 是按整个容器宽度排列的 —— 排出来比可视区宽 10px，于是表底
 * 又冒出一条横向滚动条，加上右边那条纵向的，就是"好多滚动条"。
 * 这里把原生条隐藏（width:0），改用 EP 自带的悬浮条：不占宽度、鼠标移上去才出现，
 * 列宽也就能正好铺满；列特别多的表仍会横向滚动，窄屏另有"可左右滑动 →"角标提示。
 */
.database-admin :deep(.el-drawer .el-table .el-scrollbar__wrap) {
  scrollbar-width: none;
}

.database-admin :deep(.el-drawer .el-table .el-scrollbar__wrap)::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.table-pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.pager-size { width: 110px; }
.pager-mobile {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.pager-mobile :deep(.el-pagination__jump) {
  margin-left: 0;
}
</style>
