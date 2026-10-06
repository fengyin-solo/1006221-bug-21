/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 励磁记录：一次检查登记一条，是强励次数的计数来源。 */
export type ExcitationRecord = {
  id: number
  装置编号: string
  检查日期: string
  本次强励: number
  登记时间: string
  已冲回?: boolean
}

/** 提醒事项 / 待办清单共用的一份数据：励磁页叫提醒，机组检修页叫待办。 */
export type Reminder = {
  id: number
  kind: string
  装置编号: string
  结论: string
  状态: '待办' | '已完成'
  createdAt: string
  doneAt?: string
}

/** localStorage 里持久化的整份状态：一次写入、一起回滚。 */
export type PersistedState = {
  entries: Record<string, EntryRow[]>
  excitationRecords: ExcitationRecord[]
  reminders: Reminder[]
  /** 已按哪一版励磁标准重算过结论 */
  standardVersion: string
  /** 数据结构版本，低于当前版本时触发回填迁移 */
  dataVersion: number
}
