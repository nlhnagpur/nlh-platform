// Changes a user's login email everywhere it must stay in sync:
//   1. Supabase Auth (the actual login identity)
//   2. public.users (the app's login/role row)
//   3. the domain row (franchisees / students) when a table+id is supplied
//
// Because users.id is kept equal to the auth UID (see align_user_id_to_auth
// trigger), we resolve the auth user via public.users by the OLD email.
//
// Required env var: SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js'
import { requireAdmin }  from './_auth.js'

const SUPABASE_URL = 'https://frnnoxudtlvhyyoqdqzx.supabase.co'

function isEmail(s) { return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (await requireAdmin(req, res)) return

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Server not configured (missing SUPABASE_SERVICE_ROLE_KEY)' })

  let { oldEmail, newEmail, table, rowId } = req.body || {}
  if (!isEmail(oldEmail) || !isEmail(newEmail)) return res.status(400).json({ error: 'Valid oldEmail and newEmail are required' })
  oldEmail = oldEmail.trim().toLowerCase()
  newEmail = newEmail.trim().toLowerCase()
  if (oldEmail === newEmail) return res.status(400).json({ error: 'New email is the same as the current one' })
  if (table && !['franchisees', 'students'].includes(table)) return res.status(400).json({ error: 'Invalid table' })

  const adminSb = createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Guard: the new email must not already belong to another user
  const { data: clash } = await adminSb.from('users').select('id').ilike('email', newEmail).maybeSingle()
  if (clash) return res.status(409).json({ error: 'That email is already in use by another account' })

  // Resolve the auth user id from the users row (users.id === auth UID)
  const { data: userRow } = await adminSb.from('users').select('id').ilike('email', oldEmail).maybeSingle()

  // 1. Update the Auth identity (if a login exists for this email)
  if (userRow && userRow.id) {
    const { error: authErr } = await adminSb.auth.admin.updateUserById(userRow.id, {
      email: newEmail,
      email_confirm: true,           // keep it confirmed so they can log in immediately
    })
    if (authErr) return res.status(400).json({ error: 'Auth update failed: ' + authErr.message })

    // 2. Update the app login row
    const { error: uErr } = await adminSb.from('users').update({ email: newEmail }).eq('id', userRow.id)
    if (uErr) return res.status(500).json({ error: 'users row update failed: ' + uErr.message })
  }

  // 3. Update the domain row (franchisee / student) if provided
  if (table && rowId) {
    const { error: dErr } = await adminSb.from(table).update({ email: newEmail }).eq('id', rowId)
    if (dErr) return res.status(500).json({ error: table + ' update failed: ' + dErr.message })
  }

  return res.status(200).json({ success: true, hadLogin: !!(userRow && userRow.id) })
}
