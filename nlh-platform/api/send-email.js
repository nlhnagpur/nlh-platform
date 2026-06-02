// Email API — server-side template rendering.
// Accepts { type, data, bcc } and builds the full HTML on the server.
// The client never sends raw htmlContent — only a type string and minimal params.
//
// Supported types:
//   order_confirmation   { orderId }
//   invoice_ready        { orderId }
//   payment_reminder     { orderId }          (auto-BCCs admin)
//   payment_verified     { orderId }
//   invite               { email, name, role }
//   welcome              { email, name, role, password }
//   franchisee_welcome_letter  { franchiseeId }
//   franchisee_cert      { franchiseeId }
//   student_cert         { enrollmentId, parentEmail }

import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin }  from './_auth.js'

const SUPABASE_URL  = 'https://frnnoxudtlvhyyoqdqzx.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZybm5veHVkdGx2aHl5b3FkcXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTY2NDUsImV4cCI6MjA5MjkzMjY0NX0.1OuqWuV-X09wEzWMp9_zjNRbWNDcSvR4TgYmu0373zE'

const BASE      = 'https://nlh-platform.vercel.app'
const ADMIN_EMAIL = 'admin@nlhnagpur.info'

const BANK_DETAILS =
  'Bank: IDFC FIRST Bank, Nagpur - Byramji Town Branch<br>' +
  'A/c: 10278096847 &nbsp;&nbsp; IFSC: IDFB0042504<br>' +
  'UPI: newlearninghorizons@idfcbank'

const ROLE_LABEL = {
  owner: 'Owner', super_admin: 'Super Admin', admin: 'Admin',
  manager: 'Manager', staff: 'Staff',
  smf: 'State Master Franchisee', cf: 'City Franchisee',
  uf: 'Unit Franchisee', student: 'Student',
}

function fmtAmt(n) {
  return Number(n || 0).toLocaleString('en-IN')
}

function dmyDate(ts) {
  const d = new Date(ts || Date.now())
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('.')
}

// ── Shared NLH email wrapper ───────────────────────────────────────────────────
function nlhTemplate(title, bodyHtml, footerNote) {
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

// ── Premium email shell (invoice / welcome / invite) ─────────────────────────
function premiumShell(headerHtml, bodyHtml) {
  return (
    '<div style="margin:0;padding:0;background:#F4F3F8;font-family:Arial,Helvetica,sans-serif">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3F8;padding:32px 0">' +
    '<tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">' +
    headerHtml + bodyHtml +
    '<tr><td style="background:#534AB7;height:4px"></td></tr>' +
    '<tr><td style="background:#2D2B5E;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center">' +
    '<div style="color:rgba(255,255,255,.5);font-size:11px;line-height:1.7">' +
    '<div style="color:rgba(255,255,255,.8);font-weight:600;margin-bottom:6px">New Learning Horizons</div>' +
    '9, Anjuman Shopping Complex, Residency Road, Sadar, Nagpur – 440 001<br>' +
    'Ph: 9373111311 &nbsp;·&nbsp; admin@nlhnagpur.info &nbsp;·&nbsp; www.nlhnagpur.info' +
    '</div></td></tr>' +
    '</table></td></tr></table></div>'
  )
}

function purpleHeader(emoji, title, subtitle) {
  return (
    '<tr><td style="background:linear-gradient(135deg,#534AB7 0%,#7B74D4 100%);border-radius:16px 16px 0 0;padding:40px 40px 36px;text-align:center">' +
    '<div style="display:inline-block;width:56px;height:56px;background:rgba(255,255,255,.18);border-radius:14px;text-align:center;line-height:56px;font-size:28px;margin-bottom:16px">' + emoji + '</div>' +
    '<div style="color:#FFFFFF;font-size:22px;font-weight:700;letter-spacing:-.3px;margin-bottom:4px">' + title + '</div>' +
    '<div style="color:rgba(255,255,255,.65);font-size:11px;letter-spacing:.06em;text-transform:uppercase">' + subtitle + '</div>' +
    '</td></tr>'
  )
}

// ── Template builders ─────────────────────────────────────────────────────────

function buildOrderConfirmation(order, franchiseeName) {
  const body =
    '<p>Dear ' + (franchiseeName || 'Partner') + ',</p>' +
    '<p>Your order <strong>' + order.order_ref + '</strong> has been placed successfully and is being processed.</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">' +
    '<tr style="background:#F0EEE9"><td style="padding:8px;font-weight:bold">Order Ref</td><td style="padding:8px">' + order.order_ref + '</td></tr>' +
    '<tr><td style="padding:8px;font-weight:bold">Status</td><td style="padding:8px">Pending</td></tr>' +
    '<tr style="background:#F0EEE9"><td style="padding:8px;font-weight:bold">Delivery Address</td><td style="padding:8px">' + (order.deliver_to || '—') + '</td></tr>' +
    '</table>' +
    '<p>You will receive an invoice once the order is processed for dispatch.</p>'
  return {
    subject: 'Order ' + order.order_ref + ' placed successfully — NLH',
    html: nlhTemplate('Order Confirmation', body, 'You are receiving this because you placed an order on NLH Platform.'),
  }
}

function buildInvoiceReady(order, franchiseeName) {
  const firstName  = (franchiseeName || 'Partner').split(' ')[0]
  const invoiceNo  = order.invoice_no || '—'
  const orderRef   = order.order_ref  || '—'
  const loginUrl   = BASE + '/login'

  const html =
    '<div style="margin:0;padding:0;background:#F4F3F8;font-family:Arial,Helvetica,sans-serif">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3F8;padding:32px 0">' +
    '<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">' +
    '<tr><td style="background:linear-gradient(135deg,#534AB7 0%,#7B74D4 100%);border-radius:16px 16px 0 0;padding:36px 40px 32px;text-align:center">' +
    '<div style="display:inline-block;width:56px;height:56px;background:rgba(255,255,255,.18);border-radius:14px;text-align:center;line-height:56px;font-size:28px;margin-bottom:14px">🧾</div>' +
    '<div style="color:#FFFFFF;font-size:22px;font-weight:700;margin-bottom:4px">New Learning Horizons</div>' +
    '<div style="color:rgba(255,255,255,.65);font-size:11px;letter-spacing:.06em;text-transform:uppercase">ISO 9001:2015 Certified &nbsp;·&nbsp; Enriching Children\'s Future</div>' +
    '</td></tr>' +
    '<tr><td style="background:#FFFFFF;padding:36px 40px 28px">' +
    '<div style="font-size:24px;font-weight:700;color:#1A1916;margin-bottom:6px">Invoice ready, ' + firstName + '! 📋</div>' +
    '<p style="font-size:14px;color:#5C5A54;line-height:1.7;margin:0 0 24px 0">Your invoice has been generated for order <strong>' + orderRef + '</strong>. Please review and make payment at your earliest convenience.</p>' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F7FE;border:1.5px solid #DDD9F9;border-radius:12px;margin-bottom:24px">' +
    '<tr><td style="padding:16px 24px 8px"><div style="font-size:10px;font-weight:700;color:#534AB7;letter-spacing:.1em;text-transform:uppercase;margin-bottom:16px">Invoice Details</div></td></tr>' +
    '<tr><td style="padding:0 24px 8px"><table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr style="border-bottom:1px solid #EDE9FF"><td style="padding:10px 0;font-size:12px;color:#888;width:40%">Invoice Number</td><td style="padding:10px 0;font-size:13px;font-weight:700;color:#534AB7;font-family:Courier New,monospace">' + invoiceNo + '</td></tr>' +
    '<tr style="border-bottom:1px solid #EDE9FF"><td style="padding:10px 0;font-size:12px;color:#888">Order Reference</td><td style="padding:10px 0;font-size:13px;font-weight:600;color:#1A1916">' + orderRef + '</td></tr>' +
    (order.deliver_to ? '<tr style="border-bottom:1px solid #EDE9FF"><td style="padding:10px 0;font-size:12px;color:#888">Deliver To</td><td style="padding:10px 0;font-size:13px;color:#1A1916">' + order.deliver_to + '</td></tr>' : '') +
    '<tr><td style="padding:12px 0;font-size:12px;color:#888">Amount Due</td><td style="padding:12px 0;font-size:18px;font-weight:700;color:#534AB7">₹' + fmtAmt(order.grand_total) + '</td></tr>' +
    '</table></td></tr></table>' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8E7;border:1.5px solid #FDE68A;border-radius:12px;margin-bottom:24px">' +
    '<tr><td style="padding:16px 24px"><div style="font-size:10px;font-weight:700;color:#D97706;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">💳 Payment Details</div>' +
    '<div style="font-size:13px;color:#1A1916;line-height:1.8">' + BANK_DETAILS + '</div>' +
    '</td></tr></table>' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px"><tr><td align="center">' +
    '<a href="' + loginUrl + '" style="display:inline-block;background:#534AB7;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:14px 36px;border-radius:10px">Submit Payment on NLH Platform &nbsp;→</a>' +
    '</td></tr><tr><td align="center" style="padding-top:10px;font-size:11px;color:#999">Log in → go to Orders → Submit Payment</td></tr></table>' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#F0FDF4;border-left:3px solid #16A34A;border-radius:0 8px 8px 0;padding:12px 16px">' +
    '<div style="font-size:12px;color:#166534;line-height:1.6"><strong>📦 Note:</strong> Dispatch may happen independently of payment on credit terms. Please submit your UTR / transaction reference on the platform after making payment.</div>' +
    '</td></tr></table>' +
    '</td></tr>' +
    '<tr><td style="background:#534AB7;height:4px"></td></tr>' +
    '<tr><td style="background:#2D2B5E;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center">' +
    '<div style="color:rgba(255,255,255,.5);font-size:11px;line-height:1.7">' +
    '<div style="color:rgba(255,255,255,.8);font-weight:600;margin-bottom:6px">New Learning Horizons</div>' +
    '9, Anjuman Shopping Complex, Residency Road, Sadar, Nagpur – 440 001<br>' +
    'Ph: 9373111311 &nbsp;·&nbsp; admin@nlhnagpur.info &nbsp;·&nbsp; www.nlhnagpur.info<br><br>' +
    '<span style="font-size:10px">Please retain this email for your records.</span>' +
    '</div></td></tr>' +
    '</table></td></tr></table></div>'

  return { subject: 'Invoice ' + invoiceNo + ' from New Learning Horizons', html }
}

function buildPaymentReminder(order, franchiseeName) {
  const invoiceRef = order.invoice_no || order.order_ref
  const balance    = (order.grand_total || 0) - (order.amount_paid || 0)
  const body =
    '<p>Dear ' + (franchiseeName || 'Partner') + ',</p>' +
    '<p>This is a gentle reminder that payment is pending for invoice <strong>' + invoiceRef + '</strong>.</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">' +
    '<tr style="background:#FEF3C7"><td style="padding:8px;font-weight:bold">Invoice No.</td><td style="padding:8px">' + (order.invoice_no || '—') + '</td></tr>' +
    '<tr><td style="padding:8px;font-weight:bold">Amount Due</td><td style="padding:8px;font-weight:bold;color:#8A5200">Rs ' + fmtAmt(balance) + '</td></tr>' +
    '</table>' +
    '<p>Please make the payment at your earliest convenience and submit the transaction reference via the NLH Platform.</p>' +
    '<div style="background:#F0EEE9;padding:12px;border-radius:8px;font-size:13px">' + BANK_DETAILS + '</div>'
  return {
    subject: 'Payment reminder — ' + invoiceRef + ' — NLH',
    html: nlhTemplate('Payment Reminder', body, 'This is an automated reminder from NLH Platform.'),
    bcc: [ADMIN_EMAIL],
  }
}

function buildPaymentVerified(order, franchiseeName) {
  const invoiceRef = order.invoice_no || order.order_ref
  const body =
    '<p>Dear ' + (franchiseeName || 'Partner') + ',</p>' +
    '<p>Your payment for invoice <strong>' + invoiceRef + '</strong> has been verified and confirmed. Thank you!</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">' +
    '<tr style="background:#DCFCE7"><td style="padding:8px;font-weight:bold">Invoice No.</td><td style="padding:8px">' + (order.invoice_no || '—') + '</td></tr>' +
    '<tr><td style="padding:8px;font-weight:bold">Amount Paid</td><td style="padding:8px;font-weight:bold;color:#1D7A4F">Rs ' + fmtAmt(order.amount_paid) + '</td></tr>' +
    '<tr style="background:#DCFCE7"><td style="padding:8px;font-weight:bold">Payment Mode</td><td style="padding:8px">' + (order.payment_mode || '—') + '</td></tr>' +
    '<tr><td style="padding:8px;font-weight:bold">Reference</td><td style="padding:8px">' + (order.payment_ref || '—') + '</td></tr>' +
    '</table>' +
    '<p>Order status: <strong style="color:#1D7A4F">CLOSED</strong></p>'
  return {
    subject: 'Payment confirmed — ' + invoiceRef + ' — NLH',
    html: nlhTemplate('Payment Confirmed', body, 'Thank you for your partnership with NLH.'),
  }
}

function buildInvite(email, name, role) {
  const roleLabel = ROLE_LABEL[role] || role
  const firstName = (name || email.split('@')[0]).split(' ')[0]
  const loginUrl  = BASE + '/login'

  const header = purpleHeader('🎓', 'New Learning Horizons', 'ISO 9001:2015 Certified &nbsp;·&nbsp; Enriching Children\'s Future')
  const body =
    '<tr><td style="background:#FFFFFF;padding:40px 40px 32px">' +
    '<div style="font-size:26px;font-weight:700;color:#1A1916;margin-bottom:8px">You\'re invited, ' + firstName + '! 🎉</div>' +
    '<p style="font-size:14px;color:#5C5A54;line-height:1.7;margin:0 0 28px 0">An administrator has set up an account for you on the <strong style="color:#534AB7">NLH Platform</strong>. Use the details below to sign in, then set your own password.</p>' +
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
    '</table></td></tr></table>' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px"><tr><td align="center">' +
    '<a href="' + loginUrl + '" style="display:inline-block;background:#534AB7;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;padding:15px 40px;border-radius:10px">Go to NLH Platform &nbsp;→</a>' +
    '</td></tr></table>' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#F0FDF4;border-left:3px solid #16A34A;border-radius:0 8px 8px 0;padding:14px 18px">' +
    '<div style="font-size:12px;color:#166534;line-height:1.7"><strong>🔑 How to set your password</strong><br>1. Click the button above<br>2. Click <strong>"Forgot password?"</strong> and enter your email<br>3. Check your inbox for a reset link<br>4. Done — log in and get started!</div>' +
    '</td></tr></table>' +
    '</td></tr>'

  return {
    subject: 'You\'ve been invited to NLH Platform',
    html: premiumShell(header, body),
  }
}

function buildWelcome(email, name, role, password) {
  const roleLabel = ROLE_LABEL[role] || role
  const firstName = (name || email.split('@')[0]).split(' ')[0]
  const loginUrl  = BASE + '/login'

  // When no real temporary password is supplied (the franchisee/reset-link flow),
  // we point the user to the separate "Set your password" email instead of
  // showing a fake password chip.
  const usesResetLink = !password || /reset link/i.test(password)

  const passwordBlock = usesResetLink
    ? '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px">' +
      '<tr><td style="font-size:10px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px">Password</td></tr>' +
      '<tr><td style="font-size:13px;color:#1A1916;line-height:1.5">We\'ve sent you a separate <strong style="color:#534AB7">&ldquo;Set your password&rdquo;</strong> email — click the secure link in it to choose your password, then sign in here.</td></tr>' +
      '</table>'
    : '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px">' +
      '<tr><td style="font-size:10px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px">Temporary Password</td></tr>' +
      '<tr><td><span style="display:inline-block;background:#FFFFFF;border:1.5px solid #DDD9F9;border-radius:8px;padding:7px 14px;font-family:Courier New,Courier,monospace;font-size:15px;font-weight:700;color:#534AB7;letter-spacing:.08em">' + password + '</span></td></tr>' +
      '</table>'

  const securityNote = usesResetLink
    ? '<div style="font-size:12px;color:#92400E;line-height:1.6"><strong>🔑 Setting your password</strong><br>Open the separate &ldquo;Set your password&rdquo; email we just sent and click the secure link. If it isn\'t in your inbox, check spam, or use <a href="' + loginUrl + '" style="color:#92400E;font-weight:700">Forgot Password</a> on the login page.</div>'
    : '<div style="font-size:12px;color:#92400E;line-height:1.6"><strong>🔒 Keep your account secure</strong><br>This is a temporary password. After your first login, reset it via <a href="' + loginUrl + '" style="color:#92400E;font-weight:700">Forgot Password</a> on the login page.</div>'

  const header = purpleHeader('🎓', 'New Learning Horizons', 'ISO 9001:2015 Certified &nbsp;·&nbsp; Enriching Children\'s Future')
  const body =
    '<tr><td style="background:#FFFFFF;padding:40px 40px 32px">' +
    '<div style="font-size:26px;font-weight:700;color:#1A1916;margin-bottom:8px">Welcome, ' + firstName + '! 👋</div>' +
    '<p style="font-size:14px;color:#5C5A54;line-height:1.7;margin:0 0 28px 0">We\'re excited to have you on board. Your account on the <strong style="color:#534AB7">NLH Platform</strong> has been set up. Below are your login details — please keep them safe.</p>' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F7FE;border:1.5px solid #DDD9F9;border-radius:12px;margin-bottom:28px">' +
    '<tr><td style="padding:18px 24px 14px">' +
    '<div style="font-size:10px;font-weight:700;color:#534AB7;letter-spacing:.1em;text-transform:uppercase;margin-bottom:18px">Your Login Details</div>' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px">' +
    '<tr><td style="font-size:10px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px">Login Email</td></tr>' +
    '<tr><td style="font-size:14px;font-weight:600;color:#1A1916">' + email + '</td></tr>' +
    '</table>' +
    passwordBlock +
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="font-size:10px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px">Your Role</td></tr>' +
    '<tr><td><span style="display:inline-block;background:#EDE9FF;color:#534AB7;font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:.04em">' + roleLabel + '</span></td></tr>' +
    '</table>' +
    '</td></tr></table>' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px"><tr><td align="center">' +
    '<a href="' + loginUrl + '" style="display:inline-block;background:#534AB7;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;padding:15px 40px;border-radius:10px">Log In to NLH Platform &nbsp;→</a>' +
    '</td></tr></table>' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#FFFBEB;border-left:3px solid #D97706;border-radius:0 8px 8px 0;padding:14px 18px">' +
    securityNote +
    '</td></tr></table>' +
    '</td></tr>'

  return {
    subject: 'Welcome to NLH Platform — Your account is ready',
    html: premiumShell(header, body),
  }
}

function buildFranchiseeWelcomeLetter(fr, courseNames) {
  const ownerName  = fr.owner_name || fr.business_name || 'Partner'
  const firstName  = ownerName.split(' ')[0]
  const centreName = fr.business_name && fr.business_name !== ownerName ? fr.business_name : null
  const TIER = {
    SMF: { label: 'State Master Franchisee', short: 'SMF' },
    CF:  { label: 'City Franchisee',          short: 'CF'  },
    UF:  { label: 'Unit Franchisee',           short: 'UF'  },
  }
  const tierInfo  = TIER[fr.tier] || { label: fr.tier, short: fr.tier }
  const territory = fr.tier === 'SMF'
    ? (fr.state || fr.country || '—')
    : fr.tier === 'CF'
      ? (fr.city || '—')
      : [fr.area, fr.city].filter(Boolean).join(', ') || '—'
  const apptDate   = dmyDate(fr.created_at)
  const coursesText = courseNames && courseNames.length > 0
    ? courseNames.join(', ')
    : (fr.tier === 'SMF' || fr.tier === 'CF') ? 'All NLH Programs' : 'To be assigned'

  const tierOpenings = {
    SMF: 'You are now the <strong>State Master Franchisee</strong> for <strong>' + (fr.state || fr.country) + '</strong> — responsible for growing the NLH family across your entire state.',
    CF:  'You are now the <strong>City Franchisee</strong> for <strong>' + (fr.city || territory) + '</strong> — a key pillar in expanding NLH&rsquo;s reach in your city.',
    UF:  'You are now an authorised <strong>Unit Franchisee</strong>' + (fr.city ? ' in <strong>' + fr.city + '</strong>' : '') + ' — at the heart of our mission to enrich children&rsquo;s lives every day.',
  }
  const tierOpening = tierOpenings[fr.tier] || tierOpenings.UF

  const sigUrl      = BASE + '/DRP%20Signature.png'
  const logoUrl     = BASE + '/NLH%20Logo.png'
  const awardsUrl   = BASE + '/awards-banner.png'
  const acemUrl     = BASE + '/acem-abacus-logo.png'
  const writewellUrl = BASE + '/writewell-logo.png'
  const easymathUrl  = BASE + '/easy-math-logo.png'

  const html =
    '<div style="margin:0;padding:0;background:#F4F2EC;font-family:Georgia,\'Times New Roman\',serif">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EC;padding:32px 0">' +
    '<tr><td align="center">' +
    '<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border:1px solid #D6D0C4;border-radius:4px">' +
    '<tr><td style="padding:16px 24px 12px;border-bottom:2px solid #CC0000">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="vertical-align:middle;white-space:nowrap;padding-right:12px"><img src="' + logoUrl + '" alt="NLH" style="height:88px;width:auto;display:inline-block;vertical-align:middle" /><img src="' + BASE + '/NLH%20Mascot.png" alt="" style="height:88px;width:auto;display:inline-block;vertical-align:middle;margin-left:8px;filter:drop-shadow(0 4px 10px rgba(217,119,6,.28))" /></td>' +
    '<td style="vertical-align:middle;text-align:center;padding:0 8px"><img src="' + awardsUrl + '" alt="Awards" style="width:100%;height:88px;object-fit:contain;display:block;border-radius:3px" /></td>' +
    '<td style="text-align:right;vertical-align:middle;white-space:nowrap;padding-left:12px;font-family:Arial,sans-serif"><div style="font-size:13px;font-weight:700;color:#CC0000;margin-bottom:5px">Dhiral Panchmatia</div><div style="font-size:9px;color:#444;line-height:1.48">9, Anjuman Shopping Complex<br>Residency Road, Sadar<br>Nagpur &ndash; 440 001<br>Mob.: +91 9373111311<br><a href="mailto:nlhnagpur@yahoo.in" style="color:#CC0000;text-decoration:none">nlhnagpur@yahoo.in</a><br><a href="https://www.nlhnagpur.info" style="color:#CC0000;text-decoration:none">www.nlhnagpur.info</a></div></td>' +
    '</tr></table></td></tr>' +
    '<tr><td style="padding:28px 40px 0;font-family:Arial,sans-serif;font-size:13px;color:#1A1916;line-height:1.8"><div>To,</div><div style="font-weight:700">' + ownerName + (centreName ? '<br>' + centreName : '') + '</div><div>New Learning Horizons — <em>' + tierInfo.label + '</em></div><div style="color:#555">' + territory + '</div></td></tr>' +
    '<tr><td style="padding:20px 40px 0;font-family:Arial,sans-serif"><div style="font-size:13px;font-weight:700;color:#1A1916;text-align:center">Subject: <u>Welcome to the New Learning Horizons Family!</u></div></td></tr>' +
    '<tr><td style="padding:20px 40px 0;font-family:Arial,sans-serif;font-size:13px;color:#1A1916;line-height:1.9"><p style="margin:0 0 14px 0">Dear ' + firstName + ',</p><p style="margin:0 0 14px 0">It is with great joy and pride that we welcome you to the <strong>New Learning Horizons</strong> family! ' + tierOpening + '</p><p style="margin:0 0 14px 0">You are now part of a growing educational movement that is transforming the way children learn, grow, and discover their true potential. With your new centre, we are expanding our mission to reach more young minds and create lifelong learners across India and beyond.</p><p style="margin:0 0 14px 0">At New Learning Horizons, we believe in nurturing creativity, confidence, and curiosity. With over 15 innovative programs — Abacus, Vedic Maths, Montessori, Handwriting, Rubik\'s Cube, Reading, Phonics, Personality Development, Chess, Art &amp; Craft and more — your centre will play a key role in shaping a brighter future.</p><p style="margin:0 0 6px 0">We are committed to ensuring your smooth transition and long-term success. To support you in this journey, you will be provided with:</p><table cellpadding="0" cellspacing="0" style="margin:0 0 14px 20px;font-size:13px;color:#1A1916"><tr><td style="padding:2px 0">&ndash;&nbsp; A detailed orientation and training program</td></tr><tr><td style="padding:2px 0">&ndash;&nbsp; Branding and marketing support</td></tr><tr><td style="padding:2px 0">&ndash;&nbsp; Curriculum access and teacher manuals</td></tr><tr><td style="padding:2px 0">&ndash;&nbsp; Ongoing mentorship and operational guidance</td></tr></table></td></tr>' +
    '<tr><td style="padding:0 40px"><table width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #D6D0C4;border-radius:4px;background:#FAF9F6;margin:14px 0"><tr><td style="padding:12px 20px 4px"><div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#888;margin-bottom:10px">Your Franchise Credentials</div><table cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;font-size:13px;color:#1A1916;width:100%"><tr><td style="padding:4px 0;color:#555;width:44%">Franchise Type</td><td style="padding:4px 0;font-weight:700">: ' + tierInfo.label + '</td></tr><tr><td style="padding:4px 0;color:#555">Authorised Territory</td><td style="padding:4px 0;font-weight:700">: ' + territory + '</td></tr><tr><td style="padding:4px 0;color:#555">Date of Appointment</td><td style="padding:4px 0;font-weight:700">: ' + apptDate + '</td></tr><tr><td style="padding:4px 0 10px;color:#555;vertical-align:top">Courses Selected</td><td style="padding:4px 0 10px;font-weight:700">: ' + coursesText + '</td></tr></table></td></tr></table></td></tr>' +
    '<tr><td style="padding:10px 40px 0;font-family:Arial,sans-serif;font-size:13px;color:#1A1916;line-height:1.9"><p style="margin:0 0 14px 0">Let\'s work together to make your centre a warm, enriching space where children not only learn but thrive.</p><p style="margin:0 0 20px 0">Once again, welcome aboard — we are thrilled to have you with us!</p><p style="margin:0 0 4px 0">Warm regards,</p></td></tr>' +
    '<tr><td style="padding:0 40px 4px"><img src="' + sigUrl + '" alt="Signature" style="height:52px;width:auto;display:block;opacity:0.85" /></td></tr>' +
    '<tr><td style="padding:0 40px 28px;font-family:Arial,sans-serif;font-size:13px;color:#1A1916;line-height:1.7"><div style="font-weight:700">Dhiral Panchmatia</div><div>Founder</div><div style="color:#CC0000;font-weight:600">New Learning Horizons</div></td></tr>' +
    '<tr><td style="padding:16px 32px 8px;border-top:1px solid #E8E4DA"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 8px"><img src="' + acemUrl + '" alt="ACEM Abacus" style="height:48px;width:auto;border-radius:4px" /></td><td align="center" style="padding:0 8px"><img src="' + writewellUrl + '" alt="WriteWell" style="height:48px;width:auto;border-radius:4px" /></td><td align="center" style="padding:0 8px"><img src="' + easymathUrl + '" alt="Easy Math" style="height:48px;width:auto;border-radius:4px" /></td></tr></table></td></tr>' +
    '<tr><td style="background:#CC0000;height:3px"></td></tr>' +
    '<tr><td style="padding:14px 32px;text-align:center;font-family:Arial,sans-serif;font-size:10px;color:#888;line-height:1.7;border-top:1px solid #E8E4DA"><div style="font-weight:700;color:#555;margin-bottom:4px">New Learning Horizons &nbsp;|&nbsp; ISO 9001:2015 Certified &nbsp;|&nbsp; Enriching Children\'s Future since 2008</div>9, Anjuman Shopping Complex, Residency Road, Sadar, Nagpur &ndash; 440 001 &nbsp;&nbsp; Ph: 9373111311 &nbsp;&nbsp; admin@nlhnagpur.info</td></tr>' +
    '</table></td></tr></table></div>'

  return {
    subject: 'Welcome to the New Learning Horizons Family, ' + firstName + '!',
    html,
  }
}

function buildFranchiseeCert(fr, courseNames) {
  const name      = fr.business_name || 'Partner'
  const firstName = name.split(' ')[0]

  function mkTierLabel(f) {
    if (f.tier === 'SMF') return 'State Master Franchisee'
    if (f.tier === 'CF')  return (f.city || '') + ' City Master Franchisee'
    return 'Unit Franchisee'
  }
  function mkValidTill(f) {
    if (f.valid_till) return dmyDate(f.valid_till)
    const d = new Date(f.created_at || Date.now())
    d.setFullYear(d.getFullYear() + 5)
    return dmyDate(d)
  }
  function mkAddress(f) {
    return [f.address, f.area, f.city, f.state,
      f.country && f.country !== 'India' ? f.country : null].filter(Boolean).join(', ')
  }

  const label   = mkTierLabel(fr)
  const till    = mkValidTill(fr)
  const addr    = mkAddress(fr)
  const courses = courseNames.join(', ')
  const isSMF   = fr.tier === 'SMF'
  const loginUrl = BASE

  const certCard =
    '<table width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #DDD9F9;border-radius:12px;background:#FAFAFA;margin:20px 0">' +
    '<tr><td style="padding:24px;text-align:center;font-family:Arial,sans-serif">' +
    '<div style="font-size:13px;font-weight:900;letter-spacing:2px;color:#1A1916;margin-bottom:4px">FRANCHISE CERTIFICATE</div>' +
    '<div style="font-size:10px;color:#888;margin-bottom:12px">This is to Certify that</div>' +
    '<div style="font-size:22px;font-weight:700;color:#CC0000;margin-bottom:' + (isSMF ? '2px' : '8px') + ';font-style:italic">' + name + '</div>' +
    (isSMF ? '<div style="font-size:14px;font-weight:700;color:#CC0000;margin-bottom:8px;font-style:italic">' + (fr.state || '') + '</div>' : '') +
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
    '<p style="margin:12px 0">Congratulations! Your franchise certificate from <strong>New Learning Horizons</strong> is ready. Log in to the NLH Platform to print or save a PDF copy.</p>' +
    certCard +
    '<p style="font-size:12px;color:#555;margin:16px 0">To print your certificate, log in and open your franchise profile.</p>' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
    '<a href="' + loginUrl + '" style="display:inline-block;background:#534AB7;color:#fff;text-decoration:none;font-size:13px;font-weight:700;padding:12px 28px;border-radius:8px">Log In to NLH Platform →</a>' +
    '</td></tr></table>'

  return {
    subject: 'Your NLH Franchise Certificate — New Learning Horizons',
    html: nlhTemplate('Your Franchise Certificate is Ready 🎉', body, 'Congratulations on joining the NLH family! We look forward to growing together.'),
  }
}

function buildStudentCert(student, enrollment, centre) {
  const studentName = student.full_name || 'Student'
  const courseName  = enrollment.skus?.courses?.group_name || 'Course'
  const levelName   = enrollment.skus?.level_name || 'Level'
  const fullCourse  = courseName + ' — ' + levelName
  const centreLine  = (centre?.business_name || 'New Learning Horizons') +
                      (centre?.city ? ', ' + centre.city : '')
  const parentLine  = [
    student.parent_name ? 'S/o. ' + student.parent_name : null,
    student.city
      ? 'R/o. ' + student.city + (student.country && student.country !== 'India' ? ', ' + student.country : '')
      : null,
  ].filter(Boolean).join(', ')
  const dateStr = dmyDate(new Date())

  const certCard =
    '<table width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #89CFF0;border-radius:12px;background:linear-gradient(135deg,#E8F4FD,#C8E6F8);margin:20px 0">' +
    '<tr><td style="padding:24px;text-align:center;font-family:Arial,sans-serif">' +
    '<div style="font-size:18px;font-style:italic;font-weight:700;color:#CC0000;margin-bottom:4px">Certificate of Accomplishment</div>' +
    '<div style="font-size:9px;font-weight:700;letter-spacing:2px;color:#1A3A6A;margin-bottom:12px">THIS IS TO CERTIFY THAT</div>' +
    '<div style="font-size:22px;font-weight:700;color:#CC0000;font-style:italic;margin-bottom:4px">' + studentName + '</div>' +
    (parentLine ? '<div style="font-size:10px;color:#555;margin-bottom:10px">' + parentLine + '</div>' : '') +
    '<div style="font-size:10px;color:#1A1916;margin-bottom:4px">Has successfully completed</div>' +
    (student.camp_name ? '<div style="font-size:14px;font-weight:700;font-style:italic;color:#C2410C;margin-bottom:4px;line-height:1.3">' + student.camp_name + '</div>' : '') +
    '<div style="font-size:14px;font-weight:700;color:#1A3A6A;margin-bottom:4px;line-height:1.3">' + fullCourse + '</div>' +
    '<div style="font-size:10px;color:#555;margin-bottom:14px">at ' + centreLine + '</div>' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px dashed #89CFF0;padding-top:10px"><tr>' +
    '<td style="text-align:left;font-size:9px;color:#888;font-style:italic"><div>Dhiral Panchmatia</div><div>Director, NLH</div></td>' +
    '<td style="text-align:right;font-size:10px;font-weight:700;color:#1A1916">' + dateStr + '</td>' +
    '</tr></table>' +
    '</td></tr></table>'

  const parentName   = student.parent_name || studentName
  const body =
    '<p>Dear Parent / Guardian,</p>' +
    '<p style="margin:12px 0">We are delighted to inform you that <strong>' + studentName + '</strong> has successfully completed <strong>' + fullCourse + '</strong> at <strong>' + centreLine + '</strong>. Please find the Certificate of Accomplishment below.</p>' +
    certCard +
    '<p style="font-size:12px;color:#555;margin-top:8px">You can print or save this certificate for your records. We are very proud of this achievement and look forward to continued learning!</p>'

  return {
    subject: 'Certificate of Accomplishment — ' + studentName + ' — NLH',
    html: nlhTemplate('🎓 Certificate of Accomplishment', body, 'New Learning Horizons — Enriching Children\'s Future since 2008.'),
    toName: parentName,
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  // All callers must be authenticated; admin-only types do an extra role check below
  if (await requireAuth(req, res)) return

  const key = process.env.BREVO_KEY
  if (!key) return res.status(500).json({ error: 'Email service not configured' })

  const { type, data, bcc: clientBcc } = req.body
  if (!type || !data) return res.status(400).json({ error: 'Missing type or data' })

  // These template types are restricted to admin roles
  const ADMIN_ONLY_TYPES = new Set(['invite', 'welcome', 'franchisee_welcome_letter', 'franchisee_cert'])
  if (ADMIN_ONLY_TYPES.has(type)) {
    if (await requireAdmin(req, res)) return
  }

  const callerToken = (req.headers['authorization'] || '').replace('Bearer ', '')
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
  })

  let to, toName, subject, htmlContent, bcc

  try {
    switch (type) {

      case 'order_confirmation':
      case 'invoice_ready':
      case 'payment_reminder':
      case 'payment_verified': {
        const { orderId } = data
        if (!orderId) return res.status(400).json({ error: 'orderId required' })

        const { data: order, error: oErr } = await sb
          .from('orders')
          .select('*, franchisees!placer_id(email, business_name)')
          .eq('id', orderId)
          .single()
        if (oErr || !order) return res.status(400).json({ error: 'Order not found: ' + (oErr?.message || '') })

        const fr = order.franchisees || {}
        to     = fr.email
        toName = fr.business_name || to

        if (!to) return res.status(400).json({ error: 'Franchisee email not found for this order' })

        if (type === 'order_confirmation') {
          const t = buildOrderConfirmation(order, toName)
          subject = t.subject; htmlContent = t.html
        } else if (type === 'invoice_ready') {
          const t = buildInvoiceReady(order, toName)
          subject = t.subject; htmlContent = t.html
        } else if (type === 'payment_reminder') {
          const t = buildPaymentReminder(order, toName)
          subject = t.subject; htmlContent = t.html; bcc = t.bcc
        } else {
          const t = buildPaymentVerified(order, toName)
          subject = t.subject; htmlContent = t.html
        }
        break
      }

      case 'invite': {
        const { email, name, role } = data
        if (!email || !role) return res.status(400).json({ error: 'email and role required' })
        to = email; toName = name || email
        const t = buildInvite(email, name, role)
        subject = t.subject; htmlContent = t.html
        break
      }

      case 'welcome': {
        const { email, name, role, password } = data
        if (!email) return res.status(400).json({ error: 'email required' })
        to = email; toName = name || email
        const t = buildWelcome(email, name, role, password)
        subject = t.subject; htmlContent = t.html
        break
      }

      case 'franchisee_welcome_letter':
      case 'franchisee_cert': {
        const { franchiseeId } = data
        if (!franchiseeId) return res.status(400).json({ error: 'franchiseeId required' })

        const { data: fr, error: frErr } = await sb
          .from('franchisees')
          .select('*')
          .eq('id', franchiseeId)
          .single()
        if (frErr || !fr) return res.status(400).json({ error: 'Franchisee not found: ' + (frErr?.message || '') })

        to = fr.email; toName = fr.owner_name || fr.business_name || fr.email

        // Resolve registered course names — dedupe by program (group_name), since
        // a program with several levels has several course rows sharing one name.
        let courseNames = []
        if (fr.registered_courses && fr.registered_courses.length > 0) {
          const { data: courses } = await sb
            .from('courses')
            .select('group_name')
            .in('id', fr.registered_courses)
          courseNames = Array.from(new Set((courses || []).map(function (c) { return c.group_name }).filter(Boolean)))
        }

        if (type === 'franchisee_welcome_letter') {
          const t = buildFranchiseeWelcomeLetter(fr, courseNames)
          subject = t.subject; htmlContent = t.html
        } else {
          const t = buildFranchiseeCert(fr, courseNames)
          subject = t.subject; htmlContent = t.html
        }
        break
      }

      case 'student_cert': {
        const { enrollmentId, parentEmail } = data
        if (!enrollmentId || !parentEmail) return res.status(400).json({ error: 'enrollmentId and parentEmail required' })

        const { data: enrollment, error: enErr } = await sb
          .from('enrollments')
          .select('*, students(*), skus(level_name, courses(group_name)), franchisees(business_name, city)')
          .eq('id', enrollmentId)
          .single()
        if (enErr || !enrollment) return res.status(400).json({ error: 'Enrollment not found: ' + (enErr?.message || '') })

        to = parentEmail
        const t = buildStudentCert(enrollment.students || {}, enrollment, enrollment.franchisees)
        subject = t.subject; htmlContent = t.html; toName = t.toName
        break
      }

      default:
        return res.status(400).json({ error: 'Unknown email type: ' + type })
    }
  } catch (err) {
    console.error('[send-email] build error:', err.message)
    return res.status(500).json({ error: err.message })
  }

  // ── Send via Brevo ─────────────────────────────────────────────────────────
  // Always send a monitoring copy to the admin inbox (deduped). BCC keeps the
  // admin address hidden from parents/franchisees and avoids reply-all noise.
  const bccSet = new Set([ADMIN_EMAIL])
  if (bcc) bcc.forEach(function (e) { bccSet.add(e) })
  if (clientBcc) clientBcc.forEach(function (e) { bccSet.add(e) })
  const finalBcc = Array.from(bccSet)

  // Record the attempt in the in-app email log (never blocks the send)
  async function logEmail(status, error, messageId) {
    try {
      await sb.from('email_log').insert({
        type, recipient: to, recipient_name: toName || to, subject,
        status, error: error || null, message_id: messageId || null,
        bcc: finalBcc.join(', '),
      })
    } catch (_) { /* logging must never break sending */ }
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept:         'application/json',
        'api-key':      key,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender:      { name: 'New Learning Horizons', email: ADMIN_EMAIL },
        to:          [{ email: to, name: toName || to }],
        bcc:         finalBcc.map(function (e) { return { email: e } }),
        subject,
        htmlContent,
      }),
    })

    const result = await response.json()
    if (response.ok) {
      await logEmail('sent', null, result.messageId)
      return res.status(200).json({ success: true, id: result.messageId })
    }
    await logEmail('failed', result.message || 'Send failed', null)
    return res.status(response.status).json({ success: false, error: result.message || 'Send failed' })
  } catch (err) {
    await logEmail('failed', err.message, null)
    return res.status(500).json({ success: false, error: err.message })
  }
}
