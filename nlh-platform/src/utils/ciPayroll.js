// "Per student, per cycle" pay for a CI (class instructor).
//
// Each student the CI teaches is a cycle of CI_CYCLE_SESSIONS classes. The CI
// is paid the appointment's rate for every cycle that is completed. Only
// classes the CI themselves took count (a substitute's class doesn't), and only
// from the CI's appointment date — so a cycle is paid pro-rata to the classes
// the CI actually taught, and nothing is paid for time before they joined.
//
//   dates     the days the student attended a class the CI taught (any order)
//   perCycle  classes in one cycle (the student's own cycle length, else 25)

export const CI_CYCLE_SESSIONS = 25

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']

function uniqSorted(dates) {
  return Array.from(new Set((dates || []).map(function (d) { return String(d).slice(0, 10) }))).sort()
}

// Split the classes the CI taught this student into cycles of `perCycle`.
// The last block may be short (still running, or the student left).
// Where the next pay period starts after one that was paid up to `to`: the 1st of the
// next month when the period ended at month end (the 30th or 31st, or the last day of
// a shorter month), otherwise the very next day.
export function nextCycleStart(to) {
  const t = String(to || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return ''
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)), day = Number(t.slice(8, 10))
  const last = new Date(y, m, 0).getDate()
  const pad = function (n) { return String(n).padStart(2, '0') }
  if (day >= 30 || day === last) return m === 12 ? (y + 1) + '-01-01' : y + '-' + pad(m + 1) + '-01'
  return y + '-' + pad(m) + '-' + pad(day + 1)
}

// `paidThrough`: the last date a saved payroll line already paid for; the next cycle
// starts where nextCycleStart says.
export function ciCycleBlocks(dates, perCycle, appointedOn, paidThrough) {
  const n = perCycle > 0 ? perCycle : CI_CYCLE_SESSIONS
  const from = appointedOn ? String(appointedOn).slice(0, 10) : ''
  const resume = paidThrough ? nextCycleStart(paidThrough) : ''
  const all = uniqSorted(dates).filter(function (d) { return (!from || d >= from) && (!resume || d >= resume) })
  const blocks = []
  for (let i = 0; i < all.length; i += n) {
    const part = all.slice(i, i + n)
    blocks.push({ dates: part, start: part[0], end: part[part.length - 1], count: part.length, perCycle: n, complete: part.length === n })
  }
  return blocks
}

// What is payable in `month` (YYYY-MM) for the given students.
//   students: [{ id, name, dates, perCycle, left, course }]
// A cycle belongs to the month it STARTS in (its first class): the cycle that
// began on 7 Sep is September's pay even though it closed on 8 Oct. It is only
// payable once complete. A short last cycle is paid pro-rata (rate × classes ÷
// perCycle) once the student has left; while the student is still going it only
// shows as in progress.
export function ciCyclePayroll(students, month, rate, appointedOn) {
  const r = Math.max(0, Number(rate) || 0)
  const rows = []
  const inProgress = []
  let total = 0
  ;(students || []).forEach(function (s) {
    const blocks = ciCycleBlocks(s.dates, s.perCycle, appointedOn, s.paidThrough)
    const paid = []
    blocks.forEach(function (b, i) {
      const last = i === blocks.length - 1
      const startMonth = b.start.slice(0, 7)
      if (b.complete) {
        if (startMonth === month) paid.push({ ...b, amount: Math.round(r), rate: r })
      } else if (last) {
        const accrued = Math.round(r * b.count / b.perCycle)
        if (s.left) { if (startMonth === month) paid.push({ ...b, amount: accrued, partial: true, rate: r }) }
        else inProgress.push({ id: s.id, name: s.name, count: b.count, perCycle: b.perCycle, start: b.start, accrued: accrued })
      }
    })
    if (paid.length) {
      const amount = paid.reduce(function (t, b) { return t + b.amount }, 0)
      rows.push({ id: s.id, name: s.name, course: s.course || '', blocks: paid, amount: amount })
      total += amount
    }
  })
  return { rows: rows, inProgress: inProgress, total: total }
}

// "( Sept-2026, 7,8,9 ) ( Oct-2026, 1,3 )" — a block's dates grouped by month.
export function datesByMonth(dates) {
  const groups = []
  uniqSorted(dates).forEach(function (d) {
    const key = d.slice(0, 7)
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) { g = { key: key, days: [] }; groups.push(g) }
    g.days.push(Number(d.slice(8, 10)))
  })
  return groups.map(function (g) {
    return '( ' + MONTHS[Number(g.key.slice(5, 7)) - 1] + '-' + g.key.slice(0, 4) + ', ' + g.days.join(',') + ' )'
  }).join(' ')
}

// Classes among `dates` that fall from `from` to `to` (both inclusive).
export function countInRange(dates, from, to) {
  const a = from ? String(from).slice(0, 10) : ''
  const b = to ? String(to).slice(0, 10) : ''
  return uniqSorted(dates).filter(function (d) { return (!a || d >= a) && (!b || d <= b) }).length
}

// Pay for `count` classes of a `perCycle`-class cycle: the full rate for a whole
// cycle, pro-rata otherwise.
export function amountForClasses(rate, count, perCycle) {
  const n = perCycle > 0 ? perCycle : CI_CYCLE_SESSIONS
  return Math.round((Number(rate) || 0) * (Number(count) || 0) / n)
}

// ── which appointment pays for a batch's students ───────────────────────────────
// A CI is paid for the COURSE they teach — the programme name (Phonics, Tuitions, …). Its levels are
// separate records in the system, and a student moves up a level as they complete one, so the level
// is irrelevant to the CI: every student on the batch counts under the CI's appointment for the
// programme. A CI can hold several appointments for one programme (one per level, entered over time);
// the one in force is the latest appointed on or before the end of the month.
//   appts: [{ remuneration_mode, remuneration_rate, appointed_at, skus: { courses: { group_name } } }]
function courseKey(name) { return String(name || '').trim().toLowerCase() }

export function appointmentForCourse(appts, course, monthEnd) {
  const end = monthEnd ? String(monthEnd).slice(0, 10) : ''
  const key = courseKey(course)
  const mine = (appts || []).filter(function (a) {
    const c = a.skus && a.skus.courses && a.skus.courses.group_name
    return key && courseKey(c) === key && (!a.appointed_at || !end || String(a.appointed_at).slice(0, 10) <= end)
  })
  mine.sort(function (x, y) { return String(y.appointed_at || '').localeCompare(String(x.appointed_at || '')) })
  return mine[0] || null
}

// Per programme on a batch's roster, for one month:
//   completions / doneNames / doneMembers   students who completed a level of it in the month
//   active / activeNames / activeMembers    students on the roster at any point in the month (not finished or removed before it)
//   a member is { label, from, to }: the days of the month the student was on the batch
//   roster: [{ course, student, level, assigned_at, removed_at, completed_at }]
export function batchCourseStats(roster, month) {
  const start = month + '-01'
  const end = month + '-31'
  const out = {}
  ;(roster || []).forEach(function (r) {
    if (!r.course) return
    const st = out[r.course] || (out[r.course] = { completions: 0, active: 0, doneNames: [], activeNames: [], doneMembers: [], activeMembers: [] })
    const label = (r.student || '') + (r.student && r.level ? ' (' + r.level + ')' : '')
    const assigned = r.assigned_at ? String(r.assigned_at).slice(0, 10) : ''
    const removed = r.removed_at ? String(r.removed_at).slice(0, 10) : ''
    const done = r.completed_at ? String(r.completed_at).slice(0, 10) : ''
    const from = assigned && assigned > start ? assigned : start
    const realEnd = month + '-' + String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, '0')
    const lastDay = [removed, done].filter(Boolean).sort()[0] || realEnd
    const to = lastDay < realEnd ? lastDay : realEnd
    const member = { label: label, from: from, to: to }
    if (done && done >= start && done <= end) { st.completions++; if (label) { st.doneNames.push(label); st.doneMembers.push(member) } }
    const onRoster = (!assigned || assigned <= end) && (!removed || removed >= start) && (!done || done >= start)
    if (onRoster) { st.active++; if (label) { st.activeNames.push(label); st.activeMembers.push(member) } }
  })
  return out
}

// A monthly / on-completion student's pay is the rate scaled by the share of the batch's classes the
// CI took in the period: `ci` classes the CI took out of `all` held.
export function amountForShare(rate, ci, all) {
  if (!(all > 0)) return 0
  return Math.round((Number(rate) || 0) * (Number(ci) || 0) / all)
}

// Split `total` rupees over `n` students: whole rupees, and the parts add up exactly to the total
// (the first few students carry the odd rupee).
export function splitAmount(total, n) {
  const count = Math.max(0, Math.floor(Number(n) || 0))
  if (!count) return []
  const t = Math.round(Number(total) || 0)
  const base = Math.floor(t / count)
  const extra = t - base * count
  return Array.from({ length: count }, function (_, i) { return base + (i < extra ? 1 : 0) })
}

// ONE rule for what happens when the dates on any payroll line are changed: re-count what the dates
// cover and re-price the line. Every pay basis produces the same kind of line and goes through here.
//   line.meta.kind: 'session' (classes taken × rate) · 'share' (rate × classes the CI took ÷ classes held)
//                   · 'fixed' (a fixed amount — the dates are a record only) · otherwise a 25-class cycle
//   ctx: { datesBySid: cycle students' class dates, shareDates: per batch { ci, all } class dates }
export function recountLine(line, from, to, ctx) {
  const m = line && line.meta
  if (!m) return line
  const c = ctx || {}
  if (m.kind === 'fixed') return { ...line, meta: { ...m, from: from, to: to } }
  if (m.kind === 'session') {
    const bd = (c.shareDates || {})[m.sid] || { all: [], ci: [] }
    const ci = countInRange(bd.ci, from, to)
    return { ...line, meta: { ...m, from: from, to: to, count: ci }, amount: ci * (m.rate || 0) }
  }
  if (m.kind === 'share') {
    const bd = (c.shareDates || {})[m.sid] || { all: [], ci: [] }
    const ci = countInRange(bd.ci, from, to)
    const all = countInRange(bd.all, from, to)
    return { ...line, meta: { ...m, from: from, to: to, count: ci, total: all }, amount: amountForShare(m.rate, ci, all) }
  }
  const count = countInRange((c.datesBySid || {})[m.sid] || [], from, to)
  return { ...line, meta: { ...m, from: from, to: to, count: count }, amount: amountForClasses(m.rate, count, m.perCycle) }
}
