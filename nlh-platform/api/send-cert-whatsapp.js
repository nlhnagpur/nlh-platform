// Server-side certificate WhatsApp sender.
// Steps:
//   1. Validate enrollmentIds from DB (authoritative, RLS-enforced)
//   2. Build cert URL params from DB data
//   3. Screenshot the cert page with headless Chromium (Puppeteer)
//   4. Upload PNG to Meta media endpoint
//   5. Send as cert_issued template
//
// Required env vars:
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID  — Meta Cloud API
//   SITE_URL                                  — e.g. https://nlh-platform.vercel.app
//   (VERCEL_URL is used as fallback — set automatically by Vercel)

import chromium       from '@sparticuz/chromium-min'
import puppeteer      from 'puppeteer-core'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './_auth.js'

const SUPABASE_URL  = 'https://frnnoxudtlvhyyoqdqzx.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZybm5veHVkdGx2aHl5b3FkcXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTY2NDUsImV4cCI6MjA5MjkzMjY0NX0.1OuqWuV-X09wEzWMp9_zjNRbWNDcSvR4TgYmu0373zE'

// Pinned Chromium build — tested with @sparticuz/chromium-min
const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar'

export const config = {
  api: { bodyParser: true },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (await requireAuth(req, res)) return

  const token   = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneId) return res.status(500).json({ error: 'WhatsApp not configured' })

  const { to, enrollmentIds } = req.body
  if (!to)               return res.status(400).json({ error: 'Missing recipient number' })
  if (!enrollmentIds?.length) return res.status(400).json({ error: 'Missing enrollmentIds' })

  // ── Step 1: Fetch authoritative data from DB ───────────────────────────────
  const callerToken = (req.headers['authorization'] || '').replace('Bearer ', '')
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
  })

  const { data: enrollments, error: dbErr } = await sb
    .from('enrollments')
    .select(`
      id,
      skus ( level_name, courses ( group_name ) ),
      students ( full_name, parent_name, gender, city ),
      franchisees ( business_name, city )
    `)
    .in('id', enrollmentIds)

  if (dbErr || !enrollments?.length) {
    return res.status(400).json({ error: 'Could not load enrollments: ' + (dbErr?.message || 'not found') })
  }

  const student  = enrollments[0].students  || {}
  const centre   = enrollments[0].franchisees || {}
  const isMale   = (student.gender || '').toLowerCase() === 'male'
  const today    = new Date()
  const dateStr  = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0')

  // Template text vars (also used in URL params)
  const studentName = student.full_name  || 'Student'
  const parentName  = student.parent_name || 'Parent'
  const courses     = enrollments.map(function (e) {
    const c = e.skus?.courses?.group_name || 'Course'
    const l = e.skus?.level_name || ''
    return l ? `${c} — ${l}` : c
  }).join(', ')

  // ── Step 2: Build cert page URL ────────────────────────────────────────────
  const host = process.env.SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)

  if (!host) {
    return res.status(500).json({ error: 'SITE_URL env var not set' })
  }

  const centreText = centre.city
    ? `${centre.business_name || 'New Learning Horizons'}, ${centre.city}`
    : (centre.business_name   || 'New Learning Horizons')

  const params = new URLSearchParams({
    name:     studentName,
    title:    isMale ? 'Mast.' : 'Miss.',
    rel:      isMale ? 'S/o.'  : 'D/o.',
    parent:   parentName,
    location: student.city || '',
    program:  enrollments.map(function (e) { return e.skus?.courses?.group_name || '' }).join('|'),
    level:    enrollments.map(function (e) { return e.skus?.level_name || '' }).join('|'),
    center:   centreText,
    date:     dateStr,
  })

  const certUrl = `${host}/certificate/Issue%20Certificate.html?${params}`
  console.log('[cert] rendering:', certUrl)

  // ── Step 3: Screenshot with headless Chromium ──────────────────────────────
  const execPath = process.env.CHROME_EXECUTABLE_PATH ||
    await chromium.executablePath(CHROMIUM_URL)

  const browser = await puppeteer.launch({
    args:            [...chromium.args, '--font-render-hinting=none'],
    defaultViewport: { width: 2000, height: 1414 },
    executablePath:  execPath,
    headless:        chromium.headless,
  })

  let pngBuffer
  try {
    const page = await browser.newPage()
    await page.goto(certUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await page.evaluate(function () { return document.fonts.ready })
    // Extra wait to ensure custom fonts and background image have painted
    await new Promise(function (r) { setTimeout(r, 800) })

    const certEl = await page.$('#cert')
    if (!certEl) throw new Error('Certificate element #cert not found on page')
    pngBuffer = await certEl.screenshot({ type: 'png' })
  } finally {
    await browser.close()
  }

  console.log('[cert] screenshot size:', pngBuffer.length, 'bytes')

  // ── Step 4: Upload PNG to Meta media endpoint ──────────────────────────────
  const safeName = studentName.replace(/[^a-z0-9 -]/gi, '').trim().replace(/\s+/g, '-')
  const filename = `NLH-Certificate-${safeName}.png`

  const form = new FormData()
  form.append('file', new Blob([pngBuffer], { type: 'image/png' }), filename)
  form.append('type', 'image/png')
  form.append('messaging_product', 'whatsapp')

  const uploadRes  = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const uploadData = await uploadRes.json()
  console.log('[cert] upload status:', uploadRes.status, 'mediaId:', uploadData.id)

  if (!uploadRes.ok || !uploadData.id) {
    return res.status(uploadRes.ok ? 500 : uploadRes.status).json({
      success: false,
      error: uploadData.error?.message || 'Media upload failed',
      detail: uploadData,
    })
  }

  // ── Step 5: Send cert_issued template ─────────────────────────────────────
  const digits = String(to).replace(/\D/g, '')
  const e164   = digits.startsWith('91') ? digits : '91' + digits

  const msgRes = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to:   e164,
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
              { type: 'text', text: studentName },
              { type: 'text', text: parentName  },
              { type: 'text', text: courses     },
            ],
          },
        ],
      },
    }),
  })

  const msgData = await msgRes.json()
  console.log('[cert] message status:', msgRes.status, JSON.stringify(msgData))

  if (msgRes.ok) return res.status(200).json({ success: true, data: msgData })
  return res.status(msgRes.status).json({
    success: false,
    error:   msgData.error?.message || 'Message send failed',
    detail:  msgData,
  })
}
