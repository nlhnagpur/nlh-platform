// "Move a child to another batch" as one guided action, with an effective date. Pure functions — the screen
// supplies the data and runs the operations.
//
// Membership dates are inclusive on both ends, so a move effective on D ends the old membership on D-1 and
// starts the new one on D: the child is on exactly one batch on every day.

export function dayBefore(d) {
  const t = String(d || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return ''
  const x = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)) - 1)
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')
}

export function dayAfter(d) {
  const t = String(d || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return ''
  const x = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)) + 1)
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')
}

// current: { assigned_at }   opts: { targetBatchId, effective }
export function validateMove(current, opts) {
  const problems = []
  const o = opts || {}
  if (!o.targetBatchId) problems.push('Choose the batch the child moves to.')
  if (!o.effective) problems.push('Choose the date the move takes effect.')
  else if (current && current.assigned_at && o.effective <= String(current.assigned_at).slice(0, 10)) {
    problems.push('The child joined the current batch on ' + String(current.assigned_at).slice(0, 10) + ', so the move must be after that day.')
  }
  return { ok: problems.length === 0, problems: problems }
}

// What to write: end the old membership the day before, start the new one on the effective date.
export function movePlan(current, opts) {
  return [
    { type: 'end_membership', bsId: current.bsId, removed_at: dayBefore(opts.effective) },
    { type: 'start_membership', batchId: opts.targetBatchId, enrollmentId: current.enrollmentId, assigned_at: opts.effective },
  ]
}

// Things staff should know before confirming. None of them stop the move.
//   ctx: { today, noAppointment (bool), ciNames: { old, new }, savedRuns: [{ ci, month, status }] }
export function moveWarnings(opts, ctx) {
  const out = []
  const c = ctx || {}
  const eff = (opts && opts.effective) || ''
  if (c.noAppointment) out.push((c.ciNames && c.ciNames.new || 'The new CI') + ' has no appointment for this programme yet. Appoint them (Instructors → CI → Courses) so payroll can pay for this child.')
  if (eff && c.today && eff < c.today) {
    out.push('This move is dated in the past: ' + ((c.ciNames && c.ciNames.old) || 'the old CI') + ' is paid for the child up to ' + dayBefore(eff) + ' and ' + ((c.ciNames && c.ciNames.new) || 'the new CI') + ' from ' + eff + '.')
  }
  ;(c.savedRuns || []).forEach(function (r) {
    out.push(r.ci + '’s ' + r.month + ' payroll is already ' + r.status + ' — correct it by hand if this move changes it.')
  })
  return out
}
