// The Today / Month close list: everything that needs doing, in one place, each with where to go to fix it.
// Pure — the page supplies the data.
//   month:   'YYYY-MM' being closed        today: 'YYYY-MM-DD'
//   health:  issues from loadBatchHealthIssues()
//   cis:     [{ id, full_name, status, left_at }] CIs who have an appointment
//   runs:    [{ instructor_id, month, status, total }] saved payroll runs for the month
//   certs, ordersToInvoice, ordersToVerify: counts
//   centres: [{ id, business_name, tier, status }]   agreements: [{ franchisee_id, agreement_no, status, generated_at, signed_at }]
// Each item: { group, severity: 'error' | 'warn' | 'info', title, detail, action, page }
const money = function (n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN') }

export function monthIsPast(month, today) { return String(month) < String(today).slice(0, 7) }

export function closeItems(input) {
  const out = []
  const month = input.month
  const past = monthIsPast(month, input.today)
  const first = month + '-01'

  ;(input.health || []).forEach(function (i) {
    out.push({
      group: 'Batches & students', severity: i.severity, page: i.code === 'enrolled_no_batch' ? 'students' : 'batches',
      title: (i.batch || i.student || 'Batch') + (i.ci ? ' · ' + i.ci : ''), detail: i.message, action: i.action,
    })
  })

  ;(input.cis || []).forEach(function (ci) {
    const run = (input.runs || []).find(function (r) { return r.instructor_id === ci.id })
    const goneBefore = ci.left_at && String(ci.left_at).slice(0, 10) < first
    if (!run) {
      if (goneBefore) return
      out.push({ group: 'CI payroll', severity: past ? 'warn' : 'info', page: 'instructors', title: ci.full_name,
        detail: 'Payroll for this month is not prepared yet.', action: 'Instructors → ' + ci.full_name + ' → Payroll: check the lines and Save.' })
    } else if (run.status === 'draft') {
      out.push({ group: 'CI payroll', severity: past ? 'warn' : 'info', page: 'instructors', title: ci.full_name,
        detail: 'Saved (' + money(run.total) + ') but not posted to the accounts.', action: 'Instructors → ' + ci.full_name + ' → Payroll: Post to accounts.' })
    } else if (run.status === 'posted') {
      out.push({ group: 'CI payroll', severity: past ? 'warn' : 'info', page: 'instructors', title: ci.full_name,
        detail: 'Posted (' + money(run.total) + ') but not marked paid.', action: 'Instructors → ' + ci.full_name + ' → Payroll: Mark paid once the bank transfer is done.' })
    }
  })

  if (input.ordersToInvoice > 0) out.push({ group: 'Orders', severity: 'warn', page: 'orders', title: input.ordersToInvoice + ' order' + (input.ordersToInvoice !== 1 ? 's' : '') + ' waiting for an invoice',
    detail: 'Placed by franchisees, not invoiced yet.', action: 'Orders → open the order → Generate invoice.' })
  if (input.ordersToVerify > 0) out.push({ group: 'Orders', severity: 'warn', page: 'orders', title: input.ordersToVerify + ' payment' + (input.ordersToVerify !== 1 ? 's' : '') + ' to verify',
    detail: 'A franchisee has submitted payment proof.', action: 'Orders → open the order → Verify payment.' })
  if (input.certs > 0) out.push({ group: 'Certificates', severity: 'info', page: 'students', title: input.certs + ' certificate' + (input.certs !== 1 ? 's' : '') + ' not issued',
    detail: 'Courses are completed but no certificate has been issued, emailed or sent.', action: 'Students → the student → Courses & Batches → certificate.' })

  // Franchise agreements: every active unit franchise needs a signed agreement. Not generated, or sent and still
  // unsigned for more than 14 days, is a "Check"; a recently sent one is a note.
  ;(input.centres || []).filter(function (c) { return c.tier === 'UF' && (!c.status || c.status === 'active') }).forEach(function (c) {
    const mine = (input.agreements || []).filter(function (a) { return a.franchisee_id === c.id })
    if (mine.some(function (a) { return a.status === 'signed' || a.signed_at })) return
    if (!mine.length) {
      out.push({ group: 'Franchise agreements', severity: 'warn', page: 'franchisees', title: c.business_name,
        detail: 'No agreement has been generated.', action: 'Franchisees → the centre → Agreement: generate it and send it for signature.' })
      return
    }
    const latest = mine.slice().sort(function (a, b) { return String(b.generated_at || '').localeCompare(String(a.generated_at || '')) })[0]
    const days = latest.generated_at && input.today ? Math.round((new Date(String(input.today).slice(0, 10) + 'T00:00:00') - new Date(String(latest.generated_at).slice(0, 10) + 'T00:00:00')) / 86400000) : null
    out.push({ group: 'Franchise agreements', severity: days != null && days > 14 ? 'warn' : 'info', page: 'franchisees', title: c.business_name,
      detail: (latest.agreement_no || 'Agreement') + ' sent for signature' + (days != null ? ' ' + days + ' day' + (days !== 1 ? 's' : '') + ' ago' : '') + ' — not signed yet.',
      action: 'Franchisees → the centre → Agreement: remind the franchisee to sign, or resend it.' })
  })

  const order = { error: 0, warn: 1, info: 2 }
  return out.sort(function (a, b) { return order[a.severity] - order[b.severity] })
}
