// Changes a user's login email everywhere it must stay in sync (Supabase Auth,
// public.users, and the franchisees/students row). The actual work is done by
// the admin_change_email() SECURITY DEFINER function, called with the caller's
// own session — so it never depends on the service-role key.

import { createClient } from '@supabase/supabase-js'
import { requireAdmin }  from './_auth.js'

const SUPABASE_URL  = 'https://frnnoxudtlvhyyoqdqzx.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZybm5veHVkdGx2aHl5b3FkcXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTY2NDUsImV4cCI6MjA5MjkzMjY0NX0.1OuqWuV-X09wEzWMp9_zjNRbWNDcSvR4TgYmu0373zE'

function isEmail(s) { return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (await requireAdmin(req, res)) return

  let { oldEmail, newEmail, table, rowId } = req.body || {}
  if (!isEmail(oldEmail) || !isEmail(newEmail)) return res.status(400).json({ error: 'Valid oldEmail and newEmail are required' })
  oldEmail = oldEmail.trim().toLowerCase()
  newEmail = newEmail.trim().toLowerCase()
  if (oldEmail === newEmail) return res.status(400).json({ error: 'New email is the same as the current one' })
  if (table && !['franchisees', 'students'].includes(table)) return res.status(400).json({ error: 'Invalid table' })

  const callerToken = (req.headers['authorization'] || '').replace('Bearer ', '')
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
  })

  const { data, error } = await sb.rpc('admin_change_email', {
    p_old: oldEmail,
    p_new: newEmail,
    p_table: table || null,
    p_row: rowId || null,
  })

  if (error) {
    const msg = error.message || 'Email change failed'
    const code = /already in use/i.test(msg) ? 409 : /authorized/i.test(msg) ? 403 : 400
    return res.status(code).json({ error: msg })
  }

  return res.status(200).json({ success: true, ...(data || {}) })
}
