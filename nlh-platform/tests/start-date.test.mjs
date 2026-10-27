import test from 'node:test'
import assert from 'node:assert/strict'
import { validateStartDate, startDateWarnings, startDatePlan } from '../src/utils/startDate.js'

const enr = { id: 'e1', enrolled_at: '2026-10-27T00:00:00+00:00', cycle_started_at: '2026-10-27', monthly: true }

test('start date: needs a different date, not after completion', () => {
  assert.equal(validateStartDate(enr, '', '2026-10-27').ok, false)
  assert.equal(validateStartDate(enr, '2026-10-27', '2026-10-27').ok, false)
  assert.equal(validateStartDate({ ...enr, completed_at: '2026-10-10' }, '2026-10-20', '2026-10-27').ok, false)
  assert.equal(validateStartDate(enr, '2026-10-12', '2026-10-27').ok, true)
})

test('start date plan: only what carried the old date moves, together', () => {
  const ops = startDatePlan(enr, '2026-10-12',
    [{ id: 'm1', assigned_at: '2026-10-27T00:00:00+00:00' }, { id: 'm2', assigned_at: '2026-11-03' }],
    [{ id: 'i1', invoice_date: '2026-10-27', items: [{ kind: 'course', enrollment_id: 'e1' }] }, { id: 'i2', invoice_date: '2026-10-27', items: [{ kind: 'course', enrollment_id: 'other' }] }])
  assert.deepEqual(ops.map(function (o) { return o.type + ':' + o.id }), ['enrollment:e1', 'membership:m1', 'invoice:i1'])
  assert.equal(ops[0].patch.cycle_started_at, '2026-10-12')
  // a cycle start set on purpose to another date is left alone; non-monthly has no cycle
  assert.equal(startDatePlan({ ...enr, cycle_started_at: '2026-11-01' }, '2026-10-12', [], [])[0].patch.cycle_started_at, undefined)
  assert.equal(startDatePlan({ ...enr, monthly: false }, '2026-10-12', [], [])[0].patch.cycle_started_at, undefined)
})

test('start date warnings: future date, classes before, saved payroll', () => {
  const w = startDateWarnings('2026-12-01', { today: '2026-10-27', classesBefore: 3, savedRuns: [{ ci: 'Sabahat', month: 'October 2026', status: 'saved' }] })
  assert.equal(w.length, 3)
  assert.equal(startDateWarnings('2026-10-12', { today: '2026-10-27', classesBefore: 0, savedRuns: [] }).length, 0)
})
