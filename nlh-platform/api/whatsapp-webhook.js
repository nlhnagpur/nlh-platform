// WhatsApp Cloud API webhook
// GET  → Meta verification handshake
// POST → Incoming messages + status updates

const SUPABASE_URL = 'https://frnnoxudtlvhyyoqdqzx.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZybm5veHVkdGx2aHl5b3FkcXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTY2NDUsImV4cCI6MjA5MjkzMjY0NX0.1OuqWuV-X09wEzWMp9_zjNRbWNDcSvR4TgYmu0373zE'

function getKey() {
  return process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || SUPABASE_ANON
}

async function saveMessage(payload) {
  const key = getKey()
  await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages`, {
    method: 'POST',
    headers: {
      'apikey':        key,
      'Authorization': 'Bearer ' + key,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(payload),
  })
}

async function rpc(fn, args) {
  const key = getKey()
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'apikey':        key,
      'Authorization': 'Bearer ' + key,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(args),
  })
  if (!r.ok) return null
  try { return await r.json() } catch (e) { return null }
}

// Broadcast-only number: reply once (per 6h per sender) pointing them to their
// centre. Inbound messages open a 24h service window, so plain text is allowed.
const AUTO_REPLY_TEXT =
  'Thank you for your message. 🙏\n\n' +
  'This number is used only to send certificates, receipts and course updates — it is not monitored for replies.\n\n' +
  'For any assistance, please contact your New Learning Horizons centre directly.'

async function autoReply(to) {
  try {
    if (!to) return
    const token   = process.env.WHATSAPP_TOKEN
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
    if (!token || !phoneId) return

    const allowed = await rpc('wa_should_autoreply', { p_number: to })
    if (allowed !== true) { console.log('[wa-webhook] auto-reply skipped (rate-limited) for', to); return }

    const r = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: AUTO_REPLY_TEXT },
      }),
    })
    const d = await r.json()
    console.log('[wa-webhook] auto-reply', r.status, JSON.stringify(d))
    if (r.ok) {
      await rpc('wa_log_outbound', {
        p_to: to, p_body: AUTO_REPLY_TEXT, p_type: 'auto_reply',
        p_wa_message_id: d?.messages?.[0]?.id || null,
      })
    }
  } catch (e) { console.error('[wa-webhook] auto-reply error:', e.message) }
}

export default async function handler(req, res) {
  // ── GET: Meta webhook verification ──────────────────────────────────────────
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode']
    const token     = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge)
    }
    return res.status(403).json({ error: 'Forbidden' })
  }

  // ── POST: Incoming messages & status updates ─────────────────────────────────
  if (req.method === 'POST') {
    try {
      const body = req.body
      const entry = body?.entry?.[0]
      const changes = entry?.changes?.[0]?.value

      if (!changes) return res.status(200).json({ status: 'ok' })

      // Incoming messages
      const messages = changes.messages || []
      for (const msg of messages) {
        const text = msg.text?.body
          || msg.image?.caption
          || msg.document?.caption
          || ('[' + msg.type + ']')

        await saveMessage({
          wa_message_id: msg.id,
          direction:     'inbound',
          from_number:   msg.from,
          to_number:     changes.metadata?.display_phone_number,
          message_type:  msg.type,
          message_body:  text,
          media_id:      msg.image?.id || msg.document?.id || null,
          status:        'received',
          raw:           msg,
        })

        // This is a broadcast-only number, so nobody is watching for replies.
        // Answer immediately with a generic redirect (rate-limited per sender)
        // rather than leaving the parent hanging.
        await autoReply(msg.from)
      }

      // Status updates (delivered, read, failed).
      // Go through the wa_update_status RPC: a direct PATCH is blocked by RLS
      // when running with the anon key (anon has no UPDATE policy), which
      // silently left every outbound message stuck on 'sent'.
      const statuses = changes.statuses || []
      const key = getKey()
      for (const s of statuses) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wa_update_status`, {
          method: 'POST',
          headers: {
            'apikey':        key,
            'Authorization': 'Bearer ' + key,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ p_wa_message_id: s.id, p_status: s.status }),
        })
        console.log('[wa-webhook] status', s.status, 'for', s.id, '→', r.status,
          s.errors ? JSON.stringify(s.errors) : '')
      }
    } catch (err) {
      console.error('Webhook error:', err.message)
    }

    // Always return 200 to Meta — otherwise it retries endlessly
    return res.status(200).json({ status: 'ok' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
