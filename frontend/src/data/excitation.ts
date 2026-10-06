import { EXCITATION_STANDARD, evaluateExcitation } from './standards'
import type { ActionResult, EntryRow, ExcitationRecord, PersistedState, Reminder } from './types'

// 励磁域的业务规则都收在这里，全部是纯函数：只在传入的草稿状态上改，
// 落库（以及失败回滚）由 local-service 统一负责。
//
// 两条回填路径的先后（冲突处理约定）：
//   路径一「按登记时间整体回填」：先把历史励磁记录按登记时间排定归档顺序，
//     缺装置编号 / 缺检查日期的记录不参与计数，另列一行说明；
//   路径二「按检查日期重放计数」：同一装置的记录再按检查日期重放，累计强励次数。
//   冲突时（补登：登记时间晚、检查日期早）归档顺序不动，计数按检查日期重算；
//   回填与换版重算同时触发时，先回填出次数，再按现行标准出结论，同一次原子落库。
//
// 强励冲回规则（早期退出装置多记次数的冲回）：
//   以退出日期为界，检查日期晚于退出日期的记录整笔记回，不计入强励次数；
//   冲回额 = 这些记录的本次强励之和，写入装置「强励冲回」留痕；
//   回填每次从记录整体重算（不是在上次结果上再减），天然幂等，
//   同一台装置重复退出、重复回填都不会多冲一次。

const RETIRED_STATUS = '已退出'

function excitationRows(state: PersistedState): EntryRow[] {
  return state.entries['excitation'] ?? []
}

function toCount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

function isRecordCountable(record: ExcitationRecord): boolean {
  return record.装置编号.trim() !== '' && record.检查日期.trim() !== ''
}

/** 口径归一：待检查才算待办，异常才算异常台数，已退出两者都不算。 */
export function normalizeExcitationFlags(row: EntryRow): void {
  row.pending = row.status === '待检查'
  row.abnormal = row.status === '异常'
}

function nextId(items: { id: number }[]): number {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
}

function findReminder(state: PersistedState, kind: string, 装置编号: string): Reminder | undefined {
  return state.reminders.find((item) => item.kind === kind && item.装置编号 === 装置编号)
}

function pushRetireReminder(state: PersistedState, row: EntryRow, today: string, extra: string): void {
  const 装置编号 = String(row['装置编号'] ?? '')
  if (findReminder(state, '励磁退出', 装置编号)) {
    return
  }
  const level = evaluateExcitation(toCount(row['强励次数']))
  state.reminders.push({
    id: nextId(state.reminders),
    kind: '励磁退出',
    装置编号,
    结论: `励磁装置 ${装置编号} 已退出运行，强励次数定格 ${toCount(row['强励次数'])} 次${extra}，按${EXCITATION_STANDARD.version}标准结论：${level}`,
    状态: '待办',
    createdAt: today,
  })
}

/** 按现行标准重算全部装置结论；旧结论保留当时等级并注明版本。 */
export function recalcConclusions(state: PersistedState): void {
  for (const row of excitationRows(state)) {
    const previous = String(row['结论'] ?? '')
    const previousVersion = String(row['结论版本'] ?? '')
    if (previous && previousVersion && previousVersion !== EXCITATION_STANDARD.version) {
      row['历史结论'] = `${previous}（${previousVersion}）`
    }
    row['结论'] = evaluateExcitation(toCount(row['强励次数']))
    row['结论版本'] = EXCITATION_STANDARD.version
  }
}

/**
 * 历史回填 + 口径修正 + 换版重算，一次完成：
 * 先按登记时间整体过一遍记录（路径一），再按检查日期重放计数（路径二），
 * 退出装置按退出日期冲回，最后按现行标准重算结论并补提醒。
 */
export function migrateExcitation(state: PersistedState, dataVersion: number): void {
  // 路径一：按登记时间排定归档顺序（稳定排序，登记时间相同保持原先后顺序）
  const archived = [...state.excitationRecords].sort((a, b) => a.登记时间.localeCompare(b.登记时间))

  // 路径二：按装置分组后按检查日期重放，登记时间仅作同日的先后依据
  const recordsByDevice = new Map<string, ExcitationRecord[]>()
  for (const record of archived) {
    if (!isRecordCountable(record)) {
      continue
    }
    const list = recordsByDevice.get(record.装置编号) ?? []
    list.push(record)
    recordsByDevice.set(record.装置编号, list)
  }
  for (const list of recordsByDevice.values()) {
    list.sort(
      (a, b) => a.检查日期.localeCompare(b.检查日期) || a.登记时间.localeCompare(b.登记时间),
    )
  }

  for (const row of excitationRows(state)) {
    const 装置编号 = String(row['装置编号'] ?? '')
    const records = recordsByDevice.get(装置编号) ?? []
    if (row.status === RETIRED_STATUS) {
      // 退出日期缺失时退化为最后已知检查日期，保证冲回边界有值
      const retiredAt = String(row['退出日期'] ?? '') || String(row['检查日期'] ?? '')
      let kept = 0
      let reversed = 0
      for (const record of records) {
        if (record.检查日期 <= retiredAt) {
          kept += toCount(record.本次强励)
          record.已冲回 = false
        } else {
          reversed += toCount(record.本次强励)
          record.已冲回 = true
        }
      }
      if (records.length > 0) {
        row['强励次数'] = kept
      }
      if (reversed > 0) {
        row['强励冲回'] = reversed
      } else {
        delete row['强励冲回']
      }
    } else if (records.length > 0) {
      row['强励次数'] = records.reduce((sum, record) => sum + toCount(record.本次强励), 0)
      delete row['强励冲回']
    } else {
      row['强励次数'] = toCount(row['强励次数'])
    }
    normalizeExcitationFlags(row)
  }

  recalcConclusions(state)

  // 已退出装置的结论写回机组检修待办（提醒与待办是同一份数据），重复回填不重复生成
  for (const row of excitationRows(state)) {
    if (row.status !== RETIRED_STATUS) {
      continue
    }
    const reversed = toCount(row['强励冲回'])
    pushRetireReminder(state, row, String(row['退出日期'] ?? ''), reversed > 0 ? `，退出后多记 ${reversed} 次已冲回` : '')
  }

  state.standardVersion = EXCITATION_STANDARD.version
  state.dataVersion = dataVersion
}

/** 退出运行：冻结计数、清出口径、写回待办。已退出的重复退出直接拒绝，不产生任何副作用。 */
export function retireDevice(state: PersistedState, id: number, today: string): ActionResult {
  const row = excitationRows(state).find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的励磁装置` }
  }
  if (row.status === RETIRED_STATUS) {
    return { ok: false, message: '该装置已是「已退出」，退出只算一次，不会重复扣减台数' }
  }
  row.status = RETIRED_STATUS
  row['装置状态'] = '退出'
  row['退出日期'] = today
  normalizeExcitationFlags(row)
  pushRetireReminder(state, row, today, '')
  return { ok: true, message: `励磁装置已退出运行，强励次数定格 ${toCount(row['强励次数'])} 次，不再累计` }
}

/** 登记强励：在运装置次数 +1 并留下励磁记录；已退出装置拒绝累计。 */
export function registerForcedExcitation(
  state: PersistedState,
  id: number,
  today: string,
  now: string,
): ActionResult {
  const row = excitationRows(state).find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的励磁装置` }
  }
  if (row.status === RETIRED_STATUS) {
    return { ok: false, message: '装置已退出运行，不再累计强励次数' }
  }
  row['强励次数'] = toCount(row['强励次数']) + 1
  row['检查日期'] = today
  state.excitationRecords.push({
    id: nextId(state.excitationRecords),
    装置编号: String(row['装置编号'] ?? ''),
    检查日期: today,
    本次强励: 1,
    登记时间: now,
  })
  row['结论'] = evaluateExcitation(toCount(row['强励次数']))
  row['结论版本'] = EXCITATION_STANDARD.version
  return { ok: true, message: `已登记强励 1 次，累计 ${row['强励次数']} 次` }
}

/** 回填说明：缺字段记录与冲回留痕，各列一行，页面直接展示。 */
export function buildExcitationNotes(state: PersistedState): string[] {
  const notes: string[] = []
  const knownDevices = new Set(excitationRows(state).map((row) => String(row['装置编号'] ?? '')))
  const archived = [...state.excitationRecords].sort((a, b) => a.登记时间.localeCompare(b.登记时间))
  for (const record of archived) {
    if (!isRecordCountable(record)) {
      const missing = [record.装置编号.trim() === '' ? '装置编号' : '', record.检查日期.trim() === '' ? '检查日期' : '']
        .filter(Boolean)
        .join('、')
      notes.push(
        `励磁记录#${record.id}（装置 ${record.装置编号 || '未知'}）缺${missing}，未计入强励次数，按登记时间 ${record.登记时间} 归档`,
      )
    } else if (!knownDevices.has(record.装置编号)) {
      notes.push(`励磁记录#${record.id}的装置 ${record.装置编号} 未登记，未计入强励次数`)
    }
  }
  for (const row of excitationRows(state)) {
    const reversed = toCount(row['强励冲回'])
    if (reversed > 0) {
      const current = toCount(row['强励次数'])
      notes.push(
        `${String(row['装置编号'])}：退出后多记 ${reversed} 次强励已冲回，强励次数 ${current + reversed}→${current}`,
      )
    }
  }
  return notes
}
