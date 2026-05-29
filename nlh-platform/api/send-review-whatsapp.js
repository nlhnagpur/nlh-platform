// Sends the Google-review request to a parent via the WhatsApp Cloud API,
// from the NLH business number. Locked to the `review_request` template so it
// can't be used to send arbitrary content.
//
// Body: { to, parentName, studentName, courseName }
// Template `review_request` (language en) — named body variables:
//   {{parent_name}}, {{student_name}}, {{course_name}}
// The Google review link is static text inside the approved template.

import { requireAuth } from './_auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (await requireAuth(req, res)) return

  const token   = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneId) return res.status(500).json({ error: 'WhatsApp not configured' })

  const { to, parentName, studentName, courseName } = req.body
  if (!to) return res.status(400).json({ error: 'Missing recipient number (to)' })

  const digits = String(to).replace(/\D/g, '')
  const e164   = digits.startsWith('91') ? digits : '91' + digits

  const payload = {
    messaging_product: 'whatsapp',
    to:   e164,
    type: 'template',
    template: {
      name:     'review_request',
      language: { code: 'en' },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', parameter_name: 'parent_name',  text: parentName  || 'Parent' },
          { type: 'text', parameter_name: 'student_name', text: studentName || 'your child' },
          { type: 'text', parameter_name: 'course_name',  text: courseName  || 'the course' },
        ],
      }],
    },
  }

  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await r.json()
    console.log('[WA review] status:', r.status, 'to:', e164, 'body:', JSON.stringify(data))
    if (r.ok) return res.status(200).json({ success: true, data })

    const err = data.error || {}
    const detail = err.code ? `(#${err.code}) ${err.message || 'Send failed'}` : (err.message || 'Send failed')
    return res.status(r.status).json({ success: false, error: detail, data })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}
