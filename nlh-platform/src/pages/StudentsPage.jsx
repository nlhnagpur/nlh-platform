import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast } from '../utils'
import { isAdminRole } from '../constants/roles'
import { getDescendantIds, getTreeIds } from '../utils/hierarchy'
import { sendWelcomeEmail } from '../services/email'

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
    address: student.address || '',
    payment_status: student.payment_status || '',
    fee_total: student.fee_total ?? '',
    fee_paid: student.fee_paid ?? '',
  })
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
      address: form.address.trim(),
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
            <label className="col-span-2">Address
              <input value={form.address} onChange={field('address')} disabled={!admin} />
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
              <table className="tbl" style={{ marginTop: 8 }}>
                <thead>
                  <tr><th>Course</th><th>Level / SKU</th></tr>
                </thead>
                <tbody>
                  {enrollments.map(en => (
                    <tr key={en.id}>
                      <td>{en.skus?.courses?.name || '—'}</td>
                      <td>{en.skus?.level_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

function AddStudentModal({ onClose, onSaved }) {
  const { currentRole, currentFranchiseeId } = useAuth()
  const admin = isAdminRole(currentRole)
  const isMasterFr = currentRole === 'smf' || currentRole === 'cf'

  const [form, setForm] = useState({
    full_name: '', parent_name: '', dob: '', phone: '', address: '',
    // SMF/CF default to themselves as the centre; UF defaults to self too
    franchisee_id: admin ? '' : (currentFranchiseeId || ''),
  })
  const [centreList, setCentreList] = useState([])
  const [skusByCourse, setSkusByCourse] = useState([])
  const [selectedSkus, setSelectedSkus] = useState([])
  const [feeTotal, setFeeTotal] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Load centre options for dropdown
    async function loadCentres() {
      if (admin) {
        // Admin sees all UFs
        const { data } = await sb.from('franchisees').select('id,business_name,city,tier').eq('tier', 'UF').eq('status', 'active').order('business_name')
        setCentreList(data || [])
      } else if (isMasterFr) {
        // SMF/CF: show self + all UF descendants
        const descendantIds = await getDescendantIds(currentFranchiseeId)
        const [selfRes, descRes] = await Promise.all([
          sb.from('franchisees').select('id,business_name,city,tier').eq('id', currentFranchiseeId).single(),
          descendantIds.length > 0
            ? sb.from('franchisees').select('id,business_name,city,tier').in('id', descendantIds).eq('status', 'active').order('business_name')
            : { data: [] },
        ])
        const self = selfRes.data ? [selfRes.data] : []
        const ufDescendants = (descRes.data || []).filter(f => f.tier === 'UF')
        setCentreList([...self, ...ufDescendants])
      }
      // UF: no dropdown needed — form.franchisee_id is fixed to their own id
    }
    loadCentres()

    // Load all SKUs grouped by course
    sb.from('skus').select('id,level_name,student_fee,course_id,courses(id,name,group_name)').order('course_id').order('sort_order')
      .then(({ data }) => {
        if (!data) return
        const grouped = []
        const seen = {}
        data.forEach(sku => {
          const cid = sku.course_id
          if (!seen[cid]) {
            seen[cid] = true
            grouped.push({ course: sku.courses, skus: [] })
          }
          grouped[grouped.length - 1].skus.push(sku)
        })
        setSkusByCourse(grouped)
      })
  }, [])

  function field(k) {
    return function (e) { setForm(f => ({ ...f, [k]: e.target.value })) }
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
    if (!form.franchisee_id) { showToast('Please select a centre (UF)', 'warn'); return }

    setSaving(true)
    const tempPass = genTempPass()

    try {
      // Insert student
      const { data: st, error: stErr } = await sb.from('students').insert({
        full_name: form.full_name.trim(),
        parent_name: form.parent_name.trim(),
        dob: form.dob || null,
        phone: form.phone.trim(),
        address: form.address.trim(),
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
            options: { data: { full_name: form.name.trim() } },
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

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="ch">
          <span>Add Student</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div >
          <div className="form-grid">
            <label>Student Name *
              <input value={form.full_name} onChange={field('full_name')} placeholder="Full name" />
            </label>
            <label>Parent / Guardian
              <input value={form.parent_name} onChange={field('parent_name')} placeholder="Parent name" />
            </label>
            <label>Date of Birth
              <input type="date" value={form.dob} onChange={field('dob')} />
            </label>
            <label>Phone
              <input value={form.phone} onChange={field('phone')} placeholder="10-digit mobile" />
            </label>
            <label className="col-span-2">Address
              <input value={form.address} onChange={field('address')} placeholder="Home address" />
            </label>
            <label className="col-span-2">
              Centre *
              {/* Admin or SMF/CF: show dropdown; UF: fixed to own centre */}
              {(admin || isMasterFr) ? (
                <select value={form.franchisee_id} onChange={field('franchisee_id')}>
                  <option value="">— Select Centre —</option>
                  {centreList.map(c => (
                    <option key={c.id} value={c.id}>
                      [{c.tier}] {c.business_name}{c.city ? ' (' + c.city + ')' : ''}
                      {c.id === currentFranchiseeId && isMasterFr ? ' — your centre' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={form.franchisee_id ? 'Your centre' : '—'} disabled />
              )}
            </label>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 16 }}>
            <strong>Course Enrolment</strong>
            <p className="hint">Select SKU levels to enrol. Student fee is calculated automatically.</p>
            {skusByCourse.map(group => (
              <div key={group.course?.id} style={{ marginBottom: 12 }}>
                <div className="course-group-header">{group.course?.name}</div>
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

          {feeTotal > 0 && (
            <div className="fee-summary" style={{ marginTop: 12 }}>
              <strong>Total Fee: ₹{fmtAmt(feeTotal)}</strong>
            </div>
          )}
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
        .select('*, enrollments(id, sku_id, skus(level_name, courses(name)))')
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

  return (
    <div className="pg">
      <div className="topbar">
        <h1>Students</h1>
        <div style={{display:"flex",gap:8}}>
          <input
            className="search-inp"
            placeholder="Search name / parent / phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="btn-p" onClick={() => setShowAdd(true)}>
            + Add Student
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading students…</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Parent</th>
              <th>Courses Enrolled</th>
              <th>Fee Total</th>
              <th>Fee Paid</th>
              <th>Balance</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="empty">No students found</td></tr>
            )}
            {filtered.map(s => {
              const balance = (s.fee_total || 0) - (s.fee_paid || 0)
              const courseNames = [...new Set((s.enrollments || []).map(e => e.skus?.courses?.name).filter(Boolean))]
              return (
                <tr key={s.id} style={{cursor:"pointer"}} onClick={() => setSelected(s)}>
                  <td><strong>{s.full_name}</strong></td>
                  <td>{s.parent_name || '—'}</td>
                  <td>
                    {courseNames.length === 0
                      ? <span style={{color:'var(--text3)'}}>None</span>
                      : courseNames.map(cn => (
                          <span key={cn} style={{
                            display:'inline-block', background:'var(--bg3)',
                            border:'1px solid var(--border)', borderRadius:20,
                            fontSize:10, padding:'1px 8px', marginRight:3,
                            fontFamily:'var(--mono)'
                          }}>{cn}</span>
                        ))
                    }
                  </td>
                  <td>₹{fmtAmt(s.fee_total)}</td>
                  <td>₹{fmtAmt(s.fee_paid)}</td>
                  <td style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}>₹{fmtAmt(balance)}</td>
                  <td><StatusBadge status={s.payment_status} /></td>
                  <td>
                    <button className="btn-s btn-sm" onClick={e => { e.stopPropagation(); setSelected(s) }}>
                      View
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

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
