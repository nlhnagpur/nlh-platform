// A monthly-billing student gets this many sessions per cycle, and the cycle
// renews on the same date next month (not a rolling 28 days).
export const CYCLE_SESSIONS = 22
const RENEW_SOON_DAYS = 5

function isoDay(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export function todayIso() { return isoDay(new Date()) }

// "5 Oct" — compact date for chips and pills.
export function shortDay(iso) {
  if (!iso) return ''
  return new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// Same calendar date next month; a 31st that doesn't exist next month lands
// on that month's last day (31 Jan -> 28/29 Feb).
export function addOneMonth(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  const lastDay = new Date(y, m + 1, 0).getDate()
  return isoDay(new Date(y, m, Math.min(d, lastDay)))
}

function daysBetween(fromIso, toIso) {
  return Math.round((new Date(toIso + 'T00:00:00') - new Date(fromIso + 'T00:00:00')) / 86400000)
}

// Enrolments made before cycle tracking existed have no cycle_started_at —
// they started their first cycle the day they enrolled.
export function cycleAnchor(en) {
  if (en.cycle_started_at) return String(en.cycle_started_at).slice(0, 10)
  if (en.enrolled_at) return String(en.enrolled_at).slice(0, 10)
  return null
}

export function isMonthlyActive(en) {
  return !en.completed_at && en.status !== 'dropped' && en.skus?.courses?.billing_type === 'monthly'
}

// { due, daysLeft, state: 'overdue' | 'soon' | 'ok' } for a monthly enrolment.
export function renewalInfo(en, today) {
  const anchor = cycleAnchor(en)
  if (!anchor) return null
  const due = addOneMonth(anchor)
  const daysLeft = daysBetween(today || todayIso(), due)
  return { due: due, daysLeft: daysLeft, state: daysLeft < 0 ? 'overdue' : daysLeft <= RENEW_SOON_DAYS ? 'soon' : 'ok' }
}

export function enrolmentBucket(en) {
  if (en.completed_at) return 'completed'
  if (en.status === 'dropped') return 'dropped'
  return 'active'
}

export function certPending(en) {
  return !!en.completed_at && !en.cert_wa_sent_at && !en.cert_emailed_at
}

// Why a student needs attention. attMap = { [enrolment_id]: attended count }.
// Returns [{ key, label, tone: 'red' | 'amber' }].
export function attentionReasons(student, attMap) {
  const out = []
  const ens = student.enrollments || []
  const today = todayIso()

  const overdue = [], soon = []
  ens.forEach(function (en) {
    if (!isMonthlyActive(en)) return
    const r = renewalInfo(en, today)
    if (!r) return
    if (r.state === 'overdue') overdue.push(r)
    else if (r.state === 'soon') soon.push(r)
  })
  if (overdue.length) {
    const worst = Math.max.apply(null, overdue.map(function (r) { return -r.daysLeft }))
    out.push({ key: 'renew_overdue', label: 'Renewal overdue ' + worst + 'd', tone: 'red' })
  }
  if (soon.length) {
    const next = soon.map(function (r) { return r.due }).sort()[0]
    out.push({ key: 'renew_soon', label: 'Renews ' + next, tone: 'amber', date: next })
  }

  const sessionsDone = ens.filter(function (en) {
    const tot = en.skus?.total_sessions || 0
    return enrolmentBucket(en) === 'active' && en.skus?.courses?.billing_type !== 'monthly' && tot > 0 && (attMap[en.id] || 0) >= tot
  })
  if (sessionsDone.length) out.push({ key: 'sessions_done', label: 'Sessions done — mark complete', tone: 'amber' })

  const certs = ens.filter(certPending).length
  if (certs) out.push({ key: 'cert_pending', label: certs > 1 ? certs + ' certificates pending' : 'Certificate pending', tone: 'amber' })

  if (Math.max(0, (student.fee_total || 0) - (student.fee_paid || 0)) > 0) {
    out.push({ key: 'balance', label: 'Balance due', tone: 'red' })
  }
  return out
}

export function studentBucket(student) {
  const ens = student.enrollments || []
  if (ens.some(function (en) { return enrolmentBucket(en) === 'active' })) return 'current'
  return 'past'
}

// PostgREST silently caps a single response at 1000 rows — attendance alone
// is well past that, so an un-paged read drops rows without any error (the
// list was showing 0/15 for current handwriting students because of it).
// Pages a query until a short page comes back; build(from, to) must return a
// fresh, stably-ordered query for that range.
export async function fetchAllRows(build) {
  const pageSize = 1000
  let all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw error
    all = all.concat(data || [])
    if (!data || data.length < pageSize) break
  }
  return all
}
