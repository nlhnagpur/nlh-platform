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
          <p style={{ color:'var(--text2)', fontSize:12, marginBottom: 16 }}>
            Share these credentials with the new user. They should change their password on first login.
          </p>
          <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
            <span style={{ fontSize:11, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.05em' }}>Email</span>
            <span style={{ fontFamily:'var(--mono)', fontSize:12 }}>{email}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0' }}>
            <span style={{ fontSize:11, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.05em' }}>Temp Password</span>
            <span style={{ fontFamily:'var(--mono)', fontSize:12 }}>{password}</span>
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
  pending: 'badge bp',
  approved: 'badge ba',
  rejected: 'badge bd',
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

    const { data: { session } } = await sb.auth.getSession()
    const createRes = await fetch('/api/create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        email:        req.email,
        password:     tempPass,
        fullName:     req.name,
        role:         req.type,
        franchiseeId: req.franchisee_id || null,
      }),
    })
    const createData = await createRes.json()

    if (!createData.success) {
      showToast('User creation failed: ' + (createData.error || 'Unknown error'))
      setActionLoading(null)
      return
    }

    // Mark request approved
    await sb
      .from('access_requests')
      .update({ status: 'approved' })
      .eq('id', req.id)

    // Send welcome email (non-fatal)
    const emailResult = await sendWelcomeEmail({ email: req.email, name: req.name, tempPassword: tempPass })
    if (emailResult?.success === false) {
      showToast('Approved, but email delivery failed — share credentials manually.', 'warn')
    } else {
      showToast('Approved! Credentials sent via email.')
    }
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

  if (loading) return <div className="loading"><span className="spinner" />Loading access requests…</div>

  return (
    <div className="pg">
      <div className="topbar">
        <h2>Access Requests</h2>
        <span className="badge">{requests.filter(function (r) { return r.status === 'pending' }).length} pending</span>
      </div>

      <div style={{ display:'flex', gap:6, marginBottom:14 }}>
        {['pending', 'approved', 'rejected', 'all'].map(function (s) {
          return (
            <button
              key={s}
              className={filterStatus === s ? 'btn-p btn-sm' : 'btn-s btn-sm'}
              onClick={function () { setFilterStatus(s) }}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No {filterStatus === 'all' ? '' : filterStatus} requests found.</div>
      ) : (
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <div className="tbl-scroll">
          <table className="tbl">
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
                    <td className="muted">
                      {[req.state, req.city].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td>
                      <span className={STATUS_CLASS[req.status] || 'badge'}>
                        {req.status}
                      </span>
                    </td>
                    <td>
                      {req.status === 'pending' && (
                        <div style={{ display:'flex', gap:6 }}>
                          <button
                            className="btn-p btn-sm"
                            disabled={!!actionLoading}
                            onClick={function () { handleApprove(req) }}
                          >
                            {approvingThis ? 'Approving…' : 'Approve'}
                          </button>
                          <button
                            className="btn-s btn-sm"
                            disabled={!!actionLoading}
                            onClick={function () { handleReject(req) }}
                            style={{ color:'var(--red)', borderColor:'var(--red)' }}
                          >
                            {rejectingThis ? 'Rejecting…' : 'Reject'}
                          </button>
                        </div>
                      )}
                      {req.status !== 'pending' && (
                        <span style={{color:'var(--text3)'}}>—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
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
