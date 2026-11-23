<template>
  <div class="dashboard-overview">
    <el-card shadow="hover" class="quick-actions-card">
      <template #header>
        <div class="card-header">
          <span>快捷操作</span>
        </div>
      </template>
      <div class="actions-grid">
        <el-button type="danger" plain @click="$emit('switch-tab', 'incidents')">
          <el-icon><Warning /></el-icon> 故障维护
        </el-button>
        <el-button type="danger" plain @click="showScriptGuardPreview = true">
          <el-icon><Lock /></el-icon> 脚本拦截
        </el-button>
        <el-button plain @click="showPasswordDialog = true">
          <el-icon><Key /></el-icon> 修改管理员密码
        </el-button>
      </div>
    </el-card>

    <!-- 脚本护栏面板：拦截记录 / 自定义警告页 / 一键触发真实拦截 -->
    <ScriptGuardPreviewDialog v-model="showScriptGuardPreview" />

    <el-dialog v-model="showPasswordDialog" title="修改管理员密码" width="min(480px, 90vw)" @closed="clearPasswords">
      <el-form label-position="top" @submit.prevent="submitPasswordChange">
        <el-form-item label="旧密码">
          <el-input v-model="oldPassword" type="password" autocomplete="current-password" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="newPassword" type="password" autocomplete="new-password" show-password />
        </el-form-item>
        <el-alert type="info" title="需包含大小写字母、数字与特殊字符，长度≥8" show-icon :closable="false" />
      </el-form>
      <template #footer>
        <el-button @click="showPasswordDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingPassword" @click="submitPasswordChange">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Warning, Key, Lock } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import ScriptGuardPreviewDialog from '../../components/ScriptGuardPreviewDialog.vue';
import { changeAdminPassword } from '../../services/admin';
import { validatePasswordComplexity } from '../../utils/password';

defineProps<{ embedded?: boolean }>();
defineEmits(['switch-tab']);

const showScriptGuardPreview = ref(false);
const showPasswordDialog = ref(false);
const oldPassword = ref('');
const newPassword = ref('');
const savingPassword = ref(false);

const clearPasswords = () => {
  oldPassword.value = '';
  newPassword.value = '';
};

const submitPasswordChange = async () => {
  if (savingPassword.value) return;
  if (!oldPassword.value || !newPassword.value) {
    ElMessage.error('请输入旧密码与新密码');
    return;
  }
  if (!validatePasswordComplexity(newPassword.value)) {
    ElMessage.error('新密码需包含大小写字母、数字、特殊字符且不少于8位');
    return;
  }

  savingPassword.value = true;
  try {
    await changeAdminPassword({ old_password: oldPassword.value, new_password: newPassword.value });
    showPasswordDialog.value = false;
    ElMessage.success('管理员密码修改成功');
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error || '修改失败');
  } finally {
    savingPassword.value = false;
  }
};
</script>

<style scoped>
.dashboard-overview {
  /* 顶部不留白：数据总览没有面板标题行，首卡要与侧边栏顶对齐 */
  padding: 0 10px 10px;
}

.quick-actions-card {
  /* 供下面的容器查询使用：按卡片实际宽度决定快捷操作的列数 */
  container-type: inline-size;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: bold;
}

.actions-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 15px;
}

/* 卡片偏窄时固定 2 列，避免按钮挤成小方块；第 3 个按钮独占一行，别落单 */
@container (max-width: 700px) {
  .actions-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .actions-grid .el-button:last-child {
    grid-column: 1 / -1;
  }
}

.actions-grid .el-button {
  width: 100%;
  height: 50px;
  justify-content: flex-start;
  padding-left: 20px;
  font-size: 15px;
}

/* Element Plus 默认给相邻按钮加 margin-left，在 grid 里会把列撑偏、导致换行后不对齐 */
.actions-grid .el-button + .el-button {
  margin-left: 0;
}

.actions-grid .el-icon {
  margin-right: 8px;
  font-size: 18px;
}
</style>
