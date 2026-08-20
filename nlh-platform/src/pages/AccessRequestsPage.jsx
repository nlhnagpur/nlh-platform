import { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { showToast } from '../utils'
import { sendWelcomeEmail } from '../services/email'
import ModalHeader from '../components/ModalHeader'
import { useAuth } from '../context/AuthContext'

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
        <ModalHeader flush title="Login Credentials Created" subtitle="New Learning Horizons · Access" onClose={onClose} />
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

// Public-facing submission form — rendered for anonymous visitors who click
// "Request Platform Access" from the landing/login screens. Not gated by
// auth; RLS's anyone_can_request INSERT policy is what actually allows this.
function PublicRequestForm() {
  const { setScreen } = useAuth()
  const [form, setForm] = useState({ first_name: '', last_name: '', business_name: '', email: '', phone: '', role_requested: 'uf', address: '', area: '', city: '', pincode: '', state: '', date_of_birth: '', qualification: '' })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [allPrograms, setAllPrograms] = useState([])
  const [programsRequested, setProgramsRequested] = useState([])

  useEffect(function () {
    sb.from('courses').select('group_name').eq('is_active', true).then(function (res) {
      const names = Array.from(new Set((res.data || []).map(function (c) { return c.group_name }).filter(Boolean))).sort()
      setAllPrograms(names)
    })
  }, [])

  function field(key) {
    return function (e) { setForm(function (f) { return { ...f, [key]: e.target.value } }) }
  }

  function toggleProgram(name) {
    setProgramsRequested(function (list) {
      return list.includes(name) ? list.filter(function (n) { return n !== name }) : [...list, name]
    })
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.first_name.trim())               { showToast('Please enter your first name', 'warn'); return }
    if (!form.last_name.trim())                { showToast('Please enter your last name', 'warn'); return }
    if (!form.email.trim() || !form.email.includes('@')) { showToast('Please enter a valid email address', 'warn'); return }
    if (!form.phone.trim())                    { showToast('Please enter your phone number', 'warn'); return }
    if (!form.address.trim())                  { showToast('Please enter your address', 'warn'); return }
    if (!form.area.trim())                     { showToast('Please enter the area / locality', 'warn'); return }
    if (!form.city.trim())                     { showToast('Please enter your city', 'warn'); return }
    if (!form.pincode.trim())                  { showToast('Please enter your PIN code', 'warn'); return }
    if (!form.state.trim())                    { showToast('Please enter your state', 'warn'); return }
    if (!form.date_of_birth)                   { showToast('Please enter your date of birth', 'warn'); return }
    if (form.role_requested === 'uf' && programsRequested.length === 0) {
      showToast('Please select at least one program you are applying for', 'warn'); return
    }
    setSubmitting(true)
    const { error } = await sb.from('access_requests').insert({
      first_name:         form.first_name.trim(),
      last_name:          form.last_name.trim(),
      full_name:          (form.first_name.trim() + ' ' + form.last_name.trim()).trim(),
      business_name:      form.business_name.trim() || null,
      email:              form.email.trim().toLowerCase(),
      phone:              form.phone.trim(),
      role_requested:     form.role_requested,
      address:            form.address.trim(),
      area:               form.area.trim(),
      city:               form.city.trim(),
      pincode:            form.pincode.trim(),
      state:              form.state.trim(),
      date_of_birth:      form.date_of_birth,
      qualification:      form.qualification.trim() || null,
      programs_requested: form.role_requested === 'uf' && programsRequested.length > 0 ? programsRequested : null,
    })
    setSubmitting(false)
    if (error) { showToast('Could not submit request: ' + error.message, 'err'); return }
    setDone(true)
  }

  if (done) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-logo">
            <div className="login-icon">N</div>
            <div>
              <div className="login-brand">New Learning Horizons</div>
              <div className="login-brand-sub">ISO 9001:2015 Certified · Franchise Platform</div>
            </div>
          </div>
          <div className="login-title">Request submitted ✓</div>
          <div className="login-sub">
            Thanks, {form.first_name}! NLH Admin will review your request and email your
            login details once approved.
          </div>
          <div className="login-toggle" style={{ marginTop: 16 }}>
            <a onClick={function () { setScreen('login') }}>← Back to sign in</a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="login-wrap">
      <div className="login-card wide">
        <div className="login-logo">
          <div className="login-icon">N</div>
          <div>
            <div className="login-brand">New Learning Horizons</div>
            <div className="login-brand-sub">ISO 9001:2015 Certified · Franchise Platform</div>
          </div>
        </div>
        <div className="login-title">Request platform access</div>
        <div className="login-sub">Tell us about yourself — NLH Admin will review and set up your login.</div>
        <form onSubmit={submit}>
          <div className="req-grid">
            <div className="form-row">
              <label>First name *</label>
              <input value={form.first_name} onChange={field('first_name')} placeholder="First name" />
            </div>
            <div className="form-row">
              <label>Last name *</label>
              <input value={form.last_name} onChange={field('last_name')} placeholder="Last name" />
            </div>
            <div className="form-row req-full">
              <label>Business / Centre name (optional)</label>
              <input value={form.business_name} onChange={field('business_name')} placeholder="Optional — e.g. Bright Minds Academy" />
            </div>
            <div className="form-row">
              <label>Email address *</label>
              <input type="email" value={form.email} onChange={field('email')} placeholder="you@example.com" />
            </div>
            <div className="form-row">
              <label>Phone *</label>
              <input value={form.phone} onChange={field('phone')} placeholder="10-digit mobile" />
            </div>
            <div className="form-row req-full">
              <label>What are you requesting? *</label>
              <select value={form.role_requested} onChange={field('role_requested')}>
                <option value="uf">Unit Franchise (UF)</option>
                <option value="cf">City Franchise (CF)</option>
                <option value="smf">State Master Franchise (SMF)</option>
                <option value="staff">NLH Staff</option>
              </select>
              {(form.role_requested === 'cf' || form.role_requested === 'smf') && (
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                  City and State Master Franchisees get access to all programs by default — no need to pick individual ones.
                </div>
              )}
            </div>
            {form.role_requested === 'uf' && (
              <div className="form-row req-full">
                <label>Programs applying for *</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '4px 0' }}>
                  {allPrograms.map(function (name) {
                    const checked = programsRequested.includes(name)
                    return (
                      <label
                        key={name}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '5px 10px', borderRadius: 16,
                          border: '1px solid ' + (checked ? 'var(--purple)' : 'var(--border)'),
                          background: checked ? 'var(--purple)' : 'transparent',
                          color: checked ? '#fff' : 'var(--text2)',
                          fontSize: 12, cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={function () { toggleProgram(name) }}
                          style={{ display: 'none' }}
                        />
                        {name}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="form-row req-full">
              <label>Address *</label>
              <input value={form.address} onChange={field('address')} placeholder="Shop no., building name, street" />
            </div>
            <div className="form-row">
              <label>Area / Locality *</label>
              <input value={form.area} onChange={field('area')} placeholder="Area / locality of the centre" />
            </div>
            <div className="form-row">
              <label>City *</label>
              <input value={form.city} onChange={field('city')} placeholder="City" />
            </div>
            <div className="form-row">
              <label>PIN code *</label>
              <input value={form.pincode} onChange={field('pincode')} placeholder="e.g. 440001" />
            </div>
            <div className="form-row">
              <label>State *</label>
              <input value={form.state} onChange={field('state')} placeholder="State" />
            </div>
            <div className="form-row">
              <label>Date of birth *</label>
              <input type="date" value={form.date_of_birth} onChange={field('date_of_birth')} />
            </div>
            <div className="form-row req-full">
              <label>Highest qualification</label>
              <input value={form.qualification} onChange={field('qualification')} placeholder="e.g. B.Ed, M.A. Education" />
            </div>
          </div>
          <button type="submit" className="btn-login" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit request'}
          </button>
        </form>
        <div className="login-toggle" style={{ marginTop: 12 }}>
          <a onClick={function () { setScreen('landing') }}>← Back to home</a>
          &nbsp;·&nbsp;
          <a onClick={function () { setScreen('login') }}>Already have an account?</a>
        </div>
      </div>
    </div>
  )
}

export default function AccessRequestsPage({ standalone }) {
  if (standalone) return <PublicRequestForm />

  return <AdminAccessRequestsView />
}

function AdminAccessRequestsView() {
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

    const tempPass = 'NLH@123'
    const tierMap = { uf: 'UF', cf: 'CF', smf: 'SMF' }
    const tier = tierMap[req.role_requested] || null

    // Staff requests get a login only — no franchisee record.
    let franchiseeId = null
    if (tier) {
      let courseIds = []
      if (tier === 'UF') {
        const wanted = req.programs_requested || []
        if (wanted.length > 0) {
          const { data: crs } = await sb.from('courses').select('id').eq('is_active', true).in('group_name', wanted)
          courseIds = (crs || []).map(function (c) { return c.id })
        }
      } else {
        // CF/SMF get every active course by default (matches the same
        // rule applied when adding a franchisee directly).
        const { data: crs } = await sb.from('courses').select('id').eq('is_active', true)
        courseIds = (crs || []).map(function (c) { return c.id })
      }

      const noteParts = []
      if (req.date_of_birth) noteParts.push('DOB: ' + req.date_of_birth)
      if (req.qualification) noteParts.push('Qualification: ' + req.qualification)
      noteParts.push('Created from an approved access request.')

      // Contract term starts today, runs 3 years (matches the franchise
      // agreement generator's own +3 years / -1 day convention, and the
      // same insert in FranchiseesPage.jsx's "+ Add Franchisee" flow).
      const contractStart = new Date().toISOString().slice(0, 10)
      const contractEndDate = new Date(contractStart + 'T00:00:00')
      contractEndDate.setFullYear(contractEndDate.getFullYear() + 3)
      contractEndDate.setDate(contractEndDate.getDate() - 1)
      const contractEnd = contractEndDate.toISOString().slice(0, 10)

      const { data: fr, error: frErr } = await sb.from('franchisees').insert({
        owner_name:         req.full_name,
        business_name:      req.business_name || req.full_name,
        email:               req.email,
        phone:               req.phone,
        state:               req.state,
        city:                req.city,
        area:                req.area || null,
        pincode:             req.pincode || null,
        address:             req.address || null,
        tier:                tier,
        status:              'active',
        registered_courses:  courseIds,
        date_of_birth:       req.date_of_birth || null,
        qualification:       req.qualification || null,
        notes:               noteParts.join(' · '),
        contract_start:      contractStart,
        contract_end:        contractEnd,
      }).select().single()

      if (frErr) {
        showToast('Could not create franchisee record: ' + frErr.message, 'err')
        setActionLoading(null)
        return
      }
      franchiseeId = fr.id
    }

    // Wrapped in try/catch — a network failure or a non-JSON response
    // (e.g. a 500 with an empty body) must still be treated as a failure
    // and trigger the franchisee rollback below, not throw past it.
    let createData
    try {
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
          fullName:     req.full_name,
          role:         req.role_requested,
          franchiseeId: franchiseeId,
        }),
      })
      createData = await createRes.json()
    } catch (err) {
      createData = { success: false, error: err.message }
    }

    if (!createData.success) {
      // Don't leave a franchisee record with no working login behind —
      // the exact failure mode fixed elsewhere in onboarding.
      if (franchiseeId) await sb.from('franchisees').delete().eq('id', franchiseeId)
      showToast('User creation failed: ' + (createData.error || 'Unknown error') + '. Franchisee record was not kept.', 'err')
      setActionLoading(null)
      return
    }

    // Mark request approved
    await sb
      .from('access_requests')
      .update({ status: 'approved' })
      .eq('id', req.id)

    // Send welcome email (non-fatal)
    const emailResult = await sendWelcomeEmail(req.email, req.full_name, req.role_requested, tempPass)
    if (emailResult?.success === false) {
      showToast('Approved, but email delivery failed — share credentials manually.', 'warn')
    } else {
      showToast('Approved! Credentials sent via email.' + (franchiseeId ? ' Franchisee record created — set parent centre & payment details in Franchisees.' : ''))
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
                <th>Business / Centre</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Type</th>
                <th>Programs</th>
                <th>Address</th>
                <th>Area / City / PIN / State</th>
                <th>DOB</th>
                <th>Qualification</th>
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
                    <td>{req.full_name}</td>
                    <td className="muted">{req.business_name || '—'}</td>
                    <td className="mono">{req.email}</td>
                    <td className="mono">{req.phone || '—'}</td>
                    <td>{TYPE_LABELS[req.role_requested] || req.role_requested}</td>
                    <td className="muted">
                      {(req.programs_requested || []).length > 0 ? req.programs_requested.join(', ') : '—'}
                    </td>
                    <td className="muted">{req.address || '—'}</td>
                    <td className="muted">
                      {[req.area, req.city, req.pincode, req.state].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td className="muted">{req.date_of_birth || '—'}</td>
                    <td className="muted">{req.qualification || '—'}</td>
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
