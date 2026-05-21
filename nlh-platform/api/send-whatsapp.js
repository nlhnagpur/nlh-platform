export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token   = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneId) {
    return res.status(500).json({ error: 'WhatsApp not configured' })
  }

  const { to, type, template, text } = req.body
  if (!to) return res.status(400).json({ error: 'Missing recipient number (to)' })

  // Normalise to E.164 — strip leading 0, add 91 if needed
  const normalised = String(to).replace(/\D/g, '')
  const e164 = normalised.startsWith('91') ? normalised : '91' + normalised

  let payload = { messaging_product: 'whatsapp', to: e164 }

  if (type === 'template' && template) {
    payload.type = 'template'
    payload.template = template
  } else if (text) {
    payload.type = 'text'
    payload.text = { body: text }
  } else {
    return res.status(400).json({ error: 'Provide either template or text' })
  }

  try {
    const r = await fetch(
      `https://graph.facebook.com/v19.0/${phoneId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    )
    const data = await r.json()
    if (r.ok) return res.status(200).json({ success: true, data })
    return res.status(r.status).json({ success: false, error: data.error?.message || 'Send failed', data })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}
