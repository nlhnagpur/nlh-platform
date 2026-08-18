// Receives BoldSign's Account-Level webhook. Public endpoint (BoldSign calls
// it directly, not through our app's auth) — protected instead by a shared
// secret in the URL (?key=...), since BoldSign's webhook docs don't specify
// an HMAC/signature scheme to verify against.
//
// Handles two paths to the same row:
//  - Sent via our API (boldsign-send): the row already has
//    boldsign_document_id set, so events match directly.
//  - Sent manually through BoldSign's own web app (the $0 Essentials plan,
//    used instead of paying for API access) — we never get a documentId
//    back for those, so this falls back to parsing the agreement_no out of
//    the document's title (which the admin is asked to keep in the same
//    "... (AGR-HO-####)" format used everywhere else in the app) and
//    backfills boldsign_document_id once matched, so later events for the
//    same document match directly from then on.
//
// On Completed, doesn't trust the webhook body alone — re-confirms the
// real status via BoldSign's own document/properties endpoint first.
//
// Set up in the BoldSign dashboard: API → Webhooks → Add Webhook (Account
// Level) → URL: this function's URL + "?key=<boldsign_webhook_key from
// vault>" → events: at least "Sent" and "Completed".
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
    const messageTitle: string =
      payload?.data?.messageTitle || payload?.data?.document?.messageTitle || ''

    console.log('[boldsign-webhook] event:', eventType, documentId, messageTitle)

    if (!documentId || (eventType !== 'Sent' && eventType !== 'Completed')) {
      return new Response('ok', { status: 200 })
    }

    // Find the row: by documentId if we already know it (API-sent), else by
    // the agreement number embedded in the title (manually sent).
    let row: any = null
    {
      const { data } = await sb.from('franchisee_agreements').select('id, status, boldsign_document_id').eq('boldsign_document_id', documentId).maybeSingle()
      row = data
    }
    if (!row) {
      const m = messageTitle.match(/AGR-HO-\d{4}/)
      if (m) {
        const { data } = await sb.from('franchisee_agreements').select('id, status, boldsign_document_id').eq('agreement_no', m[0]).maybeSingle()
        row = data
      }
    }
    if (!row) {
      console.warn('[boldsign-webhook] no matching agreement for', documentId, messageTitle)
      return new Response('ok', { status: 200 })
    }

    if (eventType === 'Sent') {
      if (row.status === 'draft') {
        const { error } = await sb.from('franchisee_agreements')
          .update({ status: 'sent', boldsign_document_id: documentId })
          .eq('id', row.id)
        if (error) console.warn('[boldsign-webhook] Sent update failed:', error.message)
      } else if (!row.boldsign_document_id) {
        // Already past draft (e.g. re-sent) but we still didn't have the id on record.
        await sb.from('franchisee_agreements').update({ boldsign_document_id: documentId }).eq('id', row.id)
      }
      return new Response('ok', { status: 200 })
    }

    // eventType === 'Completed' — confirm for real before marking signed.
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
        boldsign_document_id: documentId,
      })
      .eq('id', row.id)

    if (error) console.warn('[boldsign-webhook] Completed update failed:', error.message)

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
