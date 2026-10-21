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
export function ciCycleBlocks(dates, perCycle, appointedOn) {
  const n = perCycle > 0 ? perCycle : CI_CYCLE_SESSIONS
  const from = appointedOn ? String(appointedOn).slice(0, 10) : ''
  const all = uniqSorted(dates).filter(function (d) { return !from || d >= from })
  const blocks = []
  for (let i = 0; i < all.length; i += n) {
    const part = all.slice(i, i + n)
    blocks.push({ dates: part, start: part[0], end: part[part.length - 1], count: part.length, perCycle: n, complete: part.length === n })
  }
  return blocks
}

// What is payable in `month` (YYYY-MM) for the given students.
//   students: [{ id, name, dates, perCycle, left, course }]
// A completed cycle is paid in the month its last class falls in. A short last
// cycle is paid pro-rata (rate × classes ÷ perCycle) once the student has left;
// while the student is still going it only shows as in progress.
export function ciCyclePayroll(students, month, rate, appointedOn) {
  const r = Math.max(0, Number(rate) || 0)
  const rows = []
  const inProgress = []
  let total = 0
  ;(students || []).forEach(function (s) {
    const blocks = ciCycleBlocks(s.dates, s.perCycle, appointedOn)
    const paid = []
    blocks.forEach(function (b, i) {
      const last = i === blocks.length - 1
      const endMonth = b.end.slice(0, 7)
      if (b.complete) {
        if (endMonth === month) paid.push({ ...b, amount: Math.round(r) })
      } else if (last) {
        const accrued = Math.round(r * b.count / b.perCycle)
        if (s.left) { if (endMonth === month) paid.push({ ...b, amount: accrued, partial: true }) }
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
