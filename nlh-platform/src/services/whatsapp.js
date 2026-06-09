// ── WhatsApp messaging service (via /api/send-whatsapp) ───────────────────────
// All messages go through the NLH landline +91 712 351 4575 (Meta Cloud API)

import { sb } from '../supabase'

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

async function sendWA(to, payload) {
  if (!to) return { success: false, error: 'No phone number' }
  const res = await fetch('/api/send-whatsapp', {
    method: 'POST',
    headers: await waAuthHeaders(),
    body: JSON.stringify({ to, ...payload }),
  })
  return res.json()
}

// ── Template: hello_world (for testing) ───────────────────────────────────────
export async function sendWATest(to) {
  return sendWA(to, {
    type: 'template',
    template: { name: 'hello_world', language: { code: 'en_US' } },
  })
}

// ── Template: order_confirmed ─────────────────────────────────────────────────
// Params: {{1}} franchisee name, {{2}} invoice_no, {{3}} amount
export async function sendWAOrderInvoiced(to, { name, invoiceNo, amount }) {
  return sendWA(to, {
    type: 'template',
    template: {
      name: 'order_invoiced',
      language: { code: 'en' },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: name },
          { type: 'text', text: invoiceNo },
          { type: 'text', text: '₹' + amount },
        ],
      }],
    },
  })
}

// ── Template: order_dispatched ────────────────────────────────────────────────
// Params: {{1}} franchisee name, {{2}} invoice_no, {{3}} AWB number, {{4}} courier
export async function sendWAOrderDispatched(to, { name, invoiceNo, awb, courier }) {
  return sendWA(to, {
    type: 'template',
    template: {
      name: 'order_dispatched',
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
  })
}

// ── Template: payment_received ────────────────────────────────────────────────
// Params: {{1}} franchisee name, {{2}} amount, {{3}} balance
export async function sendWAPaymentReceived(to, { name, amount, balance }) {
  return sendWA(to, {
    type: 'template',
    template: {
      name: 'payment_received',
      language: { code: 'en' },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: name },
          { type: 'text', text: '₹' + amount },
          { type: 'text', text: balance > 0 ? '₹' + balance + ' remaining' : 'Fully paid ✅' },
        ],
      }],
    },
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
  return res.json()
}

// ── Template: student_enrolled ────────────────────────────────────────────────
// Params: {{1}} parent name, {{2}} student name, {{3}} courses, {{4}} centre
export async function sendWAStudentEnrolled(to, { parentName, studentName, courses, centre }) {
  return sendWA(to, {
    type: 'template',
    template: {
      name: 'student_enrolled',
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
  })
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
  return res.json()
}

// ── Template: fee_reminder ────────────────────────────────────────────────────
// Params: {{1}} franchisee name, {{2}} balance amount
export async function sendWAFeeReminder(to, { name, balance }) {
  return sendWA(to, {
    type: 'template',
    template: {
      name: 'fee_reminder',
      language: { code: 'en' },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: name },
          { type: 'text', text: '₹' + balance },
        ],
      }],
    },
  })
}
