// Sends a certificate PNG via WhatsApp using Meta Cloud API.
// Flow: upload PNG to Meta media API → send as template 'cert_issued' with image header.
// Template vars: {{student_name}}, {{parent_name}}, {{course_name}} (named-variable format)

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const token   = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneId) return res.status(500).json({ error: 'WhatsApp not configured' })

  const { to, imageBase64, filename, studentName, parentName, courses } = req.body
  if (!to)          return res.status(400).json({ error: 'Missing recipient number (to)' })
  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' })

  const digits = String(to).replace(/\D/g, '')
  const e164   = digits.startsWith('91') ? digits : '91' + digits

  console.log('[WA cert] phoneId:', phoneId, 'to:', e164)
  try {
    // ── Step 1: Upload certificate PNG to Meta media endpoint ────────────────
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '')
    const buffer     = Buffer.from(base64Data, 'base64')

    const form = new FormData()
    form.append('file', new Blob([buffer], { type: 'image/png' }), filename || 'certificate.png')
    form.append('type', 'image/png')
    form.append('messaging_product', 'whatsapp')

    const uploadRes  = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    const uploadData = await uploadRes.json()
    console.log('[WA cert] upload status:', uploadRes.status, 'mediaId:', uploadData.id)

    if (!uploadRes.ok || !uploadData.id) {
      return res.status(uploadRes.ok ? 500 : uploadRes.status).json({
        success: false,
        error: uploadData.error?.message || 'Media upload failed (no id returned)',
        detail: uploadData,
      })
    }

    // ── Step 2: Send as cert_issued template (image header + body) ───────────
    const msgRes = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: e164,
        type: 'template',
        template: {
          name:     'cert_issued',
          language: { code: 'en' },
          components: [
            {
              type:       'header',
              parameters: [{ type: 'image', image: { id: uploadData.id } }],
            },
            {
              type:       'body',
              parameters: [
                { type: 'text', text: studentName || '' },
                { type: 'text', text: parentName  || 'Parent' },
                { type: 'text', text: courses     || '' },
              ],
            },
          ],
        },
      }),
    })
    const msgData = await msgRes.json()
    console.log('[WA cert] message status:', msgRes.status, 'body:', JSON.stringify(msgData))

    if (msgRes.ok) return res.status(200).json({ success: true, data: msgData })
    return res.status(msgRes.status).json({
      success: false,
      error: msgData.error?.message || 'Message send failed',
      detail: msgData,
    })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}
