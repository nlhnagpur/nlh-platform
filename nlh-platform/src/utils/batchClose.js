// "Close a batch" as one guided action: no student may be left on a closed batch, so every student on it
// gets a decision first, then the whole thing is carried out in order. Pure functions — the screen
// supplies the data and runs the operations.

export const CLOSE_CHOICES = {
  move: 'Move to another batch',
  finished: 'Finished the course',
  off: 'Take off this batch (put on another one later)',
}

// students:  [{ bsId, enrollmentId, name, programme }]  currently on the batch
// decisions: { [bsId]: { choice: 'move' | 'finished' | 'off', targetBatchId?: string } }
// opts:      { closeDate, lastClassDate }                'YYYY-MM-DD'
// Returns { ok, problems: [string] }
export function validateClose(students, decisions, opts) {
  const problems = []
  const d = decisions || {}
  const o = opts || {}
  if (!o.closeDate) problems.push('Choose the date the batch closes.')
  else if (o.lastClassDate && o.closeDate < o.lastClassDate) problems.push('The batch had a class on ' + o.lastClassDate + ', so it cannot close before then.')
  ;(students || []).forEach(function (s) {
    const x = d[s.bsId]
    if (!x || !x.choice) problems.push('Decide what happens to ' + s.name + '.')
    else if (!CLOSE_CHOICES[x.choice]) problems.push('Unknown choice for ' + s.name + '.')
    else if (x.choice === 'move' && !x.targetBatchId) problems.push('Choose the batch ' + s.name + ' moves to.')
  })
  return { ok: problems.length === 0, problems: problems }
}

// The operations to run, in order. Students first, the batch last — so a failure part-way leaves a batch that is
// still open and can simply be closed again (students already dealt with are no longer on it).
export function closeBatchPlan(batchId, students, decisions, opts) {
  const ops = []
  const d = decisions || {}
  const date = (opts && opts.closeDate) || ''
  ;(students || []).forEach(function (s) {
    const x = d[s.bsId] || {}
    ops.push({ type: 'take_off', bsId: s.bsId, enrollmentId: s.enrollmentId, name: s.name, removed_at: date })
    if (x.choice === 'move') ops.push({ type: 'assign', enrollmentId: s.enrollmentId, name: s.name, batchId: x.targetBatchId, assigned_at: date })
    if (x.choice === 'finished') ops.push({ type: 'complete', enrollmentId: s.enrollmentId, name: s.name, completed_at: date + 'T12:00:00+00:00' })
  })
  ops.push({ type: 'close_batch', batchId: batchId })
  return ops
}

// Can a student of `programme` go to a batch whose CI holds these appointments? Appointment matching is by
// programme (see ciPayroll.appointmentForCourse); this is the entry rule that stops a student being put with a CI
// who cannot be paid for them.
export function targetBlockReason(ciAppointments, programme, appointmentFor, monthEnd, ciName) {
  if (!programme) return ''
  const ap = appointmentFor(ciAppointments, programme, monthEnd)
  return ap ? '' : (ciName || 'This CI') + ' has no appointment for ' + programme
}
