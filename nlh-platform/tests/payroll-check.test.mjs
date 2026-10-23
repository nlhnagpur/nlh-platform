import test from 'node:test'
import assert from 'node:assert/strict'
import { payrollCheckIssues, PAYROLL_ACTIONS } from '../src/utils/payrollCheck.js'
import { batchHealthIssues, BATCH_ACTIONS } from '../src/utils/batchHealth.js'

const appt = (course, mode, on) => ({ remuneration_mode: mode, appointed_at: on, skus: { courses: { group_name: course } } })
const base = { month: '2026-09', ciName: 'Sabahat Heena', classesTaken: 21, classPay: 3580, unmatched: [], appts: [], usedCourses: ['Phonics'], run: null, calcTotal: 3580 }
const codes = (x) => payrollCheckIssues({ ...base, ...x }).map((i) => i.code)

test('a healthy month raises nothing', () => assert.deepEqual(codes({}), []))

test('a programme on the roster with no appointment is an error, and says what to do', () => {
  const out = payrollCheckIssues({ ...base, unmatched: [{ batch: 'Mon-Fri 5 to 6 pm', course: 'Phonics' }] })
  assert.equal(out[0].code, 'no_appointment')
  assert.equal(out[0].severity, 'error')
  assert.ok(out[0].action.includes('Instructors'))
})

test('classes taken but ₹0 calculated is flagged (and not when the real cause is a missing appointment)', () => {
  assert.ok(codes({ classPay: 0 }).includes('zero_pay'))
  assert.ok(!codes({ classPay: 0, unmatched: [{ batch: 'b', course: 'Phonics' }] }).includes('zero_pay'))
  assert.ok(!codes({ classesTaken: 0, classPay: 0 }).includes('zero_pay'))
})

test('a change of basis inside the month is noted — Sabahat, 9 October', () => {
  const appts = [appt('Phonics', 'per_student_month', '2026-09-01'), appt('Phonics', 'per_student', '2026-10-09')]
  assert.ok(codes({ month: '2026-10', appts }).includes('basis_change'))
  assert.ok(!codes({ month: '2026-09', appts }).includes('basis_change'))                                  // the change is in October, not September
  assert.ok(!codes({ month: '2026-10', appts: [appt('Phonics', 'per_student', '2026-10-09'), appt('Phonics', 'per_student', '2026-10-20')] }).includes('basis_change'))   // same basis: nothing to say
})

test('a saved payroll that no longer matches the calculation is flagged; a posted one is only noted', () => {
  assert.ok(codes({ run: { status: 'draft', calculated_total: 2386 } }).includes('recalculated'))
  assert.ok(codes({ run: { status: 'posted', calculated_total: 2386 } }).includes('posted_differs'))
  assert.deepEqual(codes({ run: { status: 'draft', calculated_total: 3580 } }), [])
})

test('every kind of issue, in payroll and in batches, carries an action', () => {
  for (const k of ['no_appointment', 'zero_pay', 'basis_change', 'recalculated', 'posted_differs']) assert.ok(PAYROLL_ACTIONS[k] && PAYROLL_ACTIONS[k].length > 20, k)
  for (const k of ['no_ci', 'ci_not_active', 'no_students', 'class_before_start', 'other_ci_class', 'no_recent_class', 'no_appointment', 'double_batch']) assert.ok(BATCH_ACTIONS[k] && BATCH_ACTIONS[k].length > 20, k)
  const out = batchHealthIssues({ today: '2026-10-23', batches: [{ id: 'b', name: 'B', is_active: true, start_date: '2026-09-01', instructor_assigned_at: '2026-09-01', instructor_id: null, instructors: null }], openRoster: [], recentSessions: [], appointments: [] })
  assert.ok(out.length > 0 && out.every((i) => i.action))
})

test('a cycle still running is reported in the check, with what to do', () => {
  const out = payrollCheckIssues({ ...base, inProgress: [{ name: 'Parth', count: 11, perCycle: 25, start: '2026-10-09', accrued: 440 }] })
  const i = out.find((x) => x.code === 'cycle_in_progress')
  assert.ok(i && i.severity === 'info' && i.action.length > 20)
})
