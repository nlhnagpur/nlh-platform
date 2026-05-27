import { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { showToast } from '../utils'
import { ROLE_LABELS, ROLE_COLORS, isAdminRole } from '../constants/roles'
import { sendWelcomeEmail, sendInviteEmail } from '../services/email'

// â”€â”€ role hierarchy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ROLE_RANK = { owner: 6, super_admin: 5, admin: 4, manager: 3, staff: 2, smf: 1, cf: 1, uf: 1, student: 0 }
const ADMIN_ROLES     = ['owner', 'super_admin', 'admin', 'manager', 'staff']
const FRANCHISE_ROLES = ['smf', 'cf', 'uf']

// Roles the current user is allowed to assign (only roles ranked below their own)
function assignableRoles(myRole) {
  const myRank = ROLE_RANK[myRole] || 0
  return ['owner', 'super_admin', 'admin', 'manager', 'staff', 'smf', 'cf', 'uf']
    .filter(function (r) { return ROLE_RANK[r] < myRank })
}

function rolePill(role) {
  const raw = ROLE_COLORS[role] || 'background:var(--bg4);color:var(--text3)'
  const styleObj = {}
  raw.split(';').filter(Boolean).forEach(function (pair) {
    const idx = pair.indexOf(':')
    if (idx < 0) return
    const key = pair.slice(0, idx).trim().replace(/-([a-z])/g, function (_, c) { return c.toUpperCase() })
    styleObj[key] = pair.slice(idx + 1).trim()
  })
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px', borderRadius: 20,
      font: '700 10px var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em',
      ...styleObj
    }}>
      {ROLE_LABELS[role] || role}
    </span>
  )
}

function userInitials(u) {
  const name = u.full_name || u.email || '?'
  return name.split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()
}

function fmtRelative(ts) {
  if (!ts) return 'â€”'
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 2) return 'just now'
  if (m < 60) return m + 'm ago'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h ago'
  const d = Math.floor(h / 24)
  if (d < 30) return d + 'd ago'
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}

const AV_PALETTE = [
  ['#DBEAFE','#2563EB'],['#DCFCE7','#16A34A'],['#FEF3C7','#D97706'],
  ['#FCE7F3','#DB2777'],['#E9D5FF','#7C3AED'],['#BAE6FD','#0284C7'],
]
function avColor(email) {
  let h = 0
  for (let i = 0; i < (email || '').length; i++) h = (h * 31 + email.charCodeAt(i)) & 0xffff
  return AV_PALETTE[h % AV_PALETTE.length]
}

// â”€â”€ AddUserModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function AddUserModal({ myRole, onClose, onSaved }) {
  const [email,    setEmail]    = useState('')
  const [name,     setName]     = useState('')
  const [role,     setRole]     = useState('staff')
  const [password, setPassword] = useState('')
  const [saving,   setSaving]   = useState(false)
  const allowed = assignableRoles(myRole)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim() || !password.trim()) { showToast('Email and password are required.'); return }
    if (password.length < 8) { showToast('Password must be at least 8 characters.'); return }
    setSaving(true)

    // Preserve admin session â€” signUp will create a new auth session
    const { data: { session: adminSession } } = await sb.auth.getSession()

    const { error: signUpErr } = await sb.auth.signUp({
      email: email.trim().toLowerCase(),
      password: password.trim(),
      options: { data: { full_name: name.trim() } },
    })

    // Always restore admin session first
    if (adminSession) {
      await sb.auth.setSession({
        access_token: adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      })
    }

    if (signUpErr) {
      showToast('Failed to create account: ' + signUpErr.message)
      setSaving(false)
      return
    }

    // Write the correct role into our users table
    const { error: dbErr } = await sb.from('users').upsert({
      email: email.trim().toLowerCase(),
      full_name: name.trim() || email.split('@')[0],
      role,
      is_active: true,
    }, { onConflict: 'email' })

    if (dbErr) {
      showToast('User created in Auth but role save failed: ' + dbErr.message)
    } else {
      // Send credentials via email (non-fatal)
      const emailResult = await sendWelcomeEmail(email.trim().toLowerCase(), name.trim() || email.split('@')[0], role, password.trim())
      if (emailResult?.success !== false) {
        showToast('User created! Credentials emailed to ' + email.trim() + '.')
      } else {
        showToast('User created! (Email delivery failed â€” share credentials manually.)', 'warn')
      }
      onSaved()
    }
    setSaving(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }}>
        <div className="modal-h">
          <div className="modal-title">Add user</div>
          <button className="modal-x" onClick={onClose}>âœ•</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 20px 20px' }}>
          <div>
            <label className="lbl">Email address <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="inp" type="email" placeholder="user@example.com" value={email}
              onChange={function (e) { setEmail(e.target.value) }} required />
          </div>
          <div>
            <label className="lbl">Full name</label>
            <input className="inp" type="text" placeholder="Full name" value={name}
              onChange={function (e) { setName(e.target.value) }} />
          </div>
          <div>
            <label className="lbl">Role <span style={{ color: 'var(--red)' }}>*</span></label>
            <select className="inp" value={role} onChange={function (e) { setRole(e.target.value) }}>
              {allowed.map(function (r) {
                return <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
              })}
            </select>
          </div>
          <div>
            <label className="lbl">Temporary password <span style={{ color: 'var(--red)' }}>*</span></label>
            <input className="inp" type="password" placeholder="Min. 8 characters" value={password}
              onChange={function (e) { setPassword(e.target.value) }} required minLength={8} />
            <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', marginTop: 5 }}>
              The user can change their password via "Forgot password" after first login.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn btn-s" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-p" disabled={saving}>{saving ? 'Creatingâ€¦' : 'Create user'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// â”€â”€ EditRoleModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function EditRoleModal({ user, myRole, onClose, onSaved }) {
  const [role,   setRole]   = useState(user.role || 'staff')
  const [saving, setSaving] = useState(false)
  const allowed = assignableRoles(myRole)

  async function handleSave() {
    setSaving(true)
    const { error } = await sb.from('users').update({ role }).eq('id', user.id)
    if (error) { showToast('Failed to update role: ' + error.message); setSaving(false); return }
    showToast('Role updated.')
    onSaved()
    setSaving(false)
  }

  const [avBg, avCol] = avColor(user.email)

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }}>
        <div className="modal-h">
          <div className="modal-title">Change role</div>
          <button className="modal-x" onClick={onClose}>âœ•</button>
        </div>
        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg)', borderRadius: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: avBg, color: avCol, display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 13px var(--font)', flexShrink: 0 }}>
              {userInitials(user)}
            </div>
            <div>
              <div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>{user.full_name || user.email}</div>
              <div style={{ font: '500 11px var(--mono)', color: 'var(--text3)', marginTop: 2 }}>{user.email}</div>
            </div>
            <div style={{ marginLeft: 'auto' }}>{rolePill(user.role)}</div>
          </div>
          <div>
            <label className="lbl">New role</label>
            <select className="inp" value={role} onChange={function (e) { setRole(e.target.value) }}>
              {allowed.map(function (r) {
                return <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
              })}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-s" onClick={onClose}>Cancel</button>
            <button className="btn btn-p" onClick={handleSave} disabled={saving}>{saving ? 'Savingâ€¦' : 'Save role'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// â”€â”€ ConfirmModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  async function go() { setBusy(true); await onConfirm(); setBusy(false) }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }}>
        <div className="modal-h">
          <div className="modal-title">{title}</div>
          <button className="modal-x" onClick={onClose}>âœ•</button>
        </div>
        <div style={{ padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ font: '500 13px var(--font)', color: 'var(--text2)', lineHeight: 1.6 }}>{message}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-s" onClick={onClose}>Cancel</button>
            <button className="btn" style={{ background: danger ? 'var(--red)' : 'var(--purple)', color: '#fff' }}
              onClick={go} disabled={busy}>
              {busy ? 'Please waitâ€¦' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// â”€â”€ UsersPage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function UsersPage() {
  const { currentUser, currentRole } = useAuth()
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [tab,     setTab]     = useState('all')
  const [modal,   setModal]   = useState(null)

  useEffect(function () { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    const { data, error } = await sb.from('users').select('*').order('created_at', { ascending: false })
    if (error) showToast('Failed to load users: ' + error.message)
    else setUsers(data || [])
    setLoading(false)
  }

  async function toggleBlock(user) {
    const next = user.is_active === false ? true : false
    const { error } = await sb.from('users').update({ is_active: next }).eq('id', user.id)
    if (error) { showToast('Failed: ' + error.message); return }
    showToast(next ? 'User unblocked.' : 'User blocked.')
    setModal(null)
    loadUsers()
  }

  async function deleteUser(user) {
    const { error } = await sb.from('users').delete().eq('id', user.id)
    if (error) { showToast('Failed to remove: ' + error.message); return }
    showToast('User removed.')
    setModal(null)
    loadUsers()
  }

  async function sendInvite(user) {
    const displayName = user.full_name || user.email.split('@')[0]

    // Fire invite email + Supabase password reset link in parallel
    const [emailResult, { error: resetError }] = await Promise.all([
      sendInviteEmail(user.email, displayName, user.role),
      sb.auth.resetPasswordForEmail(user.email, { redirectTo: 'https://nlh-platform.vercel.app/login' }),
    ])

    if (resetError) {
      showToast('Warning: password reset link failed â€” ' + resetError.message, 'warn')
    } else if (emailResult.success) {
      showToast('Invite sent to ' + user.email + '!')
    } else {
      showToast('Invite sent (email delivery may be delayed).')
    }
    setModal(null)
  }

  // Stats
  const total    = users.length
  const adminCnt = users.filter(function (u) { return ADMIN_ROLES.includes(u.role) }).length
  const frCnt    = users.filter(function (u) { return FRANCHISE_ROLES.includes(u.role) }).length
  const blocked  = users.filter(function (u) { return u.is_active === false }).length

  // Tab + search filter
  const filtered = users
    .filter(function (u) {
      if (tab === 'admin')     return ADMIN_ROLES.includes(u.role)
      if (tab === 'franchise') return FRANCHISE_ROLES.includes(u.role)
      if (tab === 'blocked')   return u.is_active === false
      return true
    })
    .filter(function (u) {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        (u.email || '').toLowerCase().includes(q) ||
        (u.full_name || '').toLowerCase().includes(q) ||
        (u.role || '').toLowerCase().includes(q)
      )
    })

  // Hierarchy: can current user act on this target?
  function canAct(target) {
    if (!target) return false
    if (target.email === currentUser?.email) return false
    return (ROLE_RANK[currentRole] || 0) > (ROLE_RANK[target.role] || 0)
  }

  const myAssignable = assignableRoles(currentRole)

  const TABS = [
    { id: 'all',       label: 'All',          count: total },
    { id: 'admin',     label: 'Admin team',   count: adminCnt },
    { id: 'franchise', label: 'Franchisees',  count: frCnt },
    { id: 'blocked',   label: 'Blocked',      count: blocked },
  ]

  return (
    <div className="pg">
      <header className="tb">
        <div className="crumb">Settings <span className="sep">â€º</span> <b>Manage Logins</b></div>
        <div className="tb-r">
          <input className="search tb-search" placeholder="Search email / name / roleâ€¦"
            value={search} onChange={function (e) { setSearch(e.target.value) }} />
          <button className="btn btn-p" onClick={function () { setModal('add') }}>+ Add user</button>
        </div>
      </header>

      <div className="content">
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>Settings</div>
            <h1 className="ph-title">Manage Logins</h1>
            <div className="ph-sub">Control who can access the platform â€” change roles, block accounts, or add new admin &amp; staff members.</div>
          </div>
        </div>

        {/* Mini stats */}
        <div className="mini-stats">
          {[
            { ic: 'ðŸ‘¥', num: total,    lbl: 'Total users' },
            { ic: 'ðŸ”‘', num: adminCnt, lbl: 'Admin team' },
            { ic: 'ðŸ¢', num: frCnt,    lbl: 'Franchisees' },
            { ic: 'ðŸš«', num: blocked,  lbl: 'Blocked' },
          ].map(function (s) {
            return (
              <div className="mini" key={s.lbl}>
                <div className="mini-ic">{s.ic}</div>
                <div>
                  <div className="mini-num">{s.num}</div>
                  <div className="mini-lbl">{s.lbl}</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Tabs */}
        <div className="status-pills" style={{ marginBottom: 0 }}>
          {TABS.map(function (t) {
            return (
              <button key={t.id} className={'sp' + (tab === t.id ? ' on on-pend' : '')}
                onClick={function () { setTab(t.id) }}>
                {t.label}
                <span style={{ marginLeft: 6, background: 'rgba(0,0,0,.08)', padding: '1px 7px', borderRadius: 10, font: '700 10px var(--mono)' }}>{t.count}</span>
              </button>
            )
          })}
        </div>

        {/* Users table */}
        {loading ? (
          <div className="loading"><span className="spinner" />Loading usersâ€¦</div>
        ) : filtered.length === 0 ? (
          <div className="empty">No users found.</div>
        ) : (
          <div className="card tbl-scroll" style={{ marginTop: 0 }}>
            <table className="big-tbl">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(function (u) {
                  const [avBg, avCol] = avColor(u.email)
                  const isBlocked = u.is_active === false
                  const isSelf    = u.email === currentUser?.email
                  const actable   = canAct(u)

                  return (
                    <tr key={u.id} style={{ opacity: isBlocked ? 0.55 : 1, transition: 'opacity .2s' }}>
                      <td>
                        <div className="placer-cell">
                          <div className="placer-av" style={{ background: avBg, color: avCol }}>{userInitials(u)}</div>
                          <div>
                            <div className="placer-name">
                              {u.full_name || <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>No name</span>}
                              {isSelf && (
                                <span style={{ marginLeft: 6, font: '600 9px var(--mono)', color: 'var(--purple)', background: 'var(--purple-bg)', padding: '2px 7px', borderRadius: 10, verticalAlign: 'middle' }}>You</span>
                              )}
                            </div>
                            <div className="placer-loc">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>{rolePill(u.role)}</td>
                      <td>
                        {isBlocked
                          ? <span className="bdg bdg-over"><span className="d"></span>Blocked</span>
                          : <span className="bdg bdg-paid"><span className="d"></span>Active</span>
                        }
                      </td>
                      <td style={{ font: '500 12px var(--mono)', color: 'var(--text3)' }}>
                        {fmtRelative(u.last_sign_in_at)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {actable && myAssignable.length > 0 && (
                            <button className="row-action" onClick={function () { setModal({ type: 'role', user: u }) }}>
                              âœï¸ Role
                            </button>
                          )}
                          {actable && (
                            <button className="row-action" onClick={function () { setModal({ type: 'invite', user: u }) }}>
                              ðŸ“§ Invite
                            </button>
                          )}
                          {actable && (
                            <button
                              className={'row-action' + (isBlocked ? ' green' : '')}
                              onClick={function () { setModal({ type: 'block', user: u }) }}
                            >
                              {isBlocked ? 'âœ… Unblock' : 'ðŸš« Block'}
                            </button>
                          )}
                          {actable && (
                            <button className="row-action" style={{ color: 'var(--red)' }}
                              onClick={function () { setModal({ type: 'delete', user: u }) }}>
                              ðŸ—‘ Remove
                            </button>
                          )}
                          {!actable && !isSelf && (
                            <span style={{ font: '500 10px var(--mono)', color: 'var(--text3)' }}>Protected</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal === 'add' && (
        <AddUserModal myRole={currentRole}
          onClose={function () { setModal(null) }}
          onSaved={function () { setModal(null); loadUsers() }} />
      )}
      {modal?.type === 'role' && (
        <EditRoleModal user={modal.user} myRole={currentRole}
          onClose={function () { setModal(null) }}
          onSaved={function () { setModal(null); loadUsers() }} />
      )}
      {modal?.type === 'invite' && (
        <ConfirmModal
          title="Send login invite"
          message={'Send a password reset link to ' + modal.user.email + '? They will receive an email with a link to set their password and access the platform.'}
          confirmLabel="Send invite"
          danger={false}
          onConfirm={function () { return sendInvite(modal.user) }}
          onClose={function () { setModal(null) }} />
      )}
      {modal?.type === 'block' && (
        <ConfirmModal
          title={modal.user.is_active === false ? 'Unblock user' : 'Block user'}
          message={
            modal.user.is_active === false
              ? modal.user.email + ' will be able to sign in again.'
              : 'Block ' + modal.user.email + '? They will be denied access on next login.'
          }
          confirmLabel={modal.user.is_active === false ? 'Unblock' : 'Block'}
          danger={modal.user.is_active !== false}
          onConfirm={function () { return toggleBlock(modal.user) }}
          onClose={function () { setModal(null) }} />
      )}
      {modal?.type === 'delete' && (
        <ConfirmModal
          title="Remove user"
          message={'Remove ' + modal.user.email + ' from the platform? Their Supabase Auth account is preserved â€” you can re-add them later.'}
          confirmLabel="Remove"
          danger={true}
          onConfirm={function () { return deleteUser(modal.user) }}
          onClose={function () { setModal(null) }} />
      )}
    </div>
  )
}

