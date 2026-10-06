<template>
  <section class="page" data-module="excitation">
    <header class="page-head">
      <div>
        <h2>励磁系统管理</h2>
        <p class="page-desc">维护励磁装置，围绕装置编号、所属机组、励磁电压、励磁电流做登记、筛选与状态流转。装置退出运行后强励计数立即冻结，退出装置不计异常、不计待检查。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记励磁装置</button>
        <button class="btn" type="button" @click="exportRows">另存励磁装置清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummaryRows" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

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
          <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
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

    <section v-if="notes.length" class="note-panel">
      <h3 class="note-title">历史回填说明（早期退出装置冲回、缺字段记录另列）</h3>
      <ul class="note-list">
        <li v-for="note in notes" :key="`${note.moduleKey}-${note.id}`">
          装置 {{ note.id }}：{{ note.message }}
        </li>
      </ul>
    </section>

    <details class="policy-panel">
      <summary>换版与回填口径（v2.0）</summary>
      <ul class="note-list">
        <li v-for="line in policyLines" :key="line">{{ line }}</li>
      </ul>
    </details>

    <footer class="page-foot">
      <span>共 {{ total }} 条励磁系统记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import {
  BACKFILL_POLICY,
} from '@/data/migration'
import {
  downloadEntries,
  listBackfillNotes,
  listEntries,
  moduleMeta,
  moduleStatCards,
  runAction as applyAction,
  statusSummary as statusSummaryOf,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('excitation')
const columns = meta.fields
const actions = meta.actions
const policyLines = BACKFILL_POLICY

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const stats = ref<{ label: string; value: number }[]>([])
const statusSummaryRows = ref<{ status: string; count: number }[]>([])
const notes = ref(listBackfillNotes().filter((note) => note.moduleKey === 'excitation'))
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

function displayCell(row: EntryRow, column: string): string {
  if (column === '结论') {
    return typeof row.结论 === 'string' && row.结论 ? row.结论 : '—'
  }
  const value = row[column]
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

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

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = moduleStatCards(meta.key)
    statusSummaryRows.value = statusSummaryOf(meta.key)
    notes.value = listBackfillNotes().filter((note) => note.moduleKey === 'excitation')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '励磁系统列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.note-panel,
.policy-panel {
  margin-top: 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}
.note-title {
  font-size: 14px;
  margin: 0 0 8px;
}
.note-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.policy-panel summary {
  font-size: 13px;
  cursor: pointer;
}
</style>
