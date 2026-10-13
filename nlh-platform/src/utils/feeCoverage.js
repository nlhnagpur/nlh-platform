// Pure fee-status / course-coverage calculations used by the Students page.
// Moved verbatim out of StudentsPage.jsx so they can be exercised by the
// local regression tests (tests/) without loading React or Supabase.

// Shared: derive payment_status from fee amounts — single source of truth
export function deriveStatus(total, paid) {
  const t = Number(total) || 0
  const p = Number(paid)  || 0
  if (t === 0)   return 'none'
  if (p <= 0)    return 'pending'
  if (p >= t)    return 'paid'
  return 'partial'
}

// Course-wise fee settlement. Payments are held against the STUDENT, so we
// settle courses oldest-first from a pool of real credits (payments + the
// package discount). A waiver is NOT a separate thing here: discontinuing a
// course reduces its fee_amount (and the student's fee_total) exactly like a
// discount, and the amount is stored per course as `waived` purely for display
// and reversal. So the true balance is always fee_total - fee_paid — nothing to
// subtract. Returns { perId, discount, waivedTotal, activeOutstanding, other }.
export function computeCoverage(enrollments, payments, feeTotalRaw, otherRaw) {
  const list      = enrollments || []
  const paidTotal = (payments || []).reduce(function (s, p) { return s + (p.amount || 0) }, 0)
  const courseSum = list.reduce(function (s, e) { return s + (Number(e.fee_amount) || 0) }, 0)
  const other     = Number(otherRaw) || 0
  const feeTotal  = Number(feeTotalRaw) || 0
  // Charged below list = a discount (or a waiver, treated identically).
  const discount  = Math.max(0, courseSum + other - feeTotal)

  const ordered = list.slice().sort(function (a, b) {
    const ad = a.enrolled_at || a.created_at || ''
    const bd = b.enrolled_at || b.created_at || ''
    if (ad !== bd) return ad < bd ? -1 : 1     // oldest first
    return String(a.id) < String(b.id) ? -1 : 1
  })

  let pool = paidTotal + discount
  let waivedTotal = 0
  let activeDue   = 0
  const perId = {}
  ordered.forEach(function (en) {
    const fee     = Number(en.fee_amount) || 0
    const listP   = Number(en.list_price) || 0
    const waived  = Number(en.waived) || 0
    const covered = Math.min(pool, fee)
    pool -= covered
    const remaining = Math.max(0, fee - covered)
    const dropped   = en.status === 'dropped'
    waivedTotal += waived
    if (!dropped) activeDue += remaining
    perId[en.id] = {
      // fee_amount is already net of the waiver, so `off` reflects catalogue →
      // charged (real discount) and the waiver shows as its own figure.
      fee: fee, list: listP, off: Math.max(0, listP - fee - waived),
      paid: covered, due: remaining, dropped: dropped, waived: waived,
    }
  })

  const otherCovered = Math.min(pool, other)
  const otherDue     = Math.max(0, other - otherCovered)

  return {
    perId: perId, discount: discount, waivedTotal: waivedTotal,
    activeOutstanding: activeDue + otherDue,
    other: { fee: other, paid: otherCovered, due: otherDue },
  }
}
