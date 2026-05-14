import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { sb } from '../supabase'

export default function DebugOverlay() {
  const { currentRole, currentFranchiseeId, currentUser } = useAuth()
  const [counts, setCounts] = useState(null)
  const [err, setErr] = useState(null)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    async function run() {
      try {
        const [fr, or_, st, us] = await Promise.all([
          sb.from('franchisees').select('*', { count: 'exact', head: true }),
          sb.from('orders').select('*', { count: 'exact', head: true }),
          sb.from('students').select('*', { count: 'exact', head: true }),
          sb.from('users').select('*', { count: 'exact', head: true }),
        ])
        setCounts({
          franchisees: fr.count,
          orders: or_.count,
          students: st.count,
          users: us.count,
          frErr: fr.error?.message,
          orErr: or_.error?.message,
        })
      } catch (e) {
        setErr(e.message)
      }
    }
    run()
  }, [])

  if (!visible) return (
    <button
      onClick={() => setVisible(true)}
      style={{ position: 'fixed', bottom: 8, right: 8, zIndex: 9999, background: '#534AB7', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
    >Debug</button>
  )

  return (
    <div style={{
      position: 'fixed', bottom: 12, right: 12, zIndex: 9999,
      background: '#1A1916', color: '#fff', borderRadius: 10,
      padding: '12px 16px', fontSize: 11, fontFamily: 'monospace',
      maxWidth: 320, boxShadow: '0 4px 20px rgba(0,0,0,.4)',
      lineHeight: 1.8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ color: '#9B8FFF' }}>🔍 Debug</strong>
        <button onClick={() => setVisible(false)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14 }}>×</button>
      </div>

      <div><span style={{ color: '#9C9A92' }}>email: </span>{currentUser?.email || '—'}</div>
      <div><span style={{ color: '#9C9A92' }}>role: </span>
        <span style={{ color: currentRole ? '#6EE7B7' : '#FCA5A5' }}>{currentRole ?? 'NULL ⚠️'}</span>
      </div>
      <div><span style={{ color: '#9C9A92' }}>franchisee_id: </span>{currentFranchiseeId || 'null'}</div>

      <div style={{ borderTop: '1px solid #333', marginTop: 8, paddingTop: 8 }}>
        <div style={{ color: '#9C9A92', marginBottom: 4 }}>Supabase counts (direct):</div>
        {err && <div style={{ color: '#FCA5A5' }}>Error: {err}</div>}
        {counts ? (
          <>
            <div>franchisees: <span style={{ color: counts.franchisees > 0 ? '#6EE7B7' : '#FCA5A5' }}>{counts.franchisees ?? '?'}</span>{counts.frErr ? <span style={{ color: '#FCA5A5' }}> ⚠️ {counts.frErr}</span> : ''}</div>
            <div>orders: <span style={{ color: counts.orders > 0 ? '#6EE7B7' : '#FCA5A5' }}>{counts.orders ?? '?'}</span>{counts.orErr ? <span style={{ color: '#FCA5A5' }}> ⚠️ {counts.orErr}</span> : ''}</div>
            <div>students: <span style={{ color: '#6EE7B7' }}>{counts.students ?? '?'}</span></div>
            <div>users: <span style={{ color: '#6EE7B7' }}>{counts.users ?? '?'}</span></div>
          </>
        ) : (
          <div style={{ color: '#9C9A92' }}>loading…</div>
        )}
      </div>
    </div>
  )
}
