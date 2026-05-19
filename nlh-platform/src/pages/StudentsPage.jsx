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

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ── StudentDetailModal ─────────────────────────────────────────────────────────

function StudentDetailModal({ student, onClose, onSaved }) {
  const { currentRole } = useAuth()
  const admin = isAdminRole(currentRole)

  const [tab, setTab] = useState('profile')

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
    channel: student.channel || 'franchise',
    payment_status: student.payment_status || '',
    fee_total: student.fee_total ?? '',
    fee_paid: student.fee_paid ?? '',
  })
  const [certModal,   setCertModal]   = useState(null)
  const [centreCache, setCentreCache] = useState(null)
  const [saving,      setSaving]      = useState(false)

  // ── Courses / Batch state ──
  const [nlhCentreId,     setNlhCentreId]     = useState(null)
  const [batchAssignments,setBatchAssignments] = useState({})   // { [enrollment_id]: batch_student row }
  const [coursesLoaded,   setCoursesLoaded]   = useState(false)
  const [batchPanelEnrId, setBatchPanelEnrId] = useState(null)  // enrollment.id whose panel is open
  const [panelData,       setPanelData]       = useState({ batches: [], eligibleCIs: [], loading: false })
  const [showNewBatch,    setShowNewBatch]    = useState(false)
  const [newBatchCI,      setNewBatchCI]      = useState('')
  const [newBatchForm,    setNewBatchForm]    = useState({ name: '', days: [], time: '', is_individual: false })
  const [panelSaving,     setPanelSaving]     = useState(false)

  function field(k) {
    return function (e) { setForm(function (f) { return { ...f, [k]: e.target.value } }) }
  }

  const balance     = (Number(form.fee_total) || 0) - (Number(form.fee_paid) || 0)
  const enrollments = student.enrollments || []

  async function save() {
    setSaving(true)
    const payload = {
      full_name:      form.full_name.trim(),
      parent_name:    form.parent_name.trim(),
      dob:            form.dob || null,
      phone:          form.phone.trim(),
      email:          form.email.trim() || null,
      pincode:        form.pincode.trim() || null,
      country:        form.country.trim(),
      state:          form.state.trim(),
      city:           form.city.trim(),
      area:           form.area.trim(),
      address:        form.address.trim(),
      channel:        form.channel || 'walk-in',
      fee_total:      form.fee_total === '' ? null : Number(form.fee_total),
      fee_paid:       form.fee_paid  === '' ? null : Number(form.fee_paid),
    }
    const { error } = await sb.from('students').update(payload).eq('id', student.id)
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    showToast('Saved')
    onSaved({ ...student, ...payload })
  }

  // ── Load courses tab ──
  async function loadCoursesTab() {
    if (coursesLoaded) return
    setCoursesLoaded(true)

    // Get NLH centre id
    let centreId = nlhCentreId
    if (!centreId) {
      const { data: nlh } = await sb.from('franchisees').select('id').eq('tier', 'NLH').single()
      centreId = nlh?.id || null
      setNlhCentreId(centreId)
    }

    // Load batch assignments for all enrollments of this student
    const enrIds = enrollments.map(function (e) { return e.id })
    if (!enrIds.length) return
    const { data: bsRows } = await sb.from('batch_students')
      .select('id, enrollment_id, assigned_at, batch_id, batches(id, name, sku_id, schedule_days, schedule_time, instructor_id, instructors(full_name))')
      .in('enrollment_id', enrIds)
      .is('removed_at', null)
    const map = {}
    ;(bsRows || []).forEach(function (bs) { map[bs.enrollment_id] = bs })
    setBatchAssignments(map)
  }

  // ── Open batch assignment panel for one enrollment ──
  async function openBatchPanel(enrollment) {
    if (batchPanelEnrId === enrollment.id) { setBatchPanelEnrId(null); return }
    setBatchPanelEnrId(enrollment.id)
    setShowNewBatch(false)
    setNewBatchCI('')
    setNewBatchForm({ name: '', days: [], time: '', is_individual: false })
    setPanelData({ batches: [], eligibleCIs: [], loading: true })

    const [{ data: batches }, { data: ciRows }] = await Promise.all([
      sb.from('batches')
        .select('id, name, schedule_days, schedule_time, is_individual, sessions_done, instructor_id, instructors(id, full_name)')
        .eq('sku_id', enrollment.sku_id)
        .eq('is_active', true)
        .order('created_at'),
      sb.from('instructor_courses')
        .select('instructor_id, instructors(id, full_name, status)')
        .eq('sku_id', enrollment.sku_id)
        .eq('status', 'active'),
    ])

    const eligibleCIs = (ciRows || [])
      .map(function (r) { return r.instructors })
      .filter(function (i) { return i && i.status === 'active' })
      // deduplicate by id
      .filter(function (i, idx, arr) { return arr.findIndex(function (x) { return x.id === i.id }) === idx })

    setPanelData({ batches: batches || [], eligibleCIs, loading: false })
  }

  // ── Assign student to an existing batch ──
  async function assignToBatch(batchId, enrollmentId) {
    setPanelSaving(true)
    // Remove from any existing batch first
    const existing = batchAssignments[enrollmentId]
    if (existing) {
      await sb.from('batch_students').update({ removed_at: new Date().toISOString() }).eq('id', existing.id)
    }
    const { data, error } = await sb.from('batch_students')
      .insert({ batch_id: batchId, enrollment_id: enrollmentId })
      .select('id, enrollment_id, assigned_at, batch_id, batches(id, name, sku_id, schedule_days, schedule_time, instructor_id, instructors(full_name))')
      .single()
    setPanelSaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    setBatchAssignments(function (prev) { return { ...prev, [enrollmentId]: data } })
    setBatchPanelEnrId(null)
    showToast('Assigned to batch ✓')
  }

  // ── Remove student from current batch ──
  async function removeFromBatch(enrollmentId) {
    const bs = batchAssignments[enrollmentId]
    if (!bs) return
    const { error } = await sb.from('batch_students')
      .update({ removed_at: new Date().toISOString() }).eq('id', bs.id)
    if (error) { showToast('Failed', 'err'); return }
    setBatchAssignments(function (prev) { const n = { ...prev }; delete n[enrollmentId]; return n })
    showToast('Removed from batch')
  }

  // ── Create a new batch and assign student ──
  async function createAndAssign(enrollment) {
    if (!newBatchCI)             { showToast('Select a Course Instructor', 'warn'); return }
    if (!newBatchForm.name.trim()){ showToast('Batch name is required', 'warn');    return }
    setPanelSaving(true)
    const { data: batch, error } = await sb.from('batches').insert({
      instructor_id:  newBatchCI,
      sku_id:         enrollment.sku_id,
      franchisee_id:  nlhCentreId,
      name:           newBatchForm.name.trim(),
      is_individual:  newBatchForm.is_individual,
      schedule_days:  newBatchForm.days.length ? newBatchForm.days.join(', ') : null,
      schedule_time:  newBatchForm.time || null,
      is_active:      true,
      sessions_done:  0,
    }).select('id, name, schedule_days, schedule_time, is_individual, sessions_done, instructor_id, instructors(id, full_name)').single()
    if (error) { showToast('Create failed: ' + error.message, 'err'); setPanelSaving(false); return }
    // Now assign student
    const existing = batchAssignments[enrollment.id]
    if (existing) {
      await sb.from('batch_students').update({ removed_at: new Date().toISOString() }).eq('id', existing.id)
    }
    const { data: bs, error: bsErr } = await sb.from('batch_students')
      .insert({ batch_id: batch.id, enrollment_id: enrollment.id })
      .select('id, enrollment_id, assigned_at, batch_id, batches(id, name, sku_id, schedule_days, schedule_time, instructor_id, instructors(full_name))')
      .single()
    setPanelSaving(false)
    if (bsErr) { showToast('Batch created but assign failed: ' + bsErr.message, 'err'); return }
    setBatchAssignments(function (prev) { return { ...prev, [enrollment.id]: bs } })
    setBatchPanelEnrId(null)
    showToast('Batch created and student assigned ✓')
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 680 }}>
        {/* Header */}
        <div className="ch">
          <span>{student.full_name}</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '0 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
          {['profile', 'courses'].map(function (t) {
            return (
              <button
                key={t}
                onClick={function () {
                  setTab(t)
                  if (t === 'courses') loadCoursesTab()
                }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '10px 16px', fontSize: 13, fontWeight: 600,
                  color: tab === t ? 'var(--purple)' : 'var(--text3)',
                  borderBottom: tab === t ? '2px solid var(--purple)' : '2px solid transparent',
                  marginBottom: -1, transition: 'color 0.15s',
                }}
              >
                {t === 'profile' ? '👤 Profile' : '📚 Courses & Batches'}
              </button>
            )
          })}
        </div>

        {/* ── PROFILE TAB ── */}
        {tab === 'profile' && (
          <div>
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
              <label>Enrolment Channel
                <select value={form.channel} onChange={field('channel')} disabled={!admin}>
                  <option value="franchise">Franchise Centre</option>
                  <option value="own_centre">NLH Own Centre</option>
                  <option value="international">International / Online</option>
                  <option value="walk-in">Walk-in</option>
                  <option value="referral">Referral</option>
                  <option value="online">Online Campaign</option>
                  <option value="camp">Camp / Event</option>
                  <option value="school">School Tie-up</option>
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
          </div>
        )}

        {/* ── COURSES & BATCHES TAB ── */}
        {tab === 'courses' && (
          <div style={{ padding: '16px 0' }}>
            {enrollments.length === 0 ? (
              <p className="hint" style={{ textAlign: 'center', padding: 24 }}>No courses enrolled yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {enrollments.map(function (en) {
                  const bs          = batchAssignments[en.id]
                  const isOpen      = batchPanelEnrId === en.id
                  const courseName  = en.skus?.courses?.group_name || '—'
                  const levelName   = en.skus?.level_name || '—'

                  return (
                    <div key={en.id} style={{
                      border: '1px solid var(--border)', borderRadius: 10,
                      overflow: 'hidden', background: 'var(--card)',
                    }}>
                      {/* Enrollment header row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>
                            {courseName}
                            <span style={{ font: '500 11px var(--mono)', color: 'var(--text3)', marginLeft: 8 }}>
                              {levelName}
                            </span>
                          </div>
                          {bs ? (
                            <div style={{ font: '500 12px var(--font)', color: 'var(--text2)', marginTop: 3 }}>
                              <span style={{ color: 'var(--green)' }}>●</span>
                              {' '}{bs.batches?.name || 'Batch'}
                              {bs.batches?.instructors?.full_name ? (
                                <span style={{ color: 'var(--text3)' }}> · {bs.batches.instructors.full_name}</span>
                              ) : null}
                              {bs.batches?.schedule_days ? (
                                <span style={{ color: 'var(--text3)' }}> · {bs.batches.schedule_days}</span>
                              ) : null}
                              {bs.batches?.schedule_time ? (
                                <span style={{ color: 'var(--text3)' }}> {bs.batches.schedule_time}</span>
                              ) : null}
                            </div>
                          ) : (
                            <div style={{ font: '500 12px var(--font)', color: 'var(--text3)', marginTop: 3 }}>
                              Not assigned to a batch
                            </div>
                          )}
                        </div>

                        {/* Certificate button */}
                        <button
                          className="btn-s"
                          style={{ fontSize: 11, padding: '3px 10px', flexShrink: 0 }}
                          onClick={async function () {
                            let centre = centreCache
                            if (!centre && student.franchisee_id) {
                              const { data } = await sb.from('franchisees')
                                .select('id,business_name,city,area,country,tier')
                                .eq('id', student.franchisee_id).single()
                              centre = data || null
                              setCentreCache(centre)
                            }
                            setCertModal({ enrollments, centre })
                          }}
                        >
                          {en.cert_emailed_at ? '🎓 Re-issue' : '🎓 Cert'}
                        </button>

                        {/* Assign batch toggle */}
                        {admin && (
                          <button
                            className={isOpen ? 'btn' : 'btn-s'}
                            style={{ fontSize: 11, padding: '4px 12px', flexShrink: 0 }}
                            onClick={function () { openBatchPanel(en) }}
                          >
                            {isOpen ? 'Close' : bs ? '✏️ Change Batch' : '+ Assign Batch'}
                          </button>
                        )}

                        {/* Remove from batch */}
                        {admin && bs && !isOpen && (
                          <button
                            className="btn-s"
                            style={{ fontSize: 11, padding: '4px 8px', flexShrink: 0, color: 'var(--red)' }}
                            onClick={function () { removeFromBatch(en.id) }}
                            title="Remove from batch"
                          >✕</button>
                        )}
                      </div>

                      {/* Batch assignment panel */}
                      {isOpen && (
                        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)', padding: 16 }}>
                          {panelData.loading ? (
                            <div className="hint">Loading batches…</div>
                          ) : (
                            <>
                              {/* Existing batches */}
                              {panelData.batches.length > 0 && (
                                <div style={{ marginBottom: 16 }}>
                                  <div style={{ font: '600 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                                    Existing Batches
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {panelData.batches.map(function (b) {
                                      const isCurrent = bs && bs.batch_id === b.id
                                      return (
                                        <div key={b.id} style={{
                                          display: 'flex', alignItems: 'center', gap: 10,
                                          padding: '8px 12px', borderRadius: 8,
                                          border: isCurrent ? '1.5px solid var(--purple)' : '1px solid var(--border)',
                                          background: isCurrent ? 'var(--purple-bg)' : 'var(--card)',
                                        }}>
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ font: '600 12px var(--font)', color: 'var(--text)' }}>
                                              {b.name}
                                              {isCurrent && <span style={{ color: 'var(--purple)', marginLeft: 6, fontSize: 11 }}>● current</span>}
                                            </div>
                                            <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', marginTop: 2 }}>
                                              {b.instructors?.full_name || 'No instructor'}
                                              {b.schedule_days ? ' · ' + b.schedule_days : ''}
                                              {b.schedule_time ? ' ' + b.schedule_time : ''}
                                              {b.is_individual ? ' · Individual' : ' · Group'}
                                            </div>
                                          </div>
                                          {!isCurrent && (
                                            <button
                                              className="btn-s"
                                              style={{ fontSize: 11, padding: '3px 12px', flexShrink: 0 }}
                                              disabled={panelSaving}
                                              onClick={function () { assignToBatch(b.id, en.id) }}
                                            >
                                              Assign
                                            </button>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Create new batch toggle */}
                              <button
                                className="btn-s"
                                style={{ fontSize: 12, marginBottom: showNewBatch ? 12 : 0 }}
                                onClick={function () { setShowNewBatch(function (v) { return !v }) }}
                              >
                                {showNewBatch ? '▲ Hide' : '+ Create New Batch'}
                              </button>

                              {showNewBatch && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                                  {/* CI selector */}
                                  {panelData.eligibleCIs.length === 0 ? (
                                    <p className="hint" style={{ color: 'var(--red)' }}>
                                      No active Course Instructors are appointed for this level yet.
                                    </p>
                                  ) : (
                                    <label style={{ font: '500 12px var(--font)', color: 'var(--text2)' }}>
                                      Course Instructor *
                                      <select
                                        value={newBatchCI}
                                        onChange={function (e) { setNewBatchCI(e.target.value) }}
                                        style={{ marginTop: 4, fontSize: 13 }}
                                      >
                                        <option value="">— Select CI —</option>
                                        {panelData.eligibleCIs.map(function (ci) {
                                          return <option key={ci.id} value={ci.id}>{ci.full_name}</option>
                                        })}
                                      </select>
                                    </label>
                                  )}

                                  {/* Batch name */}
                                  <label style={{ font: '500 12px var(--font)', color: 'var(--text2)' }}>
                                    Batch Name *
                                    <input
                                      value={newBatchForm.name}
                                      onChange={function (e) { setNewBatchForm(function (f) { return { ...f, name: e.target.value } }) }}
                                      placeholder="e.g. Saturday Morning Group"
                                      style={{ marginTop: 4, fontSize: 13 }}
                                    />
                                  </label>

                                  {/* Day picker */}
                                  <div>
                                    <div style={{ font: '500 12px var(--font)', color: 'var(--text2)', marginBottom: 6 }}>Schedule Days</div>
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                      {DAYS.map(function (d) {
                                        const active = newBatchForm.days.includes(d)
                                        return (
                                          <button
                                            key={d}
                                            type="button"
                                            onClick={function () {
                                              setNewBatchForm(function (f) {
                                                const days = active
                                                  ? f.days.filter(function (x) { return x !== d })
                                                  : [...f.days, d]
                                                return { ...f, days }
                                              })
                                            }}
                                            style={{
                                              padding: '4px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                                              border: active ? '1.5px solid var(--purple)' : '1px solid var(--border)',
                                              background: active ? 'var(--purple-bg)' : 'var(--card)',
                                              color: active ? 'var(--purple)' : 'var(--text2)',
                                              fontWeight: active ? 700 : 500,
                                            }}
                                          >
                                            {d}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>

                                  {/* Time + individual toggle */}
                                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                                    <label style={{ font: '500 12px var(--font)', color: 'var(--text2)', flex: 1 }}>
                                      Time
                                      <input
                                        type="time"
                                        value={newBatchForm.time}
                                        onChange={function (e) { setNewBatchForm(function (f) { return { ...f, time: e.target.value } }) }}
                                        style={{ marginTop: 4, fontSize: 13 }}
                                      />
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, font: '500 12px var(--font)', color: 'var(--text2)', paddingBottom: 6 }}>
                                      <input
                                        type="checkbox"
                                        checked={newBatchForm.is_individual}
                                        onChange={function (e) { setNewBatchForm(function (f) { return { ...f, is_individual: e.target.checked } }) }}
                                      />
                                      Individual session
                                    </label>
                                  </div>

                                  <button
                                    className="btn-p"
                                    style={{ fontSize: 12, alignSelf: 'flex-start', padding: '6px 18px' }}
                                    disabled={panelSaving || !newBatchCI || !newBatchForm.name.trim()}
                                    onClick={function () { createAndAssign(en) }}
                                  >
                                    {panelSaving ? 'Creating…' : 'Create & Assign'}
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Certificate modal */}
        {certModal && (
          <StudentCertModal
            student={{ ...student, ...form }}
            enrollments={certModal.enrollments}
            centre={certModal.centre}
            onClose={function () { setCertModal(null) }}
          />
        )}

        {/* Footer actions */}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
          {admin && tab === 'profile' && (
            <button className="btn-p" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
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
    channel: 'franchise',
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

  // ── Batch assignment state ──
  // { [sku_id]: { batches: [], eligibleCIs: [], loading: bool } }
  const [batchData, setBatchData] = useState({})
  // { [sku_id]: '' | batch_id | '__new__' }
  const [batchSel, setBatchSel] = useState({})
  // { [sku_id]: { ci, name, days, time, is_individual } }
  const [newBatchForms, setNewBatchForms] = useState({})

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
    setBatchData({})
    setBatchSel({})
    setNewBatchForms({})
    if (!fid) { setRegFilter(null); return }
    const fr = centreList.find(function (c) { return c.id === fid })
    setRegFilter(deriveFilter(fr))
  }

  async function loadBatchData(skuId) {
    if (batchData[skuId]) return   // already loaded or loading
    setBatchData(function (prev) { return { ...prev, [skuId]: { batches: [], eligibleCIs: [], loading: true } } })
    const [{ data: batches }, { data: ciRows }] = await Promise.all([
      sb.from('batches')
        .select('id, name, schedule_days, schedule_time, is_individual, instructor_id, instructors(id, full_name)')
        .eq('sku_id', skuId).eq('is_active', true).order('created_at'),
      sb.from('instructor_courses')
        .select('instructor_id, instructors(id, full_name, status)')
        .eq('sku_id', skuId).eq('status', 'active'),
    ])
    const eligibleCIs = (ciRows || [])
      .map(function (r) { return r.instructors })
      .filter(function (i) { return i && i.status === 'active' })
      .filter(function (i, idx, arr) { return arr.findIndex(function (x) { return x.id === i.id }) === idx })
    setBatchData(function (prev) { return { ...prev, [skuId]: { batches: batches || [], eligibleCIs, loading: false } } })
  }

  function toggleSku(sku) {
    setSelectedSkus(function (prev) {
      const exists = prev.find(function (s) { return s.id === sku.id })
      const next = exists ? prev.filter(function (s) { return s.id !== sku.id }) : [...prev, sku]
      setFeeTotal(next.reduce(function (sum, s) { return sum + (s.student_fee || 0) }, 0))
      if (!exists) {
        // selecting — load batch data for this SKU
        loadBatchData(sku.id)
      } else {
        // deselecting — clear its batch selection
        setBatchSel(function (p) { const n = { ...p }; delete n[sku.id]; return n })
        setNewBatchForms(function (p) { const n = { ...p }; delete n[sku.id]; return n })
      }
      return next
    })
  }

  async function save() {
    if (!form.full_name.trim()) { showToast('Student name is required', 'warn'); return }
    if (!form.phone.trim()) { showToast('Parent mobile number is required', 'warn'); return }
    if (!form.email.trim() || !form.email.includes('@')) { showToast('Parent email address is required', 'warn'); return }
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

      // Insert enrollments and capture IDs for batch assignment
      let enrData = []
      if (selectedSkus.length > 0) {
        const enrollRows = selectedSkus.map(function (sku) { return {
          student_id: st.id,
          sku_id: sku.id,
          franchisee_id: form.franchisee_id,
        } })
        const { data: inserted } = await sb.from('enrollments').insert(enrollRows).select('id, sku_id')
        enrData = inserted || []
      }

      // Assign batches (or create new ones) for each selected SKU
      for (let i = 0; i < selectedSkus.length; i++) {
        const sku = selectedSkus[i]
        const sel = batchSel[sku.id]
        if (!sel) continue
        const enrollment = enrData.find(function (e) { return e.sku_id === sku.id })
        if (!enrollment) continue

        let batchId = sel
        if (sel === '__new__') {
          const nbf = newBatchForms[sku.id] || {}
          if (!nbf.ci || !nbf.name || !nbf.name.trim()) continue
          const { data: newBatch, error: bErr } = await sb.from('batches').insert({
            instructor_id:  nbf.ci,
            sku_id:         sku.id,
            franchisee_id:  form.franchisee_id,
            name:           nbf.name.trim(),
            is_individual:  nbf.is_individual || false,
            schedule_days:  (nbf.days || []).length ? nbf.days.join(', ') : null,
            schedule_time:  nbf.time || null,
            is_active:      true,
            sessions_done:  0,
          }).select('id').single()
          if (bErr) { showToast('Batch create failed for ' + sku.level_name + ': ' + bErr.message, 'warn'); continue }
          batchId = newBatch.id
        }

        await sb.from('batch_students').insert({ batch_id: batchId, enrollment_id: enrollment.id })
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
            <label>Phone *
              <input value={form.phone} onChange={field('phone')} placeholder="Parent / guardian mobile" />
            </label>
            <label>Parent / Guardian
              <input value={form.parent_name} onChange={field('parent_name')} placeholder="Parent name" />
            </label>
            <label>Date of Birth
              <input type="date" value={form.dob} onChange={field('dob')} />
            </label>
            <label className="col-span-2">Parent Email *
              <input type="email" value={form.email} onChange={field('email')} placeholder="parent@email.com" />
            </label>
          </div>

          {/* ── Section 2: Centre ── */}
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, marginTop:12 }}>
            <div style={{ font:'600 12px var(--font)', color:'var(--text)', marginBottom:8 }}>
              Enrolment Centre *
            </div>
            {(admin || isMasterFr) ? (() => {
              const nlhCentre = centreList.find(c => c.tier === 'NLH')
              const others    = centreList.filter(c => c.tier !== 'NLH')
              const tierOrder = { SMF: 1, CF: 2, UF: 3 }
              // Group by city, sort cities A→Z, sort within each city by tier hierarchy
              const cityMap = {}
              others.forEach(function (c) {
                const city = c.city || '(No City)'
                if (!cityMap[city]) cityMap[city] = []
                cityMap[city].push(c)
              })
              const sortedCities = Object.keys(cityMap).sort((a, b) => a.localeCompare(b))
              sortedCities.forEach(function (city) {
                cityMap[city].sort((a, b) => (tierOrder[a.tier] || 9) - (tierOrder[b.tier] || 9))
              })
              return (
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  <select
                    value={form.franchisee_id}
                    onChange={e => handleCentreChange(e.target.value)}
                    style={{ fontSize:13 }}
                  >
                    <option value="">— Select centre —</option>
                    {nlhCentre && (
                      <option value={nlhCentre.id}>🏛️ NLH Own Centre</option>
                    )}
                    {sortedCities.map(function (city) {
                      return (
                        <optgroup key={city} label={city}>
                          {cityMap[city].map(c => (
                            <option key={c.id} value={c.id}>
                              [{c.tier}] {c.business_name}{c.area ? ` — ${c.area}` : ''}
                            </option>
                          ))}
                        </optgroup>
                      )
                    })}
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

          {/* ── Section 4: Batch Assignment ── */}
          {selectedSkus.length > 0 && (
            <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, marginTop:12 }}>
              <div style={{ font:'600 12px var(--font)', color:'var(--text)', marginBottom:8 }}>
                📋 Batch Assignment
                <span style={{ font:'500 10px var(--font)', color:'var(--text3)', marginLeft:8 }}>
                  Assign each course to a batch (optional — can be done later)
                </span>
              </div>

              {selectedSkus.map(function (sku) {
                const bd  = batchData[sku.id] || { batches: [], eligibleCIs: [], loading: true }
                const sel = batchSel[sku.id] || ''
                const nbf = newBatchForms[sku.id] || { ci: '', name: '', days: [], time: '', is_individual: false }

                function updateNbf(patch) {
                  setNewBatchForms(function (prev) {
                    return { ...prev, [sku.id]: { ...nbf, ...patch } }
                  })
                }

                return (
                  <div key={sku.id} style={{
                    border:'1px solid var(--border)', borderRadius:8,
                    overflow:'hidden', marginBottom:8,
                  }}>
                    {/* SKU header */}
                    <div style={{
                      background:'var(--bg3)', padding:'7px 12px',
                      font:'600 12px var(--font)', color:'var(--text)',
                      display:'flex', alignItems:'center', gap:8,
                    }}>
                      <span>{sku.courses?.group_name || '—'}</span>
                      <span style={{ font:'500 10px var(--mono)', color:'var(--text3)' }}>{sku.level_name}</span>
                    </div>

                    <div style={{ padding:'10px 12px' }}>
                      {bd.loading ? (
                        <span className="hint">Loading batches…</span>
                      ) : (
                        <>
                          {/* Batch selector dropdown */}
                          <select
                            value={sel}
                            onChange={function (e) { setBatchSel(function (p) { return { ...p, [sku.id]: e.target.value } }) }}
                            style={{ fontSize:12, width:'100%', marginBottom: sel === '__new__' ? 10 : 0 }}
                          >
                            <option value="">— No batch yet (assign later) —</option>
                            {bd.batches.map(function (b) {
                              return (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                  {b.instructors?.full_name ? ' · ' + b.instructors.full_name : ''}
                                  {b.schedule_days ? ' · ' + b.schedule_days : ''}
                                  {b.schedule_time ? ' ' + b.schedule_time : ''}
                                </option>
                              )
                            })}
                            <option value="__new__">+ Create new batch</option>
                          </select>

                          {/* New batch mini-form */}
                          {sel === '__new__' && (
                            <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:10 }}>
                              {bd.eligibleCIs.length === 0 ? (
                                <p className="hint" style={{ color:'var(--red)' }}>
                                  ⚠ No active Course Instructors appointed for this level yet.
                                </p>
                              ) : (
                                <label style={{ font:'500 11px var(--font)' }}>
                                  Course Instructor *
                                  <select
                                    value={nbf.ci}
                                    onChange={function (e) { updateNbf({ ci: e.target.value }) }}
                                    style={{ marginTop:4, fontSize:12 }}
                                  >
                                    <option value="">— Select CI —</option>
                                    {bd.eligibleCIs.map(function (ci) {
                                      return <option key={ci.id} value={ci.id}>{ci.full_name}</option>
                                    })}
                                  </select>
                                </label>
                              )}

                              <label style={{ font:'500 11px var(--font)' }}>
                                Batch Name *
                                <input
                                  value={nbf.name}
                                  onChange={function (e) { updateNbf({ name: e.target.value }) }}
                                  placeholder="e.g. Saturday Morning Group"
                                  style={{ marginTop:4, fontSize:12 }}
                                />
                              </label>

                              <div>
                                <div style={{ font:'500 11px var(--font)', marginBottom:5 }}>Schedule Days</div>
                                <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                                  {DAYS.map(function (d) {
                                    const active = nbf.days.includes(d)
                                    return (
                                      <button
                                        key={d} type="button"
                                        onClick={function () {
                                          updateNbf({ days: active ? nbf.days.filter(function (x) { return x !== d }) : [...nbf.days, d] })
                                        }}
                                        style={{
                                          padding:'3px 9px', borderRadius:20, fontSize:11, cursor:'pointer',
                                          border: active ? '1.5px solid var(--purple)' : '1px solid var(--border)',
                                          background: active ? 'var(--purple-bg)' : 'var(--card)',
                                          color: active ? 'var(--purple)' : 'var(--text2)',
                                          fontWeight: active ? 700 : 500,
                                        }}
                                      >{d}</button>
                                    )
                                  })}
                                </div>
                              </div>

                              <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
                                <label style={{ font:'500 11px var(--font)', flex:1 }}>
                                  Time
                                  <input
                                    type="time" value={nbf.time}
                                    onChange={function (e) { updateNbf({ time: e.target.value }) }}
                                    style={{ marginTop:4, fontSize:12 }}
                                  />
                                </label>
                                <label style={{ display:'flex', alignItems:'center', gap:5,
                                  font:'500 11px var(--font)', paddingBottom:5 }}>
                                  <input
                                    type="checkbox" checked={nbf.is_individual}
                                    onChange={function (e) { updateNbf({ is_individual: e.target.checked }) }}
                                  />
                                  Individual
                                </label>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Section 5: Address & extras (collapsible) ── */}
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:10, marginTop:12 }}>
            <button
              type="button"
              onClick={() => setShowAddress(a => !a)}
              style={{ background:'none', border:'none', cursor:'pointer', padding:0,
                font:'500 12px var(--font)', color:'var(--text3)', display:'flex', alignItems:'center', gap:6 }}
            >
              <span style={{ fontSize:10 }}>{showAddress ? '▾' : '▸'}</span>
              {showAddress ? 'Hide' : 'Add'} address &amp; channel
              <span style={{ font:'500 10px var(--mono)', color:'var(--text3)', marginLeft:4 }}>(optional)</span>
            </button>

            {showAddress && (
              <div className="form-grid" style={{ marginTop:10 }}>
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
                <label>Enrolment Channel
                  <select value={form.channel} onChange={field('channel')}>
                    <option value="franchise">Franchise Centre</option>
                    <option value="own_centre">NLH Own Centre</option>
                    <option value="international">International / Online</option>
                    <option value="walk-in">Walk-in</option>
                    <option value="referral">Referral</option>
                    <option value="online">Online Campaign</option>
                    <option value="camp">Camp / Event</option>
                    <option value="school">School Tie-up</option>
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
        .order('created_at', { ascending: false })

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
    setStudents(ss => [{ ...st, enrollments: [] }, ...ss])
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
                            {s.created_at && (
                              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
                                Joined {new Date(s.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ color: 'var(--text2)' }}>
                        <div>{s.parent_name || '—'}</div>
                        {s.phone && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{s.phone}</div>}
                      </td>
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

