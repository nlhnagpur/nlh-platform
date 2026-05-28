// Creates a new Supabase auth user server-side using the service role key.
// This replaces the client-side sb.auth.signUp() + setSession() hack which
// displaces the admin's session during user creation.
//
// Required env var: SUPABASE_SERVICE_ROLE_KEY (set in Vercel dashboard)

import { createClient } from '@supabase/supabase-js'
import { requireAdmin }  from './_auth.js'

const SUPABASE_URL = 'https://frnnoxudtlvhyyoqdqzx.supabase.co'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Caller must be a logged-in NLH admin
  if (await requireAdmin(req, res)) return

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return res.status(500).json({ error: 'Server not configured (missing SUPABASE_SERVICE_ROLE_KEY)' })
  }

  const { email, password, fullName, role, franchiseeId } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' })
  }
  if (!role) {
    return res.status(400).json({ error: 'role is required' })
  }

  // Admin client — bypasses RLS, never touches the caller's session
  const adminSb = createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const normalizedEmail = email.trim().toLowerCase()

  const { data, error } = await adminSb.auth.admin.createUser({
    email:          normalizedEmail,
    password:       password,
    email_confirm:  true,                           // skip email verification
    user_metadata:  { full_name: (fullName || '').trim() },
  })

  if (error) {
    // Surface meaningful errors (e.g. "User already registered")
    return res.status(400).json({ success: false, error: error.message })
  }

  const userId = data.user.id

  // Insert the users profile row server-side so the client never writes role
  const { error: insertErr } = await adminSb.from('users').insert({
    id:            userId,
    email:         normalizedEmail,
    full_name:     (fullName || '').trim(),
    role:          role,
    franchisee_id: franchiseeId || null,
  })

  if (insertErr) {
    // Auth user was created but profile insert failed — clean up to avoid orphans
    await adminSb.auth.admin.deleteUser(userId)
    return res.status(500).json({ success: false, error: 'Profile insert failed: ' + insertErr.message })
  }

  return res.status(200).json({ success: true, userId })
}
