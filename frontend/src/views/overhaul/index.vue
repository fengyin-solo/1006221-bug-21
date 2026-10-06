<template>
  <section class="page" data-module="overhaul">
    <header class="page-head">
      <div>
        <h2>机组检修管理</h2>
        <p class="page-desc">维护检修工作票，围绕工作票号、检修机组、检修级别、计划工期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记检修工作票</button>
        <button class="btn" type="button" @click="exportRows">导出机组检修清单</button>
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
    </p>

    <section v-if="todos.length" class="panel">
      <h3 class="panel-title">检修待办清单（与励磁提醒事项同源）</h3>
      <ul class="panel-list">
        <li v-for="item in todos" :key="item.id" class="panel-item">
          <span class="panel-badge" :class="{ done: item.状态 === '已完成' }">{{ item.状态 }}</span>
          <span class="panel-text">{{ item.结论 }}</span>
          <button class="link" type="button" @click="toggleTodo(item)">
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
          <td :colspan="columns.length + 2" class="empty-state">暂无机组检修数据，可先登记检修工作票</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条机组检修记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listReminders,
  moduleMeta,
  runAction as applyAction,
  setReminderDone,
} from '@/api/local-service'
import type { EntryRow, Reminder } from '@/data/types'

const meta = moduleMeta('overhaul')
const columns = ["工作票号", "检修机组", "检修级别", "计划工期", "实际工期", "工作负责人", "验收人员", "检修状态"]
const actions = ["提交审批", "开工检修", "办理完工"]
const statuses = ["待审批", "已批准", "检修中", "已完工"]
const stats = [{"label": "待审批工作票", "value": 0}, {"label": "检修中机组", "value": 0}, {"label": "已完工检修", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const todos = ref<Reminder[]>([])
const filterFields = columns.slice(0, 3)
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
  errorMessage.value = '检修工作票登记入口尚未接入审批流'
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

function toggleTodo(item: Reminder) {
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
    todos.value = listReminders()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '机组检修列表读取失败'
  }
}

onMounted(reload)
</script>
