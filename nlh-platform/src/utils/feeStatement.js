// What a student's total fee is made up of, and how it was paid — built for
// the payment receipt so "Total fee ₹14,000" comes with its breakdown.
//
// students.fee_total is one running number; it's changed in a few places
// (enrolment, discount edits, monthly renewals, other charges) and the DB logs
// every change to student_fee_events. So the statement is rebuilt from that
// log, which means it ALWAYS adds up to the fee total as at the receipt date:
//
//   opening  = fee_total before the first logged change (or today's total if
//              nothing was ever logged), itemised from the invoices raised
//              up to then (course by course);
//   changes  = every later fee_total event up to the receipt date — a
//              discount/adjustment, a course added later, a monthly renewal.
//
// If invoices don't account for exactly the opening amount, the difference is
// shown as one "other charges / adjustments" line rather than hidden.

function dayOf(v) { return String(v || '').slice(0, 10) }

export function buildFeeStatement(o) {
  const events = (o.events || [])
    .filter(function (e) { return e.field === 'fee_total' && e.delta != null })
    .slice().sort(function (a, b) { return new Date(a.at) - new Date(b.at) })
  const invoices = (o.invoices || []).slice().sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at) })
  const asOf = dayOf(o.asOfDate) || dayOf(new Date().toISOString())

  const sumAll = events.reduce(function (s, e) { return s + (Number(e.delta) || 0) }, 0)
  const first = events[0]
  const firstOld = first && first.old_value != null && first.old_value !== '' && !isNaN(Number(first.old_value)) ? Number(first.old_value) : null
  const opening = firstOld != null ? firstOld : (Number(o.feeTotalNow) || 0) - sumAll
  if (!(opening >= 0)) return null

  // Opening lines: invoices in order while they still fit inside the opening
  // amount (so a course invoiced right around the first logged change isn't
  // counted twice — the change itself carries it).
  const lines = []
  let running = 0
  invoices.forEach(function (inv) {
    const courses = (inv.items || []).filter(function (i) { return i && i.kind === 'course' })
    const invSum = courses.reduce(function (s, c) { return s + (Number(c.amount) || 0) }, 0)
    if (!courses.length || running + invSum > opening) return
    courses.forEach(function (c) {
      lines.push({ label: c.name || 'Course fee', sub: 'Enrolment · ' + dayOf(inv.created_at), amount: Number(c.amount) || 0, date: dayOf(inv.created_at) })
    })
    running += invSum
  })
  if (running !== opening) {
    lines.push({ label: lines.length ? 'Other charges / adjustments' : 'Course fees', sub: '', amount: opening - running, date: '' })
  }

  // Everything logged after that, up to the receipt date.
  const enrolments = o.enrollments || []
  let total = opening
  events.filter(function (e) { return dayOf(e.at) <= asOf }).forEach(function (e) {
    const d = Number(e.delta) || 0
    total += d
    let label
    if (d < 0) {
      label = 'Discount / fee adjustment'
    } else {
      const inv = invoices.find(function (i) { return Math.abs(new Date(i.created_at) - new Date(e.at)) < 120000 && Number(i.total) === d })
      if (inv) {
        label = 'Added: ' + (inv.items || []).filter(function (x) { return x && x.kind === 'course' }).map(function (x) { return x.name }).join(', ')
      } else {
        // A renewal bumps the total by that course's monthly fee — name the
        // course when exactly one running course has that fee.
        const match = enrolments.filter(function (en) { return Number(en.fee_amount) === d && en.cycle_started_at })
        label = match.length === 1
          ? 'Monthly renewal — ' + ((match[0].skus && match[0].skus.courses && match[0].skus.courses.group_name) || 'Course') + (match[0].skus && match[0].skus.level_name ? ' — ' + match[0].skus.level_name : '')
          : 'Monthly renewal / additional fee'
      }
    }
    lines.push({ label: label, sub: dayOf(e.at), amount: d, date: dayOf(e.at) })
  })

  return { lines: lines, total: total }
}

// Payments up to and including `current`, oldest first, for the receipt's
// "Payments received" block.
export function paymentsUpTo(payments, current) {
  return (payments || [])
    .filter(function (p) { return dayOf(p.paid_at) <= dayOf(current.paid_at) })
    .slice().sort(function (a, b) { return (dayOf(a.paid_at) + (a.created_at || '')).localeCompare(dayOf(b.paid_at) + (b.created_at || '')) })
    .map(function (p) {
      return { date: dayOf(p.paid_at), receipt_no: p.receipt_no, mode: p.mode, amount: Number(p.amount) || 0, current: p.id === current.id }
    })
}
