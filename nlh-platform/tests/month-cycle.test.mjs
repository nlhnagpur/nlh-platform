import test from 'node:test'
import assert from 'node:assert/strict'
import { monthBlocks, monthPayItems, monthProgress, MONTH_SESSIONS } from '../src/utils/monthCycle.js'

const days = function (m, list) { return list.map(function (d) { return '2026-' + m + '-' + String(d).padStart(2, '0') }) }
// Sabahat's Mon–Fri 5–6 batch: every class held since 2 Sep (14 Sep was taken by a substitute)
const all = days('09', [2,3,4,7,8,9,10,11,14,15,16,17,18,19,21,22,23,24,25,28,29,30])
  .concat(days('10', [1,5,6,7,8,12,13,14,15,16,19,20,21,22,23,26,27,28,29,30,31]), days('11', [2, 3, 4]))
const ci = all.filter(function (d) { return d !== '2026-09-14' })

test('a month is 22 classes', () => { assert.equal(MONTH_SESSIONS, 22) })

test('22 classes inside the starting calendar month: counted there, extras free, next month starts on the 1st', () => {
  const dates = []
  for (let d = 1; d <= 31; d++) { const wd = new Date(2026, 9, d).getDay(); if (wd !== 0) dates.push('2026-10-' + String(d).padStart(2, '0')) }   // Mon–Sat: 27 classes
  const r = monthBlocks(dates, '2026-10-01')
  assert.equal(r.blocks.length, 1)
  assert.equal(r.blocks[0].completedOn, '2026-10-26')   // the 22nd class
  assert.equal(r.blocks[0].payMonth, '2026-10')
  assert.equal(r.blocks[0].spill, false)
  assert.equal(r.blocks[0].free.length, dates.length - 22)
  assert.equal(r.nextAnchor, '2026-11-01')
  assert.equal(r.open, null)
})

test('a month that spills into the next calendar month is counted on its 22nd class; the next starts the day after', () => {
  const r = monthBlocks(all, '2026-09-02')
  // Sai: 22nd class is 30 Sep (14 Sep counts for the child even though a substitute took it)
  assert.equal(r.blocks[0].completedOn, '2026-09-30'); assert.equal(r.blocks[0].spill, false)
  assert.equal(r.blocks[1].start, '2026-10-01')
  assert.equal(r.blocks[1].completedOn, '2026-11-02'); assert.equal(r.blocks[1].payMonth, '2026-11'); assert.equal(r.blocks[1].spill, true)
  assert.equal(r.nextAnchor, '2026-11-03')
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
  assert.equal(p.done, 10); assert.equal(p.left, 12); assert.equal(p.openStart, '2026-10-01')
})
