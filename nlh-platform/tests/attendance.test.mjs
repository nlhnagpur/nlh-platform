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

// ── level change mid-cycle ────────────────────────────────────────────────
import { levelChangePatch, cycleInProgress } from '../src/utils/studentLifecycle.js'

test('levelChangePatch: default restarts the cycle on the chosen date', () => {
  assert.deepEqual(levelChangePatch('sku3', { startDate: '2026-10-13' }), { sku_id: 'sku3', cycle_started_at: '2026-10-13' })
})

test('levelChangePatch: keepCycle swaps only the level — cycle start and fee untouched', () => {
  const p = levelChangePatch('sku3', { keepCycle: true, startDate: '2026-10-13' })
  assert.deepEqual(p, { sku_id: 'sku3' })
  assert.equal('cycle_started_at' in p, false)
  assert.equal('fee_amount' in p, false)
})

test('cycleInProgress: monthly course renewed on the 9th is mid-cycle until the next 9th', () => {
  const en = { cycle_started_at: '2026-10-09', skus: { courses: { billing_type: 'monthly' } } }
  assert.equal(cycleInProgress(en, '2026-10-13'), true)
  assert.equal(cycleInProgress(en, '2026-11-08'), true)
  assert.equal(cycleInProgress(en, '2026-11-09'), false)   // due again
  assert.equal(cycleInProgress(en, '2026-10-08'), false)   // before it started
})

test('cycleInProgress: not for session-billed, completed or dropped enrolments', () => {
  const sess = { cycle_started_at: '2026-10-09', skus: { courses: { billing_type: 'session' } } }
  const done = { cycle_started_at: '2026-10-09', completed_at: '2026-10-10', skus: { courses: { billing_type: 'monthly' } } }
  const drop = { cycle_started_at: '2026-10-09', status: 'dropped', skus: { courses: { billing_type: 'monthly' } } }
  for (const e of [sess, done, drop]) assert.equal(cycleInProgress(e, '2026-10-13'), false)
})

// ── mid-cycle level change: fee and completed-level record ─────────────────
import { levelFeePatch, completedLevelRow } from '../src/utils/studentLifecycle.js'

test('levelFeePatch: sets only the enrolment fee fields; rejects negatives and junk', () => {
  assert.deepEqual(levelFeePatch('3500', 3500), { fee_amount: 3500, list_price: 3500 })
  assert.deepEqual(levelFeePatch(0, null), { fee_amount: 0 })
  assert.equal(levelFeePatch(-1, 3500), null)
  assert.equal(levelFeePatch('abc', 3500), null)
  assert.equal(levelFeePatch('', 3500), null)
  const p = levelFeePatch(3500, 3500)
  for (const k of ['fee_total', 'fee_paid', 'amount', 'total']) assert.equal(k in p, false)
})

test('completedLevelRow: a finished level carries a completion date and NO money', () => {
  const en = { sku_id: 'L2', enrolled_at: '2026-09-05T00:00:00+00:00', fee_amount: 4000, list_price: 3500, waived: 0 }
  const r = completedLevelRow(en, 'stu1', 'cen1', '2026-10-12')
  assert.equal(r.student_id, 'stu1')
  assert.equal(r.franchisee_id, 'cen1')
  assert.equal(r.sku_id, 'L2')
  assert.equal(r.status, 'completed')
  assert.equal(r.completed_at, '2026-10-12T12:00:00+00:00')
  assert.equal(r.enrolled_at, '2026-09-05T00:00:00+00:00')
  assert.equal(r.fee_amount, 0)
  assert.equal(r.list_price, 0)
  assert.equal(r.waived, 0)
  assert.equal('cycle_started_at' in r, false)
})

test('completedLevelRow: missing centre becomes null; missing enrolled_at falls back to the completion day', () => {
  const r = completedLevelRow({ sku_id: 'L2' }, 'stu1', undefined, '2026-10-12')
  assert.equal(r.franchisee_id, null)
  assert.equal(r.enrolled_at, '2026-10-12T00:00:00+00:00')
})

// ── per-level session counts after a level is carried on in place ──────────
import { levelSessionCounts, isFinishedLevelRecord } from '../src/utils/studentLifecycle.js'

const mk = (id, level, extra) => Object.assign({ id, skus: { level_name: level, courses: { group_name: 'Phonics' } }, fee_amount: 4000, list_price: 3500, waived: 0 }, extra || {})

test('isFinishedLevelRecord: completed, no money, no cycle', () => {
  assert.equal(isFinishedLevelRecord({ completed_at: '2026-10-14', fee_amount: 0, list_price: 0, waived: 0 }), true)
  assert.equal(isFinishedLevelRecord({ completed_at: '2026-10-14', fee_amount: 4000, list_price: 3500 }), false)   // a normal completed enrolment
  assert.equal(isFinishedLevelRecord({ fee_amount: 0, list_price: 0 }), false)                                    // not completed
  assert.equal(isFinishedLevelRecord({ completed_at: '2026-10-14', fee_amount: 0, list_price: 0, cycle_started_at: '2026-10-09' }), false)
})

test('levelSessionCounts: attended days are split at the finished level’s completion date', () => {
  const live = mk('live', 'Level 3', { cycle_started_at: '2026-10-09' })
  const rec = mk('rec', 'Level 2', { completed_at: '2026-10-14T12:00:00+00:00', fee_amount: 0, list_price: 0 })
  const dates = { live: ['2026-09-08', '2026-09-09', '2026-10-12', '2026-10-14', '2026-10-15', '2026-10-16'], rec: [] }
  const c = levelSessionCounts([live, rec], dates)
  assert.equal(c.rec, 4)     // on or before 14 Oct
  assert.equal(c.live, 2)    // 15 and 16 Oct
  assert.equal(c.rec + c.live, 6)   // nothing lost or double counted
})

test('levelSessionCounts: no finished-level record means counts are unchanged', () => {
  const live = mk('live', 'Level 3')
  const c = levelSessionCounts([live], { live: ['2026-10-01', '2026-10-02'] })
  assert.equal(c.live, 2)
})

test('levelSessionCounts: an enrolment with its own attendance is never re-split', () => {
  const live = mk('live', 'Level 3')
  const rec = mk('rec', 'Level 2', { completed_at: '2026-10-14T12:00:00+00:00', fee_amount: 0, list_price: 0 })
  const c = levelSessionCounts([live, rec], { live: ['2026-10-15'], rec: ['2026-09-10', '2026-09-11'] })
  assert.equal(c.rec, 2)
  assert.equal(c.live, 1)
})

test('levelSessionCounts: other courses are not touched', () => {
  const live = mk('live', 'Level 3')
  const other = { id: 'o', skus: { level_name: 'Junior', courses: { group_name: 'Write Well' } }, fee_amount: 3500, list_price: 3500 }
  const rec = mk('rec', 'Level 2', { completed_at: '2026-10-14T12:00:00+00:00', fee_amount: 0, list_price: 0 })
  const c = levelSessionCounts([live, other, rec], { live: ['2026-10-10', '2026-10-20'], o: ['2026-10-10'] })
  assert.equal(c.o, 1)
  assert.equal(c.rec, 1)
  assert.equal(c.live, 1)
})

test('levelFeePatch: the student’s own fee is kept — an unchanged fee writes nothing', () => {
  assert.deepEqual(levelFeePatch('4000', 3500, 4000), {})
  assert.deepEqual(levelFeePatch(4000, 3500, '4000'), {})
  assert.deepEqual(levelFeePatch(3500, 3500, 4000), { fee_amount: 3500, list_price: 3500 })   // only when deliberately changed
  assert.deepEqual(levelFeePatch(4000, 3500), { fee_amount: 4000, list_price: 3500 })         // no current fee supplied: behaves as before
})
