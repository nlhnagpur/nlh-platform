// Correcting the date a course started — one guided action. The start date threads through the enrolment, the
// batch placement made with it, the monthly cycle start and the invoice date; they are changed together so the
// course has ONE start date. Pure functions — the dialog supplies the data and applies the plan.

const d10 = function (v) { return v ? String(v).slice(0, 10) : '' }

// enrollment: { id, enrolled_at, cycle_started_at, completed_at, monthly }
export function validateStartDate(enrollment, newDate, today) {
  const problems = []
  const nd = d10(newDate)
  if (!nd) problems.push('Choose the date the course really started.')
  else if (nd === d10(enrollment.enrolled_at)) problems.push('That is already the start date.')
  else if (enrollment.completed_at && nd > d10(enrollment.completed_at)) problems.push('The start date cannot be after the date the course was completed (' + d10(enrollment.completed_at) + ').')
  return { ok: problems.length === 0, problems: problems }
}

// Warnings only — HO may still go ahead.
//   classesBefore: attended classes dated before the new start date        savedRuns: [{ ci, month, status }]
export function startDateWarnings(newDate, ctx) {
  const c = ctx || {}
  const out = []
  const nd = d10(newDate)
  if (nd && c.today && nd > d10(c.today)) out.push('The start date is in the future.')
  if (c.classesBefore > 0) out.push(c.classesBefore + ' attended class' + (c.classesBefore !== 1 ? 'es are' : ' is') + ' dated before ' + nd + '. They stay as recorded — check the dates are right.')
  ;(c.savedRuns || []).forEach(function (r) { out.push(r.ci + '’s payroll for ' + r.month + ' is already ' + r.status + ' — open it and re-check after this change.') })
  return out
}

// What changes. Only things that carry the OLD start date move; anything dated differently was set on purpose.
//   enrollment:  { id, enrolled_at, cycle_started_at, monthly }
//   memberships: [{ id, assigned_at }]       invoices: [{ id, invoice_date, items }]
// Returns ops: { type: 'enrollment' | 'membership' | 'invoice', ... }
export function startDatePlan(enrollment, newDate, memberships, invoices) {
  const old = d10(enrollment.enrolled_at)
  const nd = d10(newDate)
  const ops = []
  const enrPatch = { enrolled_at: nd + 'T00:00:00+00:00' }
  if (enrollment.monthly && d10(enrollment.cycle_started_at) === old) enrPatch.cycle_started_at = nd
  ops.push({ type: 'enrollment', id: enrollment.id, patch: enrPatch })
  ;(memberships || []).forEach(function (m) {
    if (d10(m.assigned_at) === old) ops.push({ type: 'membership', id: m.id, patch: { assigned_at: nd + 'T00:00:00+00:00' } })
  })
  ;(invoices || []).forEach(function (inv) {
    const mine = (inv.items || []).some(function (x) { return x && x.kind === 'course' && x.enrollment_id === enrollment.id })
    if (mine && d10(inv.invoice_date) === old) ops.push({ type: 'invoice', id: inv.id, patch: { invoice_date: nd } })
  })
  return ops
}
