// A franchisee only ever gets to work with the courses/SKUs HO has actually
// registered them for — never the full catalogue. This is a standing rule
// across the whole platform (enrolling students, appointing instructors,
// ordering stock, anywhere a course list is shown to a non-admin login) and
// belongs in exactly one place so every screen applies it the same way.

// Tiers that can operate as student-enrolment centres
export const CENTRE_TIERS = ['UF', 'CF', 'SMF', 'NLH']

// Derive the SKU filter for a given franchisee record.
// Returns:
//   null            — no centre selected; show nothing
//   'all'           — unrestricted centre (NLH HO, CF/SMF with no explicit list)
//   { skuIds }      — filter to specific SKU IDs
//   { courseIds }   — filter to specific course IDs
export function deriveFilter(fr) {
  if (!fr) return null
  const skus    = fr.registered_skus    || []
  const courses = fr.registered_courses || []
  if (skus.length > 0)    return { skuIds: skus }
  if (courses.length > 0) return { courseIds: courses }
  // UF with nothing registered = no courses approved yet; NLH / CF / SMF = unrestricted
  if (fr.tier === 'UF') return { skuIds: [] }
  return 'all'
}

// Apply a deriveFilter() result to a list of SKU rows (each needs at least
// `id` and `course_id`). Centralises the same filter/candidates logic that
// used to be re-typed at every call site.
export function filterSkusForFranchisee(allSkuRows, fr) {
  const filter = deriveFilter(fr)
  if (filter === 'all') return allSkuRows
  if (filter && filter.skuIds)    return allSkuRows.filter(function (s) { return filter.skuIds.includes(s.id) })
  if (filter && filter.courseIds) return allSkuRows.filter(function (s) { return filter.courseIds.includes(s.course_id) })
  return []   // null filter (no centre) or UF with nothing registered yet
}
