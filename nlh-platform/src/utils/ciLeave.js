// "CI leaves / hands over" as one guided action: every open batch of the CI is either handed to another CI
// or closed before the CI is marked as left, so no batch is ever left with a CI who has gone.
// Pure functions — the screen supplies the data and runs the operations.

export const LEAVE_STATUSES = { resigned: 'Resigned', terminated: 'Terminated', inactive: 'Inactive (on a break)' }

// The new CI takes over the day after the last working day.
export function handoverDate(lastDay) {
  const t = String(lastDay || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return ''
  const d = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)) + 1)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

// Why a batch cannot go to a given CI: that CI must hold an appointment for every programme on the batch's roster.
//   programmes: ['Phonics', …]   ciAppointments: that CI's appointments   appointmentFor: ciPayroll.appointmentForCourse
export function handoverBlockReason(programmes, ciAppointments, appointmentFor, monthEnd, ciName) {
  const missing = (programmes || []).filter(function (p) { return p && !appointmentFor(ciAppointments, p, monthEnd) })
  return missing.length ? (ciName || 'This CI') + ' has no appointment for ' + missing.join(', ') : ''
}

// batches:   [{ id, name }]          the CI's open batches
// decisions: { [batchId]: { choice: 'handover' | 'closed', newCiId?: string } }   ('closed' is set once Close batch has been done)
// opts:      { status, lastDay }
export function validateLeave(batches, decisions, opts) {
  const problems = []
  const o = opts || {}
  const d = decisions || {}
  if (!LEAVE_STATUSES[o.status]) problems.push('Choose why the CI is leaving.')
  if (!o.lastDay) problems.push('Enter the CI’s last day of work.')
  ;(batches || []).forEach(function (b) {
    const x = d[b.id]
    if (!x || !x.choice) problems.push('Decide what happens to the batch "' + b.name + '".')
    else if (x.choice === 'handover' && !x.newCiId) problems.push('Choose the CI who takes over "' + b.name + '".')
  })
  return { ok: problems.length === 0, problems: problems }
}

// What to write: each hand-over, then the CI's own record last.
export function leavePlan(instructorId, batches, decisions, opts) {
  const ops = []
  const from = handoverDate(opts.lastDay)
  ;(batches || []).forEach(function (b) {
    const x = (decisions || {})[b.id] || {}
    if (x.choice === 'handover') ops.push({ type: 'handover', batchId: b.id, name: b.name, newCiId: x.newCiId, assigned_at: from })
  })
  ops.push({ type: 'mark_left', instructorId: instructorId, status: opts.status, left_at: opts.lastDay })
  return ops
}

// Setting a CI to resigned / terminated / inactive (from the Profile Status field) is allowed once their batches are
// closed or handed over — which is how it is usually done. While open batches remain it is refused, so a batch is
// never left with a CI who has gone.
export function statusChangeBlock(oldStatus, newStatus, openBatchCount) {
  if (oldStatus !== 'active' || newStatus === 'active') return ''
  const n = Number(openBatchCount) || 0
  if (n === 0) return ''
  return 'This CI still has ' + n + ' open batch' + (n !== 1 ? 'es' : '') + '. Close each batch first (Batches → Close batch), or use “CI is leaving…” to hand them over, then set the status.'
}
