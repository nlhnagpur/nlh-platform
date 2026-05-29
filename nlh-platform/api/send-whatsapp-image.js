// Sends a certificate PNG via WhatsApp using Meta Cloud API.
// Flow:
//   1. Validate enrollmentIds from DB (server-side, authoritative)
//   2. Upload PNG to Meta media endpoint
//   3. Send as cert_issued template — text vars come from DB, not client

import { createClient }  from '@supabase/supabase-js'
import { requireAuth }  from './_auth.js'

const SUPABASE_URL  = 'https://frnnoxudtlvhyyoqdqzx.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZybm5veHVkdGx2aHl5b3FkcXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTY2NDUsImV4cCI6MjA5MjkzMjY0NX0.1OuqWuV-X09wEzWMp9_zjNRbWNDcSvR4TgYmu0373zE'

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (await requireAuth(req, res)) return

  const token   = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneId) return res.status(500).json({ error: 'WhatsApp not configured' })

  const { to, imageBase64, filename, enrollmentIds } = req.body
  if (!to)                                 return res.status(400).json({ error: 'Missing recipient number (to)' })
  if (!imageBase64)                        return res.status(400).json({ error: 'Missing imageBase64' })
  if (!enrollmentIds?.length)              return res.status(400).json({ error: 'Missing enrollmentIds' })

  // ── Step 1: Fetch authoritative cert data from DB ──────────────────────────
  // Use the caller's JWT so RLS ensures they can only read their own data
  const callerToken = (req.headers['authorization'] || '').replace('Bearer ', '')
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
  })

  const { data: enrollments, error: dbErr } = await sb
    .from('enrollments')
    .select('id, skus(level_name, courses(group_name)), students(full_name, parent_name)')
    .in('id', enrollmentIds)

  if (dbErr || !enrollments?.length) {
    return res.status(400).json({ error: 'Could not verify enrollments: ' + (dbErr?.message || 'not found') })
  }

  // Build template vars from DB — these are authoritative regardless of what the client sent
  const student    = enrollments[0].students
  const studentName = student?.full_name  || 'Student'
  const parentName  = student?.parent_name || 'Parent'
  const courses     = enrollments.map(function (e) {
    const course = e.skus?.courses?.group_name || 'Course'
    const level  = e.skus?.level_name || ''
    return level ? `${course} — ${level}` : course
  }).join(', ')

  console.log('[WA cert] phoneId:', phoneId, 'to:', to, 'student:', studentName, 'courses:', courses)

  const digits = String(to).replace(/\D/g, '')
  const e164   = digits.startsWith('91') ? digits : '91' + digits

  try {
    // ── Step 2: Upload certificate PNG to Meta media endpoint ────────────────
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

    // ── Step 3: Send as cert_issued template (image header + body) ───────────
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
          language: { code: 'en_US' },
          components: [
            {
              type:       'header',
              parameters: [{ type: 'image', image: { id: uploadData.id } }],
            },
            {
              type:       'body',
              parameters: [
                { type: 'text', text: studentName },
                { type: 'text', text: parentName  },
                { type: 'text', text: courses      },
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
