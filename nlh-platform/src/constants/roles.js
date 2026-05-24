export const ADMIN_ROLES = ['owner', 'super_admin', 'admin', 'manager', 'staff']

export function isAdminRole(r) {
  return ADMIN_ROLES.includes(r)
}

const ownerNav = [
  { id: 'dashboard',        l: 'Dashboard',        c: '#534AB7' },
  { id: 'franchisees',      l: 'Franchisees',       c: '#1D7A4F' },
  { id: 'orders',           l: 'Orders',            c: '#8A5200' },
  { id: 'students',         l: 'Students',          c: '#1A5FA8' },
  { id: 'instructors',      l: 'Instructors',       c: '#6D28D9' },
  { id: 'batches',          l: 'Batches',           c: '#0F766E' },
  { id: 'whatsapp-inbox',   l: 'WhatsApp Inbox',    c: '#25D366' },
  { id: 'accounting',       l: 'HO Accounting',     c: '#0F766E' },
  { id: 'courses',          l: 'Courses & SKUs',    c: '#534AB7' },
  { id: 'prices',           l: 'Kit prices',        c: '#1D7A4F' },
  { id: 'price-history',    l: 'Price change log',  c: '#9C9A92' },
  { id: 'users',            l: 'Manage logins',     c: '#A32D2D' },
  { id: 'requests',         l: 'Access requests',   c: '#534AB7' },
]

const adminNav = [
  { id: 'dashboard',        l: 'Dashboard',        c: '#534AB7' },
  { id: 'franchisees',      l: 'Franchisees',       c: '#1D7A4F' },
  { id: 'orders',           l: 'Orders',            c: '#8A5200' },
  { id: 'students',         l: 'Students',          c: '#1A5FA8' },
  { id: 'instructors',      l: 'Instructors',       c: '#6D28D9' },
  { id: 'batches',          l: 'Batches',           c: '#0F766E' },
  { id: 'whatsapp-inbox',   l: 'WhatsApp Inbox',    c: '#25D366' },
  { id: 'courses',          l: 'Courses & SKUs',    c: '#534AB7' },
  { id: 'prices',           l: 'Kit prices',        c: '#1D7A4F' },
  { id: 'price-history',    l: 'Price change log',  c: '#9C9A92' },
  { id: 'users',            l: 'Manage logins',     c: '#A32D2D' },
  { id: 'requests',         l: 'Access requests',   c: '#534AB7' },
]

const managerNav = [
  { id: 'dashboard',      l: 'Dashboard',       c: '#534AB7' },
  { id: 'franchisees',    l: 'Franchisees',      c: '#1D7A4F' },
  { id: 'orders',         l: 'Orders',           c: '#8A5200' },
  { id: 'students',       l: 'Students',         c: '#1A5FA8' },
  { id: 'instructors',    l: 'Instructors',      c: '#6D28D9' },
  { id: 'batches',        l: 'Batches',          c: '#0F766E' },
  { id: 'whatsapp-inbox', l: 'WhatsApp Inbox',   c: '#25D366' },
  { id: 'courses',        l: 'Courses & SKUs',   c: '#534AB7' },
  { id: 'prices',         l: 'Kit prices',       c: '#1D7A4F' },
]

const staffNav = [
  { id: 'dashboard', l: 'Dashboard',      c: '#534AB7' },
  { id: 'orders',    l: 'Orders',         c: '#8A5200' },
  { id: 'students',  l: 'Students',       c: '#1A5FA8' },
  { id: 'courses',   l: 'Courses & SKUs', c: '#534AB7' },
]

export const NAV_ITEMS = {
  owner:       ownerNav,
  super_admin: ownerNav,
  admin:       adminNav,
  manager:     managerNav,
  staff:       staffNav,
  smf: [
    { id: 'dashboard',   l: 'Dashboard',        c: '#534AB7' },
    { id: 'orders',      l: 'State orders',     c: '#8A5200' },
    { id: 'franchisees', l: 'My franchisees',   c: '#1D7A4F' },
    { id: 'students',    l: 'My students',      c: '#1A5FA8' },
    { id: 'courses',     l: 'Course catalogue', c: '#534AB7' },
  ],
  cf: [
    { id: 'dashboard',   l: 'Dashboard',      c: '#534AB7' },
    { id: 'orders',      l: 'City orders',    c: '#8A5200' },
    { id: 'franchisees', l: 'My franchisees', c: '#1D7A4F' },
    { id: 'students',    l: 'My students',    c: '#1A5FA8' },
    { id: 'courses',     l: 'My courses',     c: '#534AB7' },
  ],
  uf: [
    { id: 'dashboard', l: 'Dashboard',  c: '#534AB7' },
    { id: 'orders',    l: 'My orders',  c: '#8A5200' },
    { id: 'students',  l: 'My students', c: '#1A5FA8' },
    { id: 'courses',   l: 'My courses', c: '#534AB7' },
  ],
  student: [
    { id: 'dashboard', l: 'Dashboard',   c: '#534AB7' },
    { id: 'courses',   l: 'My courses',  c: '#1A5FA8' },
  ],
}

export const ROLE_COLORS = {
  owner:       'background:#1E40AF;color:#fff',
  super_admin: 'background:#534AB7;color:#fff',
  admin:       'background:#7C3AED;color:#fff',
  manager:     'background:#0F766E;color:#fff',
  staff:       'background:#64748B;color:#fff',
  smf:         'background:var(--amber-bg);color:var(--amber)',
  cf:          'background:var(--green-bg);color:var(--green)',
  uf:          'background:var(--blue-bg);color:var(--blue)',
  student:     'background:var(--bg4);color:var(--text3)',
}

export const ROLE_LABELS = {
  owner: 'OWNER', super_admin: 'SUPER ADMIN', admin: 'ADMIN',
  manager: 'MANAGER', staff: 'STAFF',
  smf: 'SMF', cf: 'CF', uf: 'UF', student: 'STUDENT',
}

export const ROLE_FULL_LABELS = {
  owner: 'Owner', super_admin: 'Super Admin', admin: 'Admin',
  manager: 'Manager', staff: 'Staff',
  smf: 'State Master Franchisee', cf: 'City Franchisee',
  uf: 'Unit Franchisee', student: 'Student',
}
