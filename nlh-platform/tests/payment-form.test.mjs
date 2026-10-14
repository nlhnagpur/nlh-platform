// Increment 2 — pure rules behind the shared payment form. These describe the
// FORM (mode lists, duplicate warning, quick fill); they contain no allocation
// or fee calculation, which is why they are safe to share across flows.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PAYMENT_MODES, paymentModes, findDuplicatePayment, isFutureDate, quickFillOptions,
  paymentDateOf, paymentModeOf,
} from '../src/utils/paymentForm.js'

test('every flow keeps its own stored mode values (each table has its own constraint)', () => {
  const values = f => PAYMENT_MODES[f].map(m => m[0])
  assert.deepEqual(values('student'), ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'online'])
  assert.deepEqual(values('order'), ['upi', 'neft', 'cash', 'cheque', 'other'])
  assert.ok(values('orderMulti').includes('razorpay'))
  assert.deepEqual(values('franchisee'), ['UPI', 'NEFT', 'RTGS', 'Cash', 'Cheque', 'DD'])
})

test('order modes are all within the order_payments CHECK constraint', () => {
  const allowed = ['upi', 'neft', 'cash', 'cheque', 'razorpay', 'other', 'credit_note']
  for (const f of ['order', 'orderMulti']) for (const [v] of PAYMENT_MODES[f]) assert.ok(allowed.includes(v), v)
})

test('student modes are all within the student_payments CHECK constraint', () => {
  const allowed = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'online', 'neft', 'razorpay', 'other', 'opening']
  for (const [v] of PAYMENT_MODES.student) assert.ok(allowed.includes(v), v)
})

test('paymentModes falls back to the student list for an unknown flow', () => {
  assert.equal(paymentModes('nope'), PAYMENT_MODES.student)
})

test('date/mode accessors read the three tables’ column names', () => {
  assert.equal(paymentDateOf({ paid_at: '2026-10-03T00:00:00Z' }), '2026-10-03')
  assert.equal(paymentDateOf({ paid_on: '2026-10-04' }), '2026-10-04')
  assert.equal(paymentDateOf({ payment_date: '2026-10-05' }), '2026-10-05')
  assert.equal(paymentModeOf({ payment_mode: 'UPI' }), 'upi')
  assert.equal(paymentModeOf({ mode: 'Cash' }), 'cash')
})

test('findDuplicatePayment: same amount + day + mode matches, anything else does not', () => {
  const existing = [
    { id: 1, amount: 2000, paid_at: '2026-10-03', mode: 'upi', receipt_no: 'ST-1' },
    { id: 2, amount: 500, paid_on: '2026-10-03', mode: 'cash' },
  ]
  assert.equal(findDuplicatePayment(existing, { amount: '2000', date: '2026-10-03', mode: 'UPI' }).id, 1)
  assert.equal(findDuplicatePayment(existing, { amount: 2000, date: '2026-10-04', mode: 'upi' }), null)
  assert.equal(findDuplicatePayment(existing, { amount: 2000, date: '2026-10-03', mode: 'cash' }), null)
  assert.equal(findDuplicatePayment(existing, { amount: 1999, date: '2026-10-03', mode: 'upi' }), null)
  assert.equal(findDuplicatePayment(existing, { amount: 500, date: '2026-10-03', mode: 'cash' }).id, 2)
})

test('findDuplicatePayment: empty/zero input and empty list never match', () => {
  assert.equal(findDuplicatePayment([], { amount: 100, date: '2026-10-03', mode: 'upi' }), null)
  assert.equal(findDuplicatePayment(null, { amount: 100, date: '2026-10-03', mode: 'upi' }), null)
  assert.equal(findDuplicatePayment([{ amount: 0, paid_at: '', mode: '' }], { amount: 0, date: '', mode: '' }), null)
})

test('isFutureDate', () => {
  assert.equal(isFutureDate('2026-10-15', '2026-10-14'), true)
  assert.equal(isFutureDate('2026-10-14', '2026-10-14'), false)
  assert.equal(isFutureDate('2026-10-01', '2026-10-14'), false)
  assert.equal(isFutureDate('', '2026-10-14'), false)
})

test('quickFillOptions: full and half of the balance; none when nothing is owed', () => {
  assert.deepEqual(quickFillOptions(3500).map(o => [o.key, o.amount]), [['full', 3500], ['half', 1750]])
  assert.deepEqual(quickFillOptions(1).map(o => o.key), ['full'])
  assert.deepEqual(quickFillOptions(0), [])
  assert.deepEqual(quickFillOptions(-5), [])
  assert.deepEqual(quickFillOptions(null), [])
  assert.equal(quickFillOptions(2501)[1].amount, 1251)   // rounds, never exceeds the balance
})

test('quick fill matches the original order-form maths (Full = balance, Half = round(balance / 2))', () => {
  for (let b = 2; b <= 3000; b++) {
    const q = quickFillOptions(b)
    assert.equal(q[0].amount, b, 'full ' + b)
    assert.equal(q[1].amount, Math.round(b / 2), 'half ' + b)
    assert.ok(q[1].amount <= b)
  }
})

test('quick fill never offers more than the balance, for any balance', () => {
  for (const b of [1, 2, 3, 99, 100, 101, 12345, 250000]) {
    for (const o of quickFillOptions(b)) assert.ok(o.amount > 0 && o.amount <= b, b + ':' + o.key)
  }
})
