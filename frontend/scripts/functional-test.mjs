// 功能自测：用 esbuild 把内嵌的 TS 用例和 src 打成 cjs，在 node 里配 localStorage stub 后执行：
//   node scripts/functional-test.mjs
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const entry = '/tmp/hom-test-entry.ts'
const bundle = '/tmp/hom-test-bundle.cjs'

const TEST_SOURCE = String.raw`
import {
  exportEntries,
  listBackfillNotes,
  listEntries,
  listReminders,
  listTodos,
  loadOverview,
  moduleStatCards,
  runAction,
} from '/workspace/frontend/src/api/local-service.ts'

const results = []
function check(name, cond, detail) {
  results.push([name, Boolean(cond), detail])
}

// ---------- 场景一：旧版 v1.0 库首次打开，触发迁移 ----------
const before = listEntries('excitation').items
check('迁移后共5台励磁装置', before.length === 5, String(before.length))

const ex4 = before.find((r) => r.id === 4)
check('id4 强励次数 7→5（退出后多记2次冲回）', Number(ex4['强励次数']) === 5, String(ex4['强励次数']))
check('id4 退出时间按检查日期回填', ex4['退出时间'] === '2026-09-04', String(ex4['退出时间']))
check('id4 回填说明含冲回', String(ex4['回填说明']).includes('多记 2 次已冲回'), ex4['回填说明'])
check('id4 已退出不计异常', ex4.abnormal === false)
check('id4 已退出不算待办', ex4.pending === false)
check('id4 装置状态镜像=已退出（导出不再残留旧值）', ex4['装置状态'] === '已退出', String(ex4['装置状态']))
check('id4 旧结论保留并注明版本', String(ex4['结论']).includes('v1.0'), String(ex4['结论']))
check('id4 版本戳=v2.0', ex4['规则版本'] === 'v2.0', String(ex4['规则版本']))

const ex5 = before.find((r) => r.id === 5)
check('id5 缺强励次数按0计数', Number(ex5['强励次数']) === 0, String(ex5['强励次数']))
check('id5 缺字段另列说明', String(ex5['回填说明']).includes('缺少有效强励次数'), ex5['回填说明'])

const ex1 = before.find((r) => r.id === 1)
check('id1 登记时间回填', ex1['登记时间'] === '2026-09-01', String(ex1['登记时间']))

const ex2 = before.find((r) => r.id === 2)
check('id2 正常且旧异常标记被重算为非异常', ex2.abnormal === false)
const ex3 = before.find((r) => r.id === 3)
check('id3 异常态重算为异常', ex3.abnormal === true && ex3.status === '异常')

check('按登记时间整体升序', before.map((r) => r.id).join(',') === '1,2,3,4,5', before.map((r) => r.id).join(','))

// ---------- 场景二：退出后强励不再累计；重复退出只算一次 ----------
const r1 = runAction('excitation', 2, '记录强励')
check('在役装置记录强励成功', r1.ok, r1.message)
const after1 = listEntries('excitation').items.find((r) => r.id === 2)
check('强励次数 4→5', Number(after1['强励次数']) === 5, String(after1['强励次数']))

const exitOk = runAction('excitation', 2, '退出运行')
check('退出运行成功', exitOk.ok, exitOk.message)
const exited = listEntries('excitation').items.find((r) => r.id === 2)
check('退出后状态=已退出', exited.status === '已退出')
check('退出后强励次数冻结为5', Number(exited['强励次数']) === 5, String(exited['强励次数']))
check('退出时间=今天', exited['退出时间'] === new Date().toISOString().slice(0, 10))

const forcedAfterExit = runAction('excitation', 2, '记录强励')
check('退出后再点记录强励被拒绝', !forcedAfterExit.ok, forcedAfterExit.message)
const exited2 = listEntries('excitation').items.find((r) => r.id === 2)
check('强励次数仍是5（退出后没涨）', Number(exited2['强励次数']) === 5)

const exitAgain = runAction('excitation', 2, '退出运行')
check('重复点退出只算一次（被拒绝）', !exitAgain.ok, exitAgain.message)
const blocked = runAction('excitation', 2, '提交检查')
check('已退出不能再走其他流转', !blocked.ok, blocked.message)

// ---------- 场景三：页面统计卡 / 概览 / 导出 三处口径一致 ----------
const cards = moduleStatCards('excitation')
const byLabel = Object.fromEntries(cards.map((c) => [c.label, c.value]))
check('正常装置卡=0（id2也退出后）', byLabel['正常装置'] === 0, JSON.stringify(byLabel))
check('异常装置卡=1（已退出全剔除）', byLabel['异常装置'] === 1, JSON.stringify(byLabel))
check('待检查装置卡=1（退出后回落）', byLabel['待检查装置'] === 1, JSON.stringify(byLabel))

const ov = loadOverview()
const exModule = ov.modules.find((m) => m.name === '励磁系统')
check('概览励磁 pending=1（id1待检查）', exModule.pending === 1, JSON.stringify(exModule))
check('概览励磁 abnormal=1（id3）', exModule.abnormal === 1, JSON.stringify(exModule))

const csv = exportEntries('excitation').content
const lines = csv.split('\n')
check('导出版本戳', csv.includes('规则版本 v2.0'))
check('导出统计行 异常=1', csv.includes('异常装置台数（不含已退出）,1'))
check('导出统计行 待办=1', csv.includes('待办台数（不含已退出）,1'))
check('导出回填说明行（id4冲回）', csv.includes('强励次数按退出日 2026-09-04 冲回'))
const id4Line = lines.find((l) => l.startsWith('4,'))
check('导出列表 id4 强励次数=5（与页面一致）', id4Line.split(',')[6] === '5', id4Line)
check('导出列表 id4 状态镜像列=已退出', id4Line.includes('已退出'), id4Line)
const id2Line = lines.find((l) => l.startsWith('2,'))
check('导出列表 id2 冻结值=5', id2Line.split(',')[6] === '5', id2Line)

// ---------- 场景四：机组检修结论写回待办，页面/导出/待办同一份 ----------
const finish = runAction('overhaul', 1, '办理完工')
check('检修票办理完工成功', finish.ok, finish.message)
const oh = listEntries('overhaul').items.find((r) => r.id === 1)
check('检修状态镜像=已完工', oh['检修状态'] === '已完工', String(oh['检修状态']))
check('结论=已完成(v2.0)', String(oh['结论']).includes('已完成') && oh['结论'].includes('v2.0'), String(oh['结论']))
const todoOh = listTodos().find((t) => t.moduleKey === 'overhaul' && t.id === 1)
check('已完工的票不在待办里', todoOh === undefined)
const ohCsv = exportEntries('overhaul').content
check('检修导出含同一结论', ohCsv.includes(oh['结论']))
const ohLine = ohCsv.split('\n').find((l) => l.startsWith('1,'))
check('检修导出残留旧值消失（检修状态列=已完工）', ohLine.includes('已完工'), ohLine)

const ohNote = listBackfillNotes().find((n) => n.moduleKey === 'overhaul')
check('机组检修缺登记时间另列一行', Boolean(ohNote), JSON.stringify(ohNote))

// ---------- 场景五：提醒与待办同步 ----------
const todos = listTodos()
const pendingReminders = listReminders().filter((r) => r.source === 'pending')
check('待办不含已退出/已完工', todos.every((t) => t.status !== '已退出' && t.status !== '已完工'))
check('待办到期有提醒（种子日期都早于今天）', pendingReminders.length > 0, String(pendingReminders.length))
const backfillReminders = listReminders().filter((r) => r.source === 'backfill')
check('缺字段说明进了提醒', backfillReminders.some((r) => r.moduleKey === 'excitation'))
check('回填说明与提醒同源同文案', backfillReminders.some((r) => r.message === ex4['回填说明']))

// ---------- 场景六：落库失败整套回滚 ----------
const beforeCounter = Number(listEntries('excitation').items.find((r) => r.id === 3)['强励次数'])
const kv = globalThis.__store
const realSet = kv.setItem.bind(kv)
kv.setItem = () => { throw new Error('QuotaExceeded') }
const rollback = runAction('excitation', 3, '记录强励')
kv.setItem = realSet
check('落库失败时动作报错并回滚', !rollback.ok && rollback.message.includes('回滚'), rollback.message)
const afterCounter = Number(listEntries('excitation').items.find((r) => r.id === 3)['强励次数'])
check('回滚后强励次数未变（没写进去半条）', afterCounter === beforeCounter, beforeCounter + ' -> ' + afterCounter)

// ---------- 场景七：旧库迁移幂等，二次读取不重复迁移、不覆盖旧结论 ----------
const csv2 = exportEntries('excitation').content
check('二次读取后 id4 仍是5（不重复冲回）', csv2.split('\n').find((l) => l.startsWith('4,')).split(',')[6] === '5')
const ex4Again = listEntries('excitation').items.find((r) => r.id === 4)
check('二次读取后旧结论仍保留 v1.0 标注', String(ex4Again['结论']).includes('v1.0'))
const notesCount = listBackfillNotes().filter((n) => n.id === 4).length
check('回填说明不重复堆叠（id4 仍只有一行）', notesCount === 1, String(notesCount))

// ---------- 汇总输出 ----------
let failed = 0
for (const [name, ok, detail] of results) {
  if (!ok) {
    failed++
    console.log('FAIL:', name, detail !== undefined && detail !== false ? detail : '')
  }
}
console.log(failed === 0 ? 'ALL PASS (' + results.length + ' checks)' : failed + '/' + results.length + ' FAILED')
if (failed) process.exit(1)
`

writeFileSync(entry, TEST_SOURCE)

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
  logLevel: 'silent',
})

// localStorage + window stub
const map = new Map()
const storage = {
  getItem: (k) => (map.has(k) ? map.get(k) : null),
  setItem: (k, v) => {
    map.set(k, String(v))
  },
  removeItem: (k) => {
    map.delete(k)
  },
}
globalThis.window = { localStorage: storage }
globalThis.localStorage = storage
globalThis.__store = storage

require(bundle)
