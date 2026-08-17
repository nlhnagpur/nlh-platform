// Sends a franchisee's Unit Franchise Agreement to BoldSign for signature.
// Admin-only. The PDF itself is built client-side (src/utils/agreementPdf.js,
// via jsPDF — real text, not a screenshot) and passed in as a data URL; this
// function re-fetches the agreement/franchisee from the DB itself (never
// trusts the client for the terms it sends) and forwards to BoldSign.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt)
    if (userErr || !userData?.user?.email) return json({ error: 'Not authenticated' }, 401)
    const { data: profile } = await sb.from('users').select('role').ilike('email', userData.user.email).single()
    const adminRoles = ['owner', 'super_admin', 'admin', 'manager', 'staff']
    if (!profile || !adminRoles.includes(profile.role)) return json({ error: 'Admin access required' }, 403)

    const { agreementId, pdfDataUrl } = await req.json()
    if (!agreementId || !pdfDataUrl) return json({ error: 'agreementId and pdfDataUrl are required' }, 400)

    const { data: agreement, error: agErr } = await sb.from('franchisee_agreements').select('*').eq('id', agreementId).single()
    if (agErr || !agreement) return json({ error: 'Agreement not found' }, 404)
    if (agreement.status === 'signed') return json({ error: 'This agreement is already signed' }, 409)

    const { data: franchisee, error: frErr } = await sb.from('franchisees').select('*').eq('id', agreement.franchisee_id).single()
    if (frErr || !franchisee) return json({ error: 'Franchisee not found' }, 404)
    if (!franchisee.email) return json({ error: 'This franchisee has no email on file — BoldSign needs one to send the signing invite.' }, 400)

    const { data: apiKey, error: secretErr } = await sb.rpc('get_app_secret', { secret_name: 'boldsign_api_key' })
    if (secretErr || !apiKey) return json({ error: 'BoldSign key not configured' }, 500)

    const signerName = franchisee.owner_name || franchisee.business_name || 'Franchisee'
    const boldsignRes = await fetch('https://api.boldsign.com/v1/document/send', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Title: 'Unit Franchise Agreement — ' + (franchisee.business_name || signerName) + ' (' + agreement.agreement_no + ')',
        Message: 'Please review and sign your NLH Unit Franchise Agreement, ' + agreement.agreement_no + '.',
        Files: [{ base64: pdfDataUrl, fileName: agreement.agreement_no + '.pdf' }],
        Signers: [{ Name: signerName, EmailAddress: franchisee.email, SignerType: 'Signer' }],
        UseTextTags: true,
        DisableEmails: false,
        EnableSigningOrder: false,
        ExpiryDays: 60,
      }),
    })
    const boldsignBody = await boldsignRes.text()
    let parsed: any
    try { parsed = JSON.parse(boldsignBody) } catch { parsed = boldsignBody }

    if (!boldsignRes.ok) {
      return json({ error: 'BoldSign rejected the request', status: boldsignRes.status, detail: parsed }, 502)
    }

    const documentId = parsed?.documentId
    const { error: updErr } = await sb.from('franchisee_agreements')
      .update({ status: 'sent', boldsign_document_id: documentId })
      .eq('id', agreementId)
    if (updErr) return json({ error: 'Sent to BoldSign but failed to update the agreement record', detail: updErr.message }, 500)

    return json({ ok: true, documentId })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
