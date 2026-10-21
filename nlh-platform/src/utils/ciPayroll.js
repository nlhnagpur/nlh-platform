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
// `paidThrough`: classes up to and including this date are already paid (a saved
// payroll line covered them), so the next cycle starts after it.
export function ciCycleBlocks(dates, perCycle, appointedOn, paidThrough) {
  const n = perCycle > 0 ? perCycle : CI_CYCLE_SESSIONS
  const from = appointedOn ? String(appointedOn).slice(0, 10) : ''
  const done = paidThrough ? String(paidThrough).slice(0, 10) : ''
  const all = uniqSorted(dates).filter(function (d) { return (!from || d >= from) && (!done || d > done) })
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
