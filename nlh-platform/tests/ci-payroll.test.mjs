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

test('October payroll: one full ₹1000 per student whose cycle ended in October', () => {
  const aaisha = PARTH.filter(d => d !== '2026-09-07' && d !== '2026-10-01')   // joined 8 Sep, 24 by 8 Oct + a few more
    .concat(['2026-09-27', '2026-09-28', '2026-10-02'])
  const r = ciCyclePayroll([
    { id: 'p', name: 'Parth', dates: PARTH, perCycle: 25 },
    { id: 'a', name: 'Aaisha', dates: aaisha, perCycle: 25 },
  ], '2026-10', 1000, '2026-09-07')
  assert.equal(r.rows.length, 2)
  assert.equal(r.total, 2000)
  assert.equal(r.inProgress.length, 2)            // both are partway through the next cycle
  assert.equal(ciCyclePayroll([{ id: 'p', name: 'Parth', dates: PARTH, perCycle: 25 }], '2026-09', 1000, '2026-09-07').total, 0)   // nothing in September
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

test('a cycle that completed in an earlier month is not paid again', () => {
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
