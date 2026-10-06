// 励磁域规则的端到端校验：迁移回填、退出冻结、口径剔除、同源导出、原子回滚。
// 运行：npm run verify（esbuild 打包后用 node 执行，不依赖浏览器）
import {
  excitationNotes,
  exportEntries,
  listEntries,
  listReminders,
  loadOverview,
  recalcExcitation,
  runAction,
  setReminderDone,
} from '@/api/local-service'
import { loadState, storageKey } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// ---- localStorage 模拟：可控制 setItem 抛错来验证回滚 ----
const backing = new Map<string, string>()
let failWrites = false
const localStorageMock = {
  getItem: (key: string) => backing.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (failWrites) {
      throw new Error('QuotaExceededError')
    }
    backing.set(key, value)
  },
  removeItem: (key: string) => {
    backing.delete(key)
  },
}
;(globalThis as Record<string, unknown>).window = { localStorage: localStorageMock }

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
    console.error(`✗ ${label}\n  期望: ${JSON.stringify(expected)}\n  实际: ${JSON.stringify(actual)}`)
  } else {
    console.log(`✓ ${label}`)
  }
}

function excitationRow(id: number): EntryRow {
  const row = listEntries('excitation').items.find((item) => Number(item.id) === id)
  if (!row) {
    throw new Error(`励磁装置 ${id} 不存在`)
  }
  return row
}

// ---- 1. 回填迁移：退出装置冲回多记次数、口径剔除、结论换版重算 ----
const list = listEntries('excitation')
check('迁移后共 3 台装置', list.total, 3)

const retired = excitationRow(3)
check('EXCI-0003 状态为已退出', retired.status, '已退出')
check('EXCI-0003 强励次数冲回到退出前的 3 次', retired['强励次数'], 3)
check('EXCI-0003 强励冲回留痕 2 次', retired['强励冲回'], 2)
check('EXCI-0003 退出后不再计待办', retired.pending, false)
check('EXCI-0003 退出后不计异常台数', retired.abnormal, false)
check('EXCI-0003 按 2026版 重算结论为关注', retired['结论'], '关注')
check('EXCI-0003 结论版本为 2026版', retired['结论版本'], '2026版')
check('EXCI-0003 旧结论留痕注明版本', retired['历史结论'], '正常（2025版）')

const records = loadState().excitationRecords
check('退出日期之后的记录 #6 已标记冲回', records.find((r) => r.id === 6)?.['已冲回'], true)
check('退出日期之后的记录 #7 已标记冲回', records.find((r) => r.id === 7)?.['已冲回'], true)
check('退出日期当天的记录 #5 未冲回', records.find((r) => r.id === 5)?.['已冲回'], false)

check('EXCI-0001 强励次数按记录回填为 1', excitationRow(1)['强励次数'], 1)
check('EXCI-0002 缺字段记录不计数，强励次数仍为 2', excitationRow(2)['强励次数'], 2)

// ---- 2. 回填说明：缺字段另列一行、冲回留痕 ----
const notes = excitationNotes()
check('缺检查日期的记录另列一行说明', notes.some((n) => n.includes('励磁记录#3') && n.includes('缺检查日期')), true)
check('冲回留痕 5→3 另列一行说明', notes.some((n) => n.includes('EXCI-0003') && n.includes('5→3')), true)

// ---- 3. 提醒事项：退出装置结论写回待办，两处同源 ----
const reminders = listReminders()
check('退出装置生成 1 条提醒', reminders.length, 1)
check('提醒结论包含冲回与版本', reminders[0]?.['结论'].includes('EXCI-0003') && reminders[0]?.['结论'].includes('冲回'), true)
check('提醒初始为待办', reminders[0]?.['状态'], '待办')

// ---- 4. 迁移幂等：再触发一次，结果不变、提醒不重复 ----
listEntries('excitation')
check('重复迁移后强励次数仍为 3', excitationRow(3)['强励次数'], 3)
check('重复迁移后冲回留痕仍为 2', excitationRow(3)['强励冲回'], 2)
check('重复迁移后提醒不重复', listReminders().length, 1)

// ---- 5. 退出后不再累计强励 ----
const blocked = runAction('excitation', 3, '登记强励')
check('已退出装置登记强励被拒绝', blocked.ok, false)
check('已退出装置强励次数不变', excitationRow(3)['强励次数'], 3)

// ---- 6. 在运装置正常累计 ----
const registered = runAction('excitation', 1, '登记强励')
check('在运装置登记强励成功', registered.ok, true)
check('EXCI-0001 强励次数 1→2', excitationRow(1)['强励次数'], 2)
check('登记强励追加一条励磁记录', loadState().excitationRecords.some((r) => r['装置编号'] === 'EXCI-0001' && r['本次强励'] === 1 && r.id > 7), true)

// ---- 7. 退出运行：冻结计数、清口径、写待办；重复退出只算一次 ----
const overviewBefore = loadOverview().modules.find((m) => m.name === '励磁系统')
check('退出前概览待处理含待检查装置', overviewBefore?.pending, 1)

const retired2 = runAction('excitation', 1, '退出运行')
check('退出运行成功', retired2.ok, true)
check('EXCI-0001 状态已退出', excitationRow(1).status, '已退出')
check('EXCI-0001 退出日期已记录', String(excitationRow(1)['退出日期'] ?? '').length === 10, true)
check('EXCI-0001 退出后不计待办', excitationRow(1).pending, false)
check('EXCI-0001 退出后不计异常', excitationRow(1).abnormal, false)
check('退出后提醒增至 2 条', listReminders().length, 2)

const overviewAfter = loadOverview().modules.find((m) => m.name === '励磁系统')
check('概览待检查装置数回落到 0', overviewAfter?.pending, 0)
check('概览异常台数不含退出装置', overviewAfter?.abnormal, 0)

const repeated = runAction('excitation', 1, '退出运行')
check('重复退出被拒绝', repeated.ok, false)
check('重复退出不重复扣台数（提醒不新增）', listReminders().length, 2)
check('重复退出不强励次数不变', excitationRow(1)['强励次数'], 2)

// ---- 8. 列表与另存同源：导出里的次数、结论与页面一致 ----
const csv = exportEntries('excitation').content
const exportedRetired = csv.split('\n').find((line) => line.includes('EXCI-0003')) ?? ''
check('导出含结论列', csv.split('\n')[0].includes('结论'), true)
check('导出中 EXCI-0003 强励次数与页面一致为 3', exportedRetired.split(',').includes('3'), true)
check('导出中 EXCI-0003 结论与页面一致为关注', exportedRetired.includes('关注'), true)
check('导出中 EXCI-0003 状态为已退出', exportedRetired.trim().endsWith('已退出'), true)

// ---- 9. 落库失败整体回滚，不写半条记录 ----
const stateBefore = JSON.stringify(loadState())
failWrites = true
const failed = runAction('excitation', 2, '登记强励')
failWrites = false
check('落库失败返回失败', failed.ok, false)
check('失败提示整体回滚', failed.message.includes('回滚'), true)
check('落库失败后状态原样（无半条记录）', JSON.stringify(loadState()), stateBefore)
check('EXCI-0002 强励次数未被加', excitationRow(2)['强励次数'], 2)

// ---- 10. 换版重算：旧结论保留当时等级并注明版本 ----
const recalc = recalcExcitation()
check('手动重算成功', recalc.ok, true)
check('重算后旧结论留痕仍在', excitationRow(3)['历史结论'], '正常（2025版）')
check('重算后结论版本仍为现行版', excitationRow(3)['结论版本'], '2026版')

// ---- 11. 提醒事项与待办清单同步（同一份数据） ----
const reminderId = Number(listReminders()[0].id)
const done = setReminderDone(reminderId, true)
check('提醒可标记完成', done.ok, true)
check('两处取到的状态同为已完成', listReminders()[0]['状态'], '已完成')
setReminderDone(reminderId, false)
check('重新打开后两处同为待办', listReminders()[0]['状态'], '待办')

// ---- 12. 持久化内容确实写进了 localStorage ----
check('localStorage 里有持久化数据', backing.has(storageKey()), true)

if (failures > 0) {
  console.error(`\n${failures} 项校验未通过`)
  process.exit(1)
}
console.log('\n全部校验通过')
