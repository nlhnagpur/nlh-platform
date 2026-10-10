import { sb } from '../supabase'
import { buildFeeStatement, paymentsUpTo, allocateReceipt } from './feeStatement'

// Totals as at one payment, so a reprint shows what the receipt showed when it
// was issued. list = every payment of that student.
export function studentReceiptCtx(student, p, list) {
  const total = Number(student.fee_total) || 0
  const paidToDate = (list || [])
    .filter(function (x) { return (x.paid_at || '') <= (p.paid_at || '') })
    .reduce(function (s, x) { return s + (x.amount || 0) }, 0)
  return {
    centre: student.franchisees?.business_name || '',
    summary: { total: total, paid: paidToDate, balance: Math.max(0, total - paidToDate) },
  }
}

// studentReceiptCtx plus which courses this payment settled (one line each, with
// the month it covered): rebuilt from the fee-change log and invoices (see
// utils/feeStatement.js). Used by every place a student receipt is printed or
// imaged, so they all show the same thing. Falls back to the plain totals if
// the log can't be read — a receipt must never fail to print.
export async function studentReceiptCtxFull(student, p, list) {
  const base = studentReceiptCtx(student, p, list)
  try {
    const [evRes, invRes] = await Promise.all([
      sb.from('student_fee_events').select('at, field, old_value, new_value, delta, enrollment_id').eq('student_id', student.id).in('field', ['fee_total', 'fee_amount']),
      sb.from('student_invoices').select('id, invoice_no, invoice_date, created_at, items, total').eq('student_id', student.id),
    ])
    // The newest receipt shows the fee as it stands now (a payment is often
    // dated a day before the fee change it settles, so cutting at its date
    // would show a total below what was paid). An older receipt is cut at its
    // own date, but never to less than what had been paid by then.
    const all = list || []
    const isLatest = !all.some(function (x) { return (x.paid_at || '') > (p.paid_at || '') })
    const build = function (asOf) {
      return buildFeeStatement({
        feeTotalNow: Number(student.fee_total) || 0, events: evRes.data || [], invoices: invRes.data || [],
        enrollments: student.enrollments || [], asOfDate: asOf,
      })
    }
    let stmt = build(isLatest ? '9999-12-31' : p.paid_at)
    if (stmt && !isLatest && stmt.total < base.summary.paid) stmt = build('9999-12-31')
    if (stmt && stmt.lines.length) {
      base.summary = { total: stmt.total, paid: base.summary.paid, balance: Math.max(0, stmt.total - base.summary.paid) }
      // One line per course this payment settled, with the month it covered.
      const alloc = allocateReceipt({
        lines: stmt.lines, payments: paymentsUpTo(all, p), enrollments: student.enrollments || [],
      })
      base.allocLines = alloc.rows
      base.allocSummary = alloc.summary
    }
  } catch (e) { console.warn('Receipt fee details unavailable:', e.message) }
  return base
}

