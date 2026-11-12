import test from 'node:test'
import assert from 'node:assert/strict'
import { monthBlocks, monthPayItems, monthProgress, monthLayout, addMonth, MONTH_SESSIONS } from '../src/utils/monthCycle.js'

const days = function (m, list) { return list.map(function (d) { return '2026-' + m + '-' + String(d).padStart(2, '0') }) }
// Sabahat's Mon–Fri 5–6 batch: every class held since 2 Sep (14 Sep was taken by a substitute)
const all = days('09', [2,3,4,7,8,9,10,11,14,15,16,17,18,19,21,22,23,24,25,28,29,30])
  .concat(days('10', [1,5,6,7,8,12,13,14,15,16,19,20,21,22,23,26,27,28,29,30,31]), days('11', [2, 3, 4]))
const ci = all.filter(function (d) { return d !== '2026-09-14' })

test('a month is 22 classes', () => { assert.equal(MONTH_SESSIONS, 22) })

test('22 classes before the renewal date: extras are free and the next month starts on the renewal date', () => {
  // renewed 9 Oct, Mon–Sat classes: the window runs to 9 Nov; the 22nd class falls before it
  const dates = []
  for (let d = new Date(2026, 9, 9); d < new Date(2026, 10, 20); d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) continue
    dates.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'))
  }
  const r = monthBlocks(dates, '2026-10-09')
  assert.equal(r.blocks[0].end, '2026-11-09')
  assert.equal(r.blocks[0].spill, false)
  assert.equal(r.blocks[0].completedOn < '2026-11-09', true)
  assert.equal(r.blocks[0].free.length > 0, true)           // classes after the 22nd and before 9 Nov are free
  assert.equal(r.open.start, '2026-11-09')                 // the next month starts on the renewal date
})

test('22nd class on or after the renewal date: counted on that day, the next class is the 1st of the next month', () => {
  // a Mon–Fri child renewed 9 Oct with 4 holidays: only 18 classes by 8 Nov
  const dates = []
  for (let d = new Date(2026, 9, 9); d < new Date(2026, 10, 25); d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue
    dates.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'))
  }
  const fewer = dates.filter(function (x, i) { return !(i >= 3 && i <= 6) })     // four holidays
  const r = monthBlocks(fewer, '2026-10-09')
  assert.equal(r.blocks[0].spill, true)
  assert.equal(r.blocks[0].completedOn >= '2026-11-09', true)
  const next = new Date(r.blocks[0].completedOn + 'T00:00:00'); next.setDate(next.getDate() + 1)
  assert.equal(r.blocks[1] ? r.blocks[1].start : r.nextAnchor, next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0') + '-' + String(next.getDate()).padStart(2, '0'))
})

test('addMonth: same date next month, month-end clamps', () => {
  assert.equal(addMonth('2026-10-09'), '2026-11-09')
  assert.equal(addMonth('2026-01-31'), '2026-02-28')
})

test('CI pay: own classes ÷ 22, in the month the 22nd class falls', () => {
  const sep = monthPayItems({ all, ci, anchor: '2026-09-02', month: '2026-09', stillTeaching: true })
  assert.equal(sep.items.length, 1)
  assert.equal(sep.items[0].count, 21)              // the 14 Sep class was a substitute's
  assert.equal(sep.items[0].total, 22)
  const oct = monthPayItems({ all, ci, anchor: '2026-09-02', month: '2026-10', stillTeaching: true })
  assert.equal(oct.items.length, 0)                  // the October month is still running — payable in November
  assert.equal(oct.open.count > 0, true)
  const nov = monthPayItems({ all, ci, anchor: '2026-09-02', month: '2026-11', stillTeaching: true })
  assert.equal(nov.items.length, 1); assert.equal(nov.items[0].count, 22); assert.equal(nov.items[0].spill, true)
})

test('CI pay: a CI who stops mid-month is paid pro-rata in the month of their last class', () => {
  const ciStops = ci.filter(function (d) { return d <= '2026-10-15' })
  const stopped = monthPayItems({ all, ci: ciStops, anchor: '2026-09-02', month: '2026-10', stillTeaching: false })
  assert.equal(stopped.items.length, 1)
  assert.equal(stopped.items[0].complete, false)
  assert.equal(stopped.items[0].to, '2026-10-15')
  // the month later completed by someone else is not paid again to the CI who left
  const later = monthPayItems({ all, ci: ciStops, anchor: '2026-09-02', month: '2026-11', stillTeaching: false })
  assert.equal(later.items.length, 0)
})

test('student month progress', () => {
  const p = monthProgress(all.filter(function (d) { return d <= '2026-10-16' }), '2026-09-02')
  assert.equal(p.lastCompleted.completedOn, '2026-09-30')
  assert.equal(p.done, 9); assert.equal(p.left, 13); assert.equal(p.openStart, '2026-10-02')   // 1 Oct is free: the 22nd class (30 Sep) came before the renewal date 2 Oct
})

test('month layout: one segment per month, free classes after the 22nd, the running month marked open', () => {
  const dates = []
  for (let d = new Date(2026, 9, 9); d < new Date(2026, 10, 20); d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) continue
    dates.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'))
  }
  const L = monthLayout(dates, '2026-10-09', '2026-10-09')
  assert.equal(L.length, 2)
  assert.equal(L[0].counted.length, 22)
  assert.equal(L[0].free.length > 0, true)
  assert.equal(L[0].end, '2026-11-09')
  assert.equal(L[1].start, '2026-11-09'); assert.equal(L[1].open, true)
  // a renewal entered on another date cuts the earlier month off there
  const cut = monthLayout(dates, '2026-10-09', '2026-10-20')
  assert.equal(cut[0].end, '2026-10-20'); assert.equal(cut[0].open, false)
  assert.equal(cut[1].start, '2026-10-20')
})
