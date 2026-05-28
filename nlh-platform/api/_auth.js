// Shared auth guard for NLH serverless API routes.
// Usage:
//   import { requireAdmin } from './_auth.js'
//   const authErr = await requireAdmin(req, res)
//   if (authErr) return   // response already sent

import { createClient } from '@supabase/supabase-js'

const ADMIN_ROLES = new Set(['owner', 'super_admin', 'admin', 'manager', 'staff'])

export async function requireAdmin(req, res) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header' })
    return true
  }

  const supabaseUrl = process.env.SUPABASE_URL || 'https://frnnoxudtlvhyyoqdqzx.supabase.co'
  const supabaseKey = process.env.SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZybm5veHVkdGx2aHl5b3FkcXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTY2NDUsImV4cCI6MjA5MjkzMjY0NX0.1OuqWuV-X09wEzWMp9_zjNRbWNDcSvR4TgYmu0373zE'

  const sb = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  // Verify the JWT and get the user
  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return true
  }

  // Check their role in the users table
  const { data: profile } = await sb.from('users').select('role').eq('id', user.id).single()
  if (!profile || !ADMIN_ROLES.has(profile.role)) {
    res.status(403).json({ error: 'Insufficient permissions' })
    return true
  }

  return false  // auth passed
}
