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
  const firstName  = (franchiseeName || 'Partner').split(' ')[0]
  const invoiceNo  = order.invoice_no || '—'
  const orderRef   = order.order_ref  || '—'
  const loginUrl   = 'https://nlh-platform.vercel.app/login'
  const subject    = 'Invoice ' + invoiceNo + ' from New Learning Horizons'

  const html =
    '<div style="margin:0;padding:0;background:#F4F3F8;font-family:Arial,Helvetica,sans-serif">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3F8;padding:32px 0">' +
    '<tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">' +

    // Header
    '<tr><td style="background:linear-gradient(135deg,#534AB7 0%,#7B74D4 100%);border-radius:16px 16px 0 0;padding:36px 40px 32px;text-align:center">' +
    '<div style="display:inline-block;width:56px;height:56px;background:rgba(255,255,255,.18);border-radius:14px;text-align:center;line-height:56px;font-size:28px;margin-bottom:14px">🧾</div>' +
    '<div style="color:#FFFFFF;font-size:22px;font-weight:700;margin-bottom:4px">New Learning Horizons</div>' +
    '<div style="color:rgba(255,255,255,.65);font-size:11px;letter-spacing:.06em;text-transform:uppercase">ISO 9001:2015 Certified &nbsp;·&nbsp; Enriching Children\'s Future</div>' +
    '</td></tr>' +

    // Body
    '<tr><td style="background:#FFFFFF;padding:36px 40px 28px">' +
    '<div style="font-size:24px;font-weight:700;color:#1A1916;margin-bottom:6px">Invoice ready, ' + firstName + '! 📋</div>' +
    '<p style="font-size:14px;color:#5C5A54;line-height:1.7;margin:0 0 24px 0">' +
    'Your invoice has been generated for order <strong>' + orderRef + '</strong>. ' +
    'Please review the details below and make the payment at your earliest convenience.' +
    '</p>' +

    // Invoice details card
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F7FE;border:1.5px solid #DDD9F9;border-radius:12px;margin-bottom:24px">' +
    '<tr><td style="padding:16px 24px 8px">' +
    '<div style="font-size:10px;font-weight:700;color:#534AB7;letter-spacing:.1em;text-transform:uppercase;margin-bottom:16px">Invoice Details</div>' +
    '</td></tr>' +
    '<tr><td style="padding:0 24px 8px">' +
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr style="border-bottom:1px solid #EDE9FF"><td style="padding:10px 0;font-size:12px;color:#888;width:40%">Invoice Number</td><td style="padding:10px 0;font-size:13px;font-weight:700;color:#534AB7;font-family:Courier New,monospace">' + invoiceNo + '</td></tr>' +
    '<tr style="border-bottom:1px solid #EDE9FF"><td style="padding:10px 0;font-size:12px;color:#888">Order Reference</td><td style="padding:10px 0;font-size:13px;font-weight:600;color:#1A1916">' + orderRef + '</td></tr>' +
    (order.deliver_to ? '<tr style="border-bottom:1px solid #EDE9FF"><td style="padding:10px 0;font-size:12px;color:#888">Deliver To</td><td style="padding:10px 0;font-size:13px;color:#1A1916">' + order.deliver_to + '</td></tr>' : '') +
    '<tr><td style="padding:12px 0;font-size:12px;color:#888">Amount Due</td><td style="padding:12px 0;font-size:18px;font-weight:700;color:#534AB7">₹' + fmtAmt(amount) + '</td></tr>' +
    '</table>' +
    '</td></tr></table>' +

    // Payment details
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8E7;border:1.5px solid #FDE68A;border-radius:12px;margin-bottom:24px">' +
    '<tr><td style="padding:16px 24px">' +
    '<div style="font-size:10px;font-weight:700;color:#D97706;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">💳 Payment Details</div>' +
    '<div style="font-size:13px;color:#1A1916;line-height:1.8">' + BANK_DETAILS + '</div>' +
    '</td></tr></table>' +

    // CTA
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">' +
    '<tr><td align="center">' +
    '<a href="' + loginUrl + '" style="display:inline-block;background:#534AB7;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:14px 36px;border-radius:10px">' +
    'Submit Payment on NLH Platform &nbsp;→' +
    '</a>' +
    '</td></tr>' +
    '<tr><td align="center" style="padding-top:10px;font-size:11px;color:#999">Log in → go to Orders → Submit Payment</td></tr>' +
    '</table>' +

    // Note
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="background:#F0FDF4;border-left:3px solid #16A34A;border-radius:0 8px 8px 0;padding:12px 16px">' +
    '<div style="font-size:12px;color:#166534;line-height:1.6">' +
    '<strong>📦 Note:</strong> Dispatch may happen independently of payment on credit terms. ' +
    'Please submit your UTR / transaction reference on the platform after making payment.' +
    '</div>' +
    '</td></tr></table>' +

    '</td></tr>' +

    // Divider
    '<tr><td style="background:#534AB7;height:4px"></td></tr>' +

    // Footer
    '<tr><td style="background:#2D2B5E;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center">' +
    '<div style="color:rgba(255,255,255,.5);font-size:11px;line-height:1.7">' +
    '<div style="color:rgba(255,255,255,.8);font-weight:600;margin-bottom:6px">New Learning Horizons</div>' +
    '9, Anjuman Shopping Complex, Residency Road, Sadar, Nagpur – 440 001<br>' +
    'Ph: 9373111311 &nbsp;·&nbsp; admin@nlhnagpur.info &nbsp;·&nbsp; www.nlhnagpur.info<br><br>' +
    '<span style="font-size:10px">Please retain this email for your records.</span>' +
    '</div>' +
    '</td></tr>' +

    '</table></td></tr></table></div>'

  return sendBrevoEmail(franchiseeEmail, franchiseeName, subject, html)
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

export async function sendInviteEmail(email, name, role) {
  const ROLE_LABEL = {
    owner: 'Owner', super_admin: 'Super Admin', admin: 'Admin',
    manager: 'Manager', staff: 'Staff',
    smf: 'State Master Franchisee', cf: 'City Franchisee',
    uf: 'Unit Franchisee', student: 'Student',
  }
  const roleLabel = ROLE_LABEL[role] || role
  const firstName = (name || email.split('@')[0]).split(' ')[0]
  const loginUrl  = 'https://nlh-platform.vercel.app/login'

  const subject = 'You\'ve been invited to NLH Platform'

  const html =
    '<div style="margin:0;padding:0;background:#F4F3F8;font-family:Arial,Helvetica,sans-serif">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3F8;padding:32px 0">' +
    '<tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">' +

    // Header
    '<tr><td style="background:linear-gradient(135deg,#534AB7 0%,#7B74D4 100%);border-radius:16px 16px 0 0;padding:40px 40px 36px;text-align:center">' +
    '<div style="display:inline-block;width:56px;height:56px;background:rgba(255,255,255,.18);border-radius:14px;text-align:center;line-height:56px;font-size:28px;margin-bottom:16px">🎓</div>' +
    '<div style="color:#FFFFFF;font-size:22px;font-weight:700;letter-spacing:-.3px;margin-bottom:4px">New Learning Horizons</div>' +
    '<div style="color:rgba(255,255,255,.65);font-size:11px;letter-spacing:.06em;text-transform:uppercase">ISO 9001:2015 Certified &nbsp;·&nbsp; Enriching Children\'s Future</div>' +
    '</td></tr>' +

    // Body
    '<tr><td style="background:#FFFFFF;padding:40px 40px 32px">' +

    '<div style="font-size:26px;font-weight:700;color:#1A1916;margin-bottom:8px">You\'re invited, ' + firstName + '! 🎉</div>' +
    '<p style="font-size:14px;color:#5C5A54;line-height:1.7;margin:0 0 28px 0">' +
    'An administrator has set up an account for you on the <strong style="color:#534AB7">NLH Platform</strong>. ' +
    'Use the details below to sign in, then set your own password to secure your account.' +
    '</p>' +

    // Info card
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F7FE;border:1.5px solid #DDD9F9;border-radius:12px;margin-bottom:28px">' +
    '<tr><td style="padding:18px 24px 20px">' +
    '<div style="font-size:10px;font-weight:700;color:#534AB7;letter-spacing:.1em;text-transform:uppercase;margin-bottom:18px">Your Account Details</div>' +

    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px">' +
    '<tr><td style="font-size:10px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px">Login Email</td></tr>' +
    '<tr><td style="font-size:14px;font-weight:600;color:#1A1916">' + email + '</td></tr>' +
    '</table>' +

    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="font-size:10px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px">Your Role</td></tr>' +
    '<tr><td><span style="display:inline-block;background:#EDE9FF;color:#534AB7;font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:.04em">' + roleLabel + '</span></td></tr>' +
    '</table>' +
    '</td></tr></table>' +

    // CTA
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">' +
    '<tr><td align="center">' +
    '<a href="' + loginUrl + '" style="display:inline-block;background:#534AB7;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;padding:15px 40px;border-radius:10px;letter-spacing:.01em">' +
    'Go to NLH Platform &nbsp;→' +
    '</a>' +
    '</td></tr></table>' +

    // Instructions box
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="background:#F0FDF4;border-left:3px solid #16A34A;border-radius:0 8px 8px 0;padding:14px 18px">' +
    '<div style="font-size:12px;color:#166534;line-height:1.7">' +
    '<strong>🔑 How to set your password</strong><br>' +
    '1. Click the button above to go to the login page<br>' +
    '2. Click <strong>"Forgot password?"</strong> and enter your email address above<br>' +
    '3. Check your inbox for a password reset link and follow the instructions<br>' +
    '4. Done — log in and get started!' +
    '</div>' +
    '</td></tr></table>' +

    '</td></tr>' +

    // Divider
    '<tr><td style="background:#534AB7;height:4px"></td></tr>' +

    // Footer
    '<tr><td style="background:#2D2B5E;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center">' +
    '<div style="color:rgba(255,255,255,.5);font-size:11px;line-height:1.7">' +
    '<div style="color:rgba(255,255,255,.8);font-weight:600;margin-bottom:6px">New Learning Horizons</div>' +
    '9, Anjuman Shopping Complex, Residency Road, Sadar, Nagpur – 440 001<br>' +
    'Ph: 9373111311 &nbsp;·&nbsp; admin@nlhnagpur.info &nbsp;·&nbsp; www.nlhnagpur.info<br><br>' +
    '<span style="font-size:10px">You received this because an account was created for you on the NLH Platform.<br>' +
    'If you did not expect this, please contact <a href="mailto:admin@nlhnagpur.info" style="color:rgba(255,255,255,.5)">admin@nlhnagpur.info</a>.</span>' +
    '</div>' +
    '</td></tr>' +

    '</table></td></tr></table></div>'

  return sendBrevoEmail(email, name, subject, html)
}

export async function sendWelcomeEmail(email, name, role, password) {
  const ROLE_LABEL = {
    owner: 'Owner', super_admin: 'Super Admin', admin: 'Admin',
    manager: 'Manager', staff: 'Staff',
    smf: 'State Master Franchisee', cf: 'City Franchisee',
    uf: 'Unit Franchisee', student: 'Student',
  }
  const roleLabel  = ROLE_LABEL[role] || role
  const firstName  = (name || email.split('@')[0]).split(' ')[0]
  const loginUrl   = 'https://nlh-platform.vercel.app/login'
  const resetUrl   = 'https://nlh-platform.vercel.app/login'   // lands on the login page; "Forgot password" resets it

  const subject = 'Welcome to NLH Platform — Your account is ready'

  const html =
    // ── Outer wrapper ──────────────────────────────────────────────────────
    '<div style="margin:0;padding:0;background:#F4F3F8;font-family:Arial,Helvetica,sans-serif">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3F8;padding:32px 0">' +
    '<tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">' +

    // ── Header ─────────────────────────────────────────────────────────────
    '<tr><td style="background:linear-gradient(135deg,#534AB7 0%,#7B74D4 100%);border-radius:16px 16px 0 0;padding:40px 40px 36px;text-align:center">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td align="center">' +
    '<div style="display:inline-block;width:56px;height:56px;background:rgba(255,255,255,.18);border-radius:14px;text-align:center;line-height:56px;font-size:28px;margin-bottom:16px">🎓</div>' +
    '<div style="color:#FFFFFF;font-size:22px;font-weight:700;letter-spacing:-.3px;margin-bottom:4px">New Learning Horizons</div>' +
    '<div style="color:rgba(255,255,255,.65);font-size:11px;letter-spacing:.06em;text-transform:uppercase">ISO 9001:2015 Certified &nbsp;·&nbsp; Enriching Children\'s Future</div>' +
    '</td></tr></table>' +
    '</td></tr>' +

    // ── White body ─────────────────────────────────────────────────────────
    '<tr><td style="background:#FFFFFF;padding:40px 40px 32px">' +

    // Greeting
    '<div style="font-size:26px;font-weight:700;color:#1A1916;margin-bottom:8px">Welcome, ' + firstName + '! 👋</div>' +
    '<p style="font-size:14px;color:#5C5A54;line-height:1.7;margin:0 0 28px 0">' +
    'We\'re excited to have you on board. Your account on the <strong style="color:#534AB7">NLH Platform</strong> ' +
    'has been set up and is ready to use. Below are your login details — please keep them safe.' +
    '</p>' +

    // Credentials card
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F7FE;border:1.5px solid #DDD9F9;border-radius:12px;margin-bottom:28px">' +
    '<tr><td style="padding:18px 24px 14px">' +
    '<div style="font-size:10px;font-weight:700;color:#534AB7;letter-spacing:.1em;text-transform:uppercase;margin-bottom:18px">Your Login Details</div>' +

    // Email row
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px">' +
    '<tr><td style="font-size:10px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px">Login Email</td></tr>' +
    '<tr><td style="font-size:14px;font-weight:600;color:#1A1916">' + email + '</td></tr>' +
    '</table>' +

    // Password row
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px">' +
    '<tr><td style="font-size:10px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px">Temporary Password</td></tr>' +
    '<tr><td><span style="display:inline-block;background:#FFFFFF;border:1.5px solid #DDD9F9;border-radius:8px;padding:7px 14px;font-family:Courier New,Courier,monospace;font-size:15px;font-weight:700;color:#534AB7;letter-spacing:.08em">' + (password || 'NLH@123') + '</span></td></tr>' +
    '</table>' +

    // Role row
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="font-size:10px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px">Your Role</td></tr>' +
    '<tr><td><span style="display:inline-block;background:#EDE9FF;color:#534AB7;font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:.04em">' + roleLabel + '</span></td></tr>' +
    '</table>' +

    '</td></tr></table>' +

    // CTA Button
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">' +
    '<tr><td align="center">' +
    '<a href="' + loginUrl + '" style="display:inline-block;background:#534AB7;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;padding:15px 40px;border-radius:10px;letter-spacing:.01em">' +
    'Log In to NLH Platform &nbsp;→' +
    '</a>' +
    '</td></tr></table>' +

    // Security tip box
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="background:#FFFBEB;border-left:3px solid #D97706;border-radius:0 8px 8px 0;padding:14px 18px">' +
    '<div style="font-size:12px;color:#92400E;line-height:1.6">' +
    '<strong>🔒 Keep your account secure</strong><br>' +
    'This is a temporary password. After your first login, we recommend you reset it via ' +
    '<a href="' + resetUrl + '" style="color:#92400E;font-weight:700">Forgot Password</a> ' +
    'on the login page, or ask your admin to update it for you.' +
    '</div>' +
    '</td></tr></table>' +

    '</td></tr>' +   // end white body

    // ── Divider strip ──────────────────────────────────────────────────────
    '<tr><td style="background:#534AB7;height:4px"></td></tr>' +

    // ── Footer ─────────────────────────────────────────────────────────────
    '<tr><td style="background:#2D2B5E;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center">' +
    '<div style="color:rgba(255,255,255,.5);font-size:11px;line-height:1.7">' +
    '<div style="color:rgba(255,255,255,.8);font-weight:600;margin-bottom:6px">New Learning Horizons</div>' +
    '9, Anjuman Shopping Complex, Residency Road, Sadar, Nagpur – 440 001<br>' +
    'Ph: 9373111311 &nbsp;·&nbsp; admin@nlhnagpur.info &nbsp;·&nbsp; www.nlhnagpur.info<br><br>' +
    '<span style="font-size:10px">You received this email because an account was created for you on the NLH Platform.<br>' +
    'If you did not expect this, please contact <a href="mailto:admin@nlhnagpur.info" style="color:rgba(255,255,255,.5)">admin@nlhnagpur.info</a>.</span>' +
    '</div>' +
    '</td></tr>' +

    '</table>' +   // inner 600px table
    '</td></tr></table>' +  // outer full-width table
    '</div>'

  return sendBrevoEmail(email, name, subject, html)
}

// ── Franchisee Welcome Letter ─────────────────────────────────────────────────
//
// sendFranchiseeWelcomeLetter(franchisee, courseNames)
//   franchisee  — DB row (owner_name, business_name, tier, city, area, state, country, created_at, email)
//   courseNames — string[] of course group_names already registered (empty = "To be announced")

export async function sendFranchiseeWelcomeLetter(franchisee, courseNames) {
  const ownerName   = franchisee.owner_name || franchisee.business_name || 'Partner'
  const firstName   = ownerName.split(' ')[0]
  const centreName  = franchisee.business_name && franchisee.business_name !== ownerName
    ? franchisee.business_name
    : null

  // ── Tier labels & territory ──
  const TIER = {
    SMF: { label: 'State Master Franchisee', short: 'SMF' },
    CF:  { label: 'City Franchisee',          short: 'CF'  },
    UF:  { label: 'Unit Franchisee',           short: 'UF'  },
  }
  const tierInfo  = TIER[franchisee.tier] || { label: franchisee.tier, short: franchisee.tier }
  const territory = franchisee.tier === 'SMF'
    ? (franchisee.state || franchisee.country || '—')
    : franchisee.tier === 'CF'
      ? (franchisee.city || '—')
      : [franchisee.area, franchisee.city].filter(Boolean).join(', ') || '—'

  // ── Date of appointment ──
  const apptDate = (function () {
    const d = new Date(franchisee.created_at || Date.now())
    return [
      String(d.getDate()).padStart(2, '0'),
      String(d.getMonth() + 1).padStart(2, '0'),
      d.getFullYear(),
    ].join('-')
  })()

  // ── Courses ──
  const coursesText = courseNames && courseNames.length > 0
    ? courseNames.join(', ')
    : (franchisee.tier === 'SMF' || franchisee.tier === 'CF')
      ? 'All NLH Programs'
      : 'To be assigned'

  // ── Tier-specific opening line ──
  const tierOpenings = {
    SMF: 'You are now the <strong>State Master Franchisee</strong> for <strong>' + (franchisee.state || franchisee.country) + '</strong> — responsible for growing the NLH family across your entire state.',
    CF:  'You are now the <strong>City Franchisee</strong> for <strong>' + (franchisee.city || territory) + '</strong> — a key pillar in expanding NLH&rsquo;s reach in your city.',
    UF:  'You are now an authorised <strong>Unit Franchisee</strong>' + (franchisee.city ? ' in <strong>' + franchisee.city + '</strong>' : '') + ' — at the heart of our mission to enrich children&rsquo;s lives every day.',
  }
  const tierOpening = tierOpenings[franchisee.tier] || tierOpenings.UF

  const subject = 'Welcome to the New Learning Horizons Family, ' + firstName + '!'
  const BASE    = 'https://nlh-platform.vercel.app'
  const sigUrl  = BASE + '/DRP%20Signature.png'
  const logoUrl = BASE + '/NLH%20Logo.png'
  const awardsUrl  = BASE + '/awards-banner.png'
  const acemUrl    = BASE + '/acem-abacus-logo.png'
  const writewellUrl = BASE + '/writewell-logo.png'
  const easymathUrl  = BASE + '/easy-math-logo.png'

  const html =
    '<div style="margin:0;padding:0;background:#F4F2EC;font-family:Georgia,\'Times New Roman\',serif">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EC;padding:32px 0">' +
    '<tr><td align="center">' +
    '<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border:1px solid #D6D0C4;border-radius:4px">' +

    // ── Row 1: Logo + Awards strip + Address ──────────────────────────────────
    '<tr><td style="padding:16px 24px 12px;border-bottom:2px solid #CC0000">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +

    // NLH logo + Mascot — left column
    '<td style="vertical-align:top;width:170px;padding-right:10px">' +
    '<div style="display:inline-flex;align-items:center;gap:8px">' +
    '<img src="' + logoUrl + '" alt="NLH" style="height:72px;width:auto;display:block" />' +
    '<img src="' + BASE + '/NLH%20Mascot.png" alt="" style="height:72px;width:auto;display:block;filter:drop-shadow(0 4px 10px rgba(217,119,6,.28))" />' +
    '</div>' +
    '</td>' +

    // Awards photo strip — centre column
    '<td style="vertical-align:top;text-align:center;padding:0 6px">' +
    '<img src="' + awardsUrl + '" alt="Awards" style="width:100%;max-width:270px;height:auto;object-fit:contain;display:block;border-radius:3px" />' +
    '</td>' +

    // Address — right column
    '<td style="text-align:right;vertical-align:top;width:156px;padding-left:10px;font-family:Arial,sans-serif">' +
    '<div style="font-size:12px;font-weight:700;color:#CC0000">Dhiral Panchmatia</div>' +
    '<div style="font-size:9.5px;color:#444;line-height:1.75">' +
    '9, Anjuman Shopping Complex<br>Residency Road, Sadar<br>Nagpur &ndash; 440 001<br>' +
    'Mob.: +91 9373111311<br>' +
    '<a href="mailto:nlhnagpur@yahoo.in" style="color:#CC0000;text-decoration:none">nlhnagpur@yahoo.in</a><br>' +
    '<a href="https://www.nlhnagpur.info" style="color:#CC0000;text-decoration:none">www.nlhnagpur.info</a>' +
    '</div>' +
    '</td>' +

    '</tr></table>' +
    '</td></tr>' +

    // ── Addressee block ───────────────────────────────────────────────────────
    '<tr><td style="padding:28px 40px 0;font-family:Arial,sans-serif;font-size:13px;color:#1A1916;line-height:1.8">' +
    '<div>To,</div>' +
    '<div style="font-weight:700">' + ownerName + (centreName ? '<br>' + centreName : '') + '</div>' +
    '<div>New Learning Horizons — <em>' + tierInfo.label + '</em></div>' +
    '<div style="color:#555">' + territory + '</div>' +
    '</td></tr>' +

    // ── Subject ───────────────────────────────────────────────────────────────
    '<tr><td style="padding:20px 40px 0;font-family:Arial,sans-serif">' +
    '<div style="font-size:13px;font-weight:700;color:#1A1916;text-align:center">' +
    'Subject: <u>Welcome to the New Learning Horizons Family!</u>' +
    '</div>' +
    '</td></tr>' +

    // ── Letter body ───────────────────────────────────────────────────────────
    '<tr><td style="padding:20px 40px 0;font-family:Arial,sans-serif;font-size:13px;color:#1A1916;line-height:1.9">' +

    '<p style="margin:0 0 14px 0">Dear ' + firstName + ',</p>' +

    '<p style="margin:0 0 14px 0">' +
    'It is with great joy and pride that we welcome you to the <strong>New Learning Horizons</strong> family! ' +
    tierOpening +
    '</p>' +

    '<p style="margin:0 0 14px 0">' +
    'You are now part of a growing educational movement that is transforming the way children learn, grow, and discover ' +
    'their true potential. With your new centre, we are expanding our mission to reach more young minds and create ' +
    'lifelong learners across India and beyond.' +
    '</p>' +

    '<p style="margin:0 0 14px 0">' +
    'At New Learning Horizons, we believe in nurturing creativity, confidence, and curiosity. With over 15 innovative ' +
    'programs — Abacus, Vedic Maths, Montessori, Handwriting, Rubik\'s Cube, Reading, Phonics, Personality ' +
    'Development, Chess, Art &amp; Craft and more — your centre will play a key role in shaping a brighter future.' +
    '</p>' +

    '<p style="margin:0 0 6px 0">' +
    'We are committed to ensuring your smooth transition and long-term success. To support you in this journey, you will be provided with:' +
    '</p>' +
    '<table cellpadding="0" cellspacing="0" style="margin:0 0 14px 20px;font-size:13px;color:#1A1916">' +
    '<tr><td style="padding:2px 0">&ndash;&nbsp; A detailed orientation and training program</td></tr>' +
    '<tr><td style="padding:2px 0">&ndash;&nbsp; Branding and marketing support</td></tr>' +
    '<tr><td style="padding:2px 0">&ndash;&nbsp; Curriculum access and teacher manuals</td></tr>' +
    '<tr><td style="padding:2px 0">&ndash;&nbsp; Ongoing mentorship and operational guidance</td></tr>' +
    '</table>' +

    '</td></tr>' +

    // ── Credentials box ───────────────────────────────────────────────────────
    '<tr><td style="padding:0 40px">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #D6D0C4;border-radius:4px;background:#FAF9F6;margin:14px 0">' +
    '<tr><td style="padding:12px 20px 4px">' +
    '<div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#888;margin-bottom:10px">Your Franchise Credentials</div>' +
    '<table cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;font-size:13px;color:#1A1916;width:100%">' +

    '<tr><td style="padding:4px 0;color:#555;width:44%">Franchise Type</td>' +
    '<td style="padding:4px 0;font-weight:700">: ' + tierInfo.label + '</td></tr>' +

    '<tr><td style="padding:4px 0;color:#555">Authorised Territory</td>' +
    '<td style="padding:4px 0;font-weight:700">: ' + territory + '</td></tr>' +

    '<tr><td style="padding:4px 0;color:#555">Date of Appointment</td>' +
    '<td style="padding:4px 0;font-weight:700">: ' + apptDate + '</td></tr>' +

    '<tr><td style="padding:4px 0 10px;color:#555;vertical-align:top">Courses Selected</td>' +
    '<td style="padding:4px 0 10px;font-weight:700">: ' + coursesText + '</td></tr>' +

    '</table>' +
    '</td></tr></table>' +
    '</td></tr>' +

    // ── Closing ───────────────────────────────────────────────────────────────
    '<tr><td style="padding:10px 40px 0;font-family:Arial,sans-serif;font-size:13px;color:#1A1916;line-height:1.9">' +
    '<p style="margin:0 0 14px 0">' +
    'Let\'s work together to make your centre a warm, enriching space where children not only learn but thrive.' +
    '</p>' +
    '<p style="margin:0 0 20px 0">Once again, welcome aboard — we are thrilled to have you with us!</p>' +
    '<p style="margin:0 0 4px 0">Warm regards,</p>' +
    '</td></tr>' +

    // ── Signature ─────────────────────────────────────────────────────────────
    '<tr><td style="padding:0 40px 4px">' +
    '<img src="' + sigUrl + '" alt="Signature" style="height:52px;width:auto;display:block;opacity:0.85" />' +
    '</td></tr>' +

    '<tr><td style="padding:0 40px 28px;font-family:Arial,sans-serif;font-size:13px;color:#1A1916;line-height:1.7">' +
    '<div style="font-weight:700">Dhiral Panchmatia</div>' +
    '<div>Founder</div>' +
    '<div style="color:#CC0000;font-weight:600">New Learning Horizons</div>' +
    '</td></tr>' +

    // ── Premier course brand logos ────────────────────────────────────────────
    '<tr><td style="padding:16px 32px 8px;border-top:1px solid #E8E4DA">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td align="center" style="padding:0 8px">' +
    '<img src="' + acemUrl + '" alt="ACEM Abacus" style="height:48px;width:auto;border-radius:4px" />' +
    '</td>' +
    '<td align="center" style="padding:0 8px">' +
    '<img src="' + writewellUrl + '" alt="WriteWell" style="height:48px;width:auto;border-radius:4px" />' +
    '</td>' +
    '<td align="center" style="padding:0 8px">' +
    '<img src="' + easymathUrl + '" alt="Easy Math" style="height:48px;width:auto;border-radius:4px" />' +
    '</td>' +
    '</tr></table>' +
    '</td></tr>' +

    // ── Red divider ───────────────────────────────────────────────────────────
    '<tr><td style="background:#CC0000;height:3px"></td></tr>' +

    // ── Footer ────────────────────────────────────────────────────────────────
    '<tr><td style="padding:14px 32px;text-align:center;font-family:Arial,sans-serif;font-size:10px;color:#888;line-height:1.7;border-top:1px solid #E8E4DA">' +
    '<div style="font-weight:700;color:#555;margin-bottom:4px">New Learning Horizons &nbsp;|&nbsp; ISO 9001:2015 Certified &nbsp;|&nbsp; Enriching Children\'s Future since 2008</div>' +
    '9, Anjuman Shopping Complex, Residency Road, Sadar, Nagpur &ndash; 440 001 &nbsp;&nbsp; Ph: 9373111311 &nbsp;&nbsp; admin@nlhnagpur.info' +
    '</td></tr>' +

    '</table>' +
    '</td></tr></table></div>'

  return sendBrevoEmail(franchisee.email, ownerName, subject, html)
}

// ── Franchisee Certificate ─────────────────────────────────────────────────────

export async function sendFranchiseeCertEmail(franchisee, courseNames) {
  const name      = franchisee.business_name || 'Partner'
  const firstName = name.split(' ')[0]
  const subject   = 'Your NLH Franchise Certificate — New Learning Horizons'

  function mkTierLabel(fr) {
    if (fr.tier === 'SMF') return 'State Master Franchisee'
    if (fr.tier === 'CF')  return (fr.city || '') + ' City Master Franchisee'
    return 'Unit Franchisee'
  }
  function mkValidTill(ts) {
    const d = new Date(ts || Date.now())
    d.setFullYear(d.getFullYear() + 5)
    return [String(d.getDate()).padStart(2,'0'), String(d.getMonth()+1).padStart(2,'0'), d.getFullYear()].join('.')
  }
  function mkAddress(fr) {
    return [fr.address, fr.area, fr.city, fr.state,
      fr.country && fr.country !== 'India' ? fr.country : null].filter(Boolean).join(', ')
  }

  const label   = mkTierLabel(franchisee)
  const till    = mkValidTill(franchisee.created_at)
  const addr    = mkAddress(franchisee)
  const courses = courseNames.join(', ')
  const isSMF   = franchisee.tier === 'SMF'
  const loginUrl = 'https://nlh-platform.vercel.app'

  const certCard =
    '<table width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #DDD9F9;border-radius:12px;background:#FAFAFA;margin:20px 0">' +
    '<tr><td style="padding:24px;text-align:center;font-family:Arial,sans-serif">' +
    '<div style="font-size:13px;font-weight:900;letter-spacing:2px;color:#1A1916;margin-bottom:4px">FRANCHISE CERTIFICATE</div>' +
    '<div style="font-size:10px;color:#888;margin-bottom:12px">This is to Certify that</div>' +
    '<div style="font-size:22px;font-weight:700;color:#CC0000;margin-bottom:' + (isSMF ? '2px' : '8px') + ';font-style:italic">' + name + '</div>' +
    (isSMF ? '<div style="font-size:14px;font-weight:700;color:#CC0000;margin-bottom:8px;font-style:italic">' + (franchisee.state || '') + '</div>' : '') +
    '<div style="font-size:10px;color:#888;margin-bottom:2px">Is a Registered</div>' +
    '<div style="font-size:12px;font-weight:700;color:#CC0000;margin-bottom:6px">' + label + ' of</div>' +
    '<div style="font-size:13px;font-weight:700;color:#1A1916;margin-bottom:6px">New Learning Horizons at</div>' +
    '<div style="font-size:10px;color:#555;margin-bottom:' + (courses ? '6px' : '0') + '">' + addr + '</div>' +
    (courses ? '<div style="font-size:10px;color:#1A1916;line-height:1.5">for ' + courses + '</div>' : '') +
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;padding-top:10px;border-top:1px dashed #DDD9F9"><tr>' +
    '<td style="text-align:left;font-size:10px;color:#888"><div>Valid Till</div><div style="font-weight:700;color:#1A1916">' + till + '</div></td>' +
    '<td style="text-align:right;font-size:9px;color:#888;font-style:italic"><div>Dhiral Panchmatia</div><div>Director, NLH</div></td>' +
    '</tr></table>' +
    '</td></tr></table>'

  const body =
    '<p>Dear ' + firstName + ',</p>' +
    '<p style="margin:12px 0">Congratulations! Your franchise certificate from <strong>New Learning Horizons</strong> is ready. ' +
    'Please find your certificate details below. Log in to the NLH Platform to print or save a PDF copy.</p>' +
    certCard +
    '<p style="font-size:12px;color:#555;margin:16px 0">To print your certificate, log in and open your franchise profile.</p>' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
    '<a href="' + loginUrl + '" style="display:inline-block;background:#534AB7;color:#fff;text-decoration:none;font-size:13px;font-weight:700;padding:12px 28px;border-radius:8px">Log In to NLH Platform →</a>' +
    '</td></tr></table>'

  return sendBrevoEmail(
    franchisee.email, name, subject,
    nlhEmailTemplate('Your Franchise Certificate is Ready 🎉', body,
      'Congratulations on joining the NLH family! We look forward to growing together.')
  )
}

// ── Student Certificate ────────────────────────────────────────────────────────

export async function sendStudentCertEmail(student, enrollment, centre, parentEmail) {
  const studentName = student.full_name || 'Student'
  const courseName  = enrollment.skus?.courses?.group_name || 'Course'
  const levelName   = enrollment.skus?.level_name || 'Level'
  const fullCourse  = courseName + ' — ' + levelName
  const centreLine  = (centre?.business_name || 'New Learning Horizons') +
                      (centre?.city ? ', ' + centre.city : '')
  const parentLine  = [
    student.parent_name ? 'S/o. ' + student.parent_name : null,
    student.city
      ? 'R/o. ' + student.city +
        (student.country && student.country !== 'India' ? ', ' + student.country : '')
      : null,
  ].filter(Boolean).join(', ')
  const today   = new Date()
  const dateStr = [String(today.getDate()).padStart(2,'0'), String(today.getMonth()+1).padStart(2,'0'), today.getFullYear()].join('.')
  const subject = 'Certificate of Accomplishment — ' + studentName + ' — NLH'

  const certCard =
    '<table width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #89CFF0;border-radius:12px;background:linear-gradient(135deg,#E8F4FD,#C8E6F8);margin:20px 0">' +
    '<tr><td style="padding:24px;text-align:center;font-family:Arial,sans-serif">' +
    '<div style="font-size:18px;font-style:italic;font-weight:700;color:#CC0000;margin-bottom:4px">Certificate of Accomplishment</div>' +
    '<div style="font-size:9px;font-weight:700;letter-spacing:2px;color:#1A3A6A;margin-bottom:12px">THIS IS TO CERTIFY THAT</div>' +
    '<div style="font-size:22px;font-weight:700;color:#CC0000;font-style:italic;margin-bottom:4px">' + studentName + '</div>' +
    (parentLine ? '<div style="font-size:10px;color:#555;margin-bottom:10px">' + parentLine + '</div>' : '') +
    '<div style="font-size:10px;color:#1A1916;margin-bottom:4px">Has successfully completed</div>' +
    '<div style="font-size:14px;font-weight:700;color:#1A3A6A;margin-bottom:4px;line-height:1.3">' + fullCourse + '</div>' +
    '<div style="font-size:10px;color:#555;margin-bottom:14px">at ' + centreLine + '</div>' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px dashed #89CFF0;padding-top:10px"><tr>' +
    '<td style="text-align:left;font-size:9px;color:#888;font-style:italic"><div>Dhiral Panchmatia</div><div>Director, NLH</div></td>' +
    '<td style="text-align:right;font-size:10px;font-weight:700;color:#1A1916">' + dateStr + '</td>' +
    '</tr></table>' +
    '</td></tr></table>'

  const body =
    '<p>Dear Parent / Guardian,</p>' +
    '<p style="margin:12px 0">We are delighted to inform you that <strong>' + studentName + '</strong> has successfully completed ' +
    '<strong>' + fullCourse + '</strong> at <strong>' + centreLine + '</strong>. ' +
    'Please find the Certificate of Accomplishment below.</p>' +
    certCard +
    '<p style="font-size:12px;color:#555;margin-top:8px">You can print or save this certificate for your records. ' +
    'We are very proud of this achievement and look forward to continued learning!</p>'

  return sendBrevoEmail(
    parentEmail, student.parent_name || studentName, subject,
    nlhEmailTemplate('🎓 Certificate of Accomplishment', body,
      'New Learning Horizons — Enriching Children\'s Future since 2008.')
  )
}
