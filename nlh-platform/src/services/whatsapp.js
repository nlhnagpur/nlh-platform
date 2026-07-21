// ── WhatsApp messaging service (via /api/send-whatsapp) ───────────────────────
// All messages go through the NLH landline +91 712 351 4575 (Meta Cloud API)

import { sb } from '../supabase'
import { fmtAmt } from '../utils'

// ── Meta template names — single source of truth ─────────────────────────────
// Meta classifies templates by CONTENT, not by name, and anything it rules
// "Marketing" is refused delivery to recipients who haven't messaged us in the
// last 24h (error 131049). These must therefore stay pointed at the approved
// UTILITY templates. Changing a template in Meta = change the name here only.
export const WA_TEMPLATES = {
  orderInvoiced:   'order_invoiced_v3',   // v2 was an Order Details (WhatsApp Pay) type
  orderDispatched: 'order_dispatched_v3',   // v2 had no courier-charges variable
  // v2 declared an Order Status header the code never sent, so every send
  // failed with 131008. v3 is the same four body variables, header None.
  studentEnrolled: 'student_enrolled_v3',
  balanceReminder: 'balance_reminder',   // universal: students + franchisees
  // Image-header variant of `payment_receipt`, carrying a PNG of the receipt.
  // Same five body variables in the same order, so the text template remains a
  // working fallback whenever no image could be captured.
  paymentReceiptImage: 'payment_receipt_v2',
  reviewRequest:   'review_request',     // legitimately Marketing — leave as is
}

// ── What the recipient actually reads ────────────────────────────────────────
// Meta renders the template server-side, so nothing comes back that we can log.
// These mirror the approved bodies so the Inbox shows the real message instead
// of a one-line label. They are a COPY: reword a template in Meta and the
// matching function here must be reworded too, or the log quietly drifts from
// what was sent. Footer text is omitted — it is identical on every template.
const WA_FOOTER = '\n\nAutomated message · do not reply · www.nlhnagpur.info'

export const WA_BODIES = {
  orderInvoiced: function (p) {
    return `Hi ${p.name}, your order has been invoiced.\n\n` +
           `Invoice: ${p.invoiceNo}\nAmount: ₹${p.amount}\n\n` +
           `The invoice is attached above.` + WA_FOOTER
  },
  orderDispatched: function (p) {
    return `Hi ${p.name}, your order ${p.invoiceNo} has been dispatched.\n\n` +
           `AWB: ${p.awb}\nCourier: ${p.courier}\nCourier charges: ${p.freight}\n\n` +
           `Track it with the courier using the AWB number above.` + WA_FOOTER
  },
  studentEnrolled: function (p) {
    return `Hi ${p.parentName}, ${p.studentName} has been enrolled for ${p.courses} ` +
           `at ${p.centre}, New Learning Horizons.\n\n` +
           `Your centre will share the batch schedule with you shortly.\n\n` +
           `For any queries, please contact your centre.` + WA_FOOTER
  },
  paymentReceipt: function (p) {
    return `Dear ${p.name}, we have received your payment.\n\n` +
           `Receipt no: ${p.receiptNo}\nAmount: ₹${p.amount}\nDate: ${p.date}\nStatus: ${p.status}\n\n` +
           `The receipt is attached above. Thank you.` + WA_FOOTER
  },
  balanceReminder: function (p) {
    return `Dear ${p.name}, this is a reminder that ₹${p.balance} is outstanding ` +
           `against ${p.towards}.\n\nPlease arrange payment at your convenience.` + WA_FOOTER
  },
  // The review link is static inside the approved template, so it is repeated
  // here rather than passed in.
  reviewRequest: function (p) {
    return `Dear ${p.parentName}, congratulations to ${p.studentName} on completing ` +
           `${p.courseName} at New Learning Horizons.\n\n` +
           `If you are happy with your experience, a short Google review would mean a lot to us:\n` +
           `https://g.page/r/nlhnagpur/review\n\nThank you!` + WA_FOOTER
  },
  certIssued: function (p) {
    return `Congratulations ${p.studentName}!\n\n` +
           `Dear ${p.parentName}, we are delighted to share ${p.studentName}'s ` +
           `Certificate of Accomplishment for successfully completing ${p.courseName} ` +
           `at New Learning Horizons.\n\nThe certificate is attached above.` + WA_FOOTER
  },
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
  }, WA_BODIES.orderInvoiced({ name: name, invoiceNo: invoiceNo, amount: amount }), imageUrl)
}

// ── Template: order_dispatched ────────────────────────────────────────────────
// Params: {{1}} franchisee name, {{2}} invoice_no, {{3}} AWB number, {{4}} courier
// {{5}} freight: what the franchisee will be charged for carriage. Left blank
// or zero it reads "As per actuals" — dispatch often happens before the courier
// bills us, and a bare "₹0" would be read as free delivery.
export async function sendWAOrderDispatched(to, { name, invoiceNo, awb, courier, freight }) {
  const amt = Number(freight)
  const freightText = amt > 0 ? '₹' + fmtAmt(amt) : 'As per actuals'
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
          { type: 'text', text: freightText },
        ],
      }],
    },
  }, WA_BODIES.orderDispatched({ name: name, invoiceNo: invoiceNo, awb: awb || '—',
       courier: courier || 'courier', freight: freightText }))
}

// ── Template: payment_received ────────────────────────────────────────────────
// Params: {{1}} franchisee name, {{2}} amount, {{3}} balance
// Franchisee payment confirmation. Routed through the SAME approved Utility
// template as student receipts (`payment_receipt`); the old `payment_received`
// template was classified Marketing, so Meta refused delivery to franchisees
// who hadn't messaged recently (error 131049).
export async function sendWAPaymentReceived(to, { name, amount, balance, receiptNo, date, imageUrl }) {
  return sendWAStudentReceipt(to, {
    imageUrl:  imageUrl,
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
// imageUrl: public PNG of the receipt. Only attached once an image-header
// template exists (WA_TEMPLATES.paymentReceiptImage); otherwise ignored so the
// text receipt still goes out rather than failing.
export async function sendWAStudentReceipt(to, { name, receiptNo, amount, date, balance, imageUrl }) {
  if (!toWAPhone(to)) return { success: false, error: 'No valid phone number on file' }
  const withImage = !!(imageUrl && WA_TEMPLATES.paymentReceiptImage)
  const res = await fetch('/api/send-payment-whatsapp', {
    method: 'POST',
    headers: await waAuthHeaders(),
    body: JSON.stringify({
      to: toWAPhone(to), name, receiptNo, amount, date, balance,
      imageUrl:      withImage ? imageUrl : null,
      imageTemplate: withImage ? WA_TEMPLATES.paymentReceiptImage : null,
    }),
  })
  const data = await res.json()
  if (data && data.success) logOutbound(to, WA_BODIES.paymentReceipt({
    name: name, receiptNo: receiptNo || '—', amount: amount, date: date || '',
    status: Number(balance) > 0 ? '₹' + balance + ' remaining' : 'Fully paid',
  }), 'template', waMsgId(data), withImage ? imageUrl : null)
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
  }, WA_BODIES.studentEnrolled({ parentName: parentName || 'Parent', studentName: studentName,
       courses: courses, centre: centre }))
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
  if (data && data.success) logOutbound(to, WA_BODIES.reviewRequest({
    parentName: parentName || 'Parent', studentName: studentName || 'your child',
    courseName: courseName || 'the course',
  }), 'template', waMsgId(data))
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
  }, WA_BODIES.balanceReminder({ name: name, balance: balance, towards: towards || 'your account' }))
}
