// Invoice settlement, moved verbatim out of studentLedger.js so it can be
// tested without loading Supabase. studentLedger.js re-exports it.

function dayOf(v) { return String(v || '').slice(0, 10) }

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
