/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

// 规则版本：v1.0 是旧口径（退出后仍累计强励、异常口径不含状态语义）；v2.0 起按新口径重算。
export const CURRENT_RULE_VERSION = 'v2.0'
export const LEGACY_RULE_VERSION = 'v1.0'

// 每条记录挂在固定字段上的扩展信息，业务字段仍按 modules.ts 里的 fields 走。
export type EntryMeta = {
  登记时间?: string
  退出时间?: string
  规则版本?: string
  结论?: string
  强励流水?: string
  回填说明?: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
} & EntryMeta

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
  // 登记/检查时间取自哪个业务字段；缺省表示该模块历史数据没有登记时间可回填。
  dateField?: string
  // 该模块哪些状态算异常口径；缺省表示没有异常状态（不把任何在役装置算进异常台数）。
  abnormalStatuses?: string[]
  // 该模块哪些状态算待办口径；缺省表示除最后一个终态外的状态都算待办。
  pendingStatuses?: string[]
  // 页面统计卡口径：给出三个卡片各自统计的状态集合。
  statCards?: { label: string; statuses: string[] }[]
  // 该模块存在动作触发型计数（励磁的强励次数）：退出终态后不再累加。
  counterField?: string
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

export type TodoItem = {
  moduleKey: string
  moduleName: string
  id: number
  title: string
  status: string
  dueDate: string
  conclusion: string
}

export type ReminderItem = {
  moduleKey: string
  moduleName: string
  id: number
  message: string
  dueDate: string
  source: 'pending' | 'backfill'
}

export type BackfillNote = {
  moduleKey: string
  moduleName: string
  id: number
  message: string
}
