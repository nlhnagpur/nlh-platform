import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast, statusBadge } from '../utils'
import { isAdminRole } from '../constants/roles'
import { sendWelcomeEmail } from '../services/email'

// ── helpers ────────────────────────────────────────────────────────────────────

function TierBadge({ tier }) {
  if (!tier) return null
  const cls = { SMF: 't-smf', CF: 't-cf', UF: 't-uf' }[tier] || ''
  return <span className={`tier ${cls}`}>{tier}</span>
}

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase()
  const map = { active: 'ba', inactive: 'bd', pending: 'bp', approved: 'ba', rejected: 'bd' }
  return <span className={`badge ${map[s] || 'br'}`}>{status || '—'}</span>
}

function genTempPass() {
  return 'NLH@' + Math.random().toString(36).slice(2, 8).toUpperCase()
}

// ── FranchiseeDetailModal ──────────────────────────────────────────────────────

function FranchiseeDetailModal({ franchisee, allCourses, onClose, onSaved }) {
  const { currentRole } = useAuth()
  const admin = isAdminRole(currentRole)

  const [tab, setTab] = useState('info')
  const [form, setForm] = useState({
    name: franchisee.business_name || '',
    email: franchisee.email || '',
    phone: franchisee.phone || '',
    city: franchisee.city || '',
    state: franchisee.state || '',
    address: franchisee.address || '',
    status: franchisee.status || 'active',
    enrollment_fee: franchisee.enrollment_fee ?? '',
    fee_paid: franchisee.fee_paid ?? '',
  })
  const [registeredCourses, setRegisteredCourses] = useState(franchisee.registered_courses || [])
  const [saving, setSaving] = useState(false)
  const [orders, setOrders] = useState([])
  const [students, setStudents] = useState([])
  const [tabLoaded, setTabLoaded] = useState({ info: true, courses: false, orders: false, students: false })

  function field(k) {
    return function (e) { setForm(f => ({ ...f, [k]: e.target.value })) }
  }

  async function loadTab(t) {
    setTab(t)
    if (tabLoaded[t]) return
    setTabLoaded(tl => ({ ...tl, [t]: true }))

    if (t === 'orders') {
      const { data } = await sb.from('orders').select('id,created_at,status,amount_paid').eq('placer_id', franchisee.id).order('created_at', { ascending: false }).limit(20)
      setOrders(data || [])
    }
    if (t === 'students') {
      const { data } = await sb.from('students').select('id,full_name,payment_status,fee_total,fee_paid').eq('franchisee_id', franchisee.id).order('full_name').limit(50)
      setStudents(data || [])
    }
  }

  function toggleCourse(id) {
    setRegisteredCourses(rc =>
      rc.includes(id) ? rc.filter(x => x !== id) : [...rc, id]
    )
  }

  async function save() {
    setSaving(true)
    const payload = {
      business_name: form.name.trim(),
      phone: form.phone.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      address: form.address.trim(),
      status: form.status,
      enrollment_fee: form.enrollment_fee === '' ? null : Number(form.enrollment_fee),
      fee_paid: form.fee_paid === '' ? null : Number(form.fee_paid),
    }
    if (tab === 'courses') {
      payload.registered_courses = registeredCourses
    }
    const { error } = await sb.from('franchisees').update(payload).eq('id', franchisee.id)
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    showToast('Saved')
    onSaved({ ...franchisee, ...payload })
  }

  const balance = (Number(form.enrollment_fee) || 0) - (Number(form.fee_paid) || 0)

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680 }}>
        <div className="ch">
          <span>{franchisee.business_name} <TierBadge tier={franchisee.tier} /></span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div className="tabs">
          {['info', 'courses', 'orders', 'students'].map(t => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => loadTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div >

          {tab === 'info' && (
            <div className="form-grid">
              <label>Name
                <input value={form.name} onChange={field('name')} disabled={!admin} />
              </label>
              <label>Email
                <input value={form.email} disabled />
              </label>
              <label>Phone
                <input value={form.phone} onChange={field('phone')} disabled={!admin} />
              </label>
              <label>City
                <input value={form.city} onChange={field('city')} disabled={!admin} />
              </label>
              <label>State
                <input value={form.state} onChange={field('state')} disabled={!admin} />
              </label>
              <label>Address
                <input value={form.address} onChange={field('address')} disabled={!admin} />
              </label>
              <label>Status
                <select value={form.status} onChange={field('status')} disabled={!admin}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="pending">Pending</option>
                </select>
              </label>
              <div className="col-span-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
                <strong>Fee Tracking</strong>
              </div>
              <label>Enrollment Fee (₹)
                <input type="number" value={form.enrollment_fee} onChange={field('enrollment_fee')} disabled={!admin} />
              </label>
              <label>Fee Paid (₹)
                <input type="number" value={form.fee_paid} onChange={field('fee_paid')} disabled={!admin} />
              </label>
              <label>Balance
                <input value={'₹' + fmtAmt(balance)} disabled style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }} />
              </label>
            </div>
          )}

          {tab === 'courses' && (
            <div>
              <p className="hint">Check courses this franchisee is registered to deliver.</p>
              <div className="checkbox-grid">
                {allCourses.map(c => (
                  <label key={c.id} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={registeredCourses.includes(c.id)}
                      onChange={() => admin && toggleCourse(c.id)}
                      disabled={!admin}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {tab === 'orders' && (
            <table className="data-table">
              <thead>
                <tr><th>Date</th><th>Status</th><th>Paid</th></tr>
              </thead>
              <tbody>
                {orders.length === 0 && <tr><td colSpan={3} className="empty">No orders</td></tr>}
                {orders.map(o => (
                  <tr key={o.id}>
                    <td>{fmtDate(o.created_at)}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td>₹{fmtAmt(o.amount_paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'students' && (
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Status</th><th>Fee Total</th><th>Fee Paid</th><th>Balance</th></tr>
              </thead>
              <tbody>
                {students.length === 0 && <tr><td colSpan={5} className="empty">No students</td></tr>}
                {students.map(s => (
                  <tr key={s.id}>
                    <td>{s.full_name}</td>
                    <td><StatusBadge status={s.payment_status} /></td>
                    <td>₹{fmtAmt(s.fee_total)}</td>
                    <td>₹{fmtAmt(s.fee_paid)}</td>
                    <td style={{ color: (s.fee_total - s.fee_paid) > 0 ? 'var(--red)' : 'var(--green)' }}>
                      ₹{fmtAmt((s.fee_total || 0) - (s.fee_paid || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {admin && (tab === 'info' || tab === 'courses') && (
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn-p" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── AddFranchiseeModal ─────────────────────────────────────────────────────────

function AddFranchiseeModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', city: '', state: '',
    tier: 'UF', parent_id: '',
  })
  const [parentOptions, setParentOptions] = useState([])
  const [saving, setSaving] = useState(false)
  const [allCourses, setAllCourses] = useState([])

  useEffect(() => {
    sb.from('courses').select('id,name').order('name').then(({ data }) => setAllCourses(data || []))
  }, [])

  useEffect(() => {
    if (!form.tier) return
    const parentTier = form.tier === 'CF' ? 'SMF' : form.tier === 'UF' ? 'CF' : null
    if (!parentTier) { setParentOptions([]); return }
    sb.from('franchisees').select('id,business_name,city,state').eq('tier', parentTier).eq('status', 'active').order('business_name')
      .then(({ data }) => setParentOptions(data || []))
  }, [form.tier])

  function field(k) {
    return function (e) { setForm(f => ({ ...f, [k]: e.target.value })) }
  }

  async function save() {
    if (!form.name.trim() || !form.email.trim()) { showToast('Name and email are required', 'warn'); return }

    // Territory check
    if (form.tier === 'SMF' || form.tier === 'CF') {
      const col = form.tier === 'SMF' ? 'state' : 'city'
      const val = form.tier === 'SMF' ? form.state.trim() : form.city.trim()
      if (!val) { showToast(`${col} is required for ${form.tier}`, 'warn'); return }
      const { data: existing } = await sb.from('franchisees')
        .select('id,business_name').eq('tier', form.tier).ilike(col, val).eq('status', 'active')
      if (existing && existing.length > 0) {
        showToast(`An active ${form.tier} already exists for ${val}: ${existing[0].business_name}`, 'warn')
        return
      }
    }

    setSaving(true)
    const tempPass = genTempPass()

    try {
      // SMF and CF automatically get all courses; UF starts with none
      let defaultCourses = null
      if (form.tier === 'SMF' || form.tier === 'CF') {
        const { data: allCrs } = await sb.from('courses').select('id').eq('is_active', true)
        defaultCourses = (allCrs || []).map(c => c.id)
      }

      // Insert franchisee
      const { data: fr, error: frErr } = await sb.from('franchisees').insert({
        business_name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        tier: form.tier,
        parent_id: form.parent_id || null,
        status: 'active',
        registered_courses: defaultCourses,
      }).select().single()

      if (frErr) { showToast('Failed to create franchisee: ' + frErr.message, 'err'); setSaving(false); return }

      // Admin session restore hack
      const { data: admSess } = await sb.auth.getSession()
      const { error: signupErr } = await sb.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: tempPass,
        options: { data: { full_name: form.name.trim() } },
      })
      await sb.auth.setSession({
        access_token: admSess.session.access_token,
        refresh_token: admSess.session.refresh_token,
      })

      if (signupErr && !signupErr.message.includes('already registered')) {
        showToast('Auth account error: ' + signupErr.message, 'warn')
      }

      // Insert user record
      const roleMap = { SMF: 'smf', CF: 'cf', UF: 'uf' }
      await sb.from('users').upsert({
        email: form.email.trim().toLowerCase(),
        full_name: form.name.trim(),
        role: roleMap[form.tier] || 'uf',
        franchisee_id: fr.id,
      }, { onConflict: 'email' })

      // Send welcome email
      await sendWelcomeEmail({
        to: form.email.trim(),
        name: form.name.trim(),
        role: form.tier,
        tempPassword: tempPass,
      })

      showToast(`Franchisee created. Temp password: ${tempPass}`)
      onSaved(fr)
    } catch (err) {
      showToast('Unexpected error: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="ch">
          <span>Add Franchisee</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div >
          <div className="form-grid">
            <label>Name *
              <input value={form.name} onChange={field('name')} placeholder="Full name" />
            </label>
            <label>Email *
              <input type="email" value={form.email} onChange={field('email')} placeholder="login@email.com" />
            </label>
            <label>Phone
              <input value={form.phone} onChange={field('phone')} placeholder="10-digit mobile" />
            </label>
            <label>Tier *
              <select value={form.tier} onChange={field('tier')}>
                <option value="SMF">SMF — State Master Franchisee</option>
                <option value="CF">CF — City Franchisee</option>
                <option value="UF">UF — Unit Franchisee</option>
              </select>
            </label>
            {form.tier !== 'SMF' && (
              <label>Parent {form.tier === 'CF' ? 'SMF' : 'CF'} *
                <select value={form.parent_id} onChange={field('parent_id')}>
                  <option value="">— Select —</option>
                  {parentOptions.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.business_name} ({form.tier === 'CF' ? p.state : p.city})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>City
              <input value={form.city} onChange={field('city')} placeholder="City" />
            </label>
            <label>State
              <input value={form.state} onChange={field('state')} placeholder="State" />
            </label>
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            A login account will be created and a welcome email with temp password will be sent.
          </p>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Create Franchisee'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── FranchiseesPage ────────────────────────────────────────────────────────────

export default function FranchiseesPage() {
  const { currentRole, currentFranchiseeId } = useAuth()
  const admin = isAdminRole(currentRole)

  const [franchisees, setFranchisees] = useState([])
  const [allCourses, setAllCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    if (currentRole === null) return  // wait until auth resolves
    async function load() {
      setLoading(true)
      let q = sb.from('franchisees').select('*').order('business_name')
      if (!admin) {
        if (!currentFranchiseeId) { setLoading(false); return }
        q = q.eq('parent_id', currentFranchiseeId)
      }
      const [frResult, courseResult] = await Promise.all([
        q,
        sb.from('courses').select('id,name').order('name'),
      ])
      if (frResult.error) console.error('Franchisees load error:', frResult.error)
      if (courseResult.error) console.error('Courses load error:', courseResult.error)
      setFranchisees(frResult.data || [])
      setAllCourses(courseResult.data || [])
      setLoading(false)
    }
    load()
  }, [admin, currentRole, currentFranchiseeId])

  const filtered = franchisees.filter(f => {
    const q = search.toLowerCase()
    return !q || f.business_name?.toLowerCase().includes(q) || f.city?.toLowerCase().includes(q) || f.state?.toLowerCase().includes(q)
  })

  function handleSaved(updated) {
    setFranchisees(fs => fs.map(f => f.id === updated.id ? { ...f, ...updated } : f))
    setSelected(s => s && s.id === updated.id ? { ...s, ...updated } : s)
  }

  function handleAdded(fr) {
    setFranchisees(fs => [...fs, fr].sort((a, b) => (a.business_name || '').localeCompare(b.business_name || '')))
    setShowAdd(false)
  }

  return (
    <div className="pg">
      <div className="topbar">
        <div>
          <div className="pt">Franchisees</div>
          <div className="ps">{franchisees.length} partner{franchisees.length !== 1 ? 's' : ''} in network</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="search-inp"
            placeholder="Search name / city / state…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {admin && (
            <button className="btn-p" onClick={() => setShowAdd(true)}>+ Add Franchisee</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" />Loading…</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th><th>Tier</th><th>State</th><th>City</th>
                <th>Phone</th><th>Status</th><th>Fee Paid</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>No franchisees found</td></tr>
              )}
              {filtered.map(f => (
                <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(f)}>
                  <td><strong>{f.business_name}</strong></td>
                  <td><TierBadge tier={f.tier} /></td>
                  <td>{f.state || '—'}</td>
                  <td>{f.city || '—'}</td>
                  <td>{f.phone || '—'}</td>
                  <td><StatusBadge status={f.status} /></td>
                  <td>₹{fmtAmt(f.fee_paid)}</td>
                  <td>
                    <button className="btn-s btn-sm" onClick={e => { e.stopPropagation(); setSelected(f) }}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <FranchiseeDetailModal
          franchisee={selected}
          allCourses={allCourses}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
        />
      )}

      {showAdd && (
        <AddFranchiseeModal
          onClose={() => setShowAdd(false)}
          onSaved={handleAdded}
        />
      )}
    </div>
  )
}
