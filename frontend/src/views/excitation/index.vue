<template>
  <section class="page" data-module="excitation">
    <header class="page-head">
      <div>
        <h2>励磁系统管理</h2>
        <p class="page-desc">维护励磁装置，围绕装置编号、所属机组、励磁电压、励磁电流做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记励磁装置</button>
        <button class="btn" type="button" @click="recalc">按{{ standardVersion }}标准重算</button>
        <button class="btn" type="button" @click="exportRows">导出励磁系统清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">现行标准：{{ standardVersion }}</span>
    </p>

    <section v-if="reminders.length" class="panel">
      <h3 class="panel-title">提醒事项（与机组检修待办同源）</h3>
      <ul class="panel-list">
        <li v-for="item in reminders" :key="item.id" class="panel-item">
          <span class="panel-badge" :class="{ done: item.状态 === '已完成' }">{{ item.状态 }}</span>
          <span class="panel-text">{{ item.结论 }}</span>
          <button class="link" type="button" @click="toggleReminder(item)">
            {{ item.状态 === '已完成' ? '重新打开' : '标记完成' }}
          </button>
        </li>
      </ul>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无励磁系统数据，可先登记励磁装置</td>
        </tr>
      </tbody>
    </table>

    <section v-if="notes.length" class="panel">
      <h3 class="panel-title">回填说明</h3>
      <ul class="panel-list">
        <li v-for="note in notes" :key="note" class="panel-item">
          <span class="panel-text">{{ note }}</span>
        </li>
      </ul>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条励磁系统记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  excitationNotes,
  excitationStandardVersion,
  listEntries,
  listReminders,
  moduleMeta,
  recalcExcitation,
  runAction as applyAction,
  setReminderDone,
} from '@/api/local-service'
import type { EntryRow, Reminder } from '@/data/types'

const meta = moduleMeta('excitation')
const columns = ["装置编号", "所属机组", "励磁电压", "励磁电流", "可控硅温度", "强励次数", "检查日期", "装置状态", "结论"]
const actions = ["提交检查", "标记异常", "退出运行", "登记强励"]
const statuses = ["待检查", "正常", "异常", "已退出"]
const standardVersion = excitationStandardVersion()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const reminders = ref<Reminder[]>([])
const notes = ref<string[]>([])
const filterFields = columns.slice(0, 3)

// 统计口径与状态一致：已退出装置不占正常 / 异常 / 待检查任何一格
const stats = computed(() => [
  { label: '正常装置', value: rows.value.filter((row) => row.status === '正常').length },
  { label: '异常装置', value: rows.value.filter((row) => row.status === '异常').length },
  { label: '待检查装置', value: rows.value.filter((row) => row.status === '待检查').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '励磁装置登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function recalc() {
  errorMessage.value = ''
  const result = recalcExcitation()
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function toggleReminder(item: Reminder) {
  errorMessage.value = ''
  const result = setReminderDone(Number(item.id), item.状态 !== '已完成')
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    reminders.value = listReminders()
    notes.value = excitationNotes()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '励磁系统列表读取失败'
  }
}

onMounted(reload)
</script>
