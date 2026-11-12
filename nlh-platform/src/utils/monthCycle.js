// The "month" of a child (and of the CI who teaches them): a block of MONTH_SESSIONS (22) classes.
//   • A month is complete on the 22nd class the child had — Mon–Fri or Mon–Sat, holidays and personal off days left out.
//   • If the 22nd class falls in the calendar month the block started in, the month is counted there, even if the
//     child had 25 classes: the extra classes are free and the next month starts on the 1st of the next calendar month.
//   • If the block spills into the next calendar month, it is counted on the day of the 22nd class, and the next month
//     starts the day after.
//   • A month that is stopped before the 22nd class (child or CI leaves) is paid pro-rata: classes taken ÷ 22.
// Pure functions — no database access. Used by CI payroll and by the student's renewal screens so both agree.

export const MONTH_SESSIONS = 22

const d10 = function (v) { return v ? String(v).slice(0, 10) : '' }

function addDays(iso, n) {
  const x = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n)
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')
}
function firstOfNextMonth(iso) {
  const x = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 1)
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-01'
}
function uniqSorted(dates) {
  return Array.from(new Set((dates || []).map(d10).filter(Boolean))).sort()
}

// The day the next month starts after one that started on `start` and was completed on `completedOn`.
export function nextMonthStart(start, completedOn) {
  const s = d10(start), c = d10(completedOn)
  return s.slice(0, 7) !== c.slice(0, 7) ? addDays(c, 1) : firstOfNextMonth(c)
}

// dates:  every class the child had (any CI), once per date
// anchor: the day the child's first month starts (enrolment / cycle start); classes before it are ignored
// Returns { blocks, open, nextAnchor }
//   blocks: completed months  { start, completedOn, payMonth, dates (the 22), spill, free (extra classes not counted) }
//   open:   the running month { start, dates, count } — null when no class has been held in it yet
export function monthBlocks(dates, anchor, size) {
  const n = size || MONTH_SESSIONS
  const ds = uniqSorted(dates)
  let start = d10(anchor) || ds[0] || ''
  const blocks = []
  let cur = []
  let free = []
  let skipUntil = ''   // classes before this day are free (extras of a month completed inside its own calendar month)
  ds.forEach(function (d) {
    if (skipUntil && d < skipUntil) { free.push(d); return }
    if (d < start) return
    cur.push(d)
    if (cur.length === n) {
      const spill = start.slice(0, 7) !== d.slice(0, 7)
      blocks.push({ start: start, completedOn: d, payMonth: d.slice(0, 7), dates: cur, spill: spill, free: [] })
      start = spill ? addDays(d, 1) : firstOfNextMonth(d)
      skipUntil = spill ? '' : start
      cur = []
    }
  })
  if (blocks.length && free.length) blocks[blocks.length - 1].free = free
  return { blocks: blocks, open: cur.length ? { start: start, dates: cur, count: cur.length } : null, nextAnchor: start }
}

// What the CI is paid for a child's months, for one payroll month.
//   all:  every class the child had     ci: the classes this CI took of them (not as a substitute)
//   anchor: month start                 month: 'YYYY-MM' being paid
//   stillTeaching: the CI is active and the child is on one of their batches right now
// The CI's share of a month = the classes THEY took ÷ 22, at their own rate. It is payable
//   • in the month the 22nd class falls, when the CI taught up to the end of it; or
//   • in the month of the CI's last class, when they stopped before it was complete (pro-rata).
// A month still running while the CI carries on is not payable yet — it is listed as in progress.
// Returns { items: [{ from, to, count, total, complete, spill }], open: { start, count, ciCount } | null }
export function monthPayItems(ctx) {
  const c = ctx || {}
  const ci = uniqSorted(c.ci)
  const res = monthBlocks(c.all, c.anchor)
  const items = []
  const lastDate = ci[ci.length - 1] || ''
  res.blocks.forEach(function (b) {
    const mine = b.dates.filter(function (d) { return ci.includes(d) })
    if (!mine.length) return
    const lastMine = mine[mine.length - 1]
    const stoppedInside = lastMine < b.completedOn && !c.stillTeaching && lastMine === lastDate
    const payMonth = stoppedInside ? lastMine.slice(0, 7) : b.payMonth
    if (payMonth !== c.month) return
    items.push({ from: b.start, to: stoppedInside ? lastMine : b.completedOn, count: mine.length, total: MONTH_SESSIONS, complete: !stoppedInside, spill: b.spill })
  })
  let open = null
  if (res.open) {
    const mine = res.open.dates.filter(function (d) { return ci.includes(d) })
    if (mine.length) {
      const lastMine = mine[mine.length - 1]
      if (!c.stillTeaching) {
        if (lastMine.slice(0, 7) === c.month) items.push({ from: res.open.start, to: lastMine, count: mine.length, total: MONTH_SESSIONS, complete: false, spill: false })
      } else open = { start: res.open.start, count: res.open.count, ciCount: mine.length }
    }
  }
  return { items: items, open: open }
}

// Where a child's running month stands, for the renewal screens.
//   dates: every class the child has had so far (held, any CI)   anchor: the running month's start (see monthBlocks)
// Returns { done, left, complete, start, completedOn }
export function monthProgress(dates, anchor) {
  const r = monthBlocks(dates, anchor)
  const last = r.blocks[r.blocks.length - 1]
  const done = r.open ? r.open.count : 0
  return { done: done, left: MONTH_SESSIONS - done, blocks: r.blocks, openStart: r.open ? r.open.start : r.nextAnchor, lastCompleted: last || null, nextAnchor: r.nextAnchor }
}
