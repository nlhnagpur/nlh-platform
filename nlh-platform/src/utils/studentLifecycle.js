// A monthly-billing cycle runs from its start date to the same date next
// month (not a rolling 28 days). Its class target is the number of the
// student's class days in that window, less any days the batch declared a
// holiday — it varies with the calendar rather than being a fixed number.
// All seven days are class days by default (holidays and the weekly off are
// declared by hand); a student can be enrolled for fewer, e.g. Sat + Sun only.
// When Saturday is NOT one of the student's class days, Saturday classes are
// revision, included in the fee: they don't raise the target, and count only
// to make up classes the student missed.
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

function dowOf(iso) { return new Date(String(iso).slice(0, 10) + 'T00:00:00').getDay() }   // 0 Sun .. 6 Sat

function nextDay(iso) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return isoDay(d)
}

const DOW_KEYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function parseDows(str) {
  const set = new Set()
  String(str || '').split(/[,\s]+/).forEach(function (t) {
    if (!t) return
    const k = t.slice(0, 1).toUpperCase() + t.slice(1, 3).toLowerCase()
    if (DOW_KEYS[k] !== undefined) set.add(DOW_KEYS[k])
  })
  return set
}

// Days of the week (0 Sun .. 6 Sat) that count as a student's class days.
// Days chosen for the student at renewal win; failing that the batch's own
// days; a blank schedule means all seven days — holidays and the weekly off
// are declared by hand on the batch and come off the target that way.
export function cycleDows(cycleDays, scheduleDays) {
  const own = parseDows(cycleDays)
  if (own.size) return own
  const batch = parseDows(scheduleDays)
  if (batch.size) return batch
  return new Set([0, 1, 2, 3, 4, 5, 6])
}

function prevDay(iso) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return isoDay(d)
}

export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
export const CYCLE_DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// "Mon, Wed, Fri" / "Sat, Sun" — the selected days in calendar order, for storing.
export function formatCycleDays(names) {
  return CYCLE_DAY_NAMES.filter(function (n) { return names.includes(n) }).join(', ')
}

// Day names in force for a student — see cycleDows.
export function parseCycleDays(cycleDays, scheduleDays) {
  const set = cycleDows(cycleDays, scheduleDays)
  return CYCLE_DAY_NAMES.filter(function (n) { return set.has(DOW_KEYS[n]) })
}

// How many class days a cycle starting on startIso would have for the chosen
// days, before any declared holidays come off — for the renew dialog's
// preview. Same window as computeCycle: start up to the same date next month.
export function countCycleDays(startIso, names) {
  const sched = new Set(names.map(function (n) { return DOW_KEYS[n] }))
  const due = addOneMonth(startIso)
  let n = 0
  for (let d = startIso; d < due; d = nextDay(d)) if (sched.has(dowOf(d))) n++
  return n
}

// Progress through one monthly cycle.
//   sessions    batch_sessions rows { id, session_date, is_holiday } for the student's batch
//   attendance  Map(session_id -> attended boolean) for this student's enrolment.
//               A session with no entry is "not marked" — attendance was never
//               recorded — which is not the same thing as "absent".
// target  = the student's class days in [start, due) minus declared holidays
// done    = regular classes attended + Saturday revision classes attended, the
//           revision ones only up to the number of regular classes the student
//           was marked ABSENT for (capped at target). Not-marked classes aren't
//           counted either way — they're surfaced so attendance gets filled in.
//           Saturday is a regular class, not revision, for a student who has
//           Saturday as a class day; likewise Sunday only counts for a student
//           who has Sunday as a class day.
export function computeCycle(en, sessions, attendance, scheduleDays, today, noClass) {
  const start = cycleAnchor(en)
  if (!start) return null
  const due = addOneMonth(start)
  const todayStr = today || todayIso()
  const sched = cycleDows(en.cycle_days, scheduleDays)
  const att = attendance || new Map()
  // Dates this student has no class (a personal off day): not a class for them,
  // so out of their target, sessions held and absences.
  const nc = noClass || new Set()
  const inWindow = (sessions || []).filter(function (s) { return s.session_date >= start && s.session_date < due })
  const holidayDates = new Set(inWindow.filter(function (s) { return s.is_holiday }).map(function (s) { return s.session_date }))

  let target = 0
  for (let d = start; d < due; d = nextDay(d)) {
    if (sched.has(dowOf(d)) && !holidayDates.has(d) && !nc.has(d)) target++
  }

  const ran = inWindow.filter(function (s) { return !s.is_holiday && s.session_date <= todayStr && !nc.has(s.session_date) })
  const weekday = ran.filter(function (s) { const w = dowOf(s.session_date); return (w >= 1 && w <= 5) || sched.has(w) })
  const saturday = ran.filter(function (s) { return dowOf(s.session_date) === 6 && !sched.has(6) })
  const attendedWeekday = weekday.filter(function (s) { return att.get(s.id) === true }).length
  const absent = weekday.filter(function (s) { return att.get(s.id) === false }).length
  const unmarked = weekday.filter(function (s) { return !att.has(s.id) }).length
  const attendedSat = saturday.filter(function (s) { return att.get(s.id) === true }).length
  const makeUp = Math.min(absent, attendedSat)
  // Plain tally of every class that ran in the cycle so far (Saturday revision
  // included; Sunday classes only for a student who has Sunday as a class
  // day): S sessions, P present, A absent, U not marked. S = P + A + U.
  const counted = ran.filter(function (s) { return dowOf(s.session_date) !== 0 || sched.has(0) })
  const sP = counted.filter(function (s) { return att.get(s.id) === true }).length
  const sA = counted.filter(function (s) { return att.get(s.id) === false }).length
  return {
    start: start, due: due, end: prevDay(due), target: target,
    done: Math.min(target, attendedWeekday + makeUp),
    held: weekday.length, attendedWeekday: attendedWeekday, attendedSat: attendedSat,
    absent: absent, unmarked: unmarked, makeUp: makeUp,
    // S sessions held for this student, P present, A absent, U not marked
    // (S = P + A + U), N days with no class for them.
    spa: { S: counted.length, P: sP, A: sA, U: counted.length - sP - sA, N: Array.from(nc).filter(function (d) { return d >= start && d < due && d <= todayStr }).length },
    days: CYCLE_DAY_NAMES.filter(function (n) { return sched.has(DOW_KEYS[n]) }),
    satRevision: !sched.has(6),
  }
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
  return !!en.completed_at && !en.cert_wa_sent_at && !en.cert_emailed_at && !en.cert_issued_at
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
  if (sessionsDone.length) out.push({ key: 'sessions_done', label: 'Sessions done', tone: 'amber' })

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
