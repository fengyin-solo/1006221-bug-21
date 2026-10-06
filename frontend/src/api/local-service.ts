import { MODULES, MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  BackfillNote,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ReminderItem,
  TodoItem,
} from '@/data/types'
import { CURRENT_RULE_VERSION } from '@/data/types'

// 业务字段里承载当前状态镜像的那一列（装置状态 / 检修状态 / 运行状态…），最后一个「结论」不算。
export function statusFieldOf(meta: ModuleMeta): string {
  return meta.fields.find((field) => field.endsWith('状态')) ?? meta.fields[meta.fields.length - 1]
}

function pendingSetOf(meta: ModuleMeta): Set<string> {
  return new Set(meta.pendingStatuses ?? meta.statuses.slice(0, -1))
}

function abnormalSetOf(meta: ModuleMeta): Set<string> {
  return new Set(meta.abnormalStatuses ?? [])
}

function todayText(): string {
  return new Date().toISOString().slice(0, 10)
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// v2 通用流转：状态、状态镜像列、pending/异常口径、终态结论一次性写齐，
// 页面列表、导出、概览、待办/提醒取的都是同一份。
function applyStatus(row: EntryRow, meta: ModuleMeta, target: string): EntryRow {
  const updated: EntryRow = { ...row, status: target }
  updated.pending = pendingSetOf(meta).has(target)
  updated.abnormal = abnormalSetOf(meta).has(target)
  updated[statusFieldOf(meta)] = target
  const finalStatus = meta.statuses[meta.statuses.length - 1]
  if (target === finalStatus && meta.fields.includes('结论')) {
    const label = target === '已完工' ? '已完成' : target
    updated.结论 = `${label}（${CURRENT_RULE_VERSION}）`
  }
  updated.规则版本 = CURRENT_RULE_VERSION
  return updated
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)

  // 励磁专项：记录一次强励。已退出装置拒绝累加——退出后强励计数必须停住。
  if (key === 'excitation' && action === '记录强励') {
    if (current === '已退出') {
      return { ok: false, message: '装置已退出运行，强励次数停止累计' }
    }
    const counterField = meta.counterField as string
    const before = Number.parseInt(String(rows[index][counterField] ?? 0), 10)
    const count = (Number.isFinite(before) ? before : 0) + 1
    const day = todayText()
    const updated: EntryRow = {
      ...rows[index],
      [counterField]: count,
      强励流水: `${rows[index].强励流水 ? `${rows[index].强励流水};` : ''}${day}:${count}`,
      规则版本: CURRENT_RULE_VERSION,
    }
    const next = [...rows]
    next[index] = updated
    try {
      saveRows(key, next)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '落库失败，已整套回滚' }
    }
    return { ok: true, message: `${meta.entity}记录一次强励，累计 ${count} 次` }
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  // 同一台装置重复点退出只算一次：已经是目标终态直接拒绝，不会二次扣减台数。
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 已退出是励磁装置的终态，退出后不允许再改状态（强励与异常口径都已冻结）。
  if (key === 'excitation' && current === '已退出') {
    return { ok: false, message: '装置已退出运行，状态已冻结，不能再执行其他流转' }
  }

  const updated = applyStatus(rows[index], meta, target)
  if (key === 'excitation' && action === '退出运行') {
    updated.退出时间 = todayText()
  }

  const next = [...rows]
  next[index] = updated
  try {
    saveRows(key, next)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '落库失败，已整套回滚' }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 列表页的状态小结：页面状态图例与导出统计同源
export function statusSummary(key: string): { status: string; count: number }[] {
  const rows = listRows(key)
  return moduleMeta(key).statuses.map((status) => ({
    status,
    count: rows.filter((row) => String(row.status) === status).length,
  }))
}

// 列表页三张统计卡：异常台数按状态口径计算，已退出装置不计异常、不计待检查。
export function moduleStatCards(key: string): { label: string; value: number }[] {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  if (meta.statCards) {
    return meta.statCards.map((card) => ({
      label: card.label,
      value: rows.filter((row) => card.statuses.includes(String(row.status))).length,
    }))
  }
  const counts = meta.statuses.map(
    (status) => rows.filter((row) => String(row.status) === status).length,
  )
  return meta.metrics.slice(0, 3).map((label, i) => ({ label, value: counts[i] ?? 0 }))
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// 另存清单：编号 + 业务字段 + 当前状态 + 回填说明，末尾附与页面完全一致的统计口径。
// 页面显示成什么、导出里就是什么——同一个 listRows 数据源，不允许残留旧值。
export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const header = ['编号', ...meta.fields, '当前状态', '回填说明']
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) {
    const line = [
      row.id,
      ...meta.fields.map((field) => row[field] ?? ''),
      row.status,
      row.回填说明 ?? '',
    ]
    lines.push(line.map(csvCell).join(','))
  }

  lines.push('')
  lines.push(['统计口径', `规则版本 ${CURRENT_RULE_VERSION}`].map(csvCell).join(','))
  for (const item of statusSummary(key)) {
    lines.push([`${item.status}（台）`, item.count].map(csvCell).join(','))
  }
  const abnormal = rows.filter((row) => abnormalSetOf(meta).has(String(row.status))).length
  const pending = rows.filter((row) => pendingSetOf(meta).has(String(row.status))).length
  lines.push(['异常装置台数（不含已退出）', abnormal].map(csvCell).join(','))
  lines.push(['待办台数（不含已退出）', pending].map(csvCell).join(','))
  if (key === 'excitation') {
    const counterField = meta.counterField as string
    const total = rows.reduce((sum, row) => {
      const value = Number.parseInt(String(row[counterField] ?? 0), 10)
      return sum + (Number.isFinite(value) ? value : 0)
    }, 0)
    lines.push(['强励次数合计（退出装置已冻结）', total].map(csvCell).join(','))
  }
  for (const row of rows.filter((item) => item.回填说明)) {
    lines.push(['回填说明', row.id, row.回填说明].map(csvCell).join(','))
  }

  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = MODULES.map((meta) => {
    const entries = rows[meta.key] ?? []
    const abnormalSet = abnormalSetOf(meta)
    const pendingSet = pendingSetOf(meta)
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => pendingSet.has(String(row.status))).length,
      abnormal: entries.filter((row) => abnormalSet.has(String(row.status))).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// 待办清单：跨模块同源派生。机组检修的结论直接写回工作票本身，
// 所以页面、另存清单、待办三处取到的结论永远是同一份。
export function listTodos(): TodoItem[] {
  const rows = allRows()
  const todos: TodoItem[] = []
  for (const meta of MODULES) {
    const pendingSet = pendingSetOf(meta)
    for (const row of rows[meta.key] ?? []) {
      if (!pendingSet.has(String(row.status))) {
        continue
      }
      todos.push({
        moduleKey: meta.key,
        moduleName: meta.name,
        id: Number(row.id),
        title: String(row[meta.fields[0]] ?? `${meta.entity}${row.id}`),
        status: String(row.status),
        dueDate: meta.dateField ? String(row[meta.dateField] ?? '') : '',
        conclusion: typeof row.结论 === 'string' ? row.结论 : '',
      })
    }
  }
  return todos
}

// 提醒事项与待办清单共用同一份 rows：待办到期或有回填说明要催办的，都在这里。
// 任意动作落库后两边同时刷新，不存在一个变了另一个没变的情况。
export function listReminders(): ReminderItem[] {
  const rows = allRows()
  const today = todayText()
  const reminders: ReminderItem[] = []
  for (const meta of MODULES) {
    const pendingSet = pendingSetOf(meta)
    for (const row of rows[meta.key] ?? []) {
      if (typeof row.回填说明 === 'string' && row.回填说明) {
        reminders.push({
          moduleKey: meta.key,
          moduleName: meta.name,
          id: Number(row.id),
          message: row.回填说明,
          dueDate: '',
          source: 'backfill',
        })
      }
      if (!pendingSet.has(String(row.status))) {
        continue
      }
      const dueDate = meta.dateField ? String(row[meta.dateField] ?? '') : ''
      if (dueDate && dueDate <= today) {
        reminders.push({
          moduleKey: meta.key,
          moduleName: meta.name,
          id: Number(row.id),
          message: `${meta.name}「${row[meta.fields[0]] ?? row.id}」处于${row.status}，登记日期 ${dueDate}，请尽快处理`,
          dueDate,
          source: 'pending',
        })
      }
    }
  }
  return reminders
}

// 早期缺字段记录的统一说明行：页面另列、导出另列，都取这里。
export function listBackfillNotes(): BackfillNote[] {
  const rows = allRows()
  const notes: BackfillNote[] = []
  for (const meta of MODULES) {
    for (const row of rows[meta.key] ?? []) {
      if (typeof row.回填说明 === 'string' && row.回填说明) {
        notes.push({
          moduleKey: meta.key,
          moduleName: meta.name,
          id: Number(row.id),
          message: row.回填说明,
        })
      }
    }
  }
  return notes
}
