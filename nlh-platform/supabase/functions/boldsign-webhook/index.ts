// Receives BoldSign's Account-Level webhook. Public endpoint (BoldSign calls
// it directly, not through our app's auth) — protected instead by a shared
// secret in the URL (?key=...), since BoldSign's webhook docs don't specify
// an HMAC/signature scheme to verify against. On a Completed event, confirms
// the real status via BoldSign's own document/properties endpoint (never
// trusts the webhook body alone) before marking the agreement signed.
//
// Set up in the BoldSign dashboard: API → Webhooks → Add Webhook (Account
// Level) → URL: this function's URL + "?key=<boldsign_webhook_key from
// vault>" → events: at least "Completed".
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req: Request) => {
  // Always 200 quickly — BoldSign expects a response within 10s and will
  // otherwise retry. Errors are logged, not surfaced to the caller.
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const url = new URL(req.url)
    const key = url.searchParams.get('key')
    const { data: expectedKey } = await sb.rpc('get_app_secret', { secret_name: 'boldsign_webhook_key' })
    if (!expectedKey || key !== expectedKey) {
      console.warn('[boldsign-webhook] rejected: bad or missing key')
      return new Response('ok', { status: 200 })
    }

    const payload = await req.json().catch(() => ({}))
    const eventType = payload?.event?.eventType
    const documentId =
      payload?.data?.documentId || payload?.documentId || payload?.data?.document?.documentId || null

    // Full payload while we're diagnosing why a send didn't land — in
    // particular SendFailed carries an error message we otherwise never see.
    console.log('[boldsign-webhook] event:', eventType, documentId, JSON.stringify(payload).slice(0, 2000))

    if (eventType !== 'Completed' || !documentId) {
      return new Response('ok', { status: 200 })
    }

    const { data: apiKey } = await sb.rpc('get_app_secret', { secret_name: 'boldsign_api_key' })
    if (!apiKey) return new Response('ok', { status: 200 })

    const propsRes = await fetch('https://api.boldsign.com/v1/document/properties?documentId=' + encodeURIComponent(documentId), {
      headers: { 'X-API-KEY': apiKey },
    })
    if (!propsRes.ok) {
      console.warn('[boldsign-webhook] properties lookup failed', propsRes.status)
      return new Response('ok', { status: 200 })
    }
    const props = await propsRes.json()
    if (props?.status !== 'Completed') {
      console.warn('[boldsign-webhook] properties status not Completed:', props?.status)
      return new Response('ok', { status: 200 })
    }

    const signer = (props?.signerDetails || [])[0] || {}
    const doc_hash = await sha256Hex(JSON.stringify({ documentId, status: props.status, signer: signer.signerEmail }))

    const { error } = await sb.from('franchisee_agreements')
      .update({
        status: 'signed',
        signed_at: new Date().toISOString(),
        signed_name: signer.signerName || null,
        signed_ip: null, // BoldSign doesn't expose signer IP via this endpoint
        doc_hash,
      })
      .eq('boldsign_document_id', documentId)

    if (error) console.warn('[boldsign-webhook] update failed:', error.message)

    return new Response('ok', { status: 200 })
  } catch (e) {
    console.warn('[boldsign-webhook] error:', String(e))
    return new Response('ok', { status: 200 })
  }
})

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
