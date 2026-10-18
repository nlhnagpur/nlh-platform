// Teacher attendance codes in the register: P present, O off, A absent (once
// enabled by the pending migration), H holiday (derived, never stored).
import test from 'node:test'
import assert from 'node:assert/strict'

import { TEACHER_ABSENT_ENABLED, isTeacherAway, teacherNextStatus, teacherStatusTitle } from '../src/utils/teacherAttendance.js'

test('absent is not enabled until the migration is approved and applied', () => {
  assert.equal(TEACHER_ABSENT_ENABLED, false)
})

test('cell cycle today: blank -> P -> O -> blank (unchanged behaviour)', () => {
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
