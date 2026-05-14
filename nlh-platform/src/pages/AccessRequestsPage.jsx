import { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { showToast } from '../utils'
import { sendWelcomeEmail } from '../services/email'

function CredentialsModal({ email, password, onClose }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    const text = 'Email: ' + email + '\nPassword: ' + password
    navigator.clipboard.writeText(text).then(function () {
      setCopied(true)
      setTimeout(function () { setCopied(false) }, 2000)
    })
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>Login Credentials Created</h3>
          <button style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}} onClick={onClose}>×</button>
        </div>
        <div >
          <p className="text-muted" style={{ marginBottom: 16 }}>
            Share these credentials with the new user. They should change their password on first login.
          </p>
          <div className="cred-row">
            <span className="cred-label">Email</span>
            <span className="cred-val mono">{email}</span>
          </div>
          <div className="cred-row">
            <span className="cred-label">Temp Password</span>
            <span className="cred-val mono">{password}</span>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-s" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy Credentials'}
          </button>
          <button className="btn-p" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

const TYPE_LABELS = {
  smf: 'State Master Franchise',
  cf: 'City Franchise',
  uf: 'Unit Franchise',
  staff: 'Staff',
}

const STATUS_CLASS = {
  pending: 'badge badge-orange',
  approved: 'badge badge-green',
  rejected: 'badge badge-red',
}

export default function AccessRequestsPage() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null)
  const [credentials, setCredentials] = useState(null) // { email, password }
  const [filterStatus, setFilterStatus] = useState('pending')

  useEffect(function () {
    loadRequests()
  }, [])

  async function loadRequests() {
    setLoading(true)
    const { data, error } = await sb
      .from('access_requests')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      showToast('Failed to load requests: ' + error.message)
    } else {
      setRequests(data || [])
    }
    setLoading(false)
  }

  async function handleApprove(req) {
    setActionLoading(req.id + '_approve')

    const tempPass = 'NLH@' + Math.random().toString(36).slice(2, 8).toUpperCase()

    // Warning: sb.auth.signUp displaces the current admin session.
    // In production, use Supabase Admin API (service role key) from a backend.
    const { data: signUpData, error: signUpErr } = await sb.auth.signUp({
      email: req.email,
      password: tempPass,
    })

    if (signUpErr) {
      showToast('Auth signup failed: ' + signUpErr.message)
      setActionLoading(null)
      return
    }

    const userId = signUpData?.user?.id

    // Insert into users table
    const { error: userErr } = await sb.from('users').insert({
      id: userId,
      email: req.email,
      full_name: req.name,
      role: req.type,
      franchisee_id: req.franchisee_id || null,
    })
    if (userErr) {
      showToast('User insert failed: ' + userErr.message)
      setActionLoading(null)
      return
    }

    // Mark request approved
    await sb
      .from('access_requests')
      .update({ status: 'approved' })
      .eq('id', req.id)

    // Send welcome email
    try {
      await sendWelcomeEmail({
        email: req.email,
        name: req.name,
        tempPassword: tempPass,
      })
    } catch (emailErr) {
      // Non-fatal
      showToast('Approved, but welcome email failed: ' + emailErr.message)
    }

    showToast('Approved! Login credentials created.')
    setCredentials({ email: req.email, password: tempPass })
    await loadRequests()
    setActionLoading(null)
  }

  async function handleReject(req) {
    setActionLoading(req.id + '_reject')
    const { error } = await sb
      .from('access_requests')
      .update({ status: 'rejected' })
      .eq('id', req.id)
    if (error) {
      showToast('Reject failed: ' + error.message)
    } else {
      showToast('Request rejected.')
      await loadRequests()
    }
    setActionLoading(null)
  }

  const filtered = requests.filter(function (r) {
    if (filterStatus === 'all') return true
    return r.status === filterStatus
  })

  if (loading) return <div className="page-loading">Loading access requests…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h2>Access Requests</h2>
        <span className="badge">{requests.filter(function (r) { return r.status === 'pending' }).length} pending</span>
      </div>

      <div className="page-toolbar">
        <div className="filter-tabs">
          {['pending', 'approved', 'rejected', 'all'].map(function (s) {
            return (
              <button
                key={s}
                className={'filter-tab' + (filterStatus === s ? ' active' : '')}
                onClick={function () { setFilterStatus(s) }}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            )
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">No {filterStatus === 'all' ? '' : filterStatus} requests found.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Type</th>
                <th>State / City</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function (req) {
                const approvingThis = actionLoading === req.id + '_approve'
                const rejectingThis = actionLoading === req.id + '_reject'
                return (
                  <tr key={req.id}>
                    <td>{req.name}</td>
                    <td className="mono">{req.email}</td>
                    <td className="mono">{req.phone || '—'}</td>
                    <td>{TYPE_LABELS[req.type] || req.type}</td>
                    <td className="text-muted">
                      {[req.state, req.city].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td>
                      <span className={STATUS_CLASS[req.status] || 'badge'}>
                        {req.status}
                      </span>
                    </td>
                    <td>
                      {req.status === 'pending' && (
                        <div className="btn-group">
                          <button
                            className="btn-p btn-sm"
                            disabled={!!actionLoading}
                            onClick={function () { handleApprove(req) }}
                          >
                            {approvingThis ? 'Approving…' : 'Approve'}
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={!!actionLoading}
                            onClick={function () { handleReject(req) }}
                          >
                            {rejectingThis ? 'Rejecting…' : 'Reject'}
                          </button>
                        </div>
                      )}
                      {req.status !== 'pending' && (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {credentials && (
        <CredentialsModal
          email={credentials.email}
          password={credentials.password}
          onClose={function () { setCredentials(null) }}
        />
      )}
    </div>
  )
}
