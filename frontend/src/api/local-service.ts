import {
  buildExcitationNotes,
  migrateExcitation,
  normalizeExcitationFlags,
  recalcConclusions,
  registerForcedExcitation,
  retireDevice,
} from '@/data/excitation'
import { DATA_VERSION, allRows, listRows, loadState, persistState, resetRows } from '@/data/local-store'
import { MODULE_BY_KEY } from '@/data/modules'
import { EXCITATION_STANDARD } from '@/data/standards'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  PersistedState,
  Reminder,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const EXCITATION_KEY = 'excitation'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function now(): string {
  const date = new Date()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${today()} ${hours}:${minutes}`
}

/**
 * 回填迁移：存量数据版本落后、或励磁标准已换版时，先回填重算再服务。
 * 迁移在草稿上整体计算，persistState 原子落库；落库失败抛错，内存缓存不动。
 */
function ensureMigrated(): void {
  const state = loadState()
  if (state.dataVersion >= DATA_VERSION && state.standardVersion === EXCITATION_STANDARD.version) {
    return
  }
  const draft = clone(state)
  migrateExcitation(draft, DATA_VERSION)
  persistState(draft)
}

/** 在草稿状态上改、再一次落库；任何一步失败都整体回滚，不写半条记录。 */
function transact(mutate: (draft: PersistedState) => ActionResult): ActionResult {
  try {
    ensureMigrated()
  } catch {
    return { ok: false, message: '历史数据回填落库失败，已保持原数据未动' }
  }
  const draft = clone(loadState())
  const result = mutate(draft)
  if (!result.ok) {
    return result
  }
  try {
    persistState(draft)
  } catch {
    return { ok: false, message: '落库失败，本次操作已整体回滚，未写入半条记录' }
  }
  return result
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
  ensureMigrated()
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function applyTransition(meta: ModuleMeta, draft: PersistedState, id: number, action: string): ActionResult {
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = draft.entries[meta.key] ?? []
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (String(row.status) === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  row.status = target
  row.pending = target !== lastStatus
  row.abnormal = NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
  if (meta.key === EXCITATION_KEY) {
    // 励磁的口径以状态为准：待检查才待办、异常才计台数、已退出都不算
    normalizeExcitationFlags(row)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  return transact((draft) => {
    if (key === EXCITATION_KEY && action === '退出运行') {
      return retireDevice(draft, id, today())
    }
    if (key === EXCITATION_KEY && action === '登记强励') {
      return registerForcedExcitation(draft, id, today(), now())
    }
    return applyTransition(meta, draft, id, action)
  })
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 导出与列表取同一份行数据（同一次 ensureMigrated 后的缓存），
// 页面显示什么，另存的清单就是什么，不会残留旧值。
export function exportEntries(key: string): { filename: string; content: string } {
  ensureMigrated()
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
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
  ensureMigrated()
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
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

/** 提醒事项 / 待办清单：励磁页与机组检修页取的是同一份。 */
export function listReminders(): Reminder[] {
  ensureMigrated()
  return loadState().reminders
}

export function setReminderDone(id: number, done: boolean): ActionResult {
  return transact((draft) => {
    const reminder = draft.reminders.find((item) => Number(item.id) === id)
    if (!reminder) {
      return { ok: false, message: `没有找到编号为 ${id} 的提醒事项` }
    }
    reminder.状态 = done ? '已完成' : '待办'
    if (done) {
      reminder.doneAt = now()
    } else {
      delete reminder.doneAt
    }
    return { ok: true, message: done ? '提醒事项已办结' : '提醒事项已重新打开' }
  })
}

/** 回填说明：缺字段记录与冲回留痕，各列一行。 */
export function excitationNotes(): string[] {
  ensureMigrated()
  return buildExcitationNotes(loadState())
}

export function excitationStandardVersion(): string {
  return EXCITATION_STANDARD.version
}

/** 按现行标准重算全部已有记录的结论，旧结论保留当时等级并注明版本。 */
export function recalcExcitation(): ActionResult {
  return transact((draft) => {
    recalcConclusions(draft)
    draft.standardVersion = EXCITATION_STANDARD.version
    return { ok: true, message: `已按${EXCITATION_STANDARD.version}标准重算全部励磁记录` }
  })
}
