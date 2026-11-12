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

test('CI pay: paid as the classes are taken — each calendar month pays the classes taken in it (÷ 22)', () => {
  const sep = monthPayItems({ all, ci, anchor: '2026-09-02', month: '2026-09' })
  assert.equal(sep.items.length, 1)
  assert.equal(sep.items[0].count, 21)              // the 14 Sep class was a substitute's; the 22nd class is 30 Sep
  assert.equal(sep.items[0].total, 22)
  const oct = monthPayItems({ all, ci, anchor: '2026-09-02', month: '2026-10' })
  // October: the next month (from the renewal date 2 Oct) has its classes paid as they are taken; 1 Oct was free
  assert.equal(oct.items.length, 1)
  assert.equal(oct.items[0].from >= '2026-10-02', true)
  assert.equal(oct.items[0].complete, true)         // that month completed on 3 Nov, so it is a completed month with a spill
  const nov = monthPayItems({ all, ci, anchor: '2026-09-02', month: '2026-11' })
  assert.equal(nov.items.length >= 1, true)
  // across the two calendar months the CI is paid for exactly the 22 classes of the month, never more
  const paid = oct.items[0].count + nov.items[0].count
  assert.equal(paid <= 22, true)
})

test('CI pay: classes after the 22nd (free) are never paid', () => {
  const dates = []
  for (let d = new Date(2026, 9, 1); d < new Date(2026, 10, 1); d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) continue
    dates.push('2026-10-' + String(d.getDate()).padStart(2, '0'))
  }
  const r = monthPayItems({ all: dates, ci: dates, anchor: '2026-10-01', month: '2026-10' })
  assert.equal(r.items.reduce(function (t, i) { return t + i.count }, 0), 22)    // 26 classes held, 22 paid
})

test('CI pay: a CI who stops mid-month is paid pro-rata for the classes taken, once', () => {
  const ciStops = ci.filter(function (d) { return d <= '2026-10-15' })
  const oct = monthPayItems({ all, ci: ciStops, anchor: '2026-09-02', month: '2026-10' })
  assert.equal(oct.items.length, 1)
  assert.equal(oct.items[0].to, '2026-10-15')
  const nov = monthPayItems({ all, ci: ciStops, anchor: '2026-09-02', month: '2026-11' })
  assert.equal(nov.items.length, 0)               // nothing more after they left
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
