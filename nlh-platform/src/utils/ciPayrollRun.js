// A CI's monthly payroll "run": the lines that make up what they are paid for a
// month, kept as a snapshot so a manually worked-out figure stays as entered.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function monthLabel(m) {
  const parts = String(m || '').split('-')
  const i = Number(parts[1]) - 1
  return i >= 0 && i < 12 ? MONTH_NAMES[i] + ' ' + parts[0] : String(m || '')
}

function toInt(v) {
  const n = Math.round(Number(v))
  return isFinite(n) ? n : 0
}

// Whole-rupee lines with a label; a line with no label and no amount is dropped.
export function cleanLines(lines) {
  return (lines || [])
    .map(function (l, i) {
      return { key: l.key || 'x' + i, label: String(l.label || '').trim(), calc: l.calc == null ? null : toInt(l.calc), amount: toInt(l.amount), added: !!l.added, meta: l.meta || null, detail: l.detail || '' }
    })
    .filter(function (l) { return l.label || l.amount })
}

export function sumLines(lines) {
  return (lines || []).reduce(function (t, l) { return t + toInt(l.amount) }, 0)
}

// Calculated lines as editable lines: the amount starts equal to the calculation.
export function linesFromCalc(calcLines) {
  return (calcLines || []).map(function (l) {
    return { key: l.key, label: l.label, calc: toInt(l.amount), amount: toInt(l.amount), added: false, meta: l.meta ? { ...l.meta, origFrom: l.meta.from, origTo: l.meta.to } : null, detail: l.detail || '' }
  })
}

// 'draft' | 'paid' | 'none' for a (possibly missing) run
export function runStatus(run) {
  if (!run) return 'none'
  return run.status === 'paid' ? 'paid' : 'draft'
}

export function lineEdited(l) {
  if (l.added) return false
  const m = l.meta
  const datesMoved = !!(m && m.origFrom && (m.from !== m.origFrom || m.to !== m.origTo))
  return datesMoved || (l.calc != null && toInt(l.amount) !== toInt(l.calc))
}

export function lastDayOf(month) {
  const y = Number(String(month).slice(0, 4)), m = Number(String(month).slice(5, 7))
  return month + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0')
}

// Which of the selected (oldest first) runs a payment settles in full. Whatever is left
// after the last full settlement stays on the CI's account as a part payment.
//   runs: [{ id, month, total }]
export function allocatePayment(runs, amount) {
  let left = Math.max(0, Math.round(Number(amount) || 0))
  const settled = []
  const ordered = (runs || []).slice().sort(function (a, b) { return String(a.month).localeCompare(String(b.month)) })
  for (let i = 0; i < ordered.length; i++) {
    const r = ordered[i]
    if (!(left >= r.total && r.total > 0)) break      // oldest first: never skip a month to settle a later one
    settled.push(r.id); left -= r.total
  }
  return { settled: settled, leftover: left }
}
