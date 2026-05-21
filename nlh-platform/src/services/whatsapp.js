// ── WhatsApp messaging service (via /api/send-whatsapp) ───────────────────────
// All messages go through the NLH landline +91 712 351 4575 (Meta Cloud API)

async function sendWA(to, payload) {
  if (!to) return { success: false, error: 'No phone number' }
  const res = await fetch('/api/send-whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
