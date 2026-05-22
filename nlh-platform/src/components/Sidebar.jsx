import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { NAV_ITEMS, ROLE_LABELS } from '../constants/roles'

const NAV_ICONS = {
  dashboard:        '📊',
  franchisees:      '🏢',
  orders:           '📦',
  students:         '🎓',
  instructors:      '👩‍🏫',
  batches:          '🗓️',
  invoices:         '🧾',
  'whatsapp-inbox': '💬',
  courses:          '📚',
  prices:           '🏷️',
  'price-history':  '📜',
  users:            '🔑',
  requests:         '🤝',
}

const SETTINGS_IDS = ['prices', 'courses', 'price-history', 'users', 'requests']

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(function(n) { return n[0] }).join('').slice(0, 2).toUpperCase()
}

export default function Sidebar({ currentPage, onNavigate, isOpen, onClose }) {
  const { currentRole, currentUser, signOut } = useAuth()
  const navItems = NAV_ITEMS[currentRole] || NAV_ITEMS.admin
  const isAdmin = ['owner', 'super_admin', 'admin', 'manager', 'staff'].includes(currentRole)

  const userName     = currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || 'User'
  const roleLabel    = ROLE_LABELS[currentRole] || (currentRole || '').toUpperCase()
  const userInitials = initials(userName)

  // Group nav items
  const ops         = navItems.filter(function(item) {
    return ['dashboard', 'franchisees', 'orders', 'students', 'instructors', 'batches', 'invoices', 'whatsapp-inbox'].includes(item.id)
  })
  const settingsAll = navItems.filter(function(item) {
    return SETTINGS_IDS.includes(item.id)
  })

  // Fallback: items not in any known section
  const other = navItems.filter(function(item) {
    return !['dashboard','franchisees','orders','students','instructors','batches','invoices','whatsapp-inbox',...SETTINGS_IDS].includes(item.id)
  })

  // Auto-expand settings when current page lives there
  const [settingsOpen, setSettingsOpen] = useState(function() {
    return SETTINGS_IDS.includes(currentPage)
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
        <button className="sb-close" onClick={onClose} aria-label="Close menu">✕</button>
      </div>

      {/* navigation */}
      <div className="sb-nav">
        {/* Operations — always visible */}
        {ops.length > 0 && (
          <>
            <div className="sect">Operations</div>
            {ops.map(function(item) { return <NavItem key={item.id} item={item} /> })}
          </>
        )}

        {/* Settings (Catalog + Settings merged, collapsible) */}
        {settingsAll.length > 0 && (
          <>
            <div
              className="sect"
              onClick={function() { setSettingsOpen(function(o) { return !o }) }}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none' }}
            >
              <span>Settings</span>
              <span style={{
                fontSize: 9,
                color: 'var(--text3)',
                transform: settingsOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.18s',
                display: 'inline-block',
              }}>▶</span>
            </div>

            {settingsOpen && settingsAll.map(function(item) { return <NavItem key={item.id} item={item} /> })}
          </>
        )}

        {/* Fallback: items not in any section */}
        {ops.length === 0 && settingsAll.length === 0 && other.length === 0 && (
          <>
            <div className="sect">Menu</div>
            {navItems.map(function(item) { return <NavItem key={item.id} item={item} /> })}
          </>
        )}
        {other.length > 0 && other.map(function(item) { return <NavItem key={item.id} item={item} /> })}
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
          style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', cursor: 'pointer', color: 'var(--red)', fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 6, flexShrink: 0, fontFamily: 'var(--font)' }}
        >⏻ Sign out</button>
      </div>
    </div>
  )
}
