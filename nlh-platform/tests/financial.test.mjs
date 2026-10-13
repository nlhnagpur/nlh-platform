// Phase 1 regression baseline — student financial calculations.
// Synthetic data only. No network, no Supabase, no real student records.
// These are CHARACTERISATION tests: they pin what the code does today so a
// later change that alters a figure is noticed. Where today's behaviour is a
// known inconsistency it is labelled "KNOWN DIVERGENCE" — the assertion records
// the current behaviour, not the desired one.
import test from 'node:test'
import assert from 'node:assert/strict'

import { deriveStatus, computeCoverage } from '../src/utils/feeCoverage.js'
import { invoiceSettlement } from '../src/utils/invoiceSettlement.js'
import { buildFeeStatement, receiptPreview, allocateReceipt, paymentsUpTo } from '../src/utils/feeStatement.js'

// ── deriveStatus ────────────────────────────────────────────────────────────
test('deriveStatus: none / pending / partial / paid', () => {
  assert.equal(deriveStatus(0, 0), 'none')
  assert.equal(deriveStatus(5000, 0), 'pending')
  assert.equal(deriveStatus(5000, 2000), 'partial')
  assert.equal(deriveStatus(5000, 5000), 'paid')
  assert.equal(deriveStatus(5000, 6000), 'paid')          // overpayment still reads "paid"
})

test('deriveStatus: non-numeric input is treated as zero', () => {
  assert.equal(deriveStatus(null, null), 'none')
  assert.equal(deriveStatus('abc', 100), 'none')
  assert.equal(deriveStatus(1000, undefined), 'pending')
})

// ── computeCoverage ─────────────────────────────────────────────────────────
const enr = (id, fee, at, extra) => Object.assign({ id, fee_amount: fee, enrolled_at: at, list_price: fee }, extra || {})

test('computeCoverage: payments settle courses oldest-first', () => {
  const r = computeCoverage([enr('b', 3000, '2026-02-01'), enr('a', 5000, '2026-01-01')], [{ amount: 6000 }], 8000, 0)
  assert.equal(r.perId.a.paid, 5000)
  assert.equal(r.perId.a.due, 0)
  assert.equal(r.perId.b.paid, 1000)
  assert.equal(r.perId.b.due, 2000)
  assert.equal(r.activeOutstanding, 2000)
})

test('computeCoverage: fee_total below course sum is treated as a discount', () => {
  const r = computeCoverage([enr('a', 5000, '2026-01-01')], [], 4000, 0)
  assert.equal(r.discount, 1000)
  // the discount is credited to the pool, so the course shows 1000 covered
  assert.equal(r.perId.a.paid, 1000)
  assert.equal(r.perId.a.due, 4000)
})

test('computeCoverage: dropped course is excluded from outstanding', () => {
  const r = computeCoverage([enr('a', 5000, '2026-01-01', { status: 'dropped' })], [], 5000, 0)
  assert.equal(r.perId.a.dropped, true)
  assert.equal(r.activeOutstanding, 0)
})

test('computeCoverage: other charges are settled after courses', () => {
  const r = computeCoverage([enr('a', 5000, '2026-01-01')], [{ amount: 5500 }], 7000, 2000)
  assert.equal(r.perId.a.due, 0)
  assert.deepEqual(r.other, { fee: 2000, paid: 500, due: 1500 })
  assert.equal(r.activeOutstanding, 1500)
})

// ── invoiceSettlement ───────────────────────────────────────────────────────
const inv = (id, date, total, extra) => Object.assign({ id, invoice_date: date, created_at: date + 'T10:00:00Z', total, status: 'open' }, extra || {})

test('invoiceSettlement: payments apply to oldest invoice first', () => {
  const r = invoiceSettlement([inv('i2', '2026-02-01', 3000), inv('i1', '2026-01-01', 5000)], 8000, 6000)
  assert.deepEqual(r.i1, { paid: 5000, due: 0, status: 'paid' })
  assert.deepEqual(r.i2, { paid: 1000, due: 2000, status: 'part' })
})

test('invoiceSettlement: cancelled invoices are ignored', () => {
  const r = invoiceSettlement([inv('i1', '2026-01-01', 5000, { status: 'cancelled' })], 0, 0)
  assert.deepEqual(r, {})
})

test('invoiceSettlement: discount (invoices > fee_total) counts as settled', () => {
  const r = invoiceSettlement([inv('i1', '2026-01-01', 5000)], 4000, 0)
  assert.deepEqual(r.i1, { paid: 1000, due: 4000, status: 'part' })
})

test('KNOWN DIVERGENCE: invoiceSettlement vs computeCoverage when part of the fee is not invoiced', () => {
  // Student owes 5000 course fee (invoiced) + 2000 other charge (not invoiced); paid 2000.
  const settle = invoiceSettlement([inv('i1', '2026-01-01', 5000)], 7000, 2000)
  const cover = computeCoverage([enr('a', 5000, '2026-01-01', { invoice: 'i1' })], [{ amount: 2000 }], 7000, 2000)
  // invoice view: the un-invoiced 2000 soaks the payment up first -> invoice untouched
  assert.equal(settle.i1.due, 5000)
  // course view: payment goes to the course first -> course shows 3000 due
  assert.equal(cover.perId.a.due, 3000)
  // Same student, same money, two different "amount due on the course" answers.
  assert.notEqual(settle.i1.due, cover.perId.a.due)
})

// ── buildFeeStatement / receiptPreview / allocateReceipt ───────────────────
function sampleStatement() {
  return buildFeeStatement({
    asOfDate: '2026-03-01',
    feeTotalNow: 8000,
    events: [],
    enrollments: [],
    invoices: [
      { id: 'i1', invoice_no: 'SINV-2026-0001', invoice_date: '2026-01-05', created_at: '2026-01-05T09:00:00Z', total: 5000,
        items: [{ kind: 'course', name: 'Abacus — L1', amount: 5000 }] },
      { id: 'i2', invoice_no: 'SINV-2026-0002', invoice_date: '2026-01-05', created_at: '2026-01-05T09:00:30Z', total: 3000,
        items: [{ kind: 'course', name: 'Handwriting — L1', amount: 3000 }] },
    ],
  })
}

test('buildFeeStatement: opening lines come from invoices and total equals fee_total', () => {
  const st = sampleStatement()
  assert.equal(st.total, 8000)
  assert.equal(st.lines.length, 2)
  assert.equal(st.lines.reduce((s, l) => s + l.amount, 0), 8000)
})

test('buildFeeStatement: uninvoiced remainder is shown as an "other" line, never hidden', () => {
  const st = buildFeeStatement({ asOfDate: '2026-03-01', feeTotalNow: 9000, events: [], enrollments: [],
    invoices: [{ id: 'i1', created_at: '2026-01-05T09:00:00Z', total: 5000, items: [{ kind: 'course', name: 'Abacus', amount: 5000 }] }] })
  assert.equal(st.total, 9000)
  const other = st.lines.find(l => l.kind === 'other')
  assert.ok(other)
  assert.equal(other.amount, 4000)
})

test('buildFeeStatement: returns null when the log cannot be reconciled (opening < 0)', () => {
  const st = buildFeeStatement({ asOfDate: '2026-03-01', feeTotalNow: 100, enrollments: [], invoices: [],
    events: [{ field: 'fee_total', delta: 500, at: '2026-02-01T00:00:00Z', old_value: null }] })
  assert.equal(st, null)
})

test('receiptPreview: applied amounts + advance equal the receipt amount', () => {
  const st = sampleStatement()
  const p = receiptPreview({ lines: st.lines, payments: [{ amount: 2000, paid_at: '2026-01-10' }], amount: 4000 })
  const applied = p.rows.reduce((s, r) => s + r.applied, 0)
  assert.equal(applied + p.advance, 4000)
  assert.equal(p.total, 8000)
  assert.equal(p.paid, 2000)
})

test('receiptPreview: an over-payment becomes advance, not a negative balance', () => {
  const st = sampleStatement()
  const p = receiptPreview({ lines: st.lines, payments: [], amount: 9000 })
  assert.equal(p.advance, 1000)
  assert.equal(p.balance, 8000)           // balance is "before this receipt"
})

test('allocateReceipt: rows sum to the payment amount', () => {
  const st = sampleStatement()
  const pays = paymentsUpTo([
    { id: 'p1', paid_at: '2026-01-10', amount: 2000, receipt_no: 'ST-X-2026-0001', created_at: '2026-01-10T10:00:00Z' },
    { id: 'p2', paid_at: '2026-02-10', amount: 4500, receipt_no: 'ST-X-2026-0002', created_at: '2026-02-10T10:00:00Z' },
  ], { id: 'p2', paid_at: '2026-02-10' })
  const out = allocateReceipt({ lines: st.lines, payments: pays, enrollments: [] })
  assert.equal(out.rows.reduce((s, r) => s + r.amount, 0), 4500)
})

test('paymentsUpTo: excludes later payments and flags the current one', () => {
  const r = paymentsUpTo([
    { id: 'a', paid_at: '2026-03-01', amount: 100 },
    { id: 'b', paid_at: '2026-01-01', amount: 200 },
    { id: 'c', paid_at: '2026-02-01', amount: 300 },
  ], { id: 'c', paid_at: '2026-02-01' })
  assert.deepEqual(r.map(x => x.amount), [200, 300])
  assert.equal(r[1].current, true)
})
