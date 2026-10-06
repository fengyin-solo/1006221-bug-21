import { SEED_EXCITATION_RECORDS, SEED_ROWS } from './seed'
import type { EntryRow, PersistedState } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydropower-plant-om:entries'

// 数据结构版本：低于该版本的存量数据会在读取时触发一次回填迁移。
export const DATA_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function defaultState(): PersistedState {
  return {
    entries: clone(SEED_ROWS),
    excitationRecords: clone(SEED_EXCITATION_RECORDS),
    reminders: [],
    standardVersion: '',
    dataVersion: 1,
  }
}

function readStorage(): PersistedState {
  const fallback = defaultState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState> | Record<string, EntryRow[]>
    // 兼容旧结构：以前整个 value 就是 entries 映射，没有版本与励磁记录
    if (parsed && typeof parsed === 'object' && 'entries' in parsed) {
      const state = parsed as Partial<PersistedState>
      return {
        ...fallback,
        ...state,
        entries: { ...fallback.entries, ...(state.entries ?? {}) },
      }
    }
    return { ...fallback, entries: { ...fallback.entries, ...(parsed as Record<string, EntryRow[]>) } }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: PersistedState | null = null

export function loadState(): PersistedState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

/**
 * 原子落库：先写 localStorage，写成功才换内存缓存。
 * 写失败（如配额满）直接抛错，缓存保持原样——调用方拿到的还是旧状态，
 * 不会出现写进去半条记录的情况。
 */
export function persistState(next: PersistedState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  cache = next
}

export function allRows(): Record<string, EntryRow[]> {
  return loadState().entries
}

export function listRows(key: string): EntryRow[] {
  return loadState().entries[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const state = loadState()
  persistState({ ...state, entries: { ...state.entries, [key]: rows } })
}

export function resetRows(key: string): EntryRow[] {
  const state = loadState()
  const next: PersistedState = {
    ...state,
    entries: { ...state.entries, [key]: clone(SEED_ROWS[key] ?? []) },
  }
  if (key === 'excitation') {
    // 励磁重置要连记录一起回到示例，并强制重跑一次回填迁移
    next.excitationRecords = clone(SEED_EXCITATION_RECORDS)
    next.dataVersion = 1
  }
  persistState(next)
  return next.entries[key] ?? []
}

export function storageKey(): string {
  return STORAGE_KEY
}
