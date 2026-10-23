import test from 'node:test'
import assert from 'node:assert/strict'
import { dayBefore, dayAfter, validateMove, movePlan, moveWarnings } from '../src/utils/batchMove.js'
import { closeBatchPlan } from '../src/utils/batchClose.js'

test('day before / after across month and year ends', () => {
  assert.equal(dayBefore('2026-10-20'), '2026-10-19')
  assert.equal(dayBefore('2026-11-01'), '2026-10-31')
  assert.equal(dayBefore('2027-01-01'), '2026-12-31')
  assert.equal(dayAfter('2026-10-31'), '2026-11-01')
  assert.equal(dayAfter('2028-02-28'), '2028-02-29')
  assert.equal(dayBefore(''), '')
})

test('a move needs a target and a date after the child joined the current batch', () => {
  const cur = { assigned_at: '2026-09-07T00:00:00Z' }
  assert.equal(validateMove(cur, { targetBatchId: '', effective: '2026-10-20' }).ok, false)
  assert.equal(validateMove(cur, { targetBatchId: 'b2', effective: '' }).ok, false)
  assert.ok(validateMove(cur, { targetBatchId: 'b2', effective: '2026-09-07' }).problems[0].includes('after that day'))
  assert.equal(validateMove(cur, { targetBatchId: 'b2', effective: '2026-10-20' }).ok, true)
})

test('the plan ends the old membership the day before and starts the new one on the date — one batch every day', () => {
  const ops = movePlan({ bsId: 'bs1', enrollmentId: 'e1' }, { targetBatchId: 'b2', effective: '2026-10-20' })
  assert.deepEqual(ops, [
    { type: 'end_membership', bsId: 'bs1', removed_at: '2026-10-19' },
    { type: 'start_membership', batchId: 'b2', enrollmentId: 'e1', assigned_at: '2026-10-20' },
  ])
})

test('warnings never block: no appointment, a past date, and payroll already saved or posted', () => {
  const w = moveWarnings({ effective: '2026-10-20' }, {
    today: '2026-10-23', noAppointment: true, ciNames: { old: 'Khushi', new: 'Sneha' },
    savedRuns: [{ ci: 'Khushi', month: 'October 2026', status: 'posted' }],
  })
  assert.equal(w.length, 3)
  assert.ok(w[0].includes('Sneha has no appointment'))
  assert.ok(w[1].includes('up to 2026-10-19') && w[1].includes('from 2026-10-20'))
  assert.ok(w[2].includes('already posted'))
  assert.deepEqual(moveWarnings({ effective: '2026-10-23' }, { today: '2026-10-23' }), [])
})

test('closing a batch starts a moved child the day after the closing date, so no day is counted twice', () => {
  const ops = closeBatchPlan('b1', [{ bsId: 'bs1', enrollmentId: 'e1', name: 'Ayesha' }], { bs1: { choice: 'move', targetBatchId: 'b9' } }, { closeDate: '2026-10-19' })
  assert.equal(ops[0].removed_at, '2026-10-19')
  assert.equal(ops[1].assigned_at, '2026-10-20')
})
