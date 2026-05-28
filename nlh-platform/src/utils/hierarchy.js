import { sb } from '../supabase'

/**
 * Returns all descendant franchisee IDs of rootId.
 * Does NOT include rootId itself.
 * Delegates to the get_descendant_ids PostgreSQL RPC (recursive CTE).
 */
export async function getDescendantIds(rootId) {
  if (!rootId) return []
  const { data, error } = await sb.rpc('get_descendant_ids', { root_id: rootId })
  if (error) {
    console.error('[hierarchy] get_descendant_ids RPC error:', error.message)
    return []
  }
  return (data || []).map(function (row) { return row.id })
}

/**
 * Returns rootId + all descendant IDs (self-inclusive tree).
 */
export async function getTreeIds(rootId) {
  if (!rootId) return []
  const descendants = await getDescendantIds(rootId)
  return [rootId, ...descendants]
}
