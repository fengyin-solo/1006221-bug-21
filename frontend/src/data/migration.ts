import { MODULES } from './modules'
import type { EntryRow } from './types'
import { CURRENT_RULE_VERSION, LEGACY_RULE_VERSION } from './types'

// 换版与历史回填规则（页面与导出共用同一份说明）：
// 路径一（整体回填）：历史数据按「登记时间」整体回填，登记时间取自各模块的登记/检查日期字段；
//   早期缺该字段的记录不臆造，另列一行回填说明，并进提醒清单催人工补录。
// 路径二（专项回填）：励磁模块按「检查日期」重放强励流水，退出装置退出后多记的强励次数按退出日冲回。
// 先后顺序：先走路径一补齐登记时间，再走路径二修正专项指标。
// 冲突处理：两条路径对同一字段有分歧时，专项规则（路径二）优先；登记时间与检查日期语义不同，两者都保留，
//   业务判定以检查日期为准、登记时间只用于排序与审计。
// 旧结论：换版后已有记录按新版重算 pending/异常口径；终态旧结论保留当时等级，注明 v1.0 旧档，不覆盖。
// 落库：迁移结果整体提交，任一步失败整批回滚，见 local-store.commitAll()。
export const BACKFILL_POLICY = [
  '路径一（整体）：历史数据按登记时间整体回填，登记时间取各模块登记/检查日期字段；缺字段的另列一行说明并提醒补录。',
  '路径二（励磁专项）：励磁记录按检查日期重放，退出装置退出日后多记的强励次数一律冲回，计数冻结在退出日。',
  '先后与冲突：先路径一后路径二；字段分歧时专项规则优先，登记时间与检查日期都保留，业务判定以检查日期为准。',
  '旧结论：换版后按 v2.0 重算待办/异常口径，终态旧结论保留当时等级并注明 v1.0 旧档，不覆盖。',
  '落库：迁移整批提交，失败整套回滚，不允许只写进去半条记录。',
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}/

function validDate(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return DATE_RE.test(value.trim()) ? value.trim().slice(0, 10) : ''
}

// 强励流水形如 "2026-09-02:1;2026-09-04:5"：日期对应当日累计值。
function counterOnOrBefore(ledger: unknown, cutoff: string): { value: number; date: string } | null {
  if (typeof ledger !== 'string' || ledger.trim() === '') {
    return null
  }
  let hit: { value: number; date: string } | null = null
  for (const part of ledger.split(';')) {
    const [datePart, countPart] = part.split(':')
    const date = validDate(datePart)
    const value = Number.parseInt(String(countPart ?? '').trim(), 10)
    if (!date || !Number.isFinite(value)) {
      continue
    }
    if (date <= cutoff && (hit === null || date >= hit.date)) {
      hit = { value, date }
    }
  }
  return hit
}

function appendNote(row: EntryRow, note: string): void {
  row.回填说明 = row.回填说明 ? `${row.回填说明}；${note}` : note
}

// 一个模块在 v1 -> v2 时的迁移结果
type ModuleMigration = {
  rows: EntryRow[]
  migrated: boolean
}

function migrateModule(key: string, source: EntryRow[]): ModuleMigration {
  const meta = MODULES.find((item) => item.key === key)
  if (!meta || source.length === 0) {
    return { rows: source, migrated: false }
  }
  // 已是新版（该模块任一行带当前版本戳）：原样保留，不覆盖旧结论。
  if (source.some((row) => row.规则版本 === CURRENT_RULE_VERSION)) {
    return { rows: source, migrated: false }
  }

  const finalStatus = meta.statuses[meta.statuses.length - 1]
  const abnormalSet = new Set(meta.abnormalStatuses ?? [])
  const pendingSet = new Set(meta.pendingStatuses ?? meta.statuses.slice(0, -1))
  // 与 local-service.statusFieldOf 同规则：承载当前状态镜像的列（装置状态/检修状态…），结论列不算
  const mirrorField =
    meta.fields.find((field) => field.endsWith('状态')) ?? meta.fields[meta.fields.length - 1]
  const hasConclusion = meta.fields.includes('结论')
  const counterField = meta.counterField

  const rows = source.map((origin) => {
    const row: EntryRow = { ...origin }
    const notes: string[] = []

    // —— 路径一：登记时间整体回填 ——
    if (meta.dateField) {
      const registered = validDate(row[meta.dateField])
      if (registered) {
        row.登记时间 = registered
      } else {
        notes.push(`早期记录缺少有效登记时间（${meta.dateField}），未臆造，待人工补录`)
      }
    } else {
      notes.push('该模块无登记日期字段，登记时间待人工补录')
    }

    // —— 路径二（励磁专项）：强励次数按检查日期重放、退出后多记的冲回 ——
    if (key === 'excitation') {
      const rawCounter = row[counterField as string]
      const parsed = Number.parseInt(String(rawCounter ?? ''), 10)
      if (!Number.isFinite(parsed) || String(rawCounter).trim() === '') {
        row[counterField as string] = 0
        notes.push('早期记录缺少有效强励次数，按 0 重新计数，待人工核补')
      } else {
        row[counterField as string] = parsed
      }

      if (String(row.status) === '已退出') {
        const checkDate = validDate(row.检查日期) ?? row.登记时间 ?? ''
        const hadExitTime = Boolean(validDate(row.退出时间))
        const exitTime = validDate(row.退出时间) || checkDate
        if (exitTime) {
          row.退出时间 = exitTime
          if (!hadExitTime && checkDate) {
            notes.push(`退出时间缺登记，按检查日期 ${checkDate} 回填`)
          }
        }
        const current = Number(row[counterField as string])
        const freeze = counterOnOrBefore(row.强励流水, exitTime)
        // 冲回规则：退出日之后还在累加的部分一律不认，强励次数冻结为退出日（含）前最后一笔流水值；
        // 没有流水可查时保持现值并注明，由人工核对，不擅自改数。
        if (freeze && freeze.value < current) {
          row[counterField as string] = freeze.value
          notes.push(`强励次数按退出日 ${exitTime} 冲回：退出后多记 ${current - freeze.value} 次已冲回（${current}→${freeze.value}）`)
        } else if (!freeze && Number.isFinite(parsed)) {
          notes.push(`退出日 ${exitTime || '未知'} 前缺少强励流水，现值 ${current} 无法自动冲回，待人工核对`)
        }
      }
    }

    // —— 换版重算：异常口径按状态语义，退出装置从异常台数剔除；待办口径同步回落 ——
    row.abnormal = abnormalSet.has(String(row.status))
    row.pending = pendingSet.has(String(row.status))

    // 页面显示的状态与字段里镜像的状态必须是同一个值（修「页面已完成、导出残留旧值」）
    if (mirrorField) {
      row[mirrorField] = String(row.status)
    }

    // 旧结论保留当时等级并注明版本；无结论字段的模块跳过
    if (hasConclusion && String(row.status) === finalStatus) {
      const legacy = typeof row.结论 === 'string' ? row.结论 : ''
      row.结论 = legacy
        ? `${legacy}（${LEGACY_RULE_VERSION} 旧档，保留当时等级）`
        : `${finalStatus === '已完工' ? '已完成' : finalStatus}（旧等级，按${LEGACY_RULE_VERSION}口径保留）`
    }

    row.规则版本 = CURRENT_RULE_VERSION
    if (notes.length > 0) {
      appendNote(row, notes.join('；'))
    }
    return row
  })

  // 路径一要求的整体顺序：按登记时间升序，缺登记时间的排最前，同时间按编号稳定排序
  rows.sort((a, b) => {
    const da = validDate(a.登记时间)
    const db = validDate(b.登记时间)
    if (!da && !db) {
      return Number(a.id) - Number(b.id)
    }
    if (!da) {
      return -1
    }
    if (!db) {
      return 1
    }
    return da < db ? -1 : da > db ? 1 : Number(a.id) - Number(b.id)
  })

  return { rows, migrated: true }
}

export type DatasetMigration = {
  data: Record<string, EntryRow[]>
  migratedKeys: string[]
}

// 对整份库做一次迁移：逐模块纯计算，最后由 local-store 一次性整体提交。
export function migrateDataset(input: Record<string, EntryRow[]>): DatasetMigration {
  const data: Record<string, EntryRow[]> = {}
  const migratedKeys: string[] = []
  for (const meta of MODULES) {
    const result = migrateModule(meta.key, input[meta.key] ?? [])
    data[meta.key] = result.rows
    if (result.migrated) {
      migratedKeys.push(meta.key)
    }
  }
  return { data, migratedKeys }
}

export function datasetVersion(input: Record<string, EntryRow[]>): string {
  for (const meta of MODULES) {
    const stamped = (input[meta.key] ?? []).some((row) => row.规则版本 === CURRENT_RULE_VERSION)
    if (stamped) {
      return CURRENT_RULE_VERSION
    }
  }
  return LEGACY_RULE_VERSION
}
