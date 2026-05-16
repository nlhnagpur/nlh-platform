import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast } from '../utils'
import { isAdminRole } from '../constants/roles'
import { getDescendantIds, getTreeIds } from '../utils/hierarchy'
import { sendWelcomeEmail } from '../services/email'
import StudentCertModal from '../components/StudentCertModal'

// ── helpers ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase()
  const map = { active: 'ba', inactive: 'bd', pending: 'bp' }
  return <span className={`badge ${map[s] || 'br'}`}>{status || '—'}</span>
}

function genTempPass() {
  return 'NLH@' + Math.random().toString(36).slice(2, 8).toUpperCase()
}

// ── StudentDetailModal ─────────────────────────────────────────────────────────

function StudentDetailModal({ student, onClose, onSaved }) {
  const { currentRole } = useAuth()
  const admin = isAdminRole(currentRole)

  const [form, setForm] = useState({
    full_name: student.full_name || '',
    parent_name: student.parent_name || '',
    dob: student.dob || '',
    phone: student.phone || '',
    email: student.email || '',
    pincode: student.pincode || '',
    country: student.country || 'India',
    state: student.state || '',
    city: student.city || '',
    area: student.area || '',
    address: student.address || '',
    channel: student.channel || 'walk-in',
    payment_status: student.payment_status || '',
    fee_total: student.fee_total ?? '',
    fee_paid: student.fee_paid ?? '',
  })
  const [certModal, setCertModal] = useState(null)   // { enrollment, centre } | null
  const [centreCache, setCentreCache] = useState(null)
  const [saving, setSaving] = useState(false)

  function field(k) {
    return function (e) { setForm(f => ({ ...f, [k]: e.target.value })) }
  }

  const balance = (Number(form.fee_total) || 0) - (Number(form.fee_paid) || 0)

  const enrollments = student.enrollments || []

  async function save() {
    setSaving(true)
    const payload = {
      full_name: form.full_name.trim(),
      parent_name: form.parent_name.trim(),
      dob: form.dob || null,
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      pincode: form.pincode.trim() || null,
      country: form.country.trim(),
      state: form.state.trim(),
      city: form.city.trim(),
      area: form.area.trim(),
      address: form.address.trim(),
      channel: form.channel || 'walk-in',
      fee_total: form.fee_total === '' ? null : Number(form.fee_total),
      fee_paid: form.fee_paid === '' ? null : Number(form.fee_paid),
    }
    const { error } = await sb.from('students').update(payload).eq('id', student.id)
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    showToast('Saved')
    onSaved({ ...student, ...payload })
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="ch">
          <span>{student.full_name}</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div >
          <div className="form-grid">
            <label>Student Name *
              <input value={form.full_name} onChange={field('full_name')} disabled={!admin} />
            </label>
            <label>Parent / Guardian
              <input value={form.parent_name} onChange={field('parent_name')} disabled={!admin} />
            </label>
            <label>Date of Birth
              <input type="date" value={form.dob} onChange={field('dob')} disabled={!admin} />
            </label>
            <label>Phone
              <input value={form.phone} onChange={field('phone')} disabled={!admin} />
            </label>
            <label>Parent Email
              <input type="email" value={form.email} onChange={field('email')} disabled={!admin} placeholder="parent@email.com" />
            </label>
            <label>PIN Code
              <input value={form.pincode} onChange={field('pincode')} disabled={!admin} placeholder="e.g. 440001" />
            </label>
            <label>City
              <input value={form.city} onChange={field('city')} disabled={!admin} placeholder="Nagpur" />
            </label>
            <label>Area / Locality
              <input value={form.area} onChange={field('area')} disabled={!admin} placeholder="Neighbourhood / Area" />
            </label>
            <label>State
              <input value={form.state} onChange={field('state')} disabled={!admin} placeholder="Maharashtra" />
            </label>
            <label>Country
              <input value={form.country} onChange={field('country')} disabled={!admin} placeholder="India" />
            </label>
            <label className="col-span-2">Street / Building Address
              <input value={form.address} onChange={field('address')} disabled={!admin} placeholder="Flat/Shop no., building, street" />
            </label>
            <label>Channel
              <select value={form.channel} onChange={field('channel')} disabled={!admin}>
                <option value="walk-in">Walk-in</option>
                <option value="referral">Referral</option>
                <option value="online">Online</option>
                <option value="camp">Camp / Event</option>
                <option value="school">School tie-up</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>Payment Status
              <select value={form.payment_status} onChange={field('payment_status')} disabled={!admin}>
                <option value="">—</option>
                <option value="pending">Pending</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 16 }}>
            <strong>Fee Tracking</strong>
            <div className="form-grid" style={{ marginTop: 8 }}>
              <label>Fee Total (₹)
                <input type="number" value={form.fee_total} onChange={field('fee_total')} disabled={!admin} />
              </label>
              <label>Fee Paid (₹)
                <input type="number" value={form.fee_paid} onChange={field('fee_paid')} disabled={!admin} />
              </label>
              <label>Balance
                <input
                  value={'₹' + fmtAmt(balance)}
                  disabled
                  style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}
                />
              </label>
            </div>
          </div>

          {enrollments.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 16 }}>
              <strong>Enrolled Courses</strong>
              <div className="tbl-scroll">
              <table className="tbl" style={{ marginTop: 8, minWidth: 420 }}>
                <thead>
                  <tr><th>Course</th><th>Level / SKU</th><th>Certificate</th></tr>
                </thead>
                <tbody>
                  {enrollments.map(en => (
                    <tr key={en.id}>
                      <td>{en.skus?.courses?.group_name || '—'}</td>
                      <td>{en.skus?.level_name || '—'}</td>
                      <td>
                        <button
                          className="btn-s"
                          style={{ padding: '3px 10px', fontSize: 11 }}
                          onClick={async function () {
                            // fetch centre if not cached
                            let centre = centreCache
                            if (!centre && student.franchisee_id) {
                              const { data } = await sb.from('franchisees')
                                .select('id,business_name,city,area,country,tier').eq('id', student.franchisee_id).single()
                              centre = data || null
                              setCentreCache(centre)
                            }
                            setCertModal({ enrollment: en, centre })
                          }}
                        >
                          {en.cert_emailed_at ? '🎓 Re-issue' : '🎓 Certificate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Certificate modal — rendered inside StudentDetailModal */}
          {certModal && (
            <StudentCertModal
              student={{ ...student, ...form }}
              enrollment={certModal.enrollment}
              centre={certModal.centre}
              onClose={() => setCertModal(null)}
            />
          )}
        </div>

        {admin && (
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

// ── AddStudentModal ────────────────────────────────────────────────────────────

// Tiers that can operate as student-enrolment centres
const CENTRE_TIERS = ['UF', 'CF', 'SMF', 'NLH']

// Derive the SKU filter for a given franchisee record.
// Returns:
//   null            — no centre selected; show nothing
//   'all'           — unrestricted centre (NLH HO, CF/SMF with no explicit list)
//   { skuIds }      — filter to specific SKU IDs
//   { courseIds }   — filter to specific course IDs
function deriveFilter(fr) {
  if (!fr) return null
  const skus    = fr.registered_skus    || []
  const courses = fr.registered_courses || []
  if (skus.length > 0)    return { skuIds: skus }
  if (courses.length > 0) return { courseIds: courses }
  // UF with nothing registered = no courses approved yet; NLH / CF / SMF = unrestricted
  if (fr.tier === 'UF') return { skuIds: [] }
  return 'all'
}

function AddStudentModal({ onClose, onSaved }) {
  const { currentRole, currentFranchiseeId } = useAuth()
  const admin = isAdminRole(currentRole)
  const isMasterFr = currentRole === 'smf' || currentRole === 'cf'

  const [form, setForm] = useState({
    full_name: '', parent_name: '', dob: '', phone: '', email: '',
    pincode: '', city: '', area: '', state: '', country: 'India', address: '',
    channel: 'walk-in',
    franchisee_id: admin ? '' : (currentFranchiseeId || ''),
  })
  const [showAddress, setShowAddress] = useState(false)
  const [centreList, setCentreList] = useState([])
  const [allSkus, setAllSkus] = useState([])
  // null = no centre chosen yet; 'all' = show everything; {skuIds} or {courseIds} = filtered
  const [regFilter, setRegFilter] = useState(null)
  const [selectedSkus, setSelectedSkus] = useState([])
  const [feeTotal, setFeeTotal] = useState(0)
  const [saving, setSaving] = useState(false)

  const FR_FIELDS = 'id,business_name,city,area,country,tier,registered_courses,registered_skus'

  useEffect(() => {
    async function loadCentres() {
      if (admin) {
        // Admin sees all active centres across every tier
        const { data } = await sb.from('franchisees')
          .select(FR_FIELDS)
          .in('tier', CENTRE_TIERS)
          .eq('status', 'active')
          .order('tier').order('business_name')
        setCentreList(data || [])
      } else if (isMasterFr) {
        // SMF: self + CF children + UF grandchildren
        // CF:  self + UF children
        const descendantIds = await getDescendantIds(currentFranchiseeId)
        const [selfRes, descRes] = await Promise.all([
          sb.from('franchisees').select(FR_FIELDS).eq('id', currentFranchiseeId).single(),
          descendantIds.length > 0
            ? sb.from('franchisees').select(FR_FIELDS).in('id', descendantIds).eq('status', 'active').order('business_name')
            : { data: [] },
        ])
        const self = selfRes.data ? [selfRes.data] : []
        // Include ALL descendant tiers (CF + UF), not just UF
        const descendants = (descRes.data || []).filter(f => CENTRE_TIERS.includes(f.tier))
        setCentreList([...self, ...descendants])
      } else {
        // UF: fixed to their own centre — load their SKU filter immediately
        const { data } = await sb.from('franchisees')
          .select('id,business_name,tier,registered_courses,registered_skus').eq('id', currentFranchiseeId).single()
        if (data) setCentreList([data])
        setRegFilter(deriveFilter(data))
      }
    }
    loadCentres()

    // Load all SKUs once, sorted by curriculum order
    sb.from('skus').select('id,level_name,student_fee,course_id,courses(group_name)').order('sort_order')
      .then(({ data }) => { setAllSkus(data || []) })
  }, [])

  // Build filtered + grouped SKU list for display
  function buildGroups() {
    if (!regFilter) return []
    let filtered
    if (regFilter === 'all') {
      filtered = allSkus
    } else if (regFilter.skuIds) {
      filtered = allSkus.filter(s => regFilter.skuIds.includes(s.id))
    } else if (regFilter.courseIds) {
      filtered = allSkus.filter(s => regFilter.courseIds.includes(s.course_id))
    } else {
      filtered = []
    }
    const map = {}
    filtered.forEach(function (sku) {
      const g = sku.courses?.group_name || 'Other'
      if (!map[g]) map[g] = []
      map[g].push(sku)
    })
    return Object.entries(map).map(function ([name, skus]) { return { name, skus } })
  }

  function field(k) {
    return function (e) { setForm(f => ({ ...f, [k]: e.target.value })) }
  }

  function handleCentreChange(fid) {
    setForm(f => ({ ...f, franchisee_id: fid }))
    setSelectedSkus([])
    setFeeTotal(0)
    if (!fid) { setRegFilter(null); return }
    const fr = centreList.find(function (c) { return c.id === fid })
    setRegFilter(deriveFilter(fr))
  }

  function toggleSku(sku) {
    setSelectedSkus(prev => {
      const exists = prev.find(s => s.id === sku.id)
      const next = exists ? prev.filter(s => s.id !== sku.id) : [...prev, sku]
      setFeeTotal(next.reduce((sum, s) => sum + (s.student_fee || 0), 0))
      return next
    })
  }

  async function save() {
    if (!form.full_name.trim()) { showToast('Student name is required', 'warn'); return }
    if (!form.franchisee_id) { showToast('Please select a centre', 'warn'); return }

    setSaving(true)
    const tempPass = genTempPass()

    try {
      // Insert student
      const { data: st, error: stErr } = await sb.from('students').insert({
        full_name: form.full_name.trim(),
        parent_name: form.parent_name.trim(),
        dob: form.dob || null,
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        pincode: form.pincode.trim() || null,
        city: form.city.trim(),
        area: form.area.trim(),
        state: form.state.trim(),
        country: form.country.trim(),
        address: form.address.trim(),
        channel: form.channel || 'walk-in',
        franchisee_id: form.franchisee_id,
        is_active: true,
        fee_total: feeTotal,
        fee_paid: 0,
        payment_status: feeTotal > 0 ? 'pending' : 'none',
      }).select().single()

      if (stErr) { showToast('Failed to create student: ' + stErr.message, 'err'); setSaving(false); return }

      // Insert enrollments
      if (selectedSkus.length > 0) {
        const enrollRows = selectedSkus.map(sku => ({
          student_id: st.id,
          sku_id: sku.id,
          franchisee_id: form.franchisee_id,
        }))
        await sb.from('enrollments').insert(enrollRows)
      }

      // Admin session restore hack for auth account creation
      if (form.phone) {
        const loginEmail = `student.${st.id}@nlhnagpur.info`
        try {
          const { data: admSess } = await sb.auth.getSession()
          await sb.auth.signUp({
            email: loginEmail,
            password: tempPass,
            options: { data: { full_name: form.full_name.trim() } },
          })
          await sb.auth.setSession({
            access_token: admSess.session.access_token,
            refresh_token: admSess.session.refresh_token,
          })
          await sb.from('users').upsert({
            email: loginEmail,
            full_name: form.full_name.trim(),
            role: 'student',
            franchisee_id: form.franchisee_id,
            student_id: st.id,
          }, { onConflict: 'email' })
        } catch (authErr) {
          console.warn('Student auth account skipped:', authErr.message)
        }
      }

      showToast('Student added successfully')
      onSaved(st)
    } catch (err) {
      showToast('Unexpected error: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  const groups = buildGroups()

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580 }}>
        <div className="ch">
          <span>➕ Add Student</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div>
          {/* ── Section 1: Student basics ── */}
          <div className="form-grid">
            <label>Student Name *
              <input value={form.full_name} onChange={field('full_name')} placeholder="Full name" autoFocus />
            </label>
            <label>Phone
              <input value={form.phone} onChange={field('phone')} placeholder="Parent / guardian mobile" />
            </label>
            <label>Parent / Guardian
              <input value={form.parent_name} onChange={field('parent_name')} placeholder="Parent name" />
            </label>
            <label>Date of Birth
              <input type="date" value={form.dob} onChange={field('dob')} />
            </label>
          </div>

          {/* ── Section 2: Centre ── */}
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, marginTop:12 }}>
            <div style={{ font:'600 12px var(--font)', color:'var(--text)', marginBottom:8 }}>
              Enrolment Centre *
            </div>
            {(admin || isMasterFr) ? (() => {
              const nlhCentre = centreList.find(c => c.tier === 'NLH')
              const otherCentres = centreList.filter(c => c.tier !== 'NLH')
              return (
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  <select
                    value={form.franchisee_id}
                    onChange={e => handleCentreChange(e.target.value)}
                    style={{ fontSize:13 }}
                  >
                    <option value="">— Select centre —</option>
                    {otherCentres.map(c => (
                      <option key={c.id} value={c.id}>
                        [{c.tier}] {c.business_name}{c.city ? ` · ${c.city}` : ''}{c.area ? ` — ${c.area}` : ''}
                      </option>
                    ))}
                    {nlhCentre && <option value={nlhCentre.id}>🏛️ NLH Head Office</option>}
                  </select>
                </div>
              )
            })() : (
              <div style={{ padding:'8px 12px', borderRadius:8, background:'var(--purple-bg)',
                border:'1.5px solid var(--purple)', font:'600 12.5px var(--font)', color:'var(--text)' }}>
                {centreList[0]?.business_name || 'Your centre'}
              </div>
            )}
          </div>

          {/* ── Section 3: Course enrolment ── */}
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, marginTop:12 }}>
            <div style={{ font:'600 12px var(--font)', color:'var(--text)', marginBottom:4 }}>
              Courses &amp; Levels
              {feeTotal > 0 && (
                <span style={{ float:'right', color:'var(--purple)', fontSize:13 }}>
                  Total: ₹{fmtAmt(feeTotal)}
                </span>
              )}
            </div>
            {!regFilter ? (
              <p className="hint">Select a centre above to see available courses.</p>
            ) : groups.length === 0 ? (
              <p className="hint" style={{ color:'var(--red)' }}>No courses registered for this centre yet.</p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10, marginTop:8 }}>
                {groups.map(group => (
                  <div key={group.name}>
                    <div style={{ font:'600 11px var(--mono)', color:'var(--text3)', textTransform:'uppercase',
                      letterSpacing:'0.5px', marginBottom:4 }}>
                      {group.name}
                    </div>
                    <div className="checkbox-grid">
                      {group.skus.map(sku => {
                        const checked = selectedSkus.some(s => s.id === sku.id)
                        return (
                          <label key={sku.id} className="checkbox-item">
                            <input type="checkbox" checked={checked} onChange={() => toggleSku(sku)} />
                            {sku.level_name}
                            {sku.student_fee ? <span className="hint"> ₹{fmtAmt(sku.student_fee)}</span> : null}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Section 4: Address & extras (collapsible) ── */}
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:10, marginTop:12 }}>
            <button
              type="button"
              onClick={() => setShowAddress(a => !a)}
              style={{ background:'none', border:'none', cursor:'pointer', padding:0,
                font:'500 12px var(--font)', color:'var(--text3)', display:'flex', alignItems:'center', gap:6 }}
            >
              <span style={{ fontSize:10 }}>{showAddress ? '▾' : '▸'}</span>
              {showAddress ? 'Hide' : 'Add'} address, email &amp; channel
              <span style={{ font:'500 10px var(--mono)', color:'var(--text3)', marginLeft:4 }}>(optional)</span>
            </button>

            {showAddress && (
              <div className="form-grid" style={{ marginTop:10 }}>
                <label>Parent Email
                  <input type="email" value={form.email} onChange={field('email')} placeholder="parent@email.com" />
                </label>
                <label>PIN Code
                  <input value={form.pincode} onChange={field('pincode')} placeholder="e.g. 440001" />
                </label>
                <label>City
                  <input value={form.city} onChange={field('city')} placeholder="Nagpur" />
                </label>
                <label>Area / Locality
                  <input value={form.area} onChange={field('area')} placeholder="Sadar, Dharampeth…" />
                </label>
                <label>State
                  <input value={form.state} onChange={field('state')} placeholder="Maharashtra" />
                </label>
                <label>Country
                  <input value={form.country} onChange={field('country')} placeholder="India" />
                </label>
                <label className="col-span-2">Street / Building Address
                  <input value={form.address} onChange={field('address')} placeholder="Flat/Shop no., building, street" />
                </label>
                <label>How did they find us?
                  <select value={form.channel} onChange={field('channel')}>
                    <option value="walk-in">Walk-in</option>
                    <option value="referral">Referral</option>
                    <option value="online">Online</option>
                    <option value="camp">Camp / Event</option>
                    <option value="school">School tie-up</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>
            {saving ? 'Adding…' : 'Add Student'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── StudentsPage ───────────────────────────────────────────────────────────────

export default function StudentsPage() {
  const { currentRole, currentFranchiseeId } = useAuth()
  const admin = isAdminRole(currentRole)

  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    if (currentRole === null) return   // wait for auth to resolve
    async function load() {
      setLoading(true)
      let q = sb.from('students')
        .select('*, enrollments(id, sku_id, cert_emailed_at, skus(level_name, courses(group_name)))')
        .order('full_name')

      if (admin) {
        // Admin sees all students — no filter
      } else if (currentRole === 'smf' || currentRole === 'cf') {
        // SMF / CF sees students from self + all sub-franchisees
        if (!currentFranchiseeId) { setLoading(false); return }
        const treeIds = await getTreeIds(currentFranchiseeId)
        q = q.in('franchisee_id', treeIds.length > 0 ? treeIds : [currentFranchiseeId])
      } else {
        // UF sees only own students
        if (!currentFranchiseeId) { setLoading(false); return }
        q = q.eq('franchisee_id', currentFranchiseeId)
      }

      const { data, error } = await q
      if (error) { console.error('Students load error:', error); showToast('Failed to load students: ' + error.message, 'err') }
      setStudents(data || [])
      setLoading(false)
    }
    load()
  }, [admin, currentRole, currentFranchiseeId])

  const filtered = students.filter(s => {
    const q = search.toLowerCase()
    return !q || s.full_name?.toLowerCase().includes(q) || s.parent_name?.toLowerCase().includes(q) || s.phone?.includes(q)
  })

  function handleSaved(updated) {
    setStudents(ss => ss.map(s => s.id === updated.id ? { ...s, ...updated } : s))
    setSelected(s => s && s.id === updated.id ? { ...s, ...updated } : s)
  }

  function handleAdded(st) {
    setStudents(ss => [...ss, { ...st, enrollments: [] }].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')))
    setShowAdd(false)
  }

  // Tone index per course name (cycle through 8 tones)
  const courseList = [...new Set(students.flatMap(s => (s.enrollments || []).map(e => e.skus?.courses?.group_name).filter(Boolean)))]
  function courseTone(name) {
    const idx = courseList.indexOf(name)
    return (idx % 8) + 1
  }

  return (
    <div className="pg">
      {/* Topbar */}
      <header className="tb">
        <div className="crumb">Operations <span className="sep">›</span> <b>Students</b></div>
        <div className="tb-r">
          <input
            className="search tb-search"
            placeholder="Search students by name or parent…"
            value={search}
            onChange={function (e) { setSearch(e.target.value) }}
          />
          <button className="btn btn-p" onClick={() => setShowAdd(true)}>+ Enrol Student</button>
        </div>
      </header>

      <div className="content">
        {/* Page header */}
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>Enrollment</div>
            <h1 className="ph-title">Students</h1>
            <div className="ph-sub">
              <b>{students.length} students</b> enrolled across all centres.
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mini-stats">
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--purple-bg)' }}>🎓</div>
            <div className="mini-num">{students.length}</div>
            <div className="mini-lbl">Total enrolled</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--sun-bg)' }}>📚</div>
            <div className="mini-num">{courseList.length}</div>
            <div className="mini-lbl">Programs offered</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--green-bg)' }}>✅</div>
            <div className="mini-num">{students.filter(s => s.payment_status === 'paid').length}</div>
            <div className="mini-lbl">Fee paid</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--red-bg)' }}>⏳</div>
            <div className="mini-num">{students.filter(s => s.payment_status === 'pending').length}</div>
            <div className="mini-lbl">Fee pending</div>
          </div>
        </div>

        {/* Students table */}
        {loading ? (
          <div className="loading">Loading students…</div>
        ) : (
          <div className="card tbl-scroll" style={{ marginBottom: 0 }}>
            <table className="big-tbl">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Parent</th>
                  <th>Courses</th>
                  <th style={{ textAlign: 'right' }}>Fee Total</th>
                  <th style={{ textAlign: 'right' }}>Fee Paid</th>
                  <th style={{ textAlign: 'right' }}>Balance</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="empty">No students found</td></tr>
                )}
                {filtered.map(function (s) {
                  const balance = (s.fee_total || 0) - (s.fee_paid || 0)
                  const courseNames = [...new Set((s.enrollments || []).map(e => e.skus?.courses?.group_name).filter(Boolean))]
                  return (
                    <tr key={s.id} style={{ cursor: 'pointer' }} onClick={function () { setSelected(s) }}>
                      <td>
                        <div className="placer-cell">
                          <div className="placer-av" style={{ background: 'var(--purple)' }}>
                            {(s.full_name || '').split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="placer-name">{s.full_name}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ color: 'var(--text2)' }}>{s.parent_name || '—'}</td>
                      <td>
                        {courseNames.length === 0
                          ? <span style={{ color: 'var(--text3)' }}>None</span>
                          : courseNames.map(function (cn) {
                            return (
                              <span key={cn} className={'stu-chip stu-chip-' + courseTone(cn)}>{cn}</span>
                            )
                          })
                        }
                      </td>
                      <td style={{ textAlign: 'right' }}><div className="amt">₹{fmtAmt(s.fee_total)}</div></td>
                      <td style={{ textAlign: 'right' }}><div className="amt" style={{ color: 'var(--green)' }}>₹{fmtAmt(s.fee_paid)}</div></td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="amt" style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}>₹{fmtAmt(balance)}</div>
                      </td>
                      <td><StatusBadge status={s.payment_status} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="row-action" onClick={function (e) { e.stopPropagation(); setSelected(s) }}>View</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <StudentDetailModal
          student={selected}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
        />
      )}

      {showAdd && (
        <AddStudentModal
          onClose={() => setShowAdd(false)}
          onSaved={handleAdded}
        />
      )}
    </div>
  )
}

