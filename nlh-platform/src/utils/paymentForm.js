// Shared, pure rules for the payment-entry forms (student receipt, order
// payment, franchisee payment). No DOM, no Supabase, and NO allocation or fee
// calculation: this module only describes the form (modes, labels, duplicate
// detection, quick-fill amounts) — what a payment is applied to is decided
// elsewhere and is unchanged.
import { fmtMoney } from './format.js'

// The stored value differs per table (each has its own CHECK constraint or
// free text), so each flow keeps its own value set; only the labels and order
// are standardised here.
export const PAYMENT_MODES = {
  student: [
    ['cash', 'Cash'], ['upi', 'UPI'], ['bank_transfer', 'Bank Transfer / NEFT'],
    ['cheque', 'Cheque'], ['card', 'Card'], ['online', 'Online Payment'],
  ],
  order: [
    ['upi', 'UPI'], ['neft', 'NEFT / RTGS'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['other', 'Other'],
  ],
  orderMulti: [
    ['upi', 'UPI'], ['neft', 'NEFT / RTGS'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['razorpay', 'Razorpay'], ['other', 'Other'],
  ],
  franchisee: [
    ['UPI', 'UPI'], ['NEFT', 'NEFT'], ['RTGS', 'RTGS'], ['Cash', 'Cash'], ['Cheque', 'Cheque'], ['DD', 'DD'],
  ],
}

export function paymentModes(flow) {
  return PAYMENT_MODES[flow] || PAYMENT_MODES.student
}

// Payments come from three tables with different column names.
export function paymentDateOf(p) {
  return String((p && (p.paid_at || p.paid_on || p.payment_date)) || '').slice(0, 10)
}
export function paymentModeOf(p) {
  return String((p && (p.mode || p.payment_mode)) || '').toLowerCase()
}

// An already-recorded payment with the same amount, the same paid-on day and
// the same mode — the usual signature of a receipt keyed in twice. Returns the
// matching payment or null. Advisory only: it never blocks a save.
export function findDuplicatePayment(existing, input) {
  const amount = Number(input && input.amount) || 0
  if (!amount || !existing || !existing.length) return null
  const date = String((input && input.date) || '').slice(0, 10)
  const mode = String((input && input.mode) || '').toLowerCase()
  for (let i = 0; i < existing.length; i++) {
    const p = existing[i]
    if ((Number(p.amount) || 0) === amount && paymentDateOf(p) === date && paymentModeOf(p) === mode) return p
  }
  return null
}

// A payment cannot be dated in the future (it records money already received).
export function isFutureDate(iso, today) {
  const d = String(iso || '').slice(0, 10)
  return !!d && !!today && d > String(today).slice(0, 10)
}

// One-tap amounts shown under the amount field. Empty when nothing is owed.
export function quickFillOptions(balance) {
  const b = Math.round(Number(balance) || 0)
  if (b <= 0) return []
  const out = [{ key: 'full', label: 'Full ' + fmtMoney(b), amount: b }]
  const half = Math.round(b / 2)
  if (half > 0 && half < b) out.push({ key: 'half', label: 'Half ' + fmtMoney(half), amount: half })
  return out
}
