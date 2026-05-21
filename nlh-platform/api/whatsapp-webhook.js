// WhatsApp Cloud API webhook
// GET  → Meta verification handshake
// POST → Incoming messages + status updates

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://frnnoxudtlvhyyoqdqzx.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY

async function saveMessage(payload) {
  if (!SUPABASE_KEY) return
  await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages`, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=ignore-duplicates',
    },
    body: JSON.stringify(payload),
  })
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
      }

      // Status updates (delivered, read, failed)
      const statuses = changes.statuses || []
      for (const s of statuses) {
        await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages?wa_message_id=eq.${s.id}`, {
          method: 'PATCH',
          headers: {
            'apikey':        SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ status: s.status }),
        })
      }
    } catch (err) {
      console.error('Webhook error:', err.message)
    }

    // Always return 200 to Meta — otherwise it retries endlessly
    return res.status(200).json({ status: 'ok' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
