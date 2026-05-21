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
      const key = getKey()
      for (const s of statuses) {
        await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages?wa_message_id=eq.${s.id}`, {
          method: 'PATCH',
          headers: {
            'apikey':        key,
            'Authorization': 'Bearer ' + key,
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
