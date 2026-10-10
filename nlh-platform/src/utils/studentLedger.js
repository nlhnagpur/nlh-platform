import { sb } from '../supabase'
import { buildFeeStatement } from './feeStatement'

// One student's account: every charge (course fee, monthly renewal, next
// level, added course), every discount/adjustment and every payment, in date
// order with a running balance — the student counterpart of the franchisee
// Accounts tab (utils/franchiseeLedger.js).
//
// Charges and adjustments come from buildFeeStatement (the fee-change log +
// invoices), so the balance is always fee_total − payments. A charge that has
// an invoice points at it; one that doesn't (an older manual fee edit) still
// shows, just without a document.

function dayOf(v) { return String(v || '').slice(0, 10) }

function chargeDescription(l) {
  const per = l.period && l.period.label ? ' · ' + l.period.label : ''
  switch (l.kind) {
    case 'enrolment': return 'Course fee — ' + (l.course || l.label)
    case 'renewal':   return 'Monthly fee — ' + (l.course || 'Course') + per
    case 'nextlevel': return l.label
    case 'added':     return 'Course added — ' + String(l.label).replace(/^Added:\s*/, '')
    default:          return l.label || 'Fee'
  }
}

export async function loadStudentLedger(studentId) {
  const [stuRes, invRes, payRes, evRes, enrRes] = await Promise.all([
    sb.from('students')
      .select('id, full_name, parent_name, phone, email, address, area, city, state, fee_total, fee_paid, franchisee_id, franchisees(business_name, city, tier)')
      .eq('id', studentId).single(),
    sb.from('student_invoices').select('*').eq('student_id', studentId).order('created_at'),
    sb.from('student_payments').select('id, amount, mode, reference, paid_at, note, receipt_no, created_at').eq('student_id', studentId),
    sb.from('student_fee_events').select('at, field, old_value, new_value, delta, enrollment_id').eq('student_id', studentId).in('field', ['fee_total', 'fee_amount']),
    sb.from('enrollments').select('id, sku_id, fee_amount, cycle_started_at, enrolled_at, skus(level_name, courses(group_name))').eq('student_id', studentId),
  ])
  if (stuRes.error) throw stuRes.error
  const student = Object.assign({}, stuRes.data, { enrollments: enrRes.data || [] })
  const invoices = invRes.data || []
  const payments = payRes.data || []
  const invById = {}
  invoices.forEach(function (i) { invById[i.id] = i })

  const stmt = buildFeeStatement({
    feeTotalNow: Number(student.fee_total) || 0, events: evRes.data || [], invoices: invoices,
    enrollments: student.enrollments, asOfDate: '9999-12-31',
  })

  const txns = []
  const shownInv = {}
  ;(stmt ? stmt.lines : []).forEach(function (l, i) {
    if (l.amount < 0) {
      txns.push({
        id: 'adj-' + i, date: l.date, category: 'adjustment',
        desc: 'Discount / fee adjustment' + (l.course ? ' — ' + l.course : ''),
        ref: null, debit: 0, credit: -l.amount, doc: null,
      })
      return
    }
    const inv = l.invoice && l.invoice.id ? invById[l.invoice.id] : null
    const firstOfInvoice = !!inv && !shownInv[inv.id]
    if (inv) shownInv[inv.id] = true
    txns.push({
      id: 'chg-' + i, date: (l.invoice && l.invoice.invoice_date) || l.date, category: 'invoice', kind: l.kind,
      desc: chargeDescription(l), ref: inv ? inv.invoice_no : null,
      debit: l.amount, credit: 0, doc: inv && firstOfInvoice ? { type: 'invoice', invoice: inv } : null,
    })
  })
  payments.forEach(function (p) {
    txns.push({
      id: 'pay-' + p.id, date: dayOf(p.paid_at), category: 'payment',
      desc: 'Fee payment' + (p.mode ? ' · ' + String(p.mode).replace(/_/g, ' ') : ''),
      ref: p.receipt_no || p.reference || null, debit: 0, credit: Number(p.amount) || 0,
      doc: { type: 'receipt', payment: p },
    })
  })

  txns.sort(function (a, b) {
    const da = a.date || '', db = b.date || ''
    if (da !== db) return da < db ? -1 : 1
    return (b.debit - b.credit) - (a.debit - a.credit)   // same day: charge before its payment
  })
  let running = 0
  txns.forEach(function (t) { running += t.debit - t.credit; t.balance = running })

  const totalDebit = txns.reduce(function (s, t) { return s + t.debit }, 0)
  const totalCredit = txns.reduce(function (s, t) { return s + t.credit }, 0)
  return {
    student: student, invoices: invoices, payments: payments, transactions: txns,
    totalDebit: totalDebit, totalCredit: totalCredit, balance: totalDebit - totalCredit,
    settlement: invoiceSettlement(invoices, student.fee_total, student.fee_paid),
  }
}

// How far each invoice is settled. Payments are held against the student, not
// an invoice, so they're applied oldest invoice first — together with any
// discounts/adjustments (invoice totals minus the account's fee total).
// Returns { [invoiceId]: { paid, due, status: 'paid' | 'part' | 'unpaid' } }.
export function invoiceSettlement(invoices, feeTotal, feePaid) {
  const live = (invoices || []).filter(function (i) { return i.status !== 'cancelled' })
    .slice().sort(function (a, b) { return (dayOf(a.invoice_date) + a.created_at).localeCompare(dayOf(b.invoice_date) + b.created_at) })
  const sum = live.reduce(function (s, i) { return s + (Number(i.total) || 0) }, 0)
  // Part of the fee total has no invoice (an opening balance, a package paid
  // in advance): those older charges soak up payments first. Invoices that
  // add up to MORE than the fee total were discounted — that excess counts as
  // settled.
  const total = Number(feeTotal) || 0
  const uninvoiced = Math.max(0, total - sum)
  let pool = Math.max(0, (Number(feePaid) || 0) - uninvoiced) + Math.max(0, sum - total)
  const out = {}
  live.forEach(function (i) {
    const total = Number(i.total) || 0
    const paid = Math.min(total, Math.max(0, pool))
    pool -= paid
    out[i.id] = { paid: paid, due: total - paid, status: total - paid <= 0 ? 'paid' : paid > 0 ? 'part' : 'unpaid' }
  })
  return out
}
