// A batch session normally runs one hour from its start time; HO can set an end time for a shorter or longer one.
// Times are 'HH:MM' (or 'HH:MM:SS'). A missing end time means one hour after the start.

const hm = function (t) { return String(t || '').slice(0, 5) }
const mins = function (t) { const p = hm(t).split(':').map(Number); return p.length === 2 && !isNaN(p[0]) && !isNaN(p[1]) ? p[0] * 60 + p[1] : null }
const clock = function (m) { return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') }

// The end time to show / use when none was set: one hour after the start.
export function defaultEnd(start) {
  const s = mins(start)
  return s == null ? '' : clock(s + 60)
}

// Session length in hours (1 when no end time is set or the end is not after the start).
export function batchHours(start, end) {
  const s = mins(start), e = mins(end)
  if (s == null || e == null || e <= s) return 1
  return Math.round(((e - s) / 60) * 100) / 100
}

export function hoursLabel(h) { return h + (h === 1 ? ' hr' : ' hrs') }

// "15:00 – 17:00"
export function timeRange(start, end) {
  if (!start) return ''
  return hm(start) + ' – ' + (hm(end) || defaultEnd(start))
}
