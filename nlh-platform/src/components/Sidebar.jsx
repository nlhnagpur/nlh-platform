import React from 'react'
import { useAuth } from '../context/AuthContext'
import { NAV_ITEMS, ROLE_LABELS } from '../constants/roles'

const NAV_ICONS = {
  dashboard:       '📊',
  franchisees:     '🏢',
  orders:          '📦',
  students:        '🎓',
  instructors:     '👩‍🏫',
  invoices:        '🧾',
  courses:         '📚',
  prices:          '🏷️',
  'price-history': '📜',
  users:           '🔑',
  requests:        '🤝',
}

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(function(n) { return n[0] }).join('').slice(0, 2).toUpperCase()
}

export default function Sidebar({ currentPage, onNavigate, isOpen, onClose }) {
  const { currentRole, currentUser, signOut } = useAuth()
  const navItems = NAV_ITEMS[currentRole] || NAV_ITEMS.admin
  const isAdmin = ['owner', 'super_admin', 'admin', 'manager', 'staff'].includes(currentRole)

  const userName = currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || 'User'
  const roleLabel = ROLE_LABELS[currentRole] || (currentRole || '').toUpperCase()
  const userInitials = initials(userName)

  // Group nav items into sections
  const ops = navItems.filter(function(item) {
    return ['dashboard', 'franchisees', 'orders', 'students', 'instructors', 'invoices'].includes(item.id)
  })
  const catalog = navItems.filter(function(item) {
    return ['prices', 'courses', 'price-history'].includes(item.id)
  })
  const settings = navItems.filter(function(item) {
    return ['users', 'requests'].includes(item.id)
  })

  function NavItem({ item }) {
    return (
      <div
        className={'nav ' + (currentPage === item.id ? 'on' : '')}
        onClick={function() { onNavigate(item.id) }}
      >
        <span className="nav-ic">{NAV_ICONS[item.id] || '●'}</span>
        <span>{item.l}</span>
      </div>
    )
  }

  return (
    <div className={'sb' + (isOpen ? ' open' : '')}>
      {/* top: logo + brand */}
      <div className="sb-top">
        <div className="sb-logo-box">
          <img src="/NLH%20Logo.png" alt="NLH" />
        </div>
        <div className="sb-brand">
          <div className="sb-name">NLH Platform</div>
          <div className="sb-trust">Est. 2008 · <b>ISO 9001:2015</b></div>
        </div>
        {isAdmin && <span className="sb-env">{roleLabel}</span>}
        {/* close button — visible only on mobile */}
        <button className="sb-close" onClick={onClose} aria-label="Close menu">✕</button>
      </div>

      {/* navigation */}
      <div className="sb-nav">
        {ops.length > 0 && (
          <>
            <div className="sect">Operations</div>
            {ops.map(function(item) { return <NavItem key={item.id} item={item} /> })}
          </>
        )}
        {catalog.length > 0 && (
          <>
            <div className="sect">Catalog</div>
            {catalog.map(function(item) { return <NavItem key={item.id} item={item} /> })}
          </>
        )}
        {settings.length > 0 && (
          <>
            <div className="sect">Settings</div>
            {settings.map(function(item) { return <NavItem key={item.id} item={item} /> })}
          </>
        )}
        {/* fallback: items not in any section */}
        {ops.length === 0 && catalog.length === 0 && settings.length === 0 && (
          <>
            <div className="sect">Menu</div>
            {navItems.map(function(item) { return <NavItem key={item.id} item={item} /> })}
          </>
        )}
      </div>

      {/* watermark */}
      <div className="sb-watermark">
        <div className="sb-wm-ic">☀️</div>
        <div className="sb-wm-text">Enriching <b>children's future</b><br />since 2008</div>
      </div>

      {/* footer: avatar + signout */}
      <div className="sb-foot-new">
        <div className="av">{userInitials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="av-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
          <div className="av-role">{roleLabel}</div>
        </div>
        <button
          onClick={signOut}
          title="Sign out"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 14, padding: 4, borderRadius: 6, flexShrink: 0 }}
          onMouseEnter={function(e) { e.currentTarget.style.color = 'var(--red)' }}
          onMouseLeave={function(e) { e.currentTarget.style.color = 'var(--text3)' }}
        >⏻</button>
      </div>
    </div>
  )
}
