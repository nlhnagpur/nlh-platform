// The "month" of a child (and of the CI who teaches them): a block of MONTH_SESSIONS (22) classes, inside a renewal window.
//   • A month starts on a renewal date (say 9 Oct) and its window runs to the same date next month (9 Nov).
//   • It is complete on the 22nd class held for the child — Mon–Fri or Mon–Sat; holidays and the child's own off days are
//     not classes, and a class counts whether the child came or not.
//   • If the 22nd class falls BEFORE the window ends, the extra classes up to the renewal date are free and the next month
//     starts on the renewal date (9 Nov).
//   • If the 22nd class falls on or after the renewal date (too few classes), the month is counted on the day of the 22nd
//     class and the next month starts the day after — the next class is its 1st.
//   • The CI is paid at most one month's rate per child for a month, however many classes the window had: their share is the
//     classes THEY took (within the 22 counted) ÷ 22, in the month the 22nd class falls. A month stopped early (child or CI
//     leaves) is paid pro-rata: classes taken ÷ 22.
// Pure functions — no database access. Used by CI payroll and by the student's renewal screens so both agree.

export const MONTH_SESSIONS = 22

const d10 = function (v) { return v ? String(v).slice(0, 10) : '' }

function addDays(iso, n) {
  const x = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n)
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')
}
// The same date next month; a 31st that does not exist next month lands on that month's last day.
export function addMonth(iso) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10))
  const last = new Date(y, m + 1, 0).getDate()
  const x = new Date(y, m, Math.min(d, last))
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')
}
function uniqSorted(dates) {
  return Array.from(new Set((dates || []).map(d10).filter(Boolean))).sort()
}

// The day the next month starts after one that started on `start` and was completed on `completedOn`.
export function nextMonthStart(start, completedOn) {
  const s = d10(start), c = d10(completedOn)
  const end = addMonth(s)
  return c >= end ? addDays(c, 1) : end
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
  const free = []
  let skipUntil = ''   // classes before this day are free (extras after the 22nd class, up to the renewal date)
  ds.forEach(function (d) {
    if (skipUntil && d < skipUntil) { free.push(d); blocks[blocks.length - 1].free.push(d); return }
    if (d < start) return
    cur.push(d)
    if (cur.length === n) {
      const end = addMonth(start)
      const spill = d >= end
      blocks.push({ start: start, end: end, completedOn: d, payMonth: d.slice(0, 7), dates: cur, spill: spill, free: [] })
      start = spill ? addDays(d, 1) : end
      skipUntil = spill ? '' : start
      cur = []
    }
  })
  return { blocks: blocks, open: cur.length ? { start: start, dates: cur, count: cur.length } : null, nextAnchor: start }
}

// What the CI is paid for a child's months, for one payroll month.
//   all:  every class the child had     ci: the classes this CI took of them (not as a substitute)
//   anchor: month start                 month: 'YYYY-MM' being paid
// The CI is paid as the classes are taken: in a payroll month, their share is the classes THEY took in that calendar month
// that count towards a child's 22 (classes after the 22nd are free and not paid), ÷ 22, at their own rate. So a month that
// spills across two calendar months is paid part in each, a running month is paid for what has been taken so far, and in
// total the CI never receives more than one month's rate for a child's month.
// Returns { items: [{ from, to, count, total, complete, spill, completedOn }], open: { start, count, ciCount } | null }
//   `open` is the child's running month (not yet at 22), for the "month running" note.
export function monthPayItems(ctx) {
  const c = ctx || {}
  const ci = uniqSorted(c.ci)
  const res = monthBlocks(c.all, c.anchor)
  const items = []
  const groups = res.blocks.map(function (b) { return { dates: b.dates, block: b } })
  if (res.open) groups.push({ dates: res.open.dates, block: null })
  groups.forEach(function (g) {
    const mine = g.dates.filter(function (d) { return ci.includes(d) && d.slice(0, 7) === c.month })
    if (!mine.length) return
    items.push({ from: mine[0], to: mine[mine.length - 1], count: mine.length, total: MONTH_SESSIONS, complete: !!g.block, spill: g.block ? g.block.spill : false, completedOn: g.block ? g.block.completedOn : '' })
  })
  let open = null
  if (res.open) {
    const mine = res.open.dates.filter(function (d) { return ci.includes(d) })
    if (mine.length) open = { start: res.open.start, count: res.open.count, ciCount: mine.length }
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

// A child's months laid out in order, for the attendance sheet: one segment per month, with the classes that count (up to
// 22) and the free ones after the 22nd class. The month that is running has `open: true`.
//   firstAnchor: the day the first month started    currentAnchor: the stored start of the running month (a renewal may
//   have been entered on a date the rule would not have produced; months before it are laid out from firstAnchor and cut
//   off there)
// Returns [{ start, end, completedOn, spill, counted, free, open }]  — `end` is the day the next month starts
export function monthLayout(dates, firstAnchor, currentAnchor) {
  const ds = uniqSorted(dates)
  const first = d10(firstAnchor) || ds[0] || ''
  const cur = d10(currentAnchor)
  const out = []
  const run = function (list, anchor, cutoff) {
    const r = monthBlocks(list, anchor)
    r.blocks.forEach(function (b) {
      out.push({ start: b.start, end: b.spill ? addDays(b.completedOn, 1) : b.end, completedOn: b.completedOn, spill: b.spill, counted: b.dates, free: b.free, open: false })
    })
    if (r.open) out.push({ start: r.open.start, end: cutoff || '', completedOn: '', spill: false, counted: r.open.dates, free: [], open: !cutoff })
  }
  if (cur && cur > first) {
    run(ds.filter(function (d) { return d < cur }), first, cur)
    // a month cut off by the stored renewal date was finished there
    run(ds.filter(function (d) { return d >= cur }), cur, '')
  } else run(ds, first, '')
  return out
}
