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
