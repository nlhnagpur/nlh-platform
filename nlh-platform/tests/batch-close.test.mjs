import test from 'node:test'
import assert from 'node:assert/strict'
import { validateClose, closeBatchPlan, targetBlockReason, CLOSE_CHOICES } from '../src/utils/batchClose.js'
import { appointmentForCourse } from '../src/utils/ciPayroll.js'

const students = [
  { bsId: 'bs1', enrollmentId: 'e1', name: 'Sai', programme: 'Phonics' },
  { bsId: 'bs2', enrollmentId: 'e2', name: 'Ayesha', programme: 'Phonics' },
]

test('every student needs a decision, a move needs a target batch, and the batch cannot close before its last class', () => {
  assert.equal(validateClose(students, {}, { closeDate: '2026-10-20', lastClassDate: '2026-10-19' }).ok, false)
  const partial = validateClose(students, { bs1: { choice: 'finished' } }, { closeDate: '2026-10-20' })
  assert.equal(partial.ok, false); assert.ok(partial.problems[0].includes('Ayesha'))
  const noTarget = validateClose(students, { bs1: { choice: 'finished' }, bs2: { choice: 'move' } }, { closeDate: '2026-10-20' })
  assert.ok(noTarget.problems[0].includes('Choose the batch'))
  const early = validateClose(students, { bs1: { choice: 'off' }, bs2: { choice: 'off' } }, { closeDate: '2026-10-10', lastClassDate: '2026-10-19' })
  assert.ok(early.problems[0].includes('cannot close before'))
  const good = validateClose(students, { bs1: { choice: 'finished' }, bs2: { choice: 'move', targetBatchId: 'b9' } }, { closeDate: '2026-10-20', lastClassDate: '2026-10-19' })
  assert.deepEqual(good, { ok: true, problems: [] })
})

test('an empty batch can be closed once it has a date', () => {
  assert.equal(validateClose([], {}, { closeDate: '2026-10-20' }).ok, true)
  assert.equal(validateClose([], {}, { closeDate: '' }).ok, false)
})

test('the plan deals with students first and closes the batch last', () => {
  const ops = closeBatchPlan('b1', students, { bs1: { choice: 'finished' }, bs2: { choice: 'move', targetBatchId: 'b9' } }, { closeDate: '2026-10-20' })
  assert.deepEqual(ops.map((o) => o.type), ['take_off', 'complete', 'take_off', 'assign', 'close_batch'])
  assert.equal(ops[0].removed_at, '2026-10-20')
  assert.equal(ops[1].completed_at, '2026-10-20T12:00:00+00:00')
  assert.deepEqual(ops[3], { type: 'assign', enrollmentId: 'e2', name: 'Ayesha', batchId: 'b9', assigned_at: '2026-10-20' })
  assert.equal(ops[ops.length - 1].batchId, 'b1')
})

test('a student cannot be moved to a CI who holds no appointment for the programme', () => {
  const appts = [{ remuneration_mode: 'per_student', appointed_at: '2026-04-01', skus: { courses: { group_name: 'Chess' } } }]
  assert.ok(targetBlockReason(appts, 'Phonics', appointmentForCourse, '2026-10-31', 'Sneha Das').includes('no appointment for Phonics'))
  assert.equal(targetBlockReason(appts, 'Chess', appointmentForCourse, '2026-10-31', 'Sneha Das'), '')
  assert.equal(targetBlockReason(appts, '', appointmentForCourse, '2026-10-31', 'x'), '')
  assert.ok(Object.keys(CLOSE_CHOICES).length === 3)
})
