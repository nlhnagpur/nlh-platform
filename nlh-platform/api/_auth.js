// Shared auth guards for NLH serverless API routes.
//
// requireAdmin — caller must be owner/super_admin/admin/manager/staff
// requireAuth  — caller just needs a valid session (any role)
//
// Usage:
//   import { requireAdmin, requireAuth } from './_auth.js'
//   if (await requireAdmin(req, res)) return   // response already sent
//   if (await requireAuth(req, res))  return

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://frnnoxudtlvhyyoqdqzx.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZybm5veHVkdGx2aHl5b3FkcXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTY2NDUsImV4cCI6MjA5MjkzMjY0NX0.1OuqWuV-X09wEzWMp9_zjNRbWNDcSvR4TgYmu0373zE'

const ADMIN_ROLES = new Set(['owner', 'super_admin', 'admin', 'manager', 'staff'])

function extractToken(req) {
  const authHeader = req.headers['authorization'] || ''
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
}

// Verifies the JWT is valid — no role requirement.
// Returns true (and sends a response) if auth fails.
export async function requireAuth(req, res) {
  const token = extractToken(req)
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header' })
    return true
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return true
  }

  return false  // auth passed
}

// Verifies the JWT is valid AND the caller has an admin-tier role.
// Returns true (and sends a response) if auth/authz fails.
export async function requireAdmin(req, res) {
  const token = extractToken(req)
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header' })
    return true
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return true
  }

  const { data: profile } = await sb.from('users').select('role').eq('id', user.id).single()
  if (!profile || !ADMIN_ROLES.has(profile.role)) {
    res.status(403).json({ error: 'Insufficient permissions' })
    return true
  }

  return false  // auth passed
}
