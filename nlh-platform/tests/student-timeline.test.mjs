import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTimeline, timelineNow } from '../src/utils/studentTimeline.js'

const sku = (level) => ({ level_name: level, courses: { group_name: 'Phonics' } })

// Ayesha: admitted 5 Sep, Level 2 with Khushi's batch, moves up to Level 3 on 14 Oct (same CI), then to Sneha's batch on 20 Oct
const ctx = {
  student: { registered_at: '2026-09-05', closed_at: null },
  enrollments: [
    { id: 'e2', status: 'completed', enrolled_at: '2026-09-05', completed_at: '2026-10-14', fee_amount: 0, skus: sku('Level 2'), cert_issued_at: '2026-10-16T09:00:00Z' },
    { id: 'e3', status: 'active', enrolled_at: '2026-09-05', completed_at: null, fee_amount: 4000, skus: sku('Level 3') },
  ],
  memberships: [
    { enrollment_id: 'e3', assigned_at: '2026-09-08', removed_at: '2026-10-19', batch: { name: 'Tution 4.30 TO 5.30 PM' }, ci: 'Khushi' },
    { enrollment_id: 'e3', assigned_at: '2026-10-20', removed_at: null, batch: { name: 'Tuitions 4 to 5 PM' }, ci: 'Sneha' },
  ],
  classes: [
    { enrollment_id: 'e3', date: '2026-09-08', batch_name: 'Tution 4.30 TO 5.30 PM', ci: 'Khushi', substitute: false },
    { enrollment_id: 'e3', date: '2026-09-09', batch_name: 'Tution 4.30 TO 5.30 PM', ci: 'Khushi', substitute: false },
    { enrollment_id: 'e3', date: '2026-10-21', batch_name: 'Tuitions 4 to 5 PM', ci: 'Sneha', substitute: false },
    { enrollment_id: 'e3', date: '2026-10-22', batch_name: 'Tuitions 4 to 5 PM', ci: 'Other', substitute: true },
  ],
  payments: [{ paid_at: '2026-09-05', amount: 4000, receipt_no: 'R-1', mode: 'upi' }],
  feeEvents: [],
}

test('the timeline tells the child’s story in date order', () => {
  const t = buildTimeline(ctx)
  assert.deepEqual(t.map((x) => x.date), [...t.map((x) => x.date)].sort())
  const titles = t.map((x) => x.title)
  assert.ok(titles.includes('Admitted'))
  assert.ok(titles.includes('Enrolled in Phonics Level 3'))
  assert.ok(titles.some((x) => x.startsWith('Placed in Tution 4.30 TO 5.30 PM with Khushi')))
  assert.ok(titles.some((x) => x.startsWith('Moved to Tuitions 4 to 5 PM with Sneha')))
  assert.ok(titles.includes('Paid ₹4,000'))
})

test('a level finished by moving up is shown as finished, not as a separate enrolment', () => {
  const t = buildTimeline(ctx)
  const fin = t.find((x) => x.title === 'Finished Phonics Level 2')
  assert.ok(fin && fin.detail.includes('stayed the same'))
  assert.ok(!t.some((x) => x.title === 'Enrolled in Phonics Level 2'))
  assert.ok(t.some((x) => x.title === 'Certificate issued — Phonics Level 2' && x.date === '2026-10-16'))
})

test('each batch period says how many classes the child had and with whom, substitutes included', () => {
  const t = buildTimeline(ctx)
  const first = t.find((x) => x.title.startsWith('Placed in'))
  assert.ok(first.detail.includes('2 classes attended') && first.detail.includes('2 with Khushi'))
  const moved = t.find((x) => x.title.startsWith('Moved to'))
  assert.ok(moved.detail.includes('1 with Sneha') && moved.detail.includes('Other (substitute)'))
})

test('a batch the child moved out of is not reported as "left" — it is shown as a move; a plain exit is', () => {
  const t = buildTimeline(ctx)
  assert.ok(!t.some((x) => x.kind === 'batch_end'))
  const alone = buildTimeline({ ...ctx, memberships: [{ enrollment_id: 'e3', assigned_at: '2026-09-08', removed_at: '2026-10-19', batch: { name: 'B' }, ci: 'K' }] })
  assert.ok(alone.some((x) => x.kind === 'batch_end' && x.date === '2026-10-19'))
})

test('"now" says where the child is, or that no batch has been given', () => {
  assert.deepEqual(timelineNow(ctx), ['Phonics Level 3 · Tuitions 4 to 5 PM with Sneha'])
  assert.deepEqual(timelineNow({ ...ctx, memberships: [] }), ['Phonics Level 3 · no batch yet'])
  assert.deepEqual(timelineNow({ enrollments: [] }), [])
})

test('account closure and a discontinued course appear', () => {
  const t = buildTimeline({ student: { registered_at: '2026-01-01', closed_at: '2026-06-01T00:00:00Z', close_reason: 'Moved city' }, enrollments: [{ id: 'x', status: 'dropped', enrolled_at: '2026-01-02', completed_at: null, fee_amount: 100, skus: sku('Level 1') }], memberships: [], classes: [], payments: [], feeEvents: [] })
  assert.ok(t.some((x) => x.title === 'Account closed' && x.detail === 'Moved city'))
  assert.ok(t.some((x) => x.title === 'Phonics Level 1 discontinued'))
})
