import test from 'node:test'
import assert from 'node:assert/strict'
import { monthLabel, cleanLines, sumLines, linesFromCalc, runStatus, lineEdited } from '../src/utils/ciPayrollRun.js'

test('month label', () => assert.equal(monthLabel('2026-10'), 'October 2026'))

test('calculated lines become editable lines with the same amount; editing shows as edited', () => {
  const lines = linesFromCalc([{ key: 'a', label: 'Parth', amount: 1000 }, { key: 'b', label: 'Aaisha', amount: 1000 }])
  assert.equal(sumLines(lines), 2000)
  assert.equal(lineEdited(lines[0]), false)
  lines[1].amount = 1100
  assert.equal(lineEdited(lines[1]), true)
  assert.equal(sumLines(lines), 2100)
})

test('an added line is never "edited" and counts in the total; blank lines are dropped; amounts are whole rupees', () => {
  const lines = cleanLines([{ key: 'a', label: 'Parth', calc: 1000, amount: '1000.4' }, { label: 'Extra', amount: 250, added: true }, { label: '', amount: 0 }])
  assert.equal(lines.length, 2)
  assert.equal(lines[0].amount, 1000)
  assert.equal(lineEdited(lines[1]), false)
  assert.equal(sumLines(lines), 1250)
})

test('a deduction is a negative line', () => assert.equal(sumLines([{ amount: 2000 }, { amount: -250 }]), 1750))

test('run status', () => {
  assert.equal(runStatus(null), 'none')
  assert.equal(runStatus({ status: 'draft' }), 'draft')
  assert.equal(runStatus({ status: 'paid' }), 'paid')
})

test('a student line keeps its date range through clean and calc; moving the dates counts as edited', () => {
  const calc = [{ key: 'c', label: 'Parth', amount: 1000, meta: { sid: 'e1', from: '2026-09-07', to: '2026-10-08', count: 25, perCycle: 25, rate: 1000 } }]
  const lines = linesFromCalc(calc)
  assert.equal(lineEdited(lines[0]), false)
  lines[0].meta = { ...lines[0].meta, to: '2026-10-05' }
  assert.equal(lineEdited(lines[0]), true)
  assert.equal(cleanLines(lines)[0].meta.sid, 'e1')
})

import { allocatePayment, lastDayOf } from '../src/utils/ciPayrollRun.js'

test('month end date for the accrual entry', () => {
  assert.equal(lastDayOf('2026-09'), '2026-09-30')
  assert.equal(lastDayOf('2026-10'), '2026-10-31')
  assert.equal(lastDayOf('2027-02'), '2027-02-28')
})

test('a payment settles whole months oldest first; the rest stays as a part payment', () => {
  const runs = [{ id: 'oct', month: '2026-10', total: 930 }, { id: 'sep', month: '2026-09', total: 2250 }]
  assert.deepEqual(allocatePayment(runs, 2250), { settled: ['sep'], leftover: 0 })
  assert.deepEqual(allocatePayment(runs, 3180), { settled: ['sep', 'oct'], leftover: 0 })
  assert.deepEqual(allocatePayment(runs, 2000), { settled: [], leftover: 2000 })     // short of September: nothing settled
  assert.deepEqual(allocatePayment(runs, 3500), { settled: ['sep', 'oct'], leftover: 320 })
})
