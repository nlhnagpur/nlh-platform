import React from 'react'
import { useAuth } from '../context/AuthContext'
import { NAV_ITEMS, ROLE_COLORS, ROLE_LABELS } from '../constants/roles'

function parseStyleStr(str) {
  if (!str) return {}
  return Object.fromEntries(
    str.split(';').filter(Boolean).map(s => {
      const [k, ...v] = s.split(':')
      return [k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v.join(':').trim()]
    })
  )
}

export default function Sidebar({ currentPage, onNavigate }) {
  const { currentRole, currentUser, signOut } = useAuth()
  const navItems = NAV_ITEMS[currentRole] || NAV_ITEMS.admin

  return (
    <div className="sb">
      <div className="sb-logo">
        <div className="sb-logo-row">
          <div className="sb-icon">N</div>
          <div>
            <div className="sb-name">NLH Platform</div>
            <div className="sb-sub">New Learning Horizons</div>
          </div>
        </div>
        <span className="sb-role" style={parseStyleStr(ROLE_COLORS[currentRole])}>
          {ROLE_LABELS[currentRole] || (currentRole || '').toUpperCase()}
        </span>
        <div style={{fontSize:10,color:'var(--text3)',marginTop:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {currentUser?.email}
        </div>
      </div>

      <div id="sidebar-nav" style={{flex:1,padding:'8px 0'}}>
        <div className="nav-sect">Menu</div>
        {navItems.map(item => (
          <div
            key={item.id}
            className={'nav-item' + (currentPage === item.id ? ' on' : '')}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-dot" style={{background: item.c}} />
            {item.l}
          </div>
        ))}
      </div>

      <div className="sb-foot">
        <button className="signout-btn" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}
