import { sb } from '../supabase'

// Builds one combined, chronological debit/credit ledger for a franchisee —
// the franchise fee (enrollment) plus every kit order — from the existing
// systems of record (franchisee_payments, orders, order_payments). No new
// tables: fee_paid and orders.amount_paid are already kept in sync with
// these payment rows (verified via SQL — sums match exactly), so this is
// safe to compute on read rather than duplicating state anywhere.
//
// Debit  = amount owed (franchise fee assessed, order invoiced)
// Credit = amount received (a payment against either)
export async function loadFranchiseeLedger(franchiseeId) {
  const [frRes, fpRes, ordRes] = await Promise.all([
    sb.from('franchisees')
      .select('id, business_name, owner_name, enrollment_fee, contract_start, created_at')
      .eq('id', franchiseeId).single(),
    sb.from('franchisee_payments')
      .select('id, amount, payment_date, payment_mode, reference_no, notes, receipt_no')
      .eq('franchisee_id', franchiseeId),
    // placer_id, not bill_to_franchisee_id — matches RLS and matches how
    // "My orders" already scopes a franchisee's own orders.
    sb.from('orders')
      .select('id, order_ref, invoice_no, grand_total, status, created_at, invoice_cancelled_at')
      .eq('placer_id', franchiseeId),
  ])

  const franchisee = frRes.data || null
  const feePayments = fpRes.data || []
  const orders = ordRes.data || []
  const orderIds = orders.map(function (o) { return o.id })

  const opRes = orderIds.length
    ? await sb.from('order_payments')
        .select('id, order_id, amount, paid_on, mode, reference, receipt_no')
        .in('order_id', orderIds)
    : { data: [] }
  const orderPayments = opRes.data || []
  const orderById = {}
  orders.forEach(function (o) { orderById[o.id] = o })

  const txns = []

  if (franchisee && Number(franchisee.enrollment_fee) > 0) {
    txns.push({
      id: 'fee-debit-' + franchisee.id,
      date: franchisee.contract_start || franchisee.created_at,
      category: 'fee',
      desc: 'Franchise Fee (Enrollment)',
      ref: null,
      debit: Number(franchisee.enrollment_fee),
      credit: 0,
    })
  }
  feePayments.forEach(function (p) {
    txns.push({
      id: 'fee-payment-' + p.id,
      date: p.payment_date,
      category: 'fee',
      desc: 'Franchise fee payment' + (p.payment_mode ? ' · ' + p.payment_mode : '') + (p.notes ? ' · ' + p.notes : ''),
      ref: p.receipt_no || p.reference_no || null,
      debit: 0,
      credit: Number(p.amount) || 0,
    })
  })

  orders.forEach(function (o) {
    if (o.status === 'pending') return       // not invoiced yet — nothing owed
    if (o.invoice_cancelled_at) return       // cancelled invoice — doesn't count
    txns.push({
      id: 'order-debit-' + o.id,
      date: o.created_at,
      category: 'order',
      desc: 'Order ' + (o.invoice_no || o.order_ref || ''),
      ref: o.invoice_no || o.order_ref || null,
      debit: Number(o.grand_total) || 0,
      credit: 0,
    })
  })
  orderPayments.forEach(function (p) {
    const o = orderById[p.order_id]
    txns.push({
      id: 'order-payment-' + p.id,
      date: p.paid_on,
      category: 'order',
      desc: 'Payment for order ' + ((o && (o.invoice_no || o.order_ref)) || ''),
      ref: p.receipt_no || p.reference || null,
      debit: 0,
      credit: Number(p.amount) || 0,
    })
  })

  txns.sort(function (a, b) {
    const d = new Date(a.date) - new Date(b.date)
    if (d !== 0) return d
    // Same date — debit (amount owed) before its own credit (payment).
    return (b.debit - b.credit) - (a.debit - a.credit)
  })

  let running = 0
  txns.forEach(function (t) {
    running += t.debit - t.credit
    t.balance = running
  })

  const totalDebit  = txns.reduce(function (s, t) { return s + t.debit }, 0)
  const totalCredit = txns.reduce(function (s, t) { return s + t.credit }, 0)

  return {
    franchisee: franchisee,
    transactions: txns,
    totalDebit: totalDebit,
    totalCredit: totalCredit,
    balance: totalDebit - totalCredit,
  }
}
