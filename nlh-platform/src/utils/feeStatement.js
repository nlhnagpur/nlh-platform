// What a student's total fee is made up of, and which courses a given payment
// settled — built for the payment receipt.
//
// students.fee_total is one running number; it's changed in a few places
// (enrolment, discount edits, monthly renewals, other charges) and the DB logs
// every change to student_fee_events. So the fee is rebuilt from that log,
// which means it ALWAYS adds up to the fee total as at the receipt date:
//
//   opening  = fee_total before the first logged change (or today's total if
//              nothing was ever logged), itemised from the invoices raised
//              up to then (course by course);
//   changes  = every later fee_total event up to the receipt date — a
//              discount/adjustment, a course added later, a monthly renewal.
//
// If invoices don't account for exactly the opening amount, the difference is
// kept as one "other" line rather than hidden.
//
// Payments are held against the student, not a course, so a payment is applied
// to the charges oldest-first (same convention as the course-by-course "paid"
// view in the student profile) — allocateReceipt works out which courses one
// payment settled.

function dayOf(v) { return String(v || '').slice(0, 10) }

function courseLabel(en) {
  const sku = en && en.skus
  return ((sku && sku.courses && sku.courses.group_name) || 'Course') + (sku && sku.level_name ? ' — ' + sku.level_name : '')
}

function monthLabel(y, m0) {
  return new Date(y, m0, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

// events: fee_total events drive the ledger; fee_amount events (with their
// enrollment_id) are only used to say WHICH course a discount was for.
export function buildFeeStatement(o) {
  const all = o.events || []
  const events = all
    .filter(function (e) { return e.field === 'fee_total' && e.delta != null })
    .slice().sort(function (a, b) { return new Date(a.at) - new Date(b.at) })
  const courseEdits = all.filter(function (e) { return e.field === 'fee_amount' && e.enrollment_id && e.delta != null })
  const invoices = (o.invoices || []).slice().sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at) })
  const enrolments = o.enrollments || []
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
      lines.push({ kind: 'enrolment', course: c.name || 'Course fee', label: c.name || 'Course fee', amount: Number(c.amount) || 0, date: dayOf(inv.created_at) })
    })
    running += invSum
  })
  if (running !== opening) {
    lines.push({ kind: 'other', course: null, label: lines.length ? 'Other charges / adjustments' : 'Course fees', amount: opening - running, date: '' })
  }

  // Everything logged after that, up to the receipt date.
  let total = opening
  events.filter(function (e) { return dayOf(e.at) <= asOf }).forEach(function (e) {
    const d = Number(e.delta) || 0
    total += d
    if (d < 0) {
      // Which course was discounted: the course-fee edit made moments earlier.
      const edit = courseEdits.find(function (x) { return Number(x.delta) === d && Math.abs(new Date(x.at) - new Date(e.at)) < 180000 })
      const en = edit && enrolments.find(function (x) { return x.id === edit.enrollment_id })
      lines.push({ kind: 'discount', course: en ? courseLabel(en) : null, label: 'Discount / fee adjustment', amount: d, date: dayOf(e.at) })
      return
    }
    const inv = invoices.find(function (i) { return Math.abs(new Date(i.created_at) - new Date(e.at)) < 120000 && Number(i.total) === d })
    if (inv) {
      const names = (inv.items || []).filter(function (x) { return x && x.kind === 'course' }).map(function (x) { return x.name })
      lines.push({ kind: 'added', course: names.join(', ') || null, label: 'Added: ' + names.join(', '), amount: d, date: dayOf(e.at) })
      return
    }
    // A renewal bumps the total by that course's monthly fee — name the
    // course when exactly one running course has that fee.
    const match = enrolments.filter(function (en) { return Number(en.fee_amount) === d && en.cycle_started_at })
    const en = match.length === 1 ? match[0] : null
    lines.push({
      kind: 'renewal', course: en ? courseLabel(en) : null, enrollmentId: en ? en.id : null,
      label: en ? 'Monthly renewal — ' + courseLabel(en) : 'Monthly renewal / additional fee', amount: d, date: dayOf(e.at),
    })
  })

  return { lines: lines, total: total }
}

// Payments up to and including `current`, oldest first.
export function paymentsUpTo(payments, current) {
  return (payments || [])
    .filter(function (p) { return dayOf(p.paid_at) <= dayOf(current.paid_at) })
    .slice().sort(function (a, b) { return (dayOf(a.paid_at) + (a.created_at || '')).localeCompare(dayOf(b.paid_at) + (b.created_at || '')) })
    .map(function (p) {
      return { date: dayOf(p.paid_at), receipt_no: p.receipt_no, mode: p.mode, amount: Number(p.amount) || 0, current: p.id === current.id }
    })
}

// Which courses did the `current` payment settle? One row per course, with the
// month(s) it covered. Discounts are folded into the course's charge (never a
// line of their own), and anything already cleared by earlier payments is not
// shown — only what THIS payment went towards.
//   lines     buildFeeStatement().lines
//   payments  paymentsUpTo(...) — oldest first, `current` flagged
//   enrollments  for the monthly-cycle month labels
// Returns [{ label, sub, amount }] summing to the payment amount.
export function allocateReceipt(o) {
  const lines = o.lines || []
  const enrolments = o.enrollments || []
  const charges = lines
    .filter(function (l) { return l.kind !== 'discount' && l.amount > 0 })
    .map(function (l) { return Object.assign({}, l, { remaining: l.amount }) })

  // Fold discounts into charges: the matching course's earliest charge first,
  // else the most recent enrolment charge.
  lines.filter(function (l) { return l.kind === 'discount' }).forEach(function (d) {
    let left = -d.amount
    const same = d.course ? charges.filter(function (c) { return c.course === d.course }) : []
    const pool = same.length ? same : charges.filter(function (c) { return c.kind === 'enrolment' || c.kind === 'added' }).slice().reverse()
    pool.forEach(function (c) {
      const take = Math.min(left, c.remaining)
      c.remaining -= take
      left -= take
    })
  })

  // Oldest payment against the oldest charge, and so on.
  let current = []
  let ci = 0
  ;(o.payments || []).forEach(function (p) {
    let left = p.amount
    const parts = []
    while (left > 0 && ci < charges.length) {
      const c = charges[ci]
      if (c.remaining <= 0) { ci++; continue }
      const take = Math.min(left, c.remaining)
      c.remaining -= take
      left -= take
      parts.push({ charge: c, amount: take })
      if (c.remaining <= 0) ci++
    }
    if (left > 0) parts.push({ charge: null, amount: left })
    if (p.current) current = parts
  })

  // Month a charge covers: a monthly course's enrolment fee is its first cycle
  // (the enrolment month); the k-th renewal is the k-th cycle after it, or
  // the course's live cycle start for its latest renewal.
  const renewalsOf = function (course) {
    return lines.filter(function (l) { return l.kind === 'renewal' && l.course === course })
  }
  const enrolmentFor = function (course) {
    return enrolments.find(function (en) { return courseLabel(en) === course })
  }
  function periodOf(c) {
    const en = c.course ? enrolmentFor(c.course) : null
    if (!en || !en.cycle_started_at) return ''   // fixed-session course: no month
    const anchor = dayOf(en.enrolled_at) || dayOf(en.cycle_started_at)
    const [ay, am] = anchor.split('-').map(Number)
    if (c.kind === 'renewal') {
      const rs = renewalsOf(c.course)
      const k = rs.indexOf(lines.find(function (l) { return l.kind === 'renewal' && l.course === c.course && l.date === c.date && l.amount === c.amount })) + 1 || 1
      if (k === rs.length && en.cycle_started_at) {
        const [cy, cm] = dayOf(en.cycle_started_at).split('-').map(Number)
        return 'Monthly renewal · ' + monthLabel(cy, cm - 1)
      }
      return 'Monthly renewal · ' + monthLabel(ay, am - 1 + k)
    }
    return monthLabel(ay, am - 1)
  }

  const rows = []
  current.forEach(function (part) {
    const c = part.charge
    const course = c ? (c.course || c.label) : 'Fee paid in advance'
    let row = rows.find(function (r) { return r.course === course })
    if (!row) { row = { course: course, amount: 0, parts: [] }; rows.push(row) }
    row.amount += part.amount
    if (c) {
      const label = c.kind === 'renewal' && !periodOf(c) ? 'Monthly renewal' : periodOf(c)
      row.parts.push({ label: label, amount: part.amount })
    }
  })
  return rows.map(function (r) {
    const labelled = r.parts.filter(function (p) { return p.label })
    const sub = labelled.length === 0 ? ''
      : labelled.length === 1 ? labelled[0].label
      : labelled.map(function (p) { return p.label + ' ₹' + new Intl.NumberFormat('en-IN').format(p.amount) }).join('  +  ')
    return { label: r.course, sub: sub, amount: r.amount }
  })
}
