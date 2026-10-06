<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。待办清单、提醒事项、回填说明全部与各模块清单同源。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <div class="summary-grid">
      <section class="summary-panel">
        <h3 class="summary-title">待办清单（{{ todos.length }}）</h3>
        <table class="data-table">
          <thead>
            <tr><th>模块</th><th>对象</th><th>状态</th><th>结论</th></tr>
          </thead>
          <tbody>
            <tr v-for="todo in todos" :key="`${todo.moduleKey}-${todo.id}`">
              <td>{{ todo.moduleName }}</td>
              <td>{{ todo.title }}</td>
              <td>{{ todo.status }}</td>
              <td>{{ todo.conclusion || '—' }}</td>
            </tr>
            <tr v-if="!todos.length">
              <td colspan="4" class="empty-state">暂无待办</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="summary-panel">
        <h3 class="summary-title">提醒事项（{{ reminders.length }}）</h3>
        <table class="data-table">
          <thead>
            <tr><th>模块</th><th>对象</th><th>提醒内容</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in reminderRows" :key="`${item.moduleKey}-${item.id}-${item.source}`">
              <td>{{ item.moduleName }}</td>
              <td>{{ item.id }}</td>
              <td>{{ item.message }}</td>
            </tr>
            <tr v-if="!reminderRows.length">
              <td colspan="3" class="empty-state">暂无提醒</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <section class="summary-panel">
      <h3 class="summary-title">历史回填说明（早期缺字段记录另列一行，{{ notes.length }}）</h3>
      <table class="data-table">
        <thead>
          <tr><th>模块</th><th>编号</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="note in notes" :key="`${note.moduleKey}-${note.id}`">
            <td>{{ note.moduleName }}</td>
            <td>{{ note.id }}</td>
            <td>{{ note.message }}</td>
          </tr>
          <tr v-if="!notes.length">
            <td colspan="3" class="empty-state">无需要说明的早期记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据；规则版本 v2.0</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import {
  listBackfillNotes,
  listReminders,
  listTodos,
  loadOverview,
} from '@/api/local-service'
import type {
  BackfillNote,
  OverviewResult,
  ReminderItem,
  TodoItem,
} from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const todos = ref<TodoItem[]>([])
const reminders = ref<ReminderItem[]>([])
const reminderRows = ref<ReminderItem[]>([])
const notes = ref<BackfillNote[]>([])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  // 提醒事项与待办清单同源：任何动作落库后这里一起刷新，不存在只同步一半的情况
  todos.value = listTodos()
  reminders.value = listReminders()
  reminderRows.value = reminders.value
  notes.value = listBackfillNotes()
}

onMounted(refresh)
</script>

<style scoped>
.summary-grid {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}
.summary-panel {
  flex: 1;
  margin-top: 16px;
}
.summary-grid .summary-panel {
  margin-top: 0;
}
.summary-title {
  font-size: 14px;
  margin: 0 0 8px;
}
</style>
