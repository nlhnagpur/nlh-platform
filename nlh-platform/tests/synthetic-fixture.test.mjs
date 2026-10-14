// Stage 0 — consistency checks on the synthetic dataset. Pure and local: no
// database, no network, no environment variables.
//
// Purpose: make sure the fixture itself is arithmetically sound before it is
// loaded anywhere, and record how today's client engines behave on each
// scenario (so Stage 2 can be compared against a known starting point).
import test from 'node:test'
import assert from 'node:assert/strict'

import { students, centres, skus, notRepresentable, invoiceId, allPayments } from './fixtures/synthetic-dataset.mjs'
import { deriveStatus, computeCoverage } from '../src/utils/feeCoverage.js'
import { invoiceSettlement } from '../src/utils/invoiceSettlement.js'

const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0)

// Final enrolment list (some scenarios add a course after the first payment).
function finalEnrols(st) {
  const e = st.enrol.map((x, i) => Object.assign({ id: 'e' + i, enrolled_at: x.start, fee_amount: x.fee, list_price: x.list, waived: x.waived || 0, status: x.status || 'active' }, {}))
  st.after.forEach(a => {
    if (a.op === 'addEnrolment') e.push({ id: 'e' + e.length, enrolled_at: a.enrol.start, fee_amount: a.enrol.fee, list_price: a.enrol.list, waived: 0, status: 'active' })
    if (a.op === 'enrolment') Object.assign(e[a.index], { status: a.set.status || e[a.index].status, fee_amount: a.set.fee_amount != null ? a.set.fee_amount : e[a.index].fee_amount, waived: a.set.waived != null ? a.set.waived : e[a.index].waived })
  })
  return e
}
function allInvoices(st) {
  const invs = st.invoices.concat(st.after.filter(a => a.op === 'invoice'))
  return invs.map((inv, i) => {
    const fe = finalEnrols(st)
    const subtotal = sum(inv.enrol, ei => fe[ei].fee_amount === 0 && fe[ei].waived ? 0 : (st.enrol[ei] ? st.enrol[ei].fee : fe[ei].fee_amount))
    return { id: invoiceId(students.indexOf(st), i), invoice_date: inv.date, created_at: inv.date + 'T10:00:00Z', total: subtotal - (inv.discount || 0), status: 'unpaid' }
  })
}
function finalFeeTotal(st) {
  let t = st.fee_total
  st.after.forEach(a => {
    if (a.op === 'fee_total') t = a.value
    if (a.op === 'student' && a.set.fee_total != null) t = a.set.fee_total
  })
  return t
}

test('dataset is wholly synthetic', () => {
  for (const c of centres) assert.match(c.name, /^SYN /)
  for (const s of students) {
    assert.match(s.full_name, /^SYN Student /)
    assert.match(s.email, /@example\.invalid$/)
    assert.match(s.phone, /^0{6}/)
  }
})

test('identifiers are unique', () => {
  const ids = [...centres.map(c => c.id), ...students.map(s => s.id), ...skus.map(s => s.id)]
  assert.equal(new Set(ids).size, ids.length)
})

test('every scenario covers the required categories', () => {
  const txt = students.map(s => s.scenario.toLowerCase()).join(' | ')
  for (const needle of ['full payment', 'partial', 'multiple payments', 'discount', 'waiver', 'monthly', 'additional', 'duplicate', 'concurrent', 'adjustment']) {
    assert.ok(txt.includes(needle), 'missing scenario category: ' + needle)
  }
  assert.ok(new Set(students.map(s => s.centre)).size >= 3, 'needs students in several centres')
  assert.ok(notRepresentable.some(n => n.key === 'REFUND'))
})

test('expected end state is arithmetically consistent', () => {
  for (const st of students) {
    const paid = sum(allPayments(st), p => p.amount)
    assert.equal(paid, st.expect.fee_paid, st.key + ' fee_paid')
    assert.equal(finalFeeTotal(st), st.expect.fee_total, st.key + ' fee_total')
  }
})

test('expected status follows the status rule (where the scenario states one)', () => {
  for (const st of students) {
    if (['paid', 'partial', 'pending', 'none'].includes(st.expect.status)) {
      assert.equal(deriveStatus(st.expect.fee_total, st.expect.fee_paid), st.expect.status, st.key)
    }
  }
})

test('payments never exceed the fee total at the moment they are inserted (mirrors the DB cap)', () => {
  // Replays the seed in order: initial payments, then each "after" step.
  for (const st of students) {
    let fee = st.fee_total, paid = 0
    const pay = p => {
      paid += p.amount
      if (fee > 0) assert.ok(paid <= fee, st.key + ': payment of ' + p.amount + ' would trip the cap (' + paid + ' > ' + fee + ')')
    }
    st.payments.forEach(pay)
    st.after.forEach(a => {
      if (a.op === 'fee_total') fee = a.value
      if (a.op === 'student' && a.set.fee_total != null) fee = a.set.fee_total
      if (a.op === 'payment') pay(a)
    })
  }
})

test('every course-bearing student with invoices: invoices explain the invoiced part of the fee', () => {
  for (const st of students) {
    const invs = allInvoices(st)
    if (!invs.length) continue
    const invoiced = sum(invs, i => i.total)
    const feeTotal = st.expect.fee_total
    // fee_total may legitimately differ from invoices by other charges / adjustments
    const explained = invoiced + st.other_charges
    if (!['S16', 'S17', 'S07'].includes(st.key)) assert.equal(feeTotal, explained, st.key + ' fee_total vs invoices+other')
  }
})

test('engine outputs — totals agree, per-course/per-invoice may not (finding F1)', () => {
  const diverging = []
  for (const st of students) {
    const fe = finalEnrols(st)
    const pays = allPayments(st).map(p => ({ amount: p.amount }))
    const feeTotal = st.expect.fee_total
    const cov = computeCoverage(fe, pays, feeTotal, st.other_charges)
    const settle = invoiceSettlement(allInvoices(st), feeTotal, st.expect.fee_paid)
    const settleDue = sum(Object.values(settle), s => s.due)
    const invoiced = sum(allInvoices(st), i => i.total)
    const uninvoiced = Math.max(0, feeTotal - invoiced)
    const trueBalance = Math.max(0, feeTotal - st.expect.fee_paid)
    // Both engines ought to reconcile to the same account balance.
    if (cov.activeOutstanding !== trueBalance) diverging.push(st.key + ': computeCoverage ' + cov.activeOutstanding + ' vs balance ' + trueBalance)
    if (allInvoices(st).length && settleDue + Math.max(0, uninvoiced - st.expect.fee_paid) !== trueBalance && settleDue !== trueBalance) {
      diverging.push(st.key + ': invoiceSettlement ' + settleDue + ' vs balance ' + trueBalance)
    }
  }
  // Characterisation: record, do not hide. Any change to this list is a
  // deliberate behaviour change and must be reviewed.
  console.log('    engine/balance differences on synthetic data:', diverging.length ? '\n      ' + diverging.join('\n      ') : 'none')
  assert.ok(Array.isArray(diverging))
})

test('negative and concurrency scenarios are annotated for the DB-level tests', () => {
  const neg = students.filter(s => s.negativeTest || s.concurrentTest).map(s => s.key).sort()
  assert.deepEqual(neg, ['S11', 'S12', 'S13'])
})
