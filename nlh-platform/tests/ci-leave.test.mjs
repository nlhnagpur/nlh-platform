import test from 'node:test'
import assert from 'node:assert/strict'
import { handoverDate, handoverBlockReason, validateLeave, leavePlan, LEAVE_STATUSES } from '../src/utils/ciLeave.js'
import { appointmentForCourse } from '../src/utils/ciPayroll.js'

test('the new CI takes over the day after the last day of work, across month and year ends', () => {
  assert.equal(handoverDate('2026-10-19'), '2026-10-20')
  assert.equal(handoverDate('2026-10-31'), '2026-11-01')
  assert.equal(handoverDate('2026-12-31'), '2027-01-01')
  assert.equal(handoverDate('2028-02-28'), '2028-02-29')
  assert.equal(handoverDate(''), '')
})

const batches = [{ id: 'b1', name: 'Tution 5 TO 6 PM' }, { id: 'b2', name: 'Tution 4.30 TO 5.30 PM' }]

test('every open batch needs a decision, and a hand-over needs the new CI', () => {
  assert.equal(validateLeave(batches, {}, { status: 'resigned', lastDay: '2026-10-19' }).ok, false)
  const noCi = validateLeave(batches, { b1: { choice: 'handover' }, b2: { choice: 'handover', newCiId: 'c2' } }, { status: 'resigned', lastDay: '2026-10-19' })
  assert.ok(noCi.problems[0].includes('Choose the CI'))
  assert.equal(validateLeave(batches, { b1: { choice: 'handover', newCiId: 'c2' }, b2: { choice: 'handover', newCiId: 'c2' } }, { status: 'resigned', lastDay: '2026-10-19' }).ok, true)
  assert.equal(validateLeave([], {}, { status: 'resigned', lastDay: '2026-10-19' }).ok, true)          // nothing open (all closed): fine
  assert.ok(validateLeave([], {}, { status: '', lastDay: '2026-10-19' }).problems[0].includes('why'))
  assert.ok(validateLeave([], {}, { status: 'resigned', lastDay: '' }).problems[0].includes('last day'))
  assert.ok(Object.keys(LEAVE_STATUSES).includes('terminated'))
})

test('the plan hands the batches over first and marks the CI as left last', () => {
  const ops = leavePlan('ci1', batches, { b1: { choice: 'handover', newCiId: 'c2' }, b2: { choice: 'handover', newCiId: 'c3' } }, { status: 'resigned', lastDay: '2026-10-19' })
  assert.deepEqual(ops.map((o) => o.type), ['handover', 'handover', 'mark_left'])
  assert.deepEqual(ops[0], { type: 'handover', batchId: 'b1', name: 'Tution 5 TO 6 PM', newCiId: 'c2', assigned_at: '2026-10-20' })
  assert.deepEqual(ops[2], { type: 'mark_left', instructorId: 'ci1', status: 'resigned', left_at: '2026-10-19' })
})

test('a batch cannot go to a CI without an appointment for every programme on it', () => {
  const sneha = [{ remuneration_mode: 'per_student_cycle', appointed_at: '2026-10-20', skus: { courses: { group_name: 'Tuitions' } } }]
  assert.equal(handoverBlockReason(['Tuitions'], sneha, appointmentForCourse, '2026-10-31', 'Sneha Das'), '')
  assert.ok(handoverBlockReason(['Tuitions', 'Phonics'], sneha, appointmentForCourse, '2026-10-31', 'Sneha Das').includes('no appointment for Phonics'))
  assert.ok(handoverBlockReason(['Tuitions'], sneha, appointmentForCourse, '2026-10-10', 'Sneha Das').includes('Tuitions'))   // not yet appointed on the handover date
  assert.equal(handoverBlockReason([], [], appointmentForCourse, '2026-10-31', 'x'), '')
})

import { statusChangeBlock } from '../src/utils/ciLeave.js'

test('a CI can be set to resigned/inactive once their batches are closed; refused while any is open', () => {
  assert.equal(statusChangeBlock('active', 'resigned', 0), '')                 // batches already closed — the usual case
  assert.ok(statusChangeBlock('active', 'inactive', 2).includes('2 open batches'))
  assert.ok(statusChangeBlock('active', 'resigned', 1).includes('1 open batch.'))
  assert.equal(statusChangeBlock('active', 'active', 3), '')                    // not leaving
  assert.equal(statusChangeBlock('resigned', 'inactive', 3), '')                // already not active: nothing new to protect
})
