// CI pay per student, per cycle: ₹ rate per completed 25-class cycle, counting
// only classes the CI taught, from the CI's appointment date.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ciCycleBlocks, ciCyclePayroll, datesByMonth, CI_CYCLE_SESSIONS } from '../src/utils/ciPayroll.js'

// Parth's classes with the CI (the 28 Sep class was a substitute's, so absent here)
const PARTH = ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-12','2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-26','2026-09-29','2026-09-30','2026-10-01','2026-10-03','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10']

test('a cycle is 25 classes', () => assert.equal(CI_CYCLE_SESSIONS, 25))

test('Parth: 25 classes complete one cycle ending 8 Oct; the next has begun', () => {
  const b = ciCycleBlocks(PARTH, 25, '2026-09-07')
  assert.equal(b.length, 2)
  assert.equal(b[0].count, 25); assert.equal(b[0].complete, true); assert.equal(b[0].end, '2026-10-08')
  assert.equal(b[1].count, 2); assert.equal(b[1].complete, false)
})

test('a cycle is the pay of the month it started in: Parth and Aaisha began in September, so September pays ₹2000', () => {
  const aaisha = PARTH.filter(d => d !== '2026-09-07' && d !== '2026-10-01')
    .concat(['2026-09-27', '2026-09-28', '2026-10-02'])
  const students = [
    { id: 'p', name: 'Parth', dates: PARTH, perCycle: 25 },
    { id: 'a', name: 'Aaisha', dates: aaisha, perCycle: 25 },
  ]
  const sept = ciCyclePayroll(students, '2026-09', 1000, '2026-09-07')
  assert.equal(sept.rows.length, 2)
  assert.equal(sept.total, 2000)
  const oct = ciCyclePayroll(students, '2026-10', 1000, '2026-09-07')
  assert.equal(oct.total, 0)                       // the second cycle is only just under way
  assert.equal(oct.inProgress.length, 2)
})

test('after the CI leaves, the unfinished cycle is paid pro-rata in the month it started (October)', () => {
  const r = ciCyclePayroll([{ id: 'p', name: 'Parth', dates: PARTH, perCycle: 25, left: true }], '2026-10', 1000, '2026-09-07')
  assert.equal(r.total, 80)    // only 2 classes (9, 10 Oct) in this fixture: 2/25 × 1000
})

test('classes before the CI joined are not counted', () => {
  const b = ciCycleBlocks(PARTH, 25, '2026-09-20')
  assert.equal(b.reduce((n, x) => n + x.count, 0), PARTH.filter(d => d >= '2026-09-20').length)
})

test('a substitute-covered class is simply not in the list, so the cycle takes longer (pro-rata by classes taught)', () => {
  const withoutOne = PARTH.filter(d => d !== '2026-10-08')
  const b = ciCycleBlocks(withoutOne, 25, '2026-09-07')
  assert.equal(b[0].end, '2026-10-09')
})

test('a short last cycle is paid pro-rata only once the student has left', () => {
  const dates = PARTH.slice(0, 10)
  const still = ciCyclePayroll([{ id: 'p', name: 'P', dates, perCycle: 25 }], '2026-09', 1000, '2026-09-01')
  assert.equal(still.total, 0)
  assert.equal(still.inProgress[0].accrued, 400)   // 10/25 × 1000
  const left = ciCyclePayroll([{ id: 'p', name: 'P', dates, perCycle: 25, left: true }], '2026-09', 1000, '2026-09-01')
  assert.equal(left.total, 400)
  assert.equal(left.rows[0].blocks[0].partial, true)
})

test('a cycle is never paid in a month other than the one it started in', () => {
  const r = ciCyclePayroll([{ id: 'p', name: 'P', dates: PARTH, perCycle: 25 }], '2026-11', 1000, '2026-09-07')
  assert.equal(r.total, 0)
})

test('own cycle length is respected', () => {
  const b = ciCycleBlocks(PARTH.slice(0, 12), 12, '2026-09-01')
  assert.equal(b.length, 1); assert.equal(b[0].complete, true)
})

test('dates listed by month, in the sheet’s style', () => {
  assert.equal(datesByMonth(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-03']), '( Sept-2026, 29,30 ) ( Oct-2026, 1,3 )')
})

import { countInRange, amountForClasses } from '../src/utils/ciPayroll.js'

test('classes counted between two dates, inclusive', () => {
  assert.equal(countInRange(PARTH, '2026-09-07', '2026-10-08'), 25)
  assert.equal(countInRange(PARTH, '2026-09-07', '2026-10-01'), 20)
  assert.equal(countInRange(PARTH, '2026-10-02', '2026-10-01'), 0)
})

test('amount for a date range: whole cycle is the full rate, a shorter range is pro-rata', () => {
  assert.equal(amountForClasses(1000, 25, 25), 1000)
  assert.equal(amountForClasses(1000, 20, 25), 800)
  assert.equal(amountForClasses(1000, 9, 25), 360)
})

test('paid-through date: the next cycle starts after the last date already paid', () => {
  // September's line was saved as paid to 5 Oct, so the next cycle starts on 6 Oct
  const b = ciCycleBlocks(PARTH, 25, '2026-09-07', '2026-10-05')
  assert.equal(b.length, 1)
  assert.equal(b[0].start, '2026-10-06')
  assert.equal(b[0].count, PARTH.filter(d => d > '2026-10-05').length)
  const none = ciCycleBlocks(PARTH, 25, '2026-09-07', '')
  assert.equal(none[0].start, '2026-09-07')
})

import { nextCycleStart } from '../src/utils/ciPayroll.js'

test('next pay starts the day after the last date paid, or the 1st of next month if paid to month end', () => {
  assert.equal(nextCycleStart('2026-10-08'), '2026-10-09')
  assert.equal(nextCycleStart('2026-10-29'), '2026-10-30')
  assert.equal(nextCycleStart('2026-10-30'), '2026-11-01')   // 30th: month end
  assert.equal(nextCycleStart('2026-10-31'), '2026-11-01')
  assert.equal(nextCycleStart('2026-09-30'), '2026-10-01')
  assert.equal(nextCycleStart('2027-02-28'), '2027-03-01')   // last day of a short month
  assert.equal(nextCycleStart('2026-12-31'), '2027-01-01')
  assert.equal(nextCycleStart(''), '')
})

test('paid to the 30th: the 31st is not carried into the next cycle', () => {
  const dates = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02']
  const b = ciCycleBlocks(dates, 25, '2026-10-01', '2026-10-30')
  assert.equal(b[0].start, '2026-11-02')
})
