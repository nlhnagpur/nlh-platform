// Email service — thin client.
// All HTML templates live server-side in api/send-email.js.
// Each function sends { type, data } and lets the server build the email.

import { sb } from '../supabase'

async function authHeaders() {
  const { data: { session } } = await sb.auth.getSession()
  return {
    'content-type': 'application/json',
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

async function sendEmail(type, data, bcc) {
  try {
    const response = await fetch('/api/send-email', {
      method:  'POST',
      headers: await authHeaders(),
      body:    JSON.stringify({ type, data, ...(bcc ? { bcc } : {}) }),
    })
    const result = await response.json()
    if (response.ok) return { success: true, id: result.id }
    console.error('[email]', type, result.error)
    return { success: false, error: result.error || 'Send failed' }
  } catch (err) {
    console.error('[email] fetch error:', err)
    return { success: false, error: err.message }
  }
}

export function sendOrderConfirmation(order) {
  return sendEmail('order_confirmation', { orderId: order.id })
}

export function sendInvoiceEmail(order) {
  return sendEmail('invoice_ready', { orderId: order.id })
}

export function sendPaymentReminder(order) {
  return sendEmail('payment_reminder', { orderId: order.id })
}

export function sendPaymentVerified(order) {
  return sendEmail('payment_verified', { orderId: order.id })
}

export function sendInviteEmail(email, name, role) {
  return sendEmail('invite', { email, name, role })
}

export function sendWelcomeEmail(email, name, role, password) {
  return sendEmail('welcome', { email, name, role, password })
}

export function sendFranchiseeWelcomeLetter(franchisee) {
  return sendEmail('franchisee_welcome_letter', { franchiseeId: franchisee.id })
}

export function sendFranchiseeCertEmail(franchisee) {
  return sendEmail('franchisee_cert', { franchiseeId: franchisee.id })
}

export function sendStudentCertEmail(student, enrollment, centre, parentEmail) {
  return sendEmail('student_cert', { enrollmentId: enrollment.id, parentEmail })
}
