import { sb } from '../supabase'

/**
 * Returns all descendant franchisee IDs of rootId.
 * Does NOT include rootId itself.
 * Covers the full 3-level hierarchy (SMF → CF → UF) with 2 hops.
 */
export async function getDescendantIds(rootId) {
  if (!rootId) return []
  const { data: children } = await sb
    .from('franchisees')
    .select('id')
    .eq('parent_id', rootId)
  const childIds = (children || []).map(function (c) { return c.id })
  if (childIds.length === 0) return []
  const { data: grandchildren } = await sb
    .from('franchisees')
    .select('id')
    .in('parent_id', childIds)
  const grandchildIds = (grandchildren || []).map(function (g) { return g.id })
  return [...childIds, ...grandchildIds]
}

/**
 * Returns rootId + all descendant IDs (self-inclusive tree).
 */
export async function getTreeIds(rootId) {
  if (!rootId) return []
  const descendants = await getDescendantIds(rootId)
  return [rootId, ...descendants]
}
