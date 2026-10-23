import test from 'node:test'
import assert from 'node:assert/strict'
import { batchListedInMonth, batchHealthIssues } from '../src/utils/batchHealth.js'
import { teacherStartDay } from '../src/utils/teacherAttendance.js'

test('a closed batch with no classes in the month is not listed; with classes it is; an open batch is listed once the CI has it', () => {
  const closed = { is_active: false, start_date: '2026-04-15', instructor_assigned_at: '2026-04-15' }
  assert.equal(batchListedInMonth(closed, false, '2026-10-31'), false)          // Sabahat's old "2-3 pm" in October
  assert.equal(batchListedInMonth(closed, true, '2026-05-31'), true)            // it ran classes in May
  const open = { is_active: true, start_date: '2026-10-20', instructor_assigned_at: '2026-10-20' }
  assert.equal(batchListedInMonth(open, false, '2026-10-31'), true)
  assert.equal(batchListedInMonth(open, false, '2026-09-30'), false)            // not yet begun in September
})

test('the CI start day is never later than a class that was actually recorded', () => {
  const b = { start_date: '2026-09-08', instructor_assigned_at: '2026-09-08' }
  assert.equal(teacherStartDay(b), '2026-09-08')
  assert.equal(teacherStartDay(b, '2026-09-07'), '2026-09-07')   // Parth's first class came a day before the batch start
  assert.equal(teacherStartDay(b, '2026-09-20'), '2026-09-08')
})

const CI = { full_name: 'Sabahat Heena', status: 'active' }
const base = {
  today: '2026-10-23',
  batches: [{ id: 'b1', name: 'Mon-Fri 5 to 6 pm', is_active: true, start_date: '2026-09-02', instructor_assigned_at: '2026-09-02', instructor_id: 'ci1', instructors: CI }],
  openRoster: [{ batch_id: 'b1', student_id: 's1', student: 'Sai', course_id: 'phonics', course: 'Phonics' }],
  recentSessions: [{ batch_id: 'b1', session_date: '2026-10-22', instructor_id: 'ci1', is_substitute: false }],
  appointments: [{ instructor_id: 'ci1', remuneration_mode: 'per_student', appointed_at: '2026-10-09', skus: { course_id: 'phonics' } }],
}
const codes = (x) => batchHealthIssues(x).map((i) => i.code)

test('a healthy batch raises nothing', () => assert.deepEqual(codes(base), []))

test('each problem is caught', () => {
  assert.ok(codes({ ...base, batches: [{ ...base.batches[0], instructors: { ...CI, status: 'resigned' } }] }).includes('ci_not_active'))
  assert.ok(codes({ ...base, batches: [{ ...base.batches[0], instructor_id: null }] }).includes('no_ci'))
  assert.ok(codes({ ...base, openRoster: [] }).includes('no_students'))
  assert.ok(codes({ ...base, recentSessions: [{ batch_id: 'b1', session_date: '2026-09-01', instructor_id: 'ci1', is_substitute: false }] }).includes('class_before_start'))
  assert.ok(codes({ ...base, recentSessions: [{ batch_id: 'b1', session_date: '2026-10-22', instructor_id: 'other', is_substitute: false }] }).includes('other_ci_class'))
  assert.ok(!codes({ ...base, recentSessions: [{ batch_id: 'b1', session_date: '2026-10-22', instructor_id: 'other', is_substitute: true }] }).includes('other_ci_class'))   // a marked substitute is fine
  assert.ok(codes({ ...base, recentSessions: [] }).includes('no_recent_class'))
})

test('no appointment for the course on the roster is an error — payroll would calculate nothing', () => {
  assert.ok(codes({ ...base, appointments: [] }).includes('no_appointment'))
  assert.ok(codes({ ...base, appointments: [{ instructor_id: 'ci1', remuneration_mode: 'per_student', appointed_at: '2026-11-01', skus: { course_id: 'phonics' } }] }).includes('no_appointment'))   // not yet in force
  assert.ok(codes({ ...base, appointments: [{ instructor_id: 'ci1', remuneration_mode: 'per_student', appointed_at: '2026-01-01', skus: { course_id: 'grammar' } }] }).includes('no_appointment'))      // wrong course
})

test('a student on two open batches for the same course is flagged; closed batches are ignored', () => {
  const two = {
    ...base,
    batches: [...base.batches, { id: 'b2', name: 'Other', is_active: true, start_date: '2026-09-02', instructor_assigned_at: '2026-09-02', instructor_id: 'ci1', instructors: CI }],
    openRoster: [...base.openRoster, { batch_id: 'b2', student_id: 's1', student: 'Sai', course_id: 'phonics', course: 'Phonics' }],
    recentSessions: [...base.recentSessions, { batch_id: 'b2', session_date: '2026-10-22', instructor_id: 'ci1', is_substitute: false }],
  }
  assert.ok(codes(two).includes('double_batch'))
  assert.deepEqual(codes({ ...base, batches: [{ ...base.batches[0], is_active: false, instructors: { ...CI, status: 'resigned' } }], openRoster: [] }), [])
})

test('errors are listed before warnings before notes', () => {
  const out = batchHealthIssues({ ...base, openRoster: [], recentSessions: [], appointments: [] })
  const sev = out.map((i) => i.severity)
  assert.deepEqual(sev, [...sev].sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a] - { error: 0, warn: 1, info: 2 }[b])))
})
