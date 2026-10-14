// Synthetic dataset for the isolated database environment (Phase 2, Stage 0).
//
// EVERYTHING HERE IS FICTIONAL. Names, phones and e-mails are placeholders
// (`SYN …`, 000000000x, @example.invalid). No production record was copied.
//
// This module is plain data: it opens no connection and reads no environment
// variable. It is consumed by
//   - tests/synthetic-fixture.test.mjs  (arithmetic / engine consistency, local)
//   - tests/fixtures/build-seed-sql.mjs (writes docs/phase-2/stage-0/synthetic_seed.sql)
//
// Amounts are whole rupees (integers), as in the real schema.

function id(kind, n) {
  return '00000000-0000-4000-8000-' + kind + String(n).padStart(8, '0')
}
const K = { franchisee: '0001', course: '0002', sku: '0003', student: '0004', enrolment: '0005', invoice: '0006', payment: '0007' }

export const centres = [
  { key: 'C1', tier: 'SMF', parent: null, name: 'SYN State Office Maharashtra', city: 'Mumbai', state: 'Maharashtra' },
  { key: 'C2', tier: 'CF', parent: 'C1', name: 'SYN City Franchise Nagpur', city: 'Nagpur', state: 'Maharashtra' },
  { key: 'C3', tier: 'UF', parent: 'C2', name: 'SYN Unit Nagpur A', city: 'Nagpur', state: 'Maharashtra' },
  { key: 'C4', tier: 'UF', parent: 'C2', name: 'SYN Unit Nagpur B', city: 'Nagpur', state: 'Maharashtra' },
  { key: 'C5', tier: 'CF', parent: 'C1', name: 'SYN City Franchise Pune', city: 'Pune', state: 'Maharashtra' },
  { key: 'C6', tier: 'UF', parent: 'C5', name: 'SYN Unit Pune A', city: 'Pune', state: 'Maharashtra' },
].map(function (c, i) { return Object.assign({}, c, { id: id(K.franchisee, i + 1), phone: '000000000' + (i + 1), email: 'syn-centre-' + (i + 1) + '@example.invalid' }) })

export const courses = [
  { key: 'ABACUS', name: 'SYN Abacus', billing: 'session' },
  { key: 'HAND', name: 'SYN Handwriting', billing: 'monthly' },
  { key: 'PHON', name: 'SYN Phonics', billing: 'session' },
].map(function (c, i) { return Object.assign({}, c, { id: id(K.course, i + 1) }) })

export const skus = [
  { key: 'ABACUS_L1', course: 'ABACUS', level: 'Level 1', fee: 6000, sessions: 24 },
  { key: 'ABACUS_L2', course: 'ABACUS', level: 'Level 2', fee: 6000, sessions: 24 },
  { key: 'HAND_M', course: 'HAND', level: 'Monthly', fee: 1500, sessions: null },
  { key: 'PHON_L1', course: 'PHON', level: 'Level 1', fee: 4000, sessions: 16 },
].map(function (s, i) { return Object.assign({}, s, { id: id(K.sku, i + 1) }) })

// One entry per scenario. `after` steps run once the payments are in, in order.
//   enrol:    { sku, fee, list, waived?, status?, start }
//   invoices: { date, enrol: [indexes into enrol], discount?, cycle?, period? }
//   payments: { amount, paid_at, mode }
//   after:    { op: 'fee_total'|'student'|'enrolment'|'invoice'|'addEnrolment'|'payment', ... }
//   expect:   what the DB must hold once the seed has run
const raw = [
  { key: 'S01', scenario: 'Full payment, single course, single invoice', centre: 'C3',
    fee_total: 6000,
    enrol: [{ sku: 'ABACUS_L1', fee: 6000, list: 6000, start: '2026-09-01' }],
    invoices: [{ date: '2026-09-01', enrol: [0] }],
    payments: [{ amount: 6000, paid_at: '2026-09-01', mode: 'cash' }],
    expect: { fee_total: 6000, fee_paid: 6000, status: 'paid' } },

  { key: 'S02', scenario: 'Partial payment, single invoice', centre: 'C3',
    fee_total: 6000,
    enrol: [{ sku: 'ABACUS_L1', fee: 6000, list: 6000, start: '2026-09-01' }],
    invoices: [{ date: '2026-09-01', enrol: [0] }],
    payments: [{ amount: 2500, paid_at: '2026-09-02', mode: 'upi' }],
    expect: { fee_total: 6000, fee_paid: 2500, status: 'partial' } },

  { key: 'S03', scenario: 'Multiple payments against one invoice, ends fully paid', centre: 'C3',
    fee_total: 6000,
    enrol: [{ sku: 'ABACUS_L1', fee: 6000, list: 6000, start: '2026-08-15' }],
    invoices: [{ date: '2026-08-15', enrol: [0] }],
    payments: [
      { amount: 2000, paid_at: '2026-08-15', mode: 'cash' },
      { amount: 2000, paid_at: '2026-09-15', mode: 'upi' },
      { amount: 2000, paid_at: '2026-10-01', mode: 'cash' },
    ],
    expect: { fee_total: 6000, fee_paid: 6000, status: 'paid' } },

  { key: 'S04', scenario: 'Two courses on ONE invoice, payment covers part', centre: 'C4',
    fee_total: 10000,
    enrol: [
      { sku: 'ABACUS_L1', fee: 6000, list: 6000, start: '2026-09-01' },
      { sku: 'PHON_L1', fee: 4000, list: 4000, start: '2026-09-01' },
    ],
    invoices: [{ date: '2026-09-01', enrol: [0, 1] }],
    payments: [{ amount: 7000, paid_at: '2026-09-03', mode: 'upi' }],
    expect: { fee_total: 10000, fee_paid: 7000, status: 'partial' } },

  { key: 'S05', scenario: 'Second course added later with its own invoice (fee_total raised)', centre: 'C4',
    fee_total: 6000,
    enrol: [{ sku: 'ABACUS_L1', fee: 6000, list: 6000, start: '2026-09-01' }],
    invoices: [{ date: '2026-09-01', enrol: [0] }],
    payments: [{ amount: 6000, paid_at: '2026-09-10', mode: 'cash' }],
    after: [
      { op: 'addEnrolment', enrol: { sku: 'PHON_L1', fee: 4000, list: 4000, start: '2026-10-01' } },
      { op: 'fee_total', value: 10000 },
      { op: 'invoice', date: '2026-10-01', enrol: [1] },
    ],
    expect: { fee_total: 10000, fee_paid: 6000, status: 'partial' } },

  { key: 'S06', scenario: 'Admission discount (list 6000, charged 5000), paid in full', centre: 'C3',
    fee_total: 5000, discount_amount: 1000,
    enrol: [{ sku: 'ABACUS_L1', fee: 6000, list: 6000, start: '2026-09-05' }],
    invoices: [{ date: '2026-09-05', enrol: [0], discount: 1000 }],
    payments: [{ amount: 5000, paid_at: '2026-09-05', mode: 'upi' }],
    expect: { fee_total: 5000, fee_paid: 5000, status: 'paid' } },

  { key: 'S07', scenario: 'Waiver: second course discontinued, fee reduced, part paid', centre: 'C4',
    fee_total: 10000,
    enrol: [
      { sku: 'ABACUS_L1', fee: 6000, list: 6000, start: '2026-09-01' },
      { sku: 'PHON_L1', fee: 4000, list: 4000, start: '2026-09-01' },
    ],
    invoices: [{ date: '2026-09-01', enrol: [0, 1] }],
    payments: [{ amount: 3000, paid_at: '2026-09-02', mode: 'cash' }],
    after: [
      { op: 'enrolment', index: 1, set: { status: 'dropped', fee_amount: 0, waived: 4000 } },
      { op: 'student', set: { fee_total: 6000, waived_amount: 4000 } },
    ],
    expect: { fee_total: 6000, fee_paid: 3000, status: 'partial' } },

  { key: 'S08', scenario: 'Monthly course: enrolment + two renewals, each invoiced', centre: 'C3',
    fee_total: 1500,
    enrol: [{ sku: 'HAND_M', fee: 1500, list: 1500, start: '2026-08-01', cycle: '2026-10-01' }],
    invoices: [{ date: '2026-08-01', enrol: [0] }],
    payments: [{ amount: 1500, paid_at: '2026-08-01', mode: 'cash' }],
    after: [
      { op: 'fee_total', value: 3000 },
      { op: 'invoice', date: '2026-09-01', enrol: [0], cycle: 'renewal', period: '2026-09-01' },
      { op: 'payment', amount: 1500, paid_at: '2026-09-01', mode: 'cash' },
      { op: 'fee_total', value: 4500 },
      { op: 'invoice', date: '2026-10-01', enrol: [0], cycle: 'renewal', period: '2026-10-01' },
    ],
    expect: { fee_total: 4500, fee_paid: 3000, status: 'partial' } },

  { key: 'S09', scenario: 'Additional (un-invoiced) charge on top of an invoiced course', centre: 'C3',
    fee_total: 8000, other_charges: 2000,
    enrol: [{ sku: 'ABACUS_L1', fee: 6000, list: 6000, start: '2026-09-01' }],
    invoices: [{ date: '2026-09-01', enrol: [0] }],
    payments: [{ amount: 2000, paid_at: '2026-09-02', mode: 'cash' }],
    expect: { fee_total: 8000, fee_paid: 2000, status: 'partial' },
    note: 'Engine divergence case (finding F1): course view vs invoice view' },

  { key: 'S10', scenario: 'Legacy opening balance, no invoice at all', centre: 'C4',
    fee_total: 3000,
    enrol: [{ sku: 'ABACUS_L1', fee: 3000, list: 6000, start: '2026-06-01' }],
    invoices: [],
    payments: [{ amount: 1000, paid_at: '2026-06-01', mode: 'opening' }],
    expect: { fee_total: 3000, fee_paid: 1000, status: 'partial' } },

  { key: 'S11', scenario: 'Fully paid — a DUPLICATE payment must be rejected', centre: 'C3',
    fee_total: 4000,
    enrol: [{ sku: 'PHON_L1', fee: 4000, list: 4000, start: '2026-09-01' }],
    invoices: [{ date: '2026-09-01', enrol: [0] }],
    payments: [{ amount: 4000, paid_at: '2026-09-01', mode: 'upi' }],
    expect: { fee_total: 4000, fee_paid: 4000, status: 'paid' },
    negativeTest: 'insert a second 4000 payment same day/mode -> must be rejected by the cap' },

  { key: 'S12', scenario: 'Two CONCURRENT payments at the cap', centre: 'C4',
    fee_total: 6000,
    enrol: [{ sku: 'ABACUS_L1', fee: 6000, list: 6000, start: '2026-09-01' }],
    invoices: [{ date: '2026-09-01', enrol: [0] }],
    payments: [{ amount: 3000, paid_at: '2026-09-02', mode: 'cash' }],
    expect: { fee_total: 6000, fee_paid: 3000, status: 'partial' },
    concurrentTest: 'two sessions each insert 3000 at once -> exactly one may succeed' },

  { key: 'S13', scenario: 'Zero-fee (scholarship) enrolment', centre: 'C3',
    fee_total: 0,
    enrol: [{ sku: 'ABACUS_L1', fee: 0, list: 6000, waived: 6000, start: '2026-09-01' }],
    invoices: [],
    payments: [],
    expect: { fee_total: 0, fee_paid: 0, status: 'none' },
    negativeTest: 'insert a 100 payment -> today the cap is skipped when fee_total = 0 (finding F5)' },

  { key: 'S14', scenario: 'Student at a different centre (cross-centre / RLS tests)', centre: 'C6',
    fee_total: 6000,
    enrol: [{ sku: 'ABACUS_L1', fee: 6000, list: 6000, start: '2026-09-01' }],
    invoices: [{ date: '2026-09-01', enrol: [0] }],
    payments: [{ amount: 4000, paid_at: '2026-09-04', mode: 'upi' }],
    expect: { fee_total: 6000, fee_paid: 4000, status: 'partial' } },

  { key: 'S15', scenario: 'Closed / withdrawn account with a balance', centre: 'C3', is_active: false,
    fee_total: 6000,
    enrol: [{ sku: 'ABACUS_L1', fee: 6000, list: 6000, status: 'dropped', start: '2026-07-01' }],
    invoices: [{ date: '2026-07-01', enrol: [0] }],
    payments: [{ amount: 1500, paid_at: '2026-07-02', mode: 'cash' }],
    expect: { fee_total: 6000, fee_paid: 1500, status: 'pending-or-partial (trigger leaves status for inactive)' } },

  { key: 'S16', scenario: 'Fee reduced BELOW what was already paid (finding F4)', centre: 'C4',
    fee_total: 6000,
    enrol: [{ sku: 'ABACUS_L1', fee: 6000, list: 6000, start: '2026-09-01' }],
    invoices: [{ date: '2026-09-01', enrol: [0] }],
    payments: [{ amount: 4000, paid_at: '2026-09-02', mode: 'cash' }],
    after: [{ op: 'fee_total', value: 3000 }],
    expect: { fee_total: 3000, fee_paid: 4000, status: 'paid (overpaid by 1000)' } },

  { key: 'S17', scenario: 'Manual downward adjustment of the fee (-500)', centre: 'C6',
    fee_total: 6000,
    enrol: [{ sku: 'ABACUS_L1', fee: 6000, list: 6000, start: '2026-09-01' }],
    invoices: [{ date: '2026-09-01', enrol: [0] }],
    payments: [{ amount: 2000, paid_at: '2026-09-03', mode: 'cash' }],
    after: [{ op: 'fee_total', value: 5500 }],
    expect: { fee_total: 5500, fee_paid: 2000, status: 'partial' } },
]

export const students = raw.map(function (s, i) {
  const centre = centres.find(function (c) { return c.key === s.centre })
  return Object.assign({
    is_active: true, discount_amount: 0, other_charges: 0,
    id: id(K.student, i + 1),
    full_name: 'SYN Student ' + s.key,
    parent_name: 'SYN Parent ' + s.key,
    phone: '000000' + String(1000 + i + 1),
    email: 'syn-' + s.key.toLowerCase() + '@example.invalid',
    centreId: centre.id,
    invoices: [], payments: [], after: [],
  }, s)
})

export function enrolmentId(studentIdx, enrolIdx) { return id(K.enrolment, (studentIdx + 1) * 10 + enrolIdx + 1) }
export function invoiceId(studentIdx, invIdx) { return id(K.invoice, (studentIdx + 1) * 10 + invIdx + 1) }
export function paymentId(studentIdx, payIdx) { return id(K.payment, (studentIdx + 1) * 10 + payIdx + 1) }

// Scenarios that are NOT representable in the current schema.
export const notRepresentable = [
  { key: 'REFUND', reason: 'No refund / credit-note table exists for student fees. A refund cannot be recorded; a payment cannot be negative (CHECK amount > 0).' },
  { key: 'VOID_RECEIPT', reason: 'Payments can only be deleted; there is no void state or reason log.' },
]

// Every payment of a scenario in insertion order (initial + any 'payment' step).
export function allPayments(st) {
  return st.payments.concat(st.after.filter(function (a) { return a.op === 'payment' }))
}
