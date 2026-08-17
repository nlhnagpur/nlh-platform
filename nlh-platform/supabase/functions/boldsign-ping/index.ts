// Connectivity check for the BoldSign integration — confirms the sandbox
// API key stored in Postgres Vault is valid and reachable, before any
// document-sending logic is built on top of it. Admin-only (verify_jwt).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Confirm the caller is an NLH admin — same role check the rest of the
    // app uses, not just "has a valid JWT".
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt)
    if (userErr || !userData?.user?.email) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    const { data: profile } = await sb.from('users').select('role').ilike('email', userData.user.email).single()
    const adminRoles = ['owner', 'super_admin', 'admin', 'manager', 'staff']
    if (!profile || !adminRoles.includes(profile.role)) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    // vault.decrypted_secrets isn't exposed to PostgREST directly (only the
    // public schema is), so this goes through the get_app_secret() wrapper
    // function instead — see migrations/*_add_app_secret_reader.sql.
    const { data: apiKey, error: secretErr } = await sb.rpc('get_app_secret', { secret_name: 'boldsign_api_key' })

    if (secretErr || !apiKey) {
      return new Response(JSON.stringify({ error: 'BoldSign key not found in vault', detail: secretErr?.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    const res = await fetch('https://api.boldsign.com/v1/document/list?page=1&pageSize=1', {
      headers: { 'X-API-KEY': apiKey },
    })
    const body = await res.text()

    return new Response(JSON.stringify({
      ok: res.ok,
      status: res.status,
      boldsignResponse: (() => { try { return JSON.parse(body) } catch { return body.slice(0, 500) } })(),
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
