// A monthly-billing cycle runs from its start date to the same date next
// month (not a rolling 28 days). Its class target is the number of the
// student's class days in that window, less any days the batch declared a
// holiday — it varies with the calendar rather than being a fixed number.
// All seven days are class days by default (holidays and the weekly off are
// declared by hand); a student can be enrolled for fewer, e.g. Sat + Sun only.
// When Saturday is NOT one of the student's class days, Saturday classes are
// revision, included in the fee: they don't raise the target, and count only
// to make up classes the student missed.
import { monthBlocks, nextMonthStart, MONTH_SESSIONS } from './monthCycle.js'

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

// Progress through one monthly cycle — a month is MONTH_SESSIONS (22) classes (utils/monthCycle.js).
//   sessions    batch_sessions rows { id, session_date, is_holiday } for the student's batches (every batch they were on)
//   attendance  Map(session_id -> attended boolean) for this student's enrolment.
//               A session with no entry is "not marked" — attendance was never
//               recorded — which is not the same thing as "absent".
// The month starts on the stored cycle start (set at enrolment and at each renewal) and is complete on the 22nd class
// held for the student: Mon–Fri or Mon–Sat, declared holidays and the student's own off days left out. A class that
// was held counts whether the student came or not — attendance is shown beside it (S sessions, P present, A absent,
// U not marked) but does not change the count.
//   complete    the 22nd class has been held — the next month is due (renew)
//   completedOn the day of the 22nd class (projected from the schedule while the month runs)
//   dueOn       the renewal date: the same date next month when the 22nd class comes before it (extra classes until then are
//               free), otherwise the day of the 22nd class (the next class is the 1st of the new month)
//   nextStart   the day the next month starts: that renewal date, or the day after the 22nd class
export function computeCycle(en, sessions, attendance, scheduleDays, today, noClass) {
  const start = cycleAnchor(en)
  if (!start) return null
  const todayStr = today || todayIso()
  const sched = cycleDows(en.cycle_days, scheduleDays)
  const att = attendance || new Map()
  const nc = noClass || new Set()
  const all = sessions || []
  const holidayDates = new Set(all.filter(function (s) { return s.is_holiday }).map(function (s) { return String(s.session_date).slice(0, 10) }))
  const ran = all.filter(function (s) {
    const d = String(s.session_date).slice(0, 10)
    return !s.is_holiday && d >= start && d <= todayStr && !nc.has(d) && (dowOf(d) !== 0 || sched.has(0))
  })
  const byDate = {}
  ran.forEach(function (s) { const d = String(s.session_date).slice(0, 10); if (!byDate[d] || (!att.has(byDate[d].id) && att.has(s.id))) byDate[d] = s })
  const held = Object.keys(byDate).sort()
  const r = monthBlocks(held, start)
  const done = r.blocks.length ? r.blocks[0] : null
  const inMonth = done ? done.dates : (r.open ? r.open.dates : [])
  const counted = inMonth.map(function (d) { return byDate[d] })
  const sP = counted.filter(function (s) { return att.get(s.id) === true }).length
  const sA = counted.filter(function (s) { return att.get(s.id) === false }).length

  // when the 22nd class falls: the day it was held, or projected from the class days still to come
  let d22 = done ? done.completedOn : ''
  if (!d22) {
    let need = MONTH_SESSIONS - inMonth.length
    const weekly = sched.size === 7 ? new Set([1, 2, 3, 4, 5, 6]) : sched   // no schedule recorded: Mon–Sat
    let d = held.length && held[held.length - 1] >= todayStr ? held[held.length - 1] : todayStr
    for (let i = 0; i < 150 && need > 0; i++) {
      d = nextDay(d)
      if (weekly.has(dowOf(d)) && !holidayDates.has(d) && !nc.has(d)) need--
    }
    d22 = need > 0 ? '' : d
  }
  const windowEnd = addOneMonth(start)
  const dueOn = d22 && d22 >= windowEnd ? d22 : windowEnd
  const nextStart = d22 ? nextMonthStart(start, d22) : windowEnd
  return {
    start: start, due: dueOn, end: d22 && d22 < windowEnd ? d22 : (d22 || prevDay(windowEnd)), dueOn: dueOn, completedOn: d22, windowEnd: windowEnd, nextStart: nextStart, complete: !!done,
    target: MONTH_SESSIONS, done: Math.min(MONTH_SESSIONS, inMonth.length), held: inMonth.length,
    attendedWeekday: sP, attendedSat: 0, absent: sA, unmarked: counted.length - sP - sA, makeUp: 0,
    // S sessions held for this student, P present, A absent, U not marked (S = P + A + U), N days with no class for them.
    spa: { S: counted.length, P: sP, A: sA, U: counted.length - sP - sA, N: Array.from(nc).filter(function (d) { return d >= start && d <= todayStr }).length },
    days: CYCLE_DAY_NAMES.filter(function (n) { return sched.has(DOW_KEYS[n]) }),
    satRevision: false,
  }
}

// Enrolments made before cycle tracking existed have no cycle_started_at —
// they started their first cycle the day they enrolled.
// The classes that count towards a child's cycle: those held by EVERY batch the child has been on, each only
// within the dates the child was on that batch (both ends inclusive). A child moved to another batch keeps the
// cycle they had — it does not restart. One class per date: if two batches ran the same day, the one the child
// has attendance for is kept.
//   memberships: [{ batch_id, assigned_at, removed_at }]   sessions: [{ id, batch_id, session_date, is_holiday }]
export function cycleSessionsAcrossBatches(memberships, sessions, attendance) {
  const mems = (memberships || []).map(function (m) {
    return { batch_id: m.batch_id, from: m.assigned_at ? String(m.assigned_at).slice(0, 10) : '', to: m.removed_at ? String(m.removed_at).slice(0, 10) : '' }
  })
  const att = attendance || new Map()
  const byDate = {}
  ;(sessions || []).forEach(function (s) {
    const d = String(s.session_date).slice(0, 10)
    const on = mems.some(function (m) { return m.batch_id === s.batch_id && (!m.from || d >= m.from) && (!m.to || d <= m.to) })
    if (!on) return
    const cur = byDate[d]
    if (!cur || (!att.has(cur.id) && att.has(s.id))) byDate[d] = s
  })
  return Object.keys(byDate).sort().map(function (d) { return byDate[d] })
}

export function cycleAnchor(en) {
  if (en.cycle_started_at) return String(en.cycle_started_at).slice(0, 10)
  if (en.enrolled_at) return String(en.enrolled_at).slice(0, 10)
  return null
}

// What changing an enrolment's level writes. By default the new level starts
// its own monthly cycle on `startDate` (class target and renewal date restart).
// When the fee for the CURRENT cycle is already paid — e.g. the course was
// renewed on the 9th and the next level's book is handed over mid-cycle —
// `keepCycle` swaps only the level and leaves the cycle start (so the class
// count, target and renewal date) untouched. The fee is never touched here.
export function levelChangePatch(newSkuId, opts) {
  const o = opts || {}
  if (o.keepCycle) return { sku_id: newSkuId }
  return { sku_id: newSkuId, cycle_started_at: o.startDate || todayIso() }
}

// The enrolment fields written when a mid-cycle level change also sets the
// monthly fee that applies from the NEXT renewal (e.g. the new level's
// catalogue fee). Only the enrolment's own fee_amount / list_price move — the
// student's fee_total, invoices and payments are never touched here.
// Fees differ from student to student, so the fee already set for the student
// is KEPT unless it is deliberately changed: when `currentFee` equals the fee
// entered, the patch is empty (nothing about the fee is written).
export function levelFeePatch(monthlyFee, catalogueFee, currentFee) {
  if (monthlyFee === '' || monthlyFee === null || monthlyFee === undefined) return null
  const fee = Math.round(Number(monthlyFee))
  if (!isFinite(fee) || fee < 0) return null
  if (currentFee !== undefined && currentFee !== null && Math.round(Number(currentFee)) === fee) return {}
  const patch = { fee_amount: fee }
  if (catalogueFee != null && isFinite(Number(catalogueFee))) patch.list_price = Math.round(Number(catalogueFee))
  return patch
}

// The record of a level that has been finished, inserted when an enrolment is
// carried on to its next level in place (see levelChangePatch). It exists so the
// finished level has a completion date and a certificate. It deliberately
// carries NO money (fee_amount, list_price and waived are all 0): the fee for
// the running cycle stays on the live enrolment, so fee_total, invoices and the
// course-wise fee view are unchanged.
export function completedLevelRow(en, studentId, franchiseeId, completedDate) {
  const day = String((completedDate || todayIso())).slice(0, 10)
  return {
    student_id: studentId,
    sku_id: en.sku_id,
    franchisee_id: franchiseeId || null,
    enrolled_at: en.enrolled_at || (day + 'T00:00:00+00:00'),
    completed_at: day + 'T12:00:00+00:00',
    status: 'completed',
    fee_amount: 0,
    list_price: 0,
    waived: 0,
  }
}

// A finished-level record made by "Also record the previous level as completed"
// (see completedLevelRow): completed, and carrying no money and no cycle.
export function isFinishedLevelRecord(en) {
  return !!en.completed_at && !Number(en.fee_amount) && !Number(en.list_price) && !Number(en.waived) && !en.cycle_started_at
}

// Attended-session counts per enrolment for display. Attendance rows stay on the
// live enrolment when a level is carried on in place, so by default the new
// level would show every class since the first day. Where finished-level
// records exist for the same course, the live enrolment's attended days are
// split at each record's completion date: classes on or before it belong to
// that finished level, the rest to the live one. Display only — cycle progress
// is still computed from the live enrolment's own attendance.
//   datesByEnr: { [enrollment_id]: ['YYYY-MM-DD', …] } attended days
export function levelSessionCounts(enrolments, datesByEnr) {
  const list = enrolments || []
  const dates = datesByEnr || {}
  const out = {}
  list.forEach(function (e) { out[e.id] = (dates[e.id] || []).length })
  const groupOf = function (e) { return (e.skus && e.skus.courses && e.skus.courses.group_name) || '' }
  const live = list.filter(function (e) { return !e.completed_at && e.status !== 'dropped' })
  live.forEach(function (l) {
    const g = groupOf(l)
    if (!g || live.filter(function (x) { return groupOf(x) === g }).length !== 1) return
    const records = list.filter(function (r) {
      return r.id !== l.id && groupOf(r) === g && isFinishedLevelRecord(r) && (dates[r.id] || []).length === 0
    }).sort(function (a, b) { return String(a.completed_at).localeCompare(String(b.completed_at)) })
    if (!records.length) return
    let rest = (dates[l.id] || []).slice().sort()
    records.forEach(function (r) {
      const cut = String(r.completed_at).slice(0, 10)
      out[r.id] = rest.filter(function (d) { return d <= cut }).length
      rest = rest.filter(function (d) { return d > cut })
    })
    out[l.id] = rest.length
  })
  return out
}

// Whether a monthly enrolment is mid-cycle (renewed and not yet due again) —
// the case where a level change should normally keep the cycle.
export function cycleInProgress(en, today, cycle) {
  const t = String(today || todayIso()).slice(0, 10)
  if (!isMonthlyActive(en)) return false
  if (cycle) return !cycle.complete
  const anchor = cycleAnchor(en)
  if (!anchor) return false
  const due = addOneMonth(anchor)
  return anchor <= t && t < due
}

export function isMonthlyActive(en) {
  return !en.completed_at && en.status !== 'dropped' && en.skus?.courses?.billing_type === 'monthly'
}

// { due, daysLeft, state: 'overdue' | 'soon' | 'ok' } for a monthly enrolment.
// With the computed cycle (computeCycle) the renewal is due when the month's 22nd class is held; without it
// (a screen that has not loaded classes) it falls back to the same date next month.
export function renewalInfo(en, today, cycle) {
  const anchor = cycleAnchor(en)
  if (!anchor) return null
  const due = cycle && cycle.dueOn ? cycle.dueOn : addOneMonth(anchor)
  const nextStart = cycle && cycle.nextStart ? cycle.nextStart : due
  const daysLeft = daysBetween(today || todayIso(), due)
  return { due: due, nextStart: nextStart, daysLeft: daysLeft, state: daysLeft < 0 ? 'overdue' : daysLeft <= RENEW_SOON_DAYS ? 'soon' : 'ok' }
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
export function attentionReasons(student, attMap, cycleMap) {
  const out = []
  const ens = student.enrollments || []
  const today = todayIso()

  const overdue = [], soon = []
  ens.forEach(function (en) {
    if (!isMonthlyActive(en)) return
    const r = renewalInfo(en, today, (cycleMap || {})[en.id])
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

// The next level of the same course after `currentSkuId`, given the centre's levels in curriculum order.
// Null when the student is on the last level the centre offers.
export function nextLevelSku(skus, currentSkuId) {
  const list = skus || []
  const i = list.findIndex(function (x) { return x.id === currentSkuId })
  if (i < 0) return null
  const cur = list[i]
  for (let j = i + 1; j < list.length; j++) {
    if (list[j].course_id === cur.course_id) return list[j]
  }
  return null
}
