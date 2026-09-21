// Permission checklist for role='staff' logins. Owner/super_admin/admin/manager
// always have everything; franchisees are unaffected. Keys mirror the
// restrictive RLS policies in migration 20260921113855.

export const PAGE_PERMS = [
  { key: 'franchisees.view',    label: 'Franchisees' },
  { key: 'orders.view',         label: 'Orders' },
  { key: 'students.view',       label: 'Students' },
  { key: 'instructors.view',    label: 'Instructors' },
  { key: 'batches.view',        label: 'Batches' },
  { key: 'whatsapp-inbox.view', label: 'WhatsApp Inbox' },
  { key: 'messages.view',       label: 'Franchisee chat' },
  { key: 'accounting.view',     label: 'HO Accounting' },
  { key: 'courses.view',        label: 'Courses & SKUs' },
  { key: 'coupons.view',        label: 'Discount coupons' },
  { key: 'inventory.view',      label: 'Inventory & Kits' },
  { key: 'prices.view',         label: 'Kit prices' },
  { key: 'email-log.view',      label: 'Email log' },
]

export const ACTION_PERMS = [
  { group: 'Orders', items: [
    { key: 'orders.edit',     label: 'Place / edit orders & invoices', needs: 'orders.view' },
    { key: 'orders.invoice',  label: 'Generate invoices',              needs: 'orders.view' },
    { key: 'orders.payments', label: 'Verify / record payments',       needs: 'orders.view' },
    { key: 'orders.dispatch', label: 'Dispatch orders',                needs: 'orders.view' },
    { key: 'orders.delete',   label: 'Delete orders',                  needs: 'orders.view' },
  ]},
  { group: 'Students', items: [
    { key: 'students.edit',     label: 'Add / edit students & enrol',    needs: 'students.view' },
    { key: 'students.complete', label: 'Mark courses complete / certify', needs: 'students.view' },
    { key: 'students.delete',   label: 'Delete students',                needs: 'students.view' },
  ]},
  { group: 'Franchisees', items: [
    { key: 'franchisees.contact',    label: 'See phone & email',              needs: 'franchisees.view' },
    { key: 'franchisees.financials', label: 'See fees, ledger & agreements',  needs: 'franchisees.view' },
    { key: 'franchisees.edit',       label: 'Add / edit franchisees',         needs: 'franchisees.view' },
    { key: 'franchisees.access',     label: 'Send / resend login access',     needs: 'franchisees.view' },
  ]},
  { group: 'Other', items: [
    { key: 'accounting.edit',    label: 'Record accounting entries',  needs: 'accounting.view' },
    { key: 'courses.edit',       label: 'Edit courses & SKUs',        needs: 'courses.view' },
    { key: 'prices.edit',        label: 'Change kit prices',          needs: 'prices.view' },
    { key: 'inventory.edit',     label: 'Change stock / inventory',   needs: 'inventory.view' },
    { key: 'messages.reply',     label: 'Reply in Franchisee chat',   needs: 'messages.view' },
    { key: 'whatsapp-inbox.reply', label: 'Reply in WhatsApp Inbox',  needs: 'whatsapp-inbox.view' },
  ]},
]

function pick(keys) {
  const o = {}
  keys.forEach(function (k) { o[k] = true })
  return o
}

export const PRESETS = [
  { id: 'marketing', label: 'Social media / Marketing',
    desc: 'See franchisee names, cities and addresses (no fees, phones or emails).',
    perms: pick(['franchisees.view']) },
  { id: 'sales', label: 'Sales / Operations',
    desc: 'Orders, students and franchisees; can place and dispatch orders.',
    perms: pick(['franchisees.view', 'franchisees.contact', 'orders.view', 'orders.edit', 'orders.dispatch', 'students.view', 'courses.view', 'messages.view', 'messages.reply']) },
  { id: 'accounts', label: 'Accounts',
    desc: 'Orders, invoices, payments and HO accounting.',
    perms: pick(['franchisees.view', 'franchisees.contact', 'franchisees.financials', 'orders.view', 'orders.invoice', 'orders.payments', 'accounting.view', 'accounting.edit']) },
  { id: 'support', label: 'Support',
    desc: 'Students, batches and chat; view-only elsewhere.',
    perms: pick(['franchisees.view', 'franchisees.contact', 'students.view', 'students.edit', 'batches.view', 'instructors.view', 'courses.view', 'messages.view', 'messages.reply', 'whatsapp-inbox.view', 'whatsapp-inbox.reply']) },
  { id: 'viewer', label: 'View-only',
    desc: 'Dashboard, orders, students and courses — no changes.',
    perms: pick(['orders.view', 'students.view', 'courses.view']) },
]

// Pre-existing behaviour for a fresh staff login: the old five pages, no changes.
export const DEFAULT_STAFF_PERMS = pick(['orders.view', 'students.view', 'messages.view', 'courses.view'])

// True for every non-staff role; for staff, only if the box is ticked.
export function hasPerm(role, permissions, key) {
  if (role !== 'staff') return true
  return !!(permissions && permissions[key])
}

// Turning a page off also turns off its action boxes.
export function normalizePerms(perms) {
  const out = {}
  const actions = ACTION_PERMS.flatMap(function (g) { return g.items })
  Object.keys(perms || {}).forEach(function (k) { if (perms[k]) out[k] = true })
  actions.forEach(function (a) { if (out[a.key] && !out[a.needs]) delete out[a.key] })
  return out
}
