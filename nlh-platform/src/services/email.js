import { fmtAmt } from '../utils'

export async function sendBrevoEmail(to, toName, subject, htmlContent) {
  try {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to, toName, subject, htmlContent }),
    })
    const data = await response.json()
    if (response.ok) return { success: true, id: data.id }
    console.error('Brevo error:', data)
    return { success: false, error: data.error || 'Send failed' }
  } catch (err) {
    console.error('Email error:', err)
    return { success: false, error: err.message }
  }
}

export function nlhEmailTemplate(title, bodyHtml, footerNote) {
  return (
    '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff">' +
    '<div style="background:#534AB7;padding:20px 24px;text-align:center">' +
    '<div style="color:#fff;font-size:18px;font-weight:bold">New Learning Horizons</div>' +
    '<div style="color:#CCC9F8;font-size:11px;margin-top:4px">ISO 9001:2015 Certified · Enriching Children\'s Future</div>' +
    '</div>' +
    '<div style="padding:24px;color:#1A1916;font-size:14px;line-height:1.6">' +
    '<div style="font-size:16px;font-weight:bold;color:#534AB7;margin-bottom:16px">' + title + '</div>' +
    bodyHtml +
    '</div>' +
    '<div style="background:#F0EEE9;padding:16px 24px;font-size:11px;color:#5C5A54;text-align:center">' +
    (footerNote ? '<div style="margin-bottom:8px">' + footerNote + '</div>' : '') +
    '<div>New Learning Horizons · 9, Anjuman Shopping Complex, Residency Road, Sadar, Nagpur - 440 001</div>' +
    '<div style="margin-top:4px">Ph: 9373111311 · admin@nlhnagpur.info · www.nlhnagpur.info</div>' +
    '</div>' +
    '</div>'
  )
}

const BANK_DETAILS =
  'Bank: IDFC FIRST Bank, Nagpur - Byramji Town Branch<br>' +
  'A/c: 10278096847 &nbsp;&nbsp; IFSC: IDFB0042504<br>' +
  'UPI: newlearninghorizons@idfcbank'

export async function sendOrderConfirmation(order, franchiseeEmail, franchiseeName) {
  const subject = 'Order ' + order.order_ref + ' placed successfully — NLH'
  const body =
    '<p>Dear ' + (franchiseeName || 'Partner') + ',</p>' +
    '<p>Your order <strong>' + order.order_ref + '</strong> has been placed successfully and is being processed.</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">' +
    '<tr style="background:#F0EEE9"><td style="padding:8px;font-weight:bold">Order Ref</td><td style="padding:8px">' + order.order_ref + '</td></tr>' +
    '<tr><td style="padding:8px;font-weight:bold">Status</td><td style="padding:8px">Pending</td></tr>' +
    '<tr style="background:#F0EEE9"><td style="padding:8px;font-weight:bold">Delivery Address</td><td style="padding:8px">' + (order.deliver_to || '—') + '</td></tr>' +
    '</table>' +
    '<p>You will receive an invoice once the order is processed for dispatch.</p>'
  return sendBrevoEmail(franchiseeEmail, franchiseeName, subject, nlhEmailTemplate('Order Confirmation', body, 'You are receiving this because you placed an order on NLH Platform.'))
}

export async function sendInvoiceEmail(order, franchiseeEmail, franchiseeName, amount) {
  const subject = 'Invoice ' + (order.invoice_no || order.order_ref) + ' — NLH'
  const body =
    '<p>Dear ' + (franchiseeName || 'Partner') + ',</p>' +
    '<p>Your invoice has been generated for order <strong>' + order.order_ref + '</strong>.</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">' +
    '<tr style="background:#F0EEE9"><td style="padding:8px;font-weight:bold">Invoice No.</td><td style="padding:8px">' + (order.invoice_no || '—') + '</td></tr>' +
    '<tr><td style="padding:8px;font-weight:bold">Order Ref</td><td style="padding:8px">' + order.order_ref + '</td></tr>' +
    '<tr style="background:#F0EEE9"><td style="padding:8px;font-weight:bold">Amount</td><td style="padding:8px;font-weight:bold;color:#534AB7">Rs ' + fmtAmt(amount) + '</td></tr>' +
    '</table>' +
    '<p style="margin-top:16px"><strong>Payment details:</strong></p>' +
    '<div style="background:#F0EEE9;padding:12px;border-radius:8px;font-size:13px">' + BANK_DETAILS + '</div>' +
    '<p style="margin-top:16px">Please make the payment and submit the transaction reference via the NLH Platform.</p>'
  return sendBrevoEmail(franchiseeEmail, franchiseeName, subject, nlhEmailTemplate('Invoice Generated', body, 'Please retain this email for your records.'))
}

export async function sendPaymentReminder(order, franchiseeEmail, franchiseeName, amount) {
  const subject = 'Payment reminder — ' + (order.invoice_no || order.order_ref) + ' — NLH'
  const body =
    '<p>Dear ' + (franchiseeName || 'Partner') + ',</p>' +
    '<p>This is a gentle reminder that payment is pending for invoice <strong>' + (order.invoice_no || order.order_ref) + '</strong>.</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">' +
    '<tr style="background:#FEF3C7"><td style="padding:8px;font-weight:bold">Invoice No.</td><td style="padding:8px">' + (order.invoice_no || '—') + '</td></tr>' +
    '<tr><td style="padding:8px;font-weight:bold">Amount Due</td><td style="padding:8px;font-weight:bold;color:#8A5200">Rs ' + fmtAmt(amount) + '</td></tr>' +
    '</table>' +
    '<p>Please make the payment at your earliest convenience and submit the transaction reference via the NLH Platform.</p>' +
    '<div style="background:#F0EEE9;padding:12px;border-radius:8px;font-size:13px">' + BANK_DETAILS + '</div>'
  return sendBrevoEmail(franchiseeEmail, franchiseeName, subject, nlhEmailTemplate('Payment Reminder', body, 'This is an automated reminder from NLH Platform.'))
}

export async function sendPaymentVerified(order, franchiseeEmail, franchiseeName, amount) {
  const subject = 'Payment confirmed — ' + (order.invoice_no || order.order_ref) + ' — NLH'
  const body =
    '<p>Dear ' + (franchiseeName || 'Partner') + ',</p>' +
    '<p>Your payment for invoice <strong>' + (order.invoice_no || order.order_ref) + '</strong> has been verified and confirmed. Thank you!</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">' +
    '<tr style="background:#DCFCE7"><td style="padding:8px;font-weight:bold">Invoice No.</td><td style="padding:8px">' + (order.invoice_no || '—') + '</td></tr>' +
    '<tr><td style="padding:8px;font-weight:bold">Amount Paid</td><td style="padding:8px;font-weight:bold;color:#1D7A4F">Rs ' + fmtAmt(amount) + '</td></tr>' +
    '<tr style="background:#DCFCE7"><td style="padding:8px;font-weight:bold">Payment Mode</td><td style="padding:8px">' + (order.payment_mode || '—') + '</td></tr>' +
    '<tr><td style="padding:8px;font-weight:bold">Reference</td><td style="padding:8px">' + (order.payment_ref || '—') + '</td></tr>' +
    '</table>' +
    '<p>Order status: <strong style="color:#1D7A4F">CLOSED</strong></p>'
  return sendBrevoEmail(franchiseeEmail, franchiseeName, subject, nlhEmailTemplate('Payment Confirmed', body, 'Thank you for your partnership with NLH.'))
}

export async function sendWelcomeEmail(email, name, role, password) {
  const roleLabel = {
    owner: 'Owner', super_admin: 'Super Admin', admin: 'Admin',
    manager: 'Manager', staff: 'Staff', smf: 'State Master Franchisee',
    cf: 'City Franchisee', uf: 'Unit Franchisee', student: 'Student',
  }[role] || role
  const subject = 'Welcome to NLH Platform — Your login credentials'
  const body =
    '<p>Dear ' + (name || 'Partner') + ',</p>' +
    '<p>Welcome to the New Learning Horizons platform! Your account has been created.</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">' +
    '<tr style="background:#DBEAFE"><td style="padding:8px;font-weight:bold">Platform URL</td><td style="padding:8px"><a href="https://nlh-platform.vercel.app/login" style="color:#2563EB">nlh-platform.vercel.app/login</a></td></tr>' +
    '<tr><td style="padding:8px;font-weight:bold">Email</td><td style="padding:8px">' + email + '</td></tr>' +
    '<tr style="background:#DBEAFE"><td style="padding:8px;font-weight:bold">Password</td><td style="padding:8px;font-family:monospace;font-weight:bold">' + (password || 'NLH@123') + '</td></tr>' +
    '<tr><td style="padding:8px;font-weight:bold">Role</td><td style="padding:8px">' + roleLabel + '</td></tr>' +
    '</table>' +
    '<p>Please log in and complete your profile. We recommend changing your password after first login.</p>'
  return sendBrevoEmail(email, name, subject, nlhEmailTemplate('Welcome to NLH', body, 'You are receiving this because an account was created for you on NLH Platform.'))
}
