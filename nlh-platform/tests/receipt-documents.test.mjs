// Increment 2 — the four receipt documents share ONE layout (renderReceipt).
// Characterisation + consistency tests on synthetic data: they assert what is
// printed (figures, labels, party) and that the four documents agree on the
// structure. Rendering uses ctx.asHtml, so no DOM or print dialog is involved.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  printStudentReceipt, printOrderReceipt, printCombinedOrderReceipt, printFranchiseeReceipt,
} from '../src/components/studentDocs.js'

const student = { full_name: 'SYN Student S09', parent_name: 'SYN Parent S09', phone: '0000001009', email: 'syn@example.invalid', address: 'SYN Address' }
const fr = { business_name: 'SYN Unit Nagpur A', tier: 'UF', owner_name: 'SYN Owner', city: 'Nagpur', phone: '0000000003', email: 'syn@example.invalid', centre_code: 'NGP01' }

const stuPay = { receipt_no: 'ST-NGP01-2026-0007', amount: 2000, mode: 'upi', reference: 'UTR123', paid_at: '2026-10-03', receipt_date: '2026-10-05' }
const order = { invoice_no: 'INV-2026-0014', order_ref: 'ORD-2026-0014', grand_total: 12000, amount_paid: 12000, placer: fr }
const ordPay = { receipt_no: 'OR-HO-2026-0019', amount: 12000, mode: 'neft', reference: 'N1234', paid_on: '2026-09-30', receipt_date: '2026-10-12' }
const feePay = { receipt_no: 'FR-HO-2026-0004', amount: 25000, payment_mode: 'UPI', reference_no: 'U9', notes: 'Part payment', payment_date: '2026-10-12', receipt_date: '2026-10-13' }

const docs = {
  student: printStudentReceipt(student, stuPay, { asHtml: true, centre: 'NGP01', summary: { total: 8000, paid: 2000 } }),
  order: printOrderReceipt(order, ordPay, { asHtml: true, paidToDate: 12000 }),
  combined: printCombinedOrderReceipt([
    { order, payment: ordPay, balanceAfter: 0 },
    { order: Object.assign({}, order, { invoice_no: 'INV-2026-0015', grand_total: 5000, amount_paid: 3000 }), payment: Object.assign({}, ordPay, { amount: 3000 }), balanceAfter: 2000 },
  ], { asHtml: true }),
  franchisee: printFranchiseeReceipt(fr, feePay, { asHtml: true, total: 50000, paidToDate: 25000 }),
}

const metaLabels = html => [...html.matchAll(/<div class="ml">([^<]*)<\/div>/g)].map(m => m[1])

test('all four receipts are the same document: title, strap, items header, footer', () => {
  for (const [name, html] of Object.entries(docs)) {
    assert.match(html, /<div class="t">PAYMENT RECEIPT<\/div>/, name)
    assert.match(html, /Official Receipt/, name)
    assert.match(html, /Received with thanks — /, name)
    assert.match(html, /Amount \(&#8377;\)/, name)
    assert.match(html, /Computer generated payment receipt/, name)
    assert.match(html, /class="sheet a5"/, name)
  }
})

test('every receipt has the same first three meta cells; only the fourth differs', () => {
  for (const [name, html] of Object.entries(docs)) {
    const labels = metaLabels(html)
    assert.deepEqual(labels.slice(0, 3), ['Receipt no.', 'Receipt date', 'Mode'], name)
    assert.equal(labels.length, 4, name)
  }
  assert.equal(metaLabels(docs.student)[3], 'Centre')
  assert.equal(metaLabels(docs.order)[3], 'Against')
  assert.equal(metaLabels(docs.combined)[3], 'Invoices')
  assert.equal(metaLabels(docs.franchisee)[3], 'Centre')
})

test('receipt number, party and amount received are printed', () => {
  assert.match(docs.student, /ST-NGP01-2026-0007/)
  assert.match(docs.student, /SYN Student S09/)
  assert.match(docs.order, /OR-HO-2026-0019/)
  assert.match(docs.order, /SYN Unit Nagpur A/)
  assert.match(docs.franchisee, /FR-HO-2026-0004/)
  assert.match(docs.student, /&#8377;<\/span>2,000/)       // amount received box
  assert.match(docs.order, /&#8377;<\/span>12,000/)
  assert.match(docs.franchisee, /&#8377;<\/span>25,000/)
})

test('both dates are present: receipt date in the meta row, paid-on in the amount box', () => {
  assert.match(docs.student, /Paid on: <b[^>]*>03 Oct 2026<\/b>/)
  assert.match(docs.student, /<div class="mv">05 Oct 2026<\/div>/)
  assert.match(docs.order, /Paid on: <b[^>]*>30 Sept 2026<\/b>/)
  assert.match(docs.order, /<div class="mv">12 Oct 2026<\/div>/)
})

test('balance wording: Cleared when nothing is due, the amount otherwise', () => {
  assert.match(docs.order, /Cleared &#10003;/)                      // 12,000 paid of 12,000
  assert.match(docs.franchisee, /&#8377;25,000/)                    // 50,000 fee − 25,000 paid
  const part = printOrderReceipt(order, ordPay, { asHtml: true, paidToDate: 6000 })
  assert.match(part, /Balance<\/span><span class="v" style="color:#A32D2D">&#8377;6,000/)
})

test('references and notes are printed as labelled pills in a fixed order', () => {
  assert.match(docs.order, /Against:<\/span><span class="k2">INV-2026-0014/)
  assert.ok(docs.order.indexOf('Against:') < docs.order.indexOf('Ref:'))
  assert.match(docs.franchisee, /Ref:<\/span><span class="k2">U9/)
  assert.ok(docs.franchisee.indexOf('Ref:') < docs.franchisee.indexOf('Note:'))
})

test('missing values print a dash, never "undefined", "NaN" or null', () => {
  const sparse = [
    printStudentReceipt({ full_name: 'SYN' }, { amount: 100 }, { asHtml: true }),
    printOrderReceipt({ placer: {} }, { amount: 100 }, { asHtml: true }),
    printFranchiseeReceipt({}, { amount: 100 }, { asHtml: true }),
  ]
  for (const html of sparse) {
    assert.doesNotMatch(html, /undefined|NaN|>null</)
    assert.match(html, />—</)
  }
})

test('combined receipt: one line per invoice, amounts add up to the total received', () => {
  assert.match(docs.combined, /INV-2026-0014/)
  assert.match(docs.combined, /INV-2026-0015/)
  assert.match(docs.combined, /&#8377;<\/span>15,000/)               // 12,000 + 3,000
  assert.match(docs.combined, /2 invoices/)
})
