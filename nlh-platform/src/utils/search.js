// Client-side list search: every whitespace-separated word of the query must
// appear (case-insensitive) somewhere in the record's searchable text.
// `fields` may contain strings, numbers, null/undefined (ignored).
export function matchesSearch(fields, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  const hay = (fields || [])
    .filter(function (f) { return f !== null && f !== undefined && f !== '' })
    .map(function (f) { return String(f).toLowerCase() })
    .join(' ')
  return q.split(/\s+/).every(function (word) { return hay.indexOf(word) !== -1 })
}
