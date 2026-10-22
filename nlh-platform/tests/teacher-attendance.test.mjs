// Teacher attendance codes in the register: P present, O off, A absent (once
// enabled by the pending migration), H holiday (derived, never stored).
import test from 'node:test'
import assert from 'node:assert/strict'

import { TEACHER_ABSENT_ENABLED, isTeacherAway, teacherNextStatus, teacherStatusTitle } from '../src/utils/teacherAttendance.js'

test('absent is enabled (the status check now allows A)', () => {
  assert.equal(TEACHER_ABSENT_ENABLED, true)
})

test('cell cycle with absent switched off: blank -> P -> O -> blank (the previous behaviour)', () => {
  assert.equal(teacherNextStatus(null, false), 'P')
  assert.equal(teacherNextStatus(undefined, false), 'P')
  assert.equal(teacherNextStatus('P', false), 'O')
  assert.equal(teacherNextStatus('O', false), null)
})

test('cell cycle once enabled: blank -> P -> A -> O -> blank', () => {
  assert.equal(teacherNextStatus(null, true), 'P')
  assert.equal(teacherNextStatus('P', true), 'A')
  assert.equal(teacherNextStatus('A', true), 'O')
  assert.equal(teacherNextStatus('O', true), null)
})

test('a full lap returns to blank in both modes', () => {
  for (const en of [false, true]) {
    let s = null, steps = 0
    do { s = teacherNextStatus(s, en); steps++ } while (s !== null && steps < 10)
    assert.equal(s, null)
    assert.equal(steps, en ? 4 : 3)
  }
})

test('off and absent both mean the teacher is not taking the class; present and blank do not', () => {
  assert.equal(isTeacherAway('O'), true)
  assert.equal(isTeacherAway('A'), true)
  assert.equal(isTeacherAway('P'), false)
  assert.equal(isTeacherAway(null), false)
  assert.equal(isTeacherAway(undefined), false)
})

test('titles', () => {
  assert.equal(teacherStatusTitle('P'), 'Teacher present')
  assert.equal(teacherStatusTitle('A'), 'Teacher absent — was due but did not come')
  assert.equal(teacherStatusTitle('O'), "Teacher's weekly off")
  assert.equal(teacherStatusTitle(null), 'Teacher not marked')
  assert.equal(teacherStatusTitle('P', true), 'General holiday')
})

import { resolveTeacherStatus, teacherWritePlan } from '../src/utils/teacherAttendance.js'

test("a batch's own mark wins over the whole-day mark; the day mark is the fallback", () => {
  assert.equal(resolveTeacherStatus('A', 'P'), 'A')
  assert.equal(resolveTeacherStatus(null, 'O'), 'O')
  assert.equal(resolveTeacherStatus(null, null), null)
})

test("absent in one batch does not touch the same teacher's other batch", () => {
  assert.equal(resolveTeacherStatus('A', null), 'A')
  assert.equal(resolveTeacherStatus('P', null), 'P')
})

test('write plan: P/A are per batch, O is the whole day, clearing removes what exists', () => {
  assert.deepEqual(teacherWritePlan('A', false), { upsertDay: null, deleteBatch: false, deleteDay: false, upsertBatch: 'A' })
  assert.deepEqual(teacherWritePlan('O', false), { upsertDay: 'O', deleteBatch: true, deleteDay: false, upsertBatch: null })
  assert.deepEqual(teacherWritePlan(null, true), { upsertDay: null, deleteBatch: true, deleteDay: true, upsertBatch: null })
  assert.equal(teacherWritePlan(null, false).deleteDay, false)
})

import { teacherStartDay } from '../src/utils/teacherAttendance.js'

test('a CI’s register starts the later of the batch start and the day they were assigned', () => {
  assert.equal(teacherStartDay({ start_date: '2026-09-08', instructor_assigned_at: '2026-10-20' }), '2026-10-20')   // batch handed over mid-way
  assert.equal(teacherStartDay({ start_date: '2026-10-20', instructor_assigned_at: '2026-10-20' }), '2026-10-20')
  assert.equal(teacherStartDay({ start_date: '2026-09-08', instructor_assigned_at: null }), '2026-09-08')
  assert.equal(teacherStartDay({ start_date: null, instructor_assigned_at: '2026-10-05' }), '2026-10-05')
  assert.equal(teacherStartDay({}), '')
})
