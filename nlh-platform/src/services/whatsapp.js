// ── WhatsApp messaging service (via /api/send-whatsapp) ───────────────────────
// All messages go through the NLH landline +91 712 351 4575 (Meta Cloud API)

import { sb } from '../supabase'

// ── Meta template names — single source of truth ─────────────────────────────
// Meta classifies templates by CONTENT, not by name, and anything it rules
// "Marketing" is refused delivery to recipients who haven't messaged us in the
// last 24h (error 131049). These must therefore stay pointed at the approved
// UTILITY templates. Changing a template in Meta = change the name here only.
export const WA_TEMPLATES = {
  orderInvoiced:   'order_invoiced_v3',   // v2 was an Order Details (WhatsApp Pay) type
  orderDispatched: 'order_dispatched_v2',
  studentEnrolled: 'student_enrolled_v2',
  balanceReminder: 'balance_reminder',   // universal: students + franchisees
  reviewRequest:   'review_request',     // legitimately Marketing — leave as is
}

async function waAuthHeaders() {
  const { data: { session } } = await sb.auth.getSession()
  return {
    'Content-Type': 'application/json',
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

/**
 * Normalise any phone string to WhatsApp-ready format (digits only, with country code).
 * Handles Indian 10-digit, 0-prefix, +91, and already-normalised numbers.
 * Returns null if the number can't be normalised.
 */
export function toWAPhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return '91' + digits                          // 9876543210  → 919876543210
  if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1) // 09876543210 → 919876543210
  if (digits.length === 12 && digits.startsWith('91')) return digits      // already correct
  if (digits.length > 10) return digits                                   // other country codes — pass through
  return null
}

// Record an outbound message so it shows in the WhatsApp Inbox thread and can
// be tracked/audited. Non-fatal: a logging failure never blocks the send.
export async function logOutbound(to, body, messageType, waMessageId, mediaUrl) {
  try {
    const num = toWAPhone(to) || String(to || '').replace(/\D/g, '')
    if (!num) return
    await sb.from('whatsapp_messages').insert({
      direction:     'outbound',
      from_number:   '917123514575',
      to_number:     num,
      message_type:  messageType || 'template',
      message_body:  body,
      status:        'sent',
      // Store Meta's message id so the webhook can advance status → delivered/read
      wa_message_id: waMessageId || null,
      // Public URL of any image sent (e.g. certificate) so it renders in the chat
      media_url:     mediaUrl || null,
    })
  } catch (e) { /* ignore */ }
}

// Pull the WhatsApp message id (wamid) out of a send-API response
export function waMsgId(resp) {
  return resp?.data?.messages?.[0]?.id || resp?.messages?.[0]?.id || null
}

async function sendWA(to, payload, summary, mediaUrl) {
  if (!to) return { success: false, error: 'No phone number' }
  const res = await fetch('/api/send-whatsapp', {
    method: 'POST',
    headers: await waAuthHeaders(),
    body: JSON.stringify({ to, ...payload }),
  })
  const data = await res.json()
  if (data && data.success && summary) {
    logOutbound(to, summary, mediaUrl ? 'image' : (payload?.type === 'text' ? 'text' : 'template'), waMsgId(data), mediaUrl)
  }
  return data
}

// ── Template: hello_world (for testing) ───────────────────────────────────────
export async function sendWATest(to) {
  return sendWA(to, {
    type: 'template',
    template: { name: 'hello_world', language: { code: 'en_US' } },
  })
}

// ── Template: order_invoiced_v2 ───────────────────────────────────────────────
// Params: {{1}} franchisee name, {{2}} invoice_no, {{3}} amount
// The template has an IMAGE header, so `imageUrl` (a public PNG of the invoice)
// is required — Meta rejects the send if the header component is missing.
export async function sendWAOrderInvoiced(to, { name, invoiceNo, amount, imageUrl }) {
  const components = []
  if (imageUrl) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: imageUrl } }],
    })
  }
  components.push({
    type: 'body',
    parameters: [
      { type: 'text', text: name },
      { type: 'text', text: invoiceNo },
      { type: 'text', text: '₹' + amount },
    ],
  })
  return sendWA(to, {
    type: 'template',
    template: { name: WA_TEMPLATES.orderInvoiced, language: { code: 'en' }, components },
  }, '🧾 Invoice ' + invoiceNo + ' · ₹' + amount, imageUrl)
}

// ── Template: order_dispatched ────────────────────────────────────────────────
// Params: {{1}} franchisee name, {{2}} invoice_no, {{3}} AWB number, {{4}} courier
export async function sendWAOrderDispatched(to, { name, invoiceNo, awb, courier }) {
  return sendWA(to, {
    type: 'template',
    template: {
      name: WA_TEMPLATES.orderDispatched,
      language: { code: 'en' },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: name },
          { type: 'text', text: invoiceNo },
          { type: 'text', text: awb || '—' },
          { type: 'text', text: courier || 'courier' },
        ],
      }],
    },
  }, '📦 Dispatched ' + invoiceNo + ' · AWB ' + (awb || '—') + ' (' + (courier || 'courier') + ')')
}

// ── Template: payment_received ────────────────────────────────────────────────
// Params: {{1}} franchisee name, {{2}} amount, {{3}} balance
// Franchisee payment confirmation. Routed through the SAME approved Utility
// template as student receipts (`payment_receipt`); the old `payment_received`
// template was classified Marketing, so Meta refused delivery to franchisees
// who hadn't messaged recently (error 131049).
export async function sendWAPaymentReceived(to, { name, amount, balance, receiptNo, date }) {
  return sendWAStudentReceipt(to, {
    name:      name,
    receiptNo: receiptNo || '—',
    amount:    amount,
    date:      date || '',
    balance:   balance,
  })
}

// ── Payment receipt to a parent (franchisee-usable) ──────────────────────────
// Sends the `payment_receipt` template via a requireAuth endpoint so a
// franchisee can send a receipt for their own student's payment.
// { name, receiptNo, amount (formatted), date (formatted), balance (number) }
export async function sendWAStudentReceipt(to, { name, receiptNo, amount, date, balance }) {
  if (!toWAPhone(to)) return { success: false, error: 'No valid phone number on file' }
  const res = await fetch('/api/send-payment-whatsapp', {
    method: 'POST',
    headers: await waAuthHeaders(),
    body: JSON.stringify({ to: toWAPhone(to), name, receiptNo, amount, date, balance }),
  })
  const data = await res.json()
  if (data && data.success) logOutbound(to, '🧾 Receipt ' + (receiptNo || '') + ' · ₹' + amount + (Number(balance) > 0 ? ' · ₹' + balance + ' due' : ' · fully paid'), 'template', waMsgId(data))
  return data
}

// ── Template: student_enrolled ────────────────────────────────────────────────
// Params: {{1}} parent name, {{2}} student name, {{3}} courses, {{4}} centre
export async function sendWAStudentEnrolled(to, { parentName, studentName, courses, centre }) {
  return sendWA(to, {
    type: 'template',
    template: {
      name: WA_TEMPLATES.studentEnrolled,
      language: { code: 'en' },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: parentName || 'Parent' },
          { type: 'text', text: studentName },
          { type: 'text', text: courses },
          { type: 'text', text: centre },
        ],
      }],
    },
  }, '🎓 Enrolled ' + studentName + ' · ' + courses)
}


// ── WhatsApp certificate link ─────────────────────────────────────────────────
// Opens WhatsApp in a new tab with a pre-filled message containing the cert URL.
// No Meta template approval needed — this is a wa.me deep link, not a send-API call.
// Returns true if the phone was valid and the window was opened, false otherwise.
export function openWACertificate(phone, { studentName, parentName, courses, certUrl }) {
  const waPhone = toWAPhone(phone)
  if (!waPhone) return false
  const message =
    `🎓 *Congratulations ${studentName}!*\n\n` +
    `Dear ${parentName || 'Parent'},\n\n` +
    `We are delighted to share ${studentName}'s Certificate of Accomplishment for successfully completing ` +
    `*${courses}* at New Learning Horizons.\n\n` +
    `📜 View & Download Certificate:\n${certUrl}\n\n` +
    `With warm regards,\nNew Learning Horizons 🌟`
  window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`, '_blank')
  return true
}

// ── Template: review_request ──────────────────────────────────────────────────
// Sends a Google-review request to a parent from the NLH business number.
// Named params: parent_name, student_name, course_name (review link is static
// inside the approved template). Uses a dedicated requireAuth endpoint so a
// franchisee can send it for their own completed students.
export async function sendWAReviewRequest(to, { parentName, studentName, courseName }) {
  if (!toWAPhone(to)) return { success: false, error: 'No valid phone number on file' }
  const res = await fetch('/api/send-review-whatsapp', {
    method: 'POST',
    headers: await waAuthHeaders(),
    body: JSON.stringify({ to, parentName, studentName, courseName }),
  })
  const data = await res.json()
  if (data && data.success) logOutbound(to, '⭐ Google review request · ' + (studentName || '') + (courseName ? ' (' + courseName + ')' : ''), 'template', waMsgId(data))
  return data
}

// ── Template: balance_reminder (universal — students AND franchisees) ─────────
// Params: {{1}} recipient name, {{2}} balance amount, {{3}} what it's owed against
//   student:    towards = 'course fees for Navyam Choudhary'
//   franchisee: towards = 'your franchise account' / 'invoice INV-2026-0008'
export async function sendWAFeeReminder(to, { name, balance, towards }) {
  return sendWA(to, {
    type: 'template',
    template: {
      name: WA_TEMPLATES.balanceReminder,
      language: { code: 'en' },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: name },
          { type: 'text', text: '₹' + balance },
          { type: 'text', text: towards || 'your account' },
        ],
      }],
    },
  }, '⏰ Balance reminder · ₹' + balance + ' due')
}
