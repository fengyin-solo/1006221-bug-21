import { migrateDataset } from './migration'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'
import { CURRENT_RULE_VERSION } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydropower-plant-om:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 读出原始库（可能是旧版 v1.0 数据，也可能缺模块）：只合并、不改写。
function readRaw(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    // 存量库损坏时不覆盖，交给回种子流程处理
    return fallback
  }
}

// 整批提交：先在内存里生成整套下一版数据，序列化成功后一次性写盘；
// 序列化或写盘任一步失败都恢复旧库，绝不留下写进去半条的状态。
function commitAll(next: Record<string, EntryRow[]>, previous: Record<string, EntryRow[]> | null): void {
  let serialized = ''
  try {
    serialized = JSON.stringify(next)
  } catch {
    cache = previous
    throw new Error('数据序列化失败，本次改动已整套回滚')
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = next
    return
  }
  const oldRaw = window.localStorage.getItem(STORAGE_KEY)
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized)
    cache = next
  } catch (error) {
    // 回滚：尽量恢复写盘前的内容；恢复动作本身再失败也不能盖掉原始报错
    try {
      if (oldRaw === null) {
        window.localStorage.removeItem(STORAGE_KEY)
      } else {
        window.localStorage.setItem(STORAGE_KEY, oldRaw)
      }
    } catch {
      // 存储已不可写，内存缓存仍按旧库回滚，后续写入会继续失败并回滚
    }
    cache = previous as Record<string, EntryRow[]>
    throw new Error(
      `数据落库失败，本次改动已整套回滚${error instanceof Error ? `：${error.message}` : ''}`,
    )
  }
}

let cache: Record<string, EntryRow[]> | null = null
let lastMigration: { migratedKeys: string[] } | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    const raw = readRaw()
    const stamped = Object.values(raw).some((rows) =>
      rows.some((row) => row.规则版本 === CURRENT_RULE_VERSION),
    )
    if (stamped) {
      cache = raw
      lastMigration = { migratedKeys: [] }
    } else {
      // 首次打开旧版库：按规则版本迁移，整批提交；失败则保留旧库并抛错给页面提示
      const result = migrateDataset(raw)
      commitAll(result.data, null)
      lastMigration = { migratedKeys: result.migratedKeys }
    }
  }
  // commitAll 成功时一定把 cache 置为新库；失败会直接抛出，走不到这里
  return cache as Record<string, EntryRow[]>
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const previous = allRows()
  const next = { ...previous, [key]: rows }
  commitAll(next, previous)
}

// 多模块联动写入（提醒与待办同源、结论回写等）走同一事务：任一模块失败整套回滚。
export function saveDataset(patch: Record<string, EntryRow[]>): void {
  const previous = allRows()
  const next = { ...previous, ...patch }
  commitAll(next, previous)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  // 回种子的新库同样走一遍迁移，保证重置后口径也是新版
  const migrated = migrateDataset({ [key]: rows }).data[key]
  saveRows(key, migrated)
  return migrated
}

export function migrationReport(): { migratedKeys: string[] } | null {
  return lastMigration
}

export function storageKey(): string {
  return STORAGE_KEY
}
