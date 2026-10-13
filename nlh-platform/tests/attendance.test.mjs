// Phase 1 regression baseline — attendance / monthly-cycle calculations.
// Synthetic data only. Characterisation tests: they record current behaviour.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  addOneMonth, computeCycle, cycleDows, countCycleDays, renewalInfo, cycleAnchor,
  attentionReasons, certPending, enrolmentBucket, studentBucket,
} from '../src/utils/studentLifecycle.js'

// Mon-Fri sessions for Oct 2026 (Oct 1 is a Thursday)
function sessions(from, to, holidays) {
  const out = []
  let n = 0
  for (let d = new Date(from + 'T00:00:00'); d <= new Date(to + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    if (d.getDay() === 0 || d.getDay() === 6) continue
    out.push({ id: 's' + (++n), session_date: iso, is_holiday: (holidays || []).includes(iso) })
  }
  return out
}

test('addOneMonth: same date next month; month-end clamps', () => {
  assert.equal(addOneMonth('2026-10-05'), '2026-11-05')
  assert.equal(addOneMonth('2026-01-31'), '2026-02-28')
  assert.equal(addOneMonth('2028-01-31'), '2028-02-29')
  assert.equal(addOneMonth('2026-12-15'), '2027-01-15')
})

test('cycleDows: own days win, then batch days, else all seven', () => {
  assert.deepEqual([...cycleDows('Sat, Sun', 'Mon, Tue')].sort(), [0, 6])
  assert.deepEqual([...cycleDows('', 'Mon, Wed')].sort(), [1, 3])
  assert.equal(cycleDows('', '').size, 7)
})

test('countCycleDays: Mon-Fri over Oct 1 -> Nov 1 2026', () => {
  assert.equal(countCycleDays('2026-10-01', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']), 22)
})

test('computeCycle: target excludes declared holidays; unmarked is not absent', () => {
  const en = { cycle_started_at: '2026-10-01', cycle_days: 'Mon, Tue, Wed, Thu, Fri' }
  const ss = sessions('2026-10-01', '2026-10-31', ['2026-10-02'])
  const att = new Map()
  ss.filter(s => !s.is_holiday && s.session_date <= '2026-10-09').forEach((s, i) => att.set(s.id, i % 2 === 0))
  const c = computeCycle(en, ss, att, '', '2026-10-09')
  assert.equal(c.target, 21)              // 22 weekdays - 1 holiday
  assert.equal(c.due, '2026-11-01')
  assert.equal(c.end, '2026-10-31')
  assert.equal(c.spa.S, c.spa.P + c.spa.A + c.spa.U)      // S = P + A + U invariant
})

test('computeCycle: session with no attendance row counts as U (not marked), never as A', () => {
  const en = { cycle_started_at: '2026-10-01', cycle_days: 'Mon, Tue, Wed, Thu, Fri' }
  const ss = sessions('2026-10-01', '2026-10-31')
  const c = computeCycle(en, ss, new Map(), '', '2026-10-09')
  assert.equal(c.absent, 0)
  assert.ok(c.unmarked > 0)
  assert.equal(c.spa.A, 0)
})

test('computeCycle: personal no-class days come off the target', () => {
  const en = { cycle_started_at: '2026-10-01', cycle_days: 'Mon, Tue, Wed, Thu, Fri' }
  const base = computeCycle(en, sessions('2026-10-01', '2026-10-31'), new Map(), '', '2026-10-31')
  const withN = computeCycle(en, sessions('2026-10-01', '2026-10-31'), new Map(), '', '2026-10-31', new Set(['2026-10-05']))
  assert.equal(withN.target, base.target - 1)
})

test('computeCycle: Saturday revision only makes up missed weekday classes', () => {
  const en = { cycle_started_at: '2026-10-01', cycle_days: 'Mon, Tue, Wed, Thu, Fri' }
  const ss = sessions('2026-10-01', '2026-10-09')
  ss.push({ id: 'sat', session_date: '2026-10-03', is_holiday: false })
  const att = new Map()
  ss.filter(s => s.id !== 'sat').forEach(s => att.set(s.id, true))
  att.set(ss[0].id, false)               // one absence
  att.set('sat', true)                   // Saturday revision attended
  const c = computeCycle(en, ss, att, '', '2026-10-09')
  assert.equal(c.makeUp, 1)
  assert.equal(c.satRevision, true)
})

test('cycleAnchor: falls back to enrolled_at, then null', () => {
  assert.equal(cycleAnchor({ cycle_started_at: '2026-10-01T00:00:00Z' }), '2026-10-01')
  assert.equal(cycleAnchor({ enrolled_at: '2026-09-15T08:00:00Z' }), '2026-09-15')
  assert.equal(cycleAnchor({}), null)
})

test('renewalInfo: overdue / soon / ok', () => {
  const en = { cycle_started_at: '2026-10-01' }                       // due 2026-11-01
  assert.equal(renewalInfo(en, '2026-11-03').state, 'overdue')
  assert.equal(renewalInfo(en, '2026-10-28').state, 'soon')
  assert.equal(renewalInfo(en, '2026-10-10').state, 'ok')
})

test('attentionReasons: balance due and pending certificate are flagged', () => {
  const s = { fee_total: 5000, fee_paid: 2000, enrollments: [{ id: 'e1', completed_at: '2026-09-01' }] }
  const keys = attentionReasons(s, {}).map(r => r.key)
  assert.ok(keys.includes('balance'))
  assert.ok(keys.includes('cert_pending'))
})

test('buckets: completed / dropped / active; current vs past', () => {
  assert.equal(enrolmentBucket({ completed_at: '2026-01-01' }), 'completed')
  assert.equal(enrolmentBucket({ status: 'dropped' }), 'dropped')
  assert.equal(enrolmentBucket({}), 'active')
  assert.equal(studentBucket({ enrollments: [{ completed_at: 'x' }] }), 'past')
  assert.equal(studentBucket({ enrollments: [{}] }), 'current')
  assert.equal(certPending({ completed_at: 'x' }), true)
  assert.equal(certPending({ completed_at: 'x', cert_issued_at: 'y' }), false)
})
