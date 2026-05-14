import { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { fmtDate, showToast } from '../utils'

const ROLE_LABELS = {
  owner: 'Owner',
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  staff: 'Staff',
  smf: 'SMF',
  cf: 'CF',
  uf: 'UF',
  student: 'Student',
}

function roleBadgeClass(role) {
  if (['owner', 'super_admin'].includes(role)) return 'badge bpu'
  if (['admin', 'manager', 'staff'].includes(role)) return 'badge br'
  if (role === 'smf') return 'badge bp'
  if (role === 'cf') return 'badge ba'
  if (role === 'uf') return 'badge br'
  return 'badge bd'
}

export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(function () {
    loadUsers()
  }, [])

  async function loadUsers() {
    setLoading(true)
    const { data, error } = await sb
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      showToast('Failed to load users: ' + error.message)
    } else {
      setUsers(data || [])
    }
    setLoading(false)
  }

  const filtered = users.filter(function (u) {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (u.email || '').toLowerCase().includes(q) ||
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q)
    )
  })

  if (loading) return <div className="loading"><span className="spinner" />Loading users…</div>

  return (
    <div className="pg">
      <div className="topbar">
        <h2>Users</h2>
        <span className="badge">{users.length} total</span>
      </div>

      <div style={{ marginBottom: 14 }}>
        <input
          type="search"
          className="search-inp"
          placeholder="Search by email, name or role…"
          value={search}
          onChange={function (e) { setSearch(e.target.value) }}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No users found.</div>
      ) : (
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Email</th>
                <th>Full Name</th>
                <th>Role</th>
                <th>Franchisee ID</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function (user) {
                return (
                  <tr key={user.id}>
                    <td className="mono">{user.email}</td>
                    <td>{user.full_name || <span className="muted">—</span>}</td>
                    <td>
                      <span className={roleBadgeClass(user.role)}>
                        {ROLE_LABELS[user.role] || user.role}
                      </span>
                    </td>
                    <td className="mono text-muted">
                      {user.franchisee_id || '—'}
                    </td>
                    <td className="muted">{fmtDate(user.created_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
