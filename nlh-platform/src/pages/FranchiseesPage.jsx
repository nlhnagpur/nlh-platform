import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast, statusBadge } from '../utils'
import { isAdminRole } from '../constants/roles'
import { getDescendantIds } from '../utils/hierarchy'
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
    country: franchisee.country || 'India',
    state: franchisee.state || '',
    city: franchisee.city || '',
    area: franchisee.area || '',
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
      country: form.country.trim(),
      state: form.state.trim(),
      city: form.city.trim(),
      area: form.area.trim(),
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
              <label>Country
                <input value={form.country} onChange={field('country')} disabled={!admin} placeholder="India" />
              </label>
              <label>State
                <input value={form.state} onChange={field('state')} disabled={!admin} placeholder="Maharashtra" />
              </label>
              <label>City
                <input value={form.city} onChange={field('city')} disabled={!admin} placeholder="Nagpur" />
              </label>
              <label>Area / Locality
                <input value={form.area} onChange={field('area')} disabled={!admin} placeholder="Sadar, Dharampeth…" />
              </label>
              <label className="col-span-2">Street / Building Address
                <input value={form.address} onChange={field('address')} disabled={!admin} placeholder="Shop no., building name, street" />
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
              {(() => {
                // Group by group_name
                const groups = []
                const seen = {}
                allCourses.forEach(c => {
                  const g = c.group_name || 'Other'
                  if (!seen[g]) { seen[g] = []; groups.push({ name: g, courses: seen[g] }) }
                  seen[g].push(c)
                })
                return groups.map(group => {
                  const allChecked = group.courses.every(c => registeredCourses.includes(c.id))
                  const someChecked = group.courses.some(c => registeredCourses.includes(c.id))
                  function toggleGroup() {
                    if (!admin) return
                    if (allChecked) {
                      setRegisteredCourses(prev => prev.filter(id => !group.courses.find(c => c.id === id)))
                    } else {
                      setRegisteredCourses(prev => [...new Set([...prev, ...group.courses.map(c => c.id)])])
                    }
                  }
                  return (
                    <div key={group.name} style={{ marginBottom: 14 }}>
                      {/* Group header with select-all toggle */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
                          onChange={toggleGroup}
                          disabled={!admin}
                          style={{ accentColor: 'var(--purple)', width: 14, height: 14, cursor: admin ? 'pointer' : 'default' }}
                        />
                        <span style={{ font: '600 12px var(--font)', color: 'var(--text)' }}>{group.name}</span>
                        <span style={{ font: '500 10px var(--mono)', color: 'var(--text3)', marginLeft: 'auto' }}>
                          {group.courses.filter(c => registeredCourses.includes(c.id)).length}/{group.courses.length}
                        </span>
                      </div>
                      {/* Individual course checkboxes */}
                      <div className="checkbox-grid" style={{ paddingLeft: 4 }}>
                        {group.courses.map(c => (
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
                  )
                })
              })()}
            </div>
          )}

          {tab === 'orders' && (
            <div className="tbl-scroll">
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
            </div>
          )}

          {tab === 'students' && (
            <div className="tbl-scroll">
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
            </div>
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
    name: '', email: '', phone: '',
    country: 'India', state: '', city: '', area: '', address: '',
    tier: 'UF', parent_id: '',
  })
  const [parentOptions, setParentOptions] = useState([])
  const [saving, setSaving] = useState(false)
  const [allCourses, setAllCourses] = useState([])

  useEffect(() => {
    sb.from('courses').select('id,name,group_name').order('group_name').order('name').then(({ data }) => setAllCourses(data || []))
  }, [])

  useEffect(() => {
    if (!form.tier) return
    const parentTier = form.tier === 'CF' ? 'SMF' : form.tier === 'UF' ? 'CF' : null
    if (!parentTier) { setParentOptions([]); return }
    sb.from('franchisees').select('id,business_name,city,state,country').eq('tier', parentTier).eq('status', 'active').order('business_name')
      .then(({ data }) => setParentOptions(data || []))
  }, [form.tier])

  function field(k) {
    return function (e) { setForm(f => ({ ...f, [k]: e.target.value })) }
  }

  async function save() {
    if (!form.name.trim() || !form.email.trim()) { showToast('Name and email are required', 'warn'); return }
    if ((form.tier === 'UF' || form.tier === 'CF') && !form.parent_id) {
      showToast(`Please select a parent ${form.tier === 'UF' ? 'CF' : 'SMF'}`, 'warn'); return
    }

    // Territory check — country-aware
    if (form.tier === 'SMF' || form.tier === 'CF') {
      const country = (form.country || 'India').trim()
      const isIndia = country.toLowerCase() === 'india'

      if (form.tier === 'SMF') {
        // India: 1 SMF per state. International: 1 SMF per country.
        if (isIndia && !form.state.trim()) { showToast('State is required for an Indian SMF', 'warn'); return }
        let dupQ = sb.from('franchisees').select('id,business_name').eq('tier', 'SMF').ilike('country', country).eq('status', 'active')
        if (isIndia) dupQ = dupQ.ilike('state', form.state.trim())
        const { data: existing } = await dupQ
        if (existing && existing.length > 0) {
          const territory = isIndia ? form.state.trim() : country
          showToast(`An active SMF already exists for ${territory}: ${existing[0].business_name}`, 'warn')
          return
        }
      } else { // CF
        if (!form.city.trim()) { showToast('City is required for CF', 'warn'); return }
        const { data: existing } = await sb.from('franchisees')
          .select('id,business_name').eq('tier', 'CF').ilike('country', country).ilike('city', form.city.trim()).eq('status', 'active')
        if (existing && existing.length > 0) {
          showToast(`An active CF already exists in ${form.city} (${country}): ${existing[0].business_name}`, 'warn')
          return
        }
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
        country: form.country.trim(),
        state: form.state.trim(),
        city: form.city.trim(),
        area: form.area.trim(),
        address: form.address.trim(),
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
      await sendWelcomeEmail(form.email.trim(), form.name.trim(), form.tier, tempPass)

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
                      {p.business_name} ({form.tier === 'CF' ? (p.state || p.country) : p.city}{p.country && p.country !== 'India' ? ' · ' + p.country : ''})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>Country
              <input value={form.country} onChange={field('country')} placeholder="India" />
            </label>
            <label>State
              <input value={form.state} onChange={field('state')} placeholder="Maharashtra" />
            </label>
            <label>City
              <input value={form.city} onChange={field('city')} placeholder="Nagpur" />
            </label>
            <label>Area / Locality
              <input value={form.area} onChange={field('area')} placeholder="Sadar, Dharampeth…" />
            </label>
            <label className="col-span-2">Street / Building Address
              <input value={form.address} onChange={field('address')} placeholder="Shop no., building name, street" />
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
      const courseResult = await sb.from('courses').select('id,name,group_name').order('group_name').order('name')
      if (courseResult.error) console.error('Courses load error:', courseResult.error)
      setAllCourses(courseResult.data || [])

      if (admin) {
        // Admin sees all franchisees
        const { data, error } = await sb.from('franchisees').select('*').order('business_name')
        if (error) console.error('Franchisees load error:', error)
        setFranchisees(data || [])
      } else {
        // SMF / CF: show full descendant tree (children + grandchildren)
        if (!currentFranchiseeId) { setLoading(false); return }
        const descendantIds = await getDescendantIds(currentFranchiseeId)
        if (descendantIds.length === 0) {
          setFranchisees([])
          setLoading(false)
          return
        }
        const { data, error } = await sb
          .from('franchisees')
          .select('*')
          .in('id', descendantIds)
          .order('tier')          // SMF → CF → UF grouping
          .order('business_name')
        if (error) console.error('Franchisees load error:', error)
        setFranchisees(data || [])
      }
      setLoading(false)
    }
    load()
  }, [admin, currentRole, currentFranchiseeId])

  const filtered = franchisees.filter(f => {
    const q = search.toLowerCase()
    return !q || f.business_name?.toLowerCase().includes(q) || f.city?.toLowerCase().includes(q) || f.state?.toLowerCase().includes(q) || f.country?.toLowerCase().includes(q)
  })

  function handleSaved(updated) {
    setFranchisees(fs => fs.map(f => f.id === updated.id ? { ...f, ...updated } : f))
    setSelected(s => s && s.id === updated.id ? { ...s, ...updated } : s)
  }

  function handleAdded(fr) {
    setFranchisees(fs => [...fs, fr].sort((a, b) => (a.business_name || '').localeCompare(b.business_name || '')))
    setShowAdd(false)
  }

  const [tierFilter, setTierFilter] = useState('all')

  const tierFiltered = filtered.filter(function (f) {
    if (tierFilter === 'all') return true
    return (f.tier || '').toLowerCase() === tierFilter
  })

  const counts = {
    all: filtered.length,
    smf: filtered.filter(function (f) { return f.tier === 'SMF' }).length,
    cf:  filtered.filter(function (f) { return f.tier === 'CF' }).length,
    uf:  filtered.filter(function (f) { return f.tier === 'UF' }).length,
  }

  // Avatar color by tier
  function tierColor(tier) {
    return { SMF: '#F59E0B', CF: '#16A34A', UF: '#2563EB' }[tier] || '#534AB7'
  }

  function frInitials(name) {
    return (name || '').split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()
  }

  return (
    <div className="pg">
      {/* Topbar */}
      <header className="tb">
        <div className="crumb">Operations <span className="sep">›</span> <b>Franchisees</b></div>
        <div className="tb-r">
          <input
            className="search tb-search"
            placeholder="Search by name, owner, or city…"
            value={search}
            onChange={function (e) { setSearch(e.target.value) }}
          />
          {admin && (
            <button className="btn btn-p" onClick={() => setShowAdd(true)}>+ Add Franchisee</button>
          )}
        </div>
      </header>

      <div className="content">
        {/* Page header */}
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>Network</div>
            <h1 className="ph-title">Franchisees</h1>
            <div className="ph-sub">
              <b>{franchisees.length} partner{franchisees.length !== 1 ? 's' : ''}</b> in your network.
              Organised by tier: SMF · CF · UF.
            </div>
          </div>
        </div>

        {/* Mini stats */}
        <div className="mini-stats">
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--purple-bg)' }}>🏢</div>
            <div className="mini-num">{franchisees.length}</div>
            <div className="mini-lbl">Total partners</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--sun-bg)' }}>🌟</div>
            <div className="mini-num">{counts.smf}</div>
            <div className="mini-lbl">SMF · State Master</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--green-bg)' }}>🏙️</div>
            <div className="mini-num">{counts.cf}</div>
            <div className="mini-lbl">CF · City</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--blue-bg)' }}>📍</div>
            <div className="mini-num">{counts.uf}</div>
            <div className="mini-lbl">UF · Urban</div>
          </div>
        </div>

        {/* Toolbar with search + tier filter */}
        <div className="fr-toolbar">
          <input
            className="fr-search"
            placeholder="Search by business name, city…"
            value={search}
            onChange={function (e) { setSearch(e.target.value) }}
          />
          <div className="fr-tabs">
            {[
              { id: 'all', l: 'All' },
              { id: 'smf', l: 'SMF' },
              { id: 'cf',  l: 'CF'  },
              { id: 'uf',  l: 'UF'  },
            ].map(function (t) {
              return (
                <button
                  key={t.id}
                  className={'fr-tab ' + (tierFilter === t.id ? 'on' : '')}
                  onClick={function () { setTierFilter(t.id) }}
                >
                  {t.l} <span className="ct">{counts[t.id]}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Franchisee cards grid */}
        {loading ? (
          <div className="loading"><span className="spinner" />Loading…</div>
        ) : tierFiltered.length === 0 ? (
          <div className="empty">No franchisees found.</div>
        ) : (
          <div className="fr-grid">
            {tierFiltered.map(function (f) {
              const tier = (f.tier || 'UF').toLowerCase()
              return (
                <div key={f.id} className={'fr-card ' + tier} onClick={function () { setSelected(f) }}>
                  <div className="fr-head">
                    <div className="fr-av" style={{ background: tierColor(f.tier) }}>
                      {frInitials(f.business_name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="fr-name">{f.business_name}</div>
                      <div className="fr-loc">{[f.city, f.state, f.country && f.country !== 'India' ? f.country : null].filter(Boolean).join(' · ')}</div>
                      <div className="fr-badge-row">
                        <TierBadge tier={f.tier} />
                        {f.phone && <span style={{ font: '500 10px var(--mono)', color: 'var(--text3)' }}>{f.phone}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="fr-stat-row">
                    <div className="fr-stat">
                      <div className="fr-stat-num">{f.fee_paid > 0 ? '₹' + fmtAmt(f.fee_paid) : '—'}</div>
                      <div className="fr-stat-lbl">Fee paid</div>
                    </div>
                    <div className="fr-stat">
                      <div className="fr-stat-num">{(f.registered_courses || []).length}</div>
                      <div className="fr-stat-lbl">Courses</div>
                    </div>
                    <div className="fr-stat">
                      <div className="fr-stat-num">{f.status || '—'}</div>
                      <div className="fr-stat-lbl">Status</div>
                    </div>
                  </div>
                  <div className="fr-card-foot">
                    <div className="fr-since">{f.city || f.state || '—'}</div>
                    <div className={'fr-active ' + (f.status !== 'active' ? 'fr-dormant' : '')}>
                      <span className="d"></span>{f.status === 'active' ? 'Active' : (f.status || 'Unknown')}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

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

