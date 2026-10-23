// A student's timeline: everything that has happened to the child, in date order, built only from records that
// already exist (enrolments, batch memberships, classes, certificates, payments, fee changes) — nothing is typed
// in. Pure function; the screen supplies the data.

const d10 = function (v) { return v ? String(v).slice(0, 10) : '' }
const rupees = function (n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN') }
const programmeOf = function (en) { return (en.skus && en.skus.courses && en.skus.courses.group_name) || 'Course' }
const levelOf = function (en) { return (en.skus && en.skus.level_name) || '' }
const labelOf = function (en) { return programmeOf(en) + (levelOf(en) ? ' ' + levelOf(en) : '') }

// A completed enrolment at ₹0 with no class of its own is a "finished-level record" (made when a child is moved up).
function isFinishedLevel(en, classCountByEnr) {
  return !!en.completed_at && !Number(en.fee_amount) && !(classCountByEnr[en.id] > 0)
}

// ctx:
//   student:     { registered_at, closed_at, close_reason }
//   enrollments: [{ id, status, enrolled_at, completed_at, fee_amount, cert_status, cert_issued_at, cert_emailed_at, cert_wa_sent_at, marks_submitted_at, skus }]
//   memberships: [{ enrollment_id, assigned_at, removed_at, batch: { name }, ci: 'Name' }]
//   classes:     [{ enrollment_id, date, batch_id, batch_name, ci: 'Name', substitute }]   classes the child attended
//   payments:    [{ paid_at, amount, receipt_no, mode }]
//   feeEvents:   [{ at, field, old_value, new_value, delta, actor }]
// Returns events oldest first: { date, kind, title, detail }
export function buildTimeline(ctx) {
  const c = ctx || {}
  const ev = []
  const add = function (date, kind, title, detail) { if (date) ev.push({ date: d10(date), kind: kind, title: title, detail: detail || '' }) }
  const enrs = c.enrollments || []
  const classes = c.classes || []
  const classCountByEnr = {}
  classes.forEach(function (x) { classCountByEnr[x.enrollment_id] = (classCountByEnr[x.enrollment_id] || 0) + 1 })
  const enrById = {}
  enrs.forEach(function (e) { enrById[e.id] = e })

  if (c.student && c.student.registered_at) add(c.student.registered_at, 'admission', 'Admitted', '')

  enrs.forEach(function (en) {
    const finished = isFinishedLevel(en, classCountByEnr)
    if (!finished) add(en.enrolled_at, 'enrolled', 'Enrolled in ' + labelOf(en), Number(en.fee_amount) ? 'Fee ' + rupees(en.fee_amount) : '')
    if (en.completed_at) {
      add(en.completed_at, 'completed', (finished ? 'Finished ' : 'Completed ') + labelOf(en),
        finished ? 'Moved up to the next level — the CI and batch stayed the same' : '')
    } else if (en.status === 'dropped') {
      add(en.enrolled_at, 'dropped', labelOf(en) + ' discontinued', 'The date of discontinuing is not recorded')
    }
    if (en.marks_submitted_at) add(en.marks_submitted_at, 'marks', 'Marks submitted for ' + labelOf(en), '')
    if (en.cert_status === 'certified') add(en.completed_at, 'certificate', 'Certified by HO — ' + labelOf(en), '')
    if (en.cert_issued_at) add(en.cert_issued_at, 'certificate', 'Certificate issued — ' + labelOf(en), '')
    if (en.cert_emailed_at) add(en.cert_emailed_at, 'certificate', 'Certificate emailed — ' + labelOf(en), '')
    if (en.cert_wa_sent_at) add(en.cert_wa_sent_at, 'certificate', 'Certificate sent on WhatsApp — ' + labelOf(en), '')
  })

  // batches: where, with whom, from when to when, and how many classes the child had there
  const mems = (c.memberships || []).slice().sort(function (a, b) { return d10(a.assigned_at).localeCompare(d10(b.assigned_at)) })
  mems.forEach(function (m, i) {
    const en = enrById[m.enrollment_id]
    const mine = classes.filter(function (x) { return x.enrollment_id === m.enrollment_id && x.batch_name === (m.batch && m.batch.name) })
    const first = mine.map(function (x) { return d10(x.date) }).sort()[0]
    const last = mine.map(function (x) { return d10(x.date) }).sort().slice(-1)[0]
    const byCi = {}
    mine.forEach(function (x) { const k = x.substitute ? (x.ci || 'a substitute') + ' (substitute)' : (x.ci || 'CI'); byCi[k] = (byCi[k] || 0) + 1 })
    const tally = Object.keys(byCi).map(function (k) { return byCi[k] + ' with ' + k }).join(', ')
    const where = (m.batch && m.batch.name) || 'a batch'
    const prevEnds = mems.some(function (o, j) { return j !== i && o.enrollment_id === m.enrollment_id && o.removed_at && d10(o.removed_at) < d10(m.assigned_at) })
    add(m.assigned_at, prevEnds ? 'batch_move' : 'batch', (prevEnds ? 'Moved to ' : 'Placed in ') + where + (m.ci ? ' with ' + m.ci : ''),
      (en ? labelOf(en) : '') + (mine.length ? ' · ' + mine.length + ' classes attended' + (first ? ' (' + first + ' to ' + last + ')' : '') + (tally ? ': ' + tally : '') : ''))
    if (m.removed_at) {
      const followedBy = mems.some(function (o, j) { return j !== i && o.enrollment_id === m.enrollment_id && d10(o.assigned_at) > d10(m.removed_at) })
      if (!followedBy) add(m.removed_at, 'batch_end', 'Left ' + where, (en ? labelOf(en) : ''))
    }
  })

  ;(c.payments || []).forEach(function (p) {
    add(p.paid_at, 'payment', 'Paid ' + rupees(p.amount), [p.receipt_no ? 'Receipt ' + p.receipt_no : '', p.mode || ''].filter(Boolean).join(' · '))
  })
  ;(c.feeEvents || []).forEach(function (f) {
    add(f.at, 'fee', 'Fee change: ' + String(f.field || '').replace(/_/g, ' '), (f.old_value != null && f.new_value != null ? f.old_value + ' → ' + f.new_value : '') + (f.actor ? ' · ' + f.actor : ''))
  })
  if (c.student && c.student.closed_at) add(c.student.closed_at, 'closed', 'Account closed', c.student.close_reason || '')

  const order = { admission: 0, enrolled: 1, batch: 2, batch_move: 2, payment: 3, fee: 3, marks: 4, completed: 5, certificate: 6, batch_end: 7, dropped: 7, closed: 8 }
  return ev.sort(function (a, b) { return a.date.localeCompare(b.date) || (order[a.kind] || 0) - (order[b.kind] || 0) })
}

// One line for the top of the timeline: where the child is now.
export function timelineNow(ctx) {
  const c = ctx || {}
  const live = (c.enrollments || []).filter(function (e) { return !e.completed_at && e.status !== 'dropped' })
  const open = (c.memberships || []).filter(function (m) { return !m.removed_at })
  return live.map(function (en) {
    const m = open.find(function (x) { return x.enrollment_id === en.id })
    return labelOf(en) + (m ? ' · ' + ((m.batch && m.batch.name) || 'a batch') + (m.ci ? ' with ' + m.ci : '') : ' · no batch yet')
  })
}
