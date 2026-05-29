import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast } from '../utils'
import { isAdminRole } from '../constants/roles'
import { getTreeIds } from '../utils/hierarchy'
import { sendWelcomeEmail } from '../services/email'
import { sendWAStudentEnrolled, sendWAReviewRequest } from '../services/whatsapp'
import StudentCertModal from '../components/StudentCertModal'

// ── helpers ────────────────────────────────────────────────────────────────────

// Shared: derive payment_status from fee amounts — single source of truth
function deriveStatus(total, paid) {
  const t = Number(total) || 0
  const p = Number(paid)  || 0
  if (t === 0)   return 'none'
  if (p <= 0)    return 'pending'
  if (p >= t)    return 'paid'
  return 'partial'
}

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

export function StudentDetailModal({ student, onClose, onSaved }) {
  const { currentRole, currentFranchiseeId } = useAuth()
  const admin = isAdminRole(currentRole)
  const canEdit = admin || (['uf', 'cf', 'smf'].includes(currentRole) && student.franchisee_id === currentFranchiseeId)

  const [tab, setTab] = useState('profile')

  const [form, setForm] = useState({
    full_name: student.full_name || '',
    parent_name: student.parent_name || '',
    gender: student.gender || '',
    dob: student.dob || '',
    registered_at: student.registered_at || '',
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
    payment_mode: student.payment_mode || '',
    fee_total: student.fee_total ?? '',
    fee_paid: student.fee_paid ?? '',
  })
  const [certModal,   setCertModal]   = useState(null)
  const [centreCache, setCentreCache] = useState(null)
  const [saving,      setSaving]      = useState(false)

  // ── Courses / Batch state ──
  const [localEnrollments, setLocalEnrollments] = useState(student.enrollments || [])
  const [batchAssignments,setBatchAssignments] = useState({})   // { [enrollment_id]: batch_student row }
  const [sessionCounts,   setSessionCounts]   = useState({})   // { [enrollment_id]: attended count }
  const [skuTotals,       setSkuTotals]       = useState({})   // { [sku_id]: total_sessions }
  const [coursesLoaded,   setCoursesLoaded]   = useState(false)
  const [batchPanelEnrId, setBatchPanelEnrId] = useState(null)  // enrollment.id whose panel is open
  const [panelData,       setPanelData]       = useState({ batches: [], loading: false })
  const [panelSaving,     setPanelSaving]     = useState(false)
  const [assignJoinDate,  setAssignJoinDate]  = useState(new Date().toISOString().slice(0, 10))
  const [completingEnr,   setCompletingEnr]   = useState(null)  // enrollment pending completion-date entry
  const [completeDate,    setCompleteDate]    = useState(new Date().toISOString().slice(0, 10))
  const [reviewingEn,     setReviewingEn]     = useState(null)  // enrollment pending review-send
  const [reviewPhone,     setReviewPhone]     = useState('')
  const [reviewSending,   setReviewSending]   = useState(false)

  // ── Add-enrollment state ──
  const [showAddEnrollment, setShowAddEnrollment] = useState(false)
  const [allCentreSkus,     setAllCentreSkus]     = useState([])   // ALL SKUs the centre offers (enrolled + available)
  const [availableSkus,     setAvailableSkus]     = useState([])   // SKUs the centre offers, minus already enrolled
  const [selectedNewSkus,   setSelectedNewSkus]   = useState([])
  const [addingEnrollment,  setAddingEnrollment]  = useState(false)

  // ── Delete state ──
  const [deleting, setDeleting] = useState(false)

  const balance = (Number(form.fee_total) || 0) - (Number(form.fee_paid) || 0)

  function field(k) {
    return function (e) { setForm(function (f) { return { ...f, [k]: e.target.value } }) }
  }

  // deriveStatus is defined at module level — shared with AddStudentModal
  const derivedStatus = deriveStatus(form.fee_total, form.fee_paid)

  async function save() {
    setSaving(true)
    const feeTotal = form.fee_total === '' ? null : Number(form.fee_total)
    const feePaid  = form.fee_paid  === '' ? null : Number(form.fee_paid)
    const payload = {
      full_name:      form.full_name.trim(),
      parent_name:    form.parent_name.trim(),
      gender:         form.gender || null,
      dob:            form.dob || null,
      registered_at:  form.registered_at || null,
      phone:          form.phone.trim(),
      email:          form.email.trim() || null,
      pincode:        form.pincode.trim() || null,
      country:        form.country.trim(),
      state:          form.state.trim(),
      city:           form.city.trim(),
      area:           form.area.trim(),
      address:        form.address.trim(),
      channel:        form.channel || 'walk-in',
      fee_total:      feeTotal,
      fee_paid:       feePaid,
      payment_mode:   form.payment_mode || null,
      payment_status: derivedStatus,
    }
    const { error } = await sb.from('students').update(payload).eq('id', student.id)
    if (error) { setSaving(false); showToast('Save failed: ' + error.message, 'err'); return }

    // Sync batch joining date to match updated registration date
    if (form.registered_at && form.registered_at !== student.registered_at) {
      const enrIds = (student.enrollments || []).map(function (e) { return e.id })
      if (enrIds.length > 0) {
        await sb.from('batch_students')
          .update({ assigned_at: form.registered_at + 'T00:00:00+00:00' })
          .in('enrollment_id', enrIds)
          .is('removed_at', null)
      }
    }

    setSaving(false)
    showToast('Saved')
    onSaved({ ...student, ...payload })
  }

  // ── Load courses tab ──
  async function loadCoursesTab() {
    if (coursesLoaded) return
    setCoursesLoaded(true)

    // Load batch assignments for all enrollments of this student
    const enrIds = localEnrollments.map(function (e) { return e.id })
    if (enrIds.length > 0) {
      const { data: bsRows } = await sb.from('batch_students')
        .select('id, enrollment_id, assigned_at, batch_id, batches(id, name, schedule_days, schedule_time, instructor_id, instructors(full_name))')
        .in('enrollment_id', enrIds)
        .is('removed_at', null)
      const map = {}
      ;(bsRows || []).forEach(function (bs) { map[bs.enrollment_id] = bs })
      setBatchAssignments(map)

      // Attended-session count per enrollment (for the "X / Y sessions" badge)
      const { data: attRows } = await sb.from('session_attendance')
        .select('enrollment_id')
        .in('enrollment_id', enrIds)
        .eq('attended', true)
      const counts = {}
      ;(attRows || []).forEach(function (a) {
        counts[a.enrollment_id] = (counts[a.enrollment_id] || 0) + 1
      })
      setSessionCounts(counts)

      // Total sessions per enrolled SKU
      const enrSkuIds = localEnrollments.map(function (e) { return e.sku_id }).filter(Boolean)
      if (enrSkuIds.length > 0) {
        const { data: skuRows } = await sb.from('skus')
          .select('id, total_sessions')
          .in('id', enrSkuIds)
        const totals = {}
        ;(skuRows || []).forEach(function (s) { totals[s.id] = s.total_sessions })
        setSkuTotals(totals)
      }
    }

    // Load available SKUs for the "+ Add Course" panel
    const [{ data: fr }, { data: allSkuRows }] = await Promise.all([
      sb.from('franchisees').select('tier, registered_skus, registered_courses').eq('id', student.franchisee_id).single(),
      sb.from('skus').select('id, level_name, student_fee, course_id, courses(group_name)').order('sort_order'),
    ])
    const filter = deriveFilter(fr)
    const enrolledSkuIds = localEnrollments.map(function (e) { return e.sku_id })
    let candidates = []
    if (filter === 'all') {
      candidates = allSkuRows || []
    } else if (filter && filter.skuIds) {
      candidates = (allSkuRows || []).filter(function (s) { return filter.skuIds.includes(s.id) })
    } else if (filter && filter.courseIds) {
      candidates = (allSkuRows || []).filter(function (s) { return filter.courseIds.includes(s.course_id) })
    }
    setAllCentreSkus(candidates)
    setAvailableSkus(candidates.filter(function (s) { return !enrolledSkuIds.includes(s.id) }))
  }

  // ── Open batch assignment panel for one enrollment ──
  async function openBatchPanel(enrollment) {
    if (batchPanelEnrId === enrollment.id) { setBatchPanelEnrId(null); return }
    setBatchPanelEnrId(enrollment.id)
    setAssignJoinDate(student.registered_at || new Date().toISOString().slice(0, 10))
    setPanelData({ batches: [], loading: true })

    // Get the course_id for this enrollment's SKU
    const { data: skuRow } = await sb.from('skus').select('course_id').eq('id', enrollment.sku_id).single()

    // Get all SKU IDs for that course so we can find batches at any level
    const { data: courseSkus } = skuRow?.course_id
      ? await sb.from('skus').select('id').eq('course_id', skuRow.course_id)
      : { data: [] }
    const courseSkuIds = (courseSkus || []).map(function (s) { return s.id })

    // Fetch all active batches for this course (any level)
    const { data: batches } = courseSkuIds.length
      ? await sb.from('batches')
          .select('id, name, sku_id, schedule_days, schedule_time, is_individual, sessions_done, instructor_id, instructors(id, full_name)')
          .in('sku_id', courseSkuIds)
          .eq('is_active', true)
          .order('schedule_time')
      : { data: [] }

    setPanelData({ batches: batches || [], loading: false })
  }

  // ── Assign student to an existing batch ──
  async function assignToBatch(batchId, enrollmentId) {
    setPanelSaving(true)
    const assignedAt = assignJoinDate + 'T00:00:00+00:00'
    const selectFields = 'id, enrollment_id, assigned_at, batch_id, batches(id, name, schedule_days, schedule_time, instructor_id, instructors(full_name))'

    // Remove from any existing (different) batch first
    const existing = batchAssignments[enrollmentId]
    if (existing && existing.batch_id !== batchId) {
      await sb.from('batch_students').update({ removed_at: new Date().toISOString() }).eq('id', existing.id)
    }

    // Reactivate a prior row for this (batch, enrollment) if one exists, else insert
    const { data: prior } = await sb.from('batch_students')
      .select('id')
      .eq('batch_id', batchId)
      .eq('enrollment_id', enrollmentId)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let data, error
    if (prior) {
      ;({ data, error } = await sb.from('batch_students')
        .update({ removed_at: null, assigned_at: assignedAt })
        .eq('id', prior.id)
        .select(selectFields)
        .single())
    } else {
      ;({ data, error } = await sb.from('batch_students')
        .insert({ batch_id: batchId, enrollment_id: enrollmentId, assigned_at: assignedAt })
        .select(selectFields)
        .single())
    }
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

  // ── Mark course complete ──

  async function markCourseComplete(en, endDate) {
    // endDate is 'YYYY-MM-DD' (course end date chosen by the user); default to today.
    var dateStr = endDate || new Date().toISOString().slice(0, 10)
    var completed_at = dateStr + 'T12:00:00+00:00'
    var { error } = await sb.from('enrollments')
      .update({ completed_at, status: 'completed' })
      .eq('id', en.id)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    setLocalEnrollments(function (prev) {
      return prev.map(function (e) {
        return e.id === en.id ? { ...e, completed_at, status: 'completed' } : e
      })
    })
    setCompletingEnr(null)
    showToast('Marked as completed on ' + fmtDate(dateStr) + ' ✓')
  }

  function openReview(en) {
    setReviewPhone(student.phone || '')
    setReviewingEn(en)
  }

  async function doSendReview() {
    if (!reviewingEn) return
    if (!reviewPhone.trim()) { showToast('Enter a WhatsApp number', 'warn'); return }
    var en = reviewingEn
    var course = (en.skus?.courses?.group_name || '') + (en.skus?.level_name ? ' ' + en.skus.level_name : '')
    setReviewSending(true)
    var res = await sendWAReviewRequest(reviewPhone.trim(), {
      parentName:  student.parent_name,
      studentName: student.full_name,
      courseName:  course.trim(),
    })
    setReviewSending(false)
    if (res.success) { showToast('Review request sent on WhatsApp ✓'); setReviewingEn(null) }
    else showToast('Review send failed: ' + (res.error || 'Unknown error'), 'err')
  }

  // ── Remove an enrollment ──
  async function removeEnrollment(enrollment) {
    // Soft-delete any active batch_student row first
    const { data: bsRows } = await sb.from('batch_students')
      .select('id')
      .eq('enrollment_id', enrollment.id)
      .is('removed_at', null)
    if (bsRows && bsRows.length > 0) {
      await sb.from('batch_students')
        .update({ removed_at: new Date().toISOString() })
        .in('id', bsRows.map(function (b) { return b.id }))
    }
    const { error } = await sb.from('enrollments').delete().eq('id', enrollment.id)
    if (error) { showToast('Remove failed: ' + error.message, 'err'); return }
    setLocalEnrollments(function (prev) { return prev.filter(function (e) { return e.id !== enrollment.id }) })
    setBatchAssignments(function (prev) { const n = { ...prev }; delete n[enrollment.id]; return n })
    // Re-add the SKU to the available list
    setAvailableSkus(function (prev) {
      if (prev.some(function (s) { return s.id === enrollment.sku_id })) return prev
      return [...prev, { id: enrollment.sku_id, sku_id: enrollment.sku_id, level_name: enrollment.skus?.level_name, student_fee: null, courses: enrollment.skus?.courses }]
    })
    showToast('Course removed')
    const { data: updated } = await sb.from('students')
      .select('*, enrollments(id, sku_id, completed_at, status, cert_emailed_at, cert_wa_sent_at, skus(level_name, courses(group_name)))')
      .eq('id', student.id).single()
    if (updated) onSaved(updated)
  }

  // ── Add new enrollments ──
  async function addEnrollments() {
    if (!selectedNewSkus.length) { showToast('Select at least one course', 'warn'); return }
    setAddingEnrollment(true)
    const rows = selectedNewSkus.map(function (sku) { return {
      student_id:    student.id,
      sku_id:        sku.id,
      franchisee_id: student.franchisee_id,
    } })
    const { data, error } = await sb.from('enrollments').insert(rows)
      .select('id, sku_id, completed_at, status, cert_emailed_at, cert_wa_sent_at, skus(level_name, courses(group_name))')
    setAddingEnrollment(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    const added = data || []
    setLocalEnrollments(function (prev) { return [...prev, ...added] })
    const addedSkuIds = added.map(function (e) { return e.sku_id })
    setAvailableSkus(function (prev) { return prev.filter(function (s) { return !addedSkuIds.includes(s.id) }) })
    setSelectedNewSkus([])
    setShowAddEnrollment(false)
    showToast(added.length + ' course' + (added.length !== 1 ? 's' : '') + ' added ✓')
    const { data: updated } = await sb.from('students')
      .select('*, enrollments(id, sku_id, completed_at, status, cert_emailed_at, cert_wa_sent_at, skus(level_name, courses(group_name)))')
      .eq('id', student.id).single()
    if (updated) onSaved(updated)
  }

  // ── Delete student (admin only) ──
  async function deleteStudent() {
    if (!window.confirm('Permanently delete ' + student.full_name + ' and ALL their records (enrollments, batch assignments)?\n\nThis CANNOT be undone.')) return
    setDeleting(true)
    const enrIds = localEnrollments.map(function (e) { return e.id })
    if (enrIds.length > 0) {
      await sb.from('batch_students').delete().in('enrollment_id', enrIds)
      await sb.from('enrollments').delete().in('id', enrIds)
    }
    const { error } = await sb.from('students').delete().eq('id', student.id)
    setDeleting(false)
    if (error) { showToast('Delete failed: ' + error.message, 'err'); return }
    showToast(student.full_name + ' deleted')
    onSaved(null)   // null signals deletion to parent
    onClose()
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 860, maxWidth: '96vw' }}>
        {/* Hero header */}
        {(function () {
          var av = (student.full_name || '?').split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()
          var loc = [form.city, form.state].filter(Boolean).join(', ')
          return (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '18px 20px 14px', background: 'linear-gradient(135deg,#eff6ff,#dbeafe)', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 50, height: 50, borderRadius: 13, flexShrink: 0, background: '#dbeafe', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 17px var(--font)' }}>{av}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 2 }}>
                  <span style={{ font: '700 15px var(--font)', color: 'var(--text)' }}>{student.full_name}</span>
                  {derivedStatus && derivedStatus !== 'none' && (
                    <span className={`badge ${derivedStatus === 'paid' ? 'ba' : derivedStatus === 'partial' ? 'bp' : 'br'}`}>{derivedStatus}</span>
                  )}
                </div>
                {form.parent_name && <div style={{ font: '500 12px var(--font)', color: 'var(--text2)', marginBottom: 2 }}>Parent: {form.parent_name}</div>}
                {loc && <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>📍 {loc}</div>}
              </div>
              <button className="btn-icon" onClick={onClose} style={{ flexShrink: 0, marginTop: -2 }}>✕</button>
            </div>
          )
        })()}

        {/* Stats strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
          {[
            { label: 'Courses',   val: localEnrollments.length > 0 ? String(localEnrollments.length) : '—', color: 'var(--blue)' },
            { label: 'Fee Total', val: form.fee_total !== '' && form.fee_total != null ? '₹' + fmtAmt(form.fee_total) : '—', color: 'var(--text)' },
            { label: 'Paid',      val: form.fee_paid  !== '' && form.fee_paid  != null ? '₹' + fmtAmt(form.fee_paid)  : '—', color: 'var(--green)' },
            { label: 'Balance',   val: form.fee_total != null && form.fee_total !== '' ? (balance > 0 ? '₹' + fmtAmt(balance) : '✓ Cleared') : '—', color: balance > 0 ? 'var(--red)' : 'var(--green)' },
          ].map(function (st, i) {
            return (
              <div key={i} style={{ padding: '9px 14px', borderRight: i < 3 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ font: '500 9px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>{st.label}</div>
                <div style={{ font: '700 14px var(--font)', color: st.color }}>{st.val}</div>
              </div>
            )
          })}
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
                <input value={form.full_name} onChange={field('full_name')} disabled={!canEdit} />
              </label>
              <label>Parent / Guardian
                <input value={form.parent_name} onChange={field('parent_name')} disabled={!canEdit} />
              </label>
              <label>Gender
                <select value={form.gender} onChange={field('gender')} disabled={!canEdit}>
                  <option value="">— Select —</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </label>
              <label>Date of Birth
                <input type="date" value={form.dob} onChange={field('dob')} disabled={!canEdit} />
              </label>
              <label>Date of Registration
                <input type="date" value={form.registered_at} onChange={field('registered_at')} disabled={!canEdit} />
              </label>
              <label>Phone
                <input value={form.phone} onChange={field('phone')} disabled={!canEdit} />
              </label>
              <label>Parent Email
                <input type="email" value={form.email} onChange={field('email')} disabled={!canEdit} placeholder="parent@email.com" />
              </label>
              <label>PIN Code
                <input value={form.pincode} onChange={field('pincode')} disabled={!canEdit} placeholder="e.g. 440001" />
              </label>
              <label>City
                <input value={form.city} onChange={field('city')} disabled={!canEdit} placeholder="Nagpur" />
              </label>
              <label>Area / Locality
                <input value={form.area} onChange={field('area')} disabled={!canEdit} placeholder="Neighbourhood / Area" />
              </label>
              <label>State
                <input value={form.state} onChange={field('state')} disabled={!canEdit} placeholder="Maharashtra" />
              </label>
              <label>Country
                <input value={form.country} onChange={field('country')} disabled={!canEdit} placeholder="India" />
              </label>
              <label className="col-span-2">Street / Building Address
                <input value={form.address} onChange={field('address')} disabled={!canEdit} placeholder="Flat/Shop no., building, street" />
              </label>
              <label>Enrolment Channel
                <select value={form.channel} onChange={field('channel')} disabled={!canEdit}>
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
                <div style={{ paddingTop: 6 }}>
                  <StatusBadge status={derivedStatus} />
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6 }}>auto-calculated</span>
                </div>
              </label>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 16 }}>
              <strong>Fee Tracking</strong>
              <div className="form-grid" style={{ marginTop: 8 }}>
                <label>Fee Total (₹)
                  <input type="number" value={form.fee_total} onChange={field('fee_total')} disabled={!canEdit} />
                </label>
                <label>Fee Paid (₹)
                  <input type="number" value={form.fee_paid} onChange={field('fee_paid')} disabled={!canEdit} />
                </label>
                <label>Balance
                  <input
                    value={'₹' + fmtAmt(balance)}
                    disabled
                    style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}
                  />
                </label>
                <label>Payment Mode
                  <select value={form.payment_mode} onChange={field('payment_mode')} disabled={!canEdit}>
                    <option value="">—</option>
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="bank_transfer">Bank Transfer / NEFT</option>
                    <option value="cheque">Cheque</option>
                    <option value="card">Card</option>
                    <option value="online">Online Payment</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ── COURSES & BATCHES TAB ── */}
        {tab === 'courses' && (
          <div style={{ padding: '16px 0' }}>
            {localEnrollments.length === 0 && !showAddEnrollment ? (
              <p className="hint" style={{ textAlign: 'center', padding: 24 }}>No courses enrolled yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {localEnrollments.map(function (en) {
                  const bs          = batchAssignments[en.id]
                  const isOpen      = batchPanelEnrId === en.id
                  const courseName  = en.skus?.courses?.group_name || '—'
                  const levelName   = en.skus?.level_name || '—'

                  const isCompleted  = !!en.completed_at
                  const attended     = sessionCounts[en.id] || 0
                  const totalSess    = skuTotals[en.sku_id] || 0

                  return (
                    <div key={en.id} style={{
                      border: '1px solid ' + (isCompleted ? 'var(--green)' : 'var(--border)'),
                      borderRadius: 10, overflow: 'hidden',
                      background: isCompleted ? 'var(--green-bg)' : 'var(--card)',
                    }}>
                      {/* Enrollment header row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ font: '600 13px var(--font)', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            {courseName}
                            <span style={{ font: '500 11px var(--mono)', color: 'var(--text3)' }}>
                              {levelName}
                            </span>
                            {isCompleted && (
                              <span style={{ font: '600 10px var(--font)', color: 'var(--green)', background: 'var(--green-bg)', border: '1px solid var(--green)', borderRadius: 20, padding: '1px 7px' }}>
                                ✓ Completed
                              </span>
                            )}
                            <span style={{ font: '600 10px var(--mono)', color: 'var(--purple)', background: 'var(--purple-bg)', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                              {attended}{totalSess > 0 ? ' / ' + totalSess : ''} sessions
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

                        {/* Complete / WhatsApp / Certificate buttons */}
                        {canEdit && !isCompleted && (
                          <button className="btn-s"
                            style={{ fontSize: 11, padding: '3px 10px', flexShrink: 0 }}
                            onClick={function () {
                              setCompleteDate(new Date().toISOString().slice(0, 10))
                              setCompletingEnr(en)
                            }}>
                            ✓ Complete
                          </button>
                        )}
                        {isCompleted && (
                          <button className="btn-s"
                            style={{ fontSize: 11, padding: '3px 10px', flexShrink: 0, background: '#25D366', borderColor: '#25D366', color: '#fff' }}
                            onClick={function () { openReview(en) }}
                            title="Send Google Review request on WhatsApp">
                            💬 Review
                          </button>
                        )}
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
                            setCertModal({ enrollments: localEnrollments, centre })
                          }}
                        >
                          {en.cert_emailed_at ? '🎓 Re-issue' : '🎓 Cert'}
                        </button>

                        {/* Assign batch toggle */}
                        {canEdit && (
                          <button
                            className={isOpen ? 'btn' : 'btn-s'}
                            style={{ fontSize: 11, padding: '4px 12px', flexShrink: 0 }}
                            onClick={function () { openBatchPanel(en) }}
                          >
                            {isOpen ? 'Close' : bs ? '✏️ Batch' : '+ Batch'}
                          </button>
                        )}

                        {/* Remove from batch */}
                        {canEdit && bs && !isOpen && (
                          <button
                            className="btn-s"
                            style={{ fontSize: 11, padding: '4px 8px', flexShrink: 0, color: 'var(--red)' }}
                            onClick={function () { removeFromBatch(en.id) }}
                            title="Remove from batch"
                          >✕ Batch</button>
                        )}

                        {/* Remove enrollment entirely */}
                        {admin && (
                          <button
                            className="btn-s"
                            style={{ fontSize: 11, padding: '4px 8px', flexShrink: 0, color: 'var(--red)', borderColor: 'var(--red)' }}
                            onClick={function () {
                              if (window.confirm('Remove ' + courseName + ' ' + levelName + ' enrollment for ' + student.full_name + '?')) {
                                removeEnrollment(en)
                              }
                            }}
                            title="Remove course enrollment"
                          >🗑</button>
                        )}
                      </div>

                      {/* Batch assignment panel */}
                      {isOpen && (
                        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)', padding: 16 }}>
                          {panelData.loading ? (
                            <div className="hint">Loading batches…</div>
                          ) : (
                            <>
                              {/* Joining date */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                                <span style={{ font: '600 11px var(--font)', color: 'var(--text2)', whiteSpace: 'nowrap' }}>Joining date:</span>
                                <input type="date" value={assignJoinDate}
                                  onChange={function (e) { setAssignJoinDate(e.target.value) }}
                                  style={{ fontSize: 12, padding: '4px 8px' }} />
                              </div>
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

                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* ── Add Course panel ── */}
                {canEdit && (
                  <div style={{ marginTop: 4 }}>
                    {!showAddEnrollment ? (
                      <button
                        className="btn-s"
                        style={{ fontSize: 12, width: '100%' }}
                        onClick={function () { setShowAddEnrollment(true) }}
                        disabled={availableSkus.length === 0}
                      >
                        {availableSkus.length === 0 ? 'All available courses enrolled' : '+ Add Course'}
                      </button>
                    ) : (
                      <div style={{ border: '1.5px dashed var(--purple)', borderRadius: 10, padding: 16, background: 'var(--bg)' }}>
                        <div style={{ font: '600 12px var(--font)', color: 'var(--purple)', marginBottom: 12 }}>
                          Add Course Enrollment
                        </div>
                        {(function () {
                          const enrolledSkuIds = localEnrollments.map(function (e) { return e.sku_id })
                          // Group ALL centre SKUs by course (so enrolled levels are visible too)
                          const groupMap = {}
                          allCentreSkus.forEach(function (s) {
                            const g = s.courses?.group_name || 'Other'
                            if (!groupMap[g]) groupMap[g] = []
                            groupMap[g].push(s)
                          })
                          const groups = Object.entries(groupMap)
                          if (groups.length === 0) {
                            return <p className="hint" style={{ color: 'var(--red)' }}>No additional courses available for this centre.</p>
                          }
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              {groups.map(function ([groupName, skus]) {
                                // Enrolled SKUs in this group
                                const enrolledInGroup = skus.filter(function (s) { return enrolledSkuIds.includes(s.id) })
                                // Available (unenrolled) SKUs in this group, in curriculum order
                                const availableInGroup = skus.filter(function (s) { return !enrolledSkuIds.includes(s.id) })
                                // The first available SKU is the "next level" recommendation
                                const nextLevelId = availableInGroup.length > 0 ? availableInGroup[0].id : null
                                if (enrolledInGroup.length === 0 && availableInGroup.length === 0) return null
                                return (
                                  <div key={groupName}>
                                    <div style={{ font: '600 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                                      {groupName}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      {/* Already enrolled levels — greyed out */}
                                      {enrolledInGroup.map(function (sku) {
                                        return (
                                          <div key={sku.id} style={{
                                            display: 'flex', alignItems: 'center', gap: 8,
                                            padding: '5px 10px', borderRadius: 6,
                                            background: 'var(--bg2)', border: '1px solid var(--border)',
                                            opacity: 0.7,
                                          }}>
                                            <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 13 }}>✓</span>
                                            <span style={{ font: '500 12px var(--font)', color: 'var(--text2)', flex: 1 }}>{sku.level_name}</span>
                                            <span style={{ font: '500 10px var(--mono)', color: 'var(--text3)', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 4, padding: '1px 6px' }}>Enrolled</span>
                                          </div>
                                        )
                                      })}
                                      {/* Available levels — selectable, first one highlighted as Next Level */}
                                      {availableInGroup.map(function (sku) {
                                        const checked = selectedNewSkus.some(function (s) { return s.id === sku.id })
                                        const isNext = sku.id === nextLevelId && enrolledInGroup.length > 0
                                        return (
                                          <label key={sku.id} style={{
                                            display: 'flex', alignItems: 'center', gap: 8,
                                            padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
                                            background: isNext ? 'var(--purple-bg)' : (checked ? 'var(--purple-bg)' : 'var(--card)'),
                                            border: isNext ? '1.5px solid var(--purple)' : (checked ? '1.5px solid var(--purple)' : '1px solid var(--border)'),
                                          }}>
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={function () {
                                                setSelectedNewSkus(function (prev) {
                                                  return checked
                                                    ? prev.filter(function (s) { return s.id !== sku.id })
                                                    : [...prev, sku]
                                                })
                                              }}
                                              style={{ accentColor: 'var(--purple)' }}
                                            />
                                            <span style={{ font: '500 12px var(--font)', color: 'var(--text)', flex: 1 }}>{sku.level_name}</span>
                                            {isNext && <span style={{ font: '700 10px var(--mono)', color: 'var(--purple)', background: 'var(--purple-bg)', border: '1px solid var(--purple)', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>→ Next Level</span>}
                                            {sku.student_fee ? <span style={{ font: '500 10px var(--mono)', color: 'var(--text3)' }}>₹{fmtAmt(sku.student_fee)}</span> : null}
                                          </label>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })()}
                        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                          <button className="btn" style={{ fontSize: 12 }} onClick={function () { setShowAddEnrollment(false); setSelectedNewSkus([]) }}>
                            Cancel
                          </button>
                          <button
                            className="btn-p"
                            style={{ fontSize: 12 }}
                            disabled={!selectedNewSkus.length || addingEnrollment}
                            onClick={addEnrollments}
                          >
                            {addingEnrollment ? 'Adding…' : 'Enroll in ' + selectedNewSkus.length + ' Course' + (selectedNewSkus.length !== 1 ? 's' : '')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
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

        {/* Course completion date modal */}
        {completingEnr && (
          <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) setCompletingEnr(null) }}>
            <div className="modal" style={{ maxWidth: 380 }}>
              <div className="ch">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Mark Course Complete</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {(completingEnr.skus?.courses?.group_name || 'Course')}
                    {completingEnr.skus?.level_name ? ' · ' + completingEnr.skus.level_name : ''}
                  </div>
                </div>
                <button className="btn-icon" onClick={function () { setCompletingEnr(null) }}>✕</button>
              </div>
              <div style={{ padding: '4px 20px 16px' }}>
                <label style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>
                  Course end date
                  <input
                    type="date"
                    value={completeDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={function (e) { setCompleteDate(e.target.value) }}
                    style={{ marginTop: 6, fontSize: 13, width: '100%' }}
                  />
                </label>
                <p className="hint" style={{ marginTop: 8 }}>
                  The student stays on sessions up to this date and drops off any sessions after it.
                </p>
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={function () { setCompletingEnr(null) }}>Cancel</button>
                <button className="btn-p"
                  disabled={!completeDate}
                  onClick={function () { markCourseComplete(completingEnr, completeDate) }}>
                  Mark Complete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Send-review modal (editable recipient number) */}
        {reviewingEn && (
          <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) setReviewingEn(null) }}>
            <div className="modal" style={{ maxWidth: 380 }}>
              <div className="ch">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Send Google Review Request</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {(reviewingEn.skus?.courses?.group_name || 'Course')}
                    {reviewingEn.skus?.level_name ? ' · ' + reviewingEn.skus.level_name : ''}
                  </div>
                </div>
                <button className="btn-icon" onClick={function () { setReviewingEn(null) }}>✕</button>
              </div>
              <div style={{ padding: '4px 20px 16px' }}>
                <label style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>
                  Parent's WhatsApp number
                  <input
                    type="tel"
                    value={reviewPhone}
                    onChange={function (e) { setReviewPhone(e.target.value) }}
                    placeholder="e.g. 9028006800"
                    style={{ marginTop: 6, fontSize: 13, width: '100%' }}
                  />
                </label>
                <p className="hint" style={{ marginTop: 8 }}>
                  Defaults to the number on file. Change it to send to any number (e.g. to verify delivery).
                </p>
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={function () { setReviewingEn(null) }} disabled={reviewSending}>Cancel</button>
                <button className="btn-p" onClick={doSendReview} disabled={reviewSending || !reviewPhone.trim()}>
                  {reviewSending ? 'Sending…' : 'Send on WhatsApp'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="modal-actions">
          {admin && (
            <button
              className="btn"
              style={{ color: 'var(--red, #dc2626)', borderColor: 'var(--red, #dc2626)', marginRight: 'auto' }}
              onClick={deleteStudent}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : '🗑 Delete Student'}
            </button>
          )}
          <button className="btn" onClick={onClose}>Close</button>
          {canEdit && tab === 'profile' && (
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

function AddStudentModal({ onClose, onSaved, onOpenExisting }) {
  const { currentRole, currentFranchiseeId } = useAuth()
  const admin = isAdminRole(currentRole)

  const [form, setForm] = useState({
    full_name: '', parent_name: '', gender: '', dob: '', registered_at: '', phone: '', email: '',
    pincode: '', city: '', area: '', state: '', country: 'India', address: '',
    channel: 'franchise',
    franchisee_id: admin ? '' : (currentFranchiseeId || ''),
  })
  const [showAddress, setShowAddress] = useState(false)
  const [centreList, setCentreList] = useState([])
  const [allSkus, setAllSkus] = useState([])
  const [phoneMatches, setPhoneMatches] = useState([])   // existing students with same phone
  const [phoneConfirmed, setPhoneConfirmed] = useState(false) // user chose to add new despite matches
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
      } else {
        // UF / CF / SMF: fixed to their own centre — registration is by the centre holder only
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

  // Phone lookup — debounced 500ms, searches ALL centres
  useEffect(function () {
    setPhoneConfirmed(false)
    if (!form.phone || form.phone.replace(/\D/g, '').length < 10) { setPhoneMatches([]); return }
    const timer = setTimeout(async function () {
      const { data } = await sb.from('students')
        .select('id, full_name, parent_name, franchisee_id, franchisees(business_name, city), enrollments(id, sku_id, skus(level_name, courses(group_name)))')
        .eq('phone', form.phone.trim())
      setPhoneMatches(data || [])
    }, 500)
    return function () { clearTimeout(timer) }
  }, [form.phone])

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
    // Get CIs certified for this SKU
    const { data: ciRows } = await sb.from('instructor_courses')
      .select('instructor_id, instructors(id, full_name, status)')
      .eq('sku_id', skuId).eq('status', 'active')
    const eligibleCIs = (ciRows || [])
      .map(function (r) { return r.instructors })
      .filter(function (i) { return i && i.status === 'active' })
      .filter(function (i, idx, arr) { return arr.findIndex(function (x) { return x.id === i.id }) === idx })
    const eligibleCIIds = eligibleCIs.map(function (ci) { return ci.id })
    // Batches whose instructor is certified for this SKU
    const { data: batches } = eligibleCIIds.length
      ? await sb.from('batches')
          .select('id, name, schedule_days, schedule_time, is_individual, instructor_id, instructors(id, full_name)')
          .in('instructor_id', eligibleCIIds).eq('is_active', true).order('created_at')
      : { data: [] }
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
        gender: form.gender || null,
        dob: form.dob || null,
        registered_at: form.registered_at || new Date().toISOString().slice(0, 10),
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
        payment_status: deriveStatus(feeTotal, 0),
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
          const { data: { session: admSess } } = await sb.auth.getSession()
          await fetch('/api/create-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(admSess ? { Authorization: `Bearer ${admSess.access_token}` } : {}),
            },
            body: JSON.stringify({
              email:    loginEmail,
              password: tempPass,
              fullName: form.full_name.trim(),
            }),
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
      try {
        if (form.phone && selectedSkus.length > 0) {
          const courseNames = selectedSkus.map(function (s) { return s.courses?.group_name || s.name }).join(', ')
          await sendWAStudentEnrolled(form.phone, {
            parentName:  form.parent_name || 'Parent',
            studentName: form.full_name,
            courses:     courseNames,
            centre:      'New Learning Horizons',
          })
        }
      } catch (waErr) {
        console.warn('WhatsApp enrollment notification failed:', waErr.message)
      }
      // Re-fetch with full joins so the list shows enrollments immediately
      const { data: fullSt } = await sb.from('students')
        .select('*, franchisees(business_name, city), enrollments(id, sku_id, completed_at, status, cert_emailed_at, cert_wa_sent_at, skus(level_name, courses(group_name)))')
        .eq('id', st.id)
        .single()
      onSaved(fullSt || st)
    } catch (err) {
      showToast('Unexpected error: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  const groups = buildGroups()

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="ch">
          <span>➕ Add Student</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div>
          {/* ── Phone — primary student ID (always visible) ── */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ font: '600 12px var(--font)', color: 'var(--text)', display: 'block', marginBottom: 4 }}>
              Mobile Number *
              <span style={{ font: '500 10px var(--font)', color: 'var(--text3)', marginLeft: 6 }}>
                (primary student ID — enter first)
              </span>
            </label>
            <input
              value={form.phone}
              onChange={field('phone')}
              placeholder="10-digit parent / guardian mobile"
              autoFocus
              style={{ fontSize: 15, letterSpacing: '0.5px', fontWeight: 600 }}
            />
            {form.phone.replace(/\D/g, '').length >= 10 && phoneMatches.length === 0 && (
              <div style={{ font: '500 11px var(--font)', color: 'var(--green, #16a34a)', marginTop: 4 }}>
                ✓ No existing student found — fill in details below
              </div>
            )}
          </div>

          {/* ── Phase 2a: Match picker ── */}
          {phoneMatches.length > 0 && !phoneConfirmed && (
            <div>
              <div style={{ font: '600 12px var(--font)', color: 'var(--text)', marginBottom: 8 }}>
                {phoneMatches.length} student{phoneMatches.length > 1 ? 's' : ''} found with this number:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {phoneMatches.map(function (st) {
                  const initials = (st.full_name || '?').split(' ').slice(0, 2).map(function (w) { return w[0] }).join('').toUpperCase()
                  const courses = (st.enrollments || [])
                    .map(function (e) { return e.skus?.courses?.group_name })
                    .filter(Boolean)
                    .filter(function (c, i, a) { return a.indexOf(c) === i })
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={function () { onOpenExisting(st); onClose() }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', borderRadius: 10,
                        border: '1.5px solid var(--border)', background: 'var(--card)',
                        cursor: 'pointer', textAlign: 'left', width: '100%',
                      }}
                    >
                      <div style={{
                        width: 38, height: 38, borderRadius: '50%',
                        background: 'var(--purple-bg)', color: 'var(--purple)',
                        font: '700 14px var(--font)', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>{initials}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ font: '700 13px var(--font)', color: 'var(--text)' }}>{st.full_name}</div>
                        {st.parent_name && (
                          <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>
                            Parent: {st.parent_name}
                          </div>
                        )}
                        <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>
                          📍 {st.franchisees?.business_name || '—'}{st.franchisees?.city ? `, ${st.franchisees.city}` : ''}
                        </div>
                        {courses.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {courses.map(function (c) {
                              return (
                                <span key={c} style={{
                                  padding: '1px 7px', borderRadius: 20,
                                  background: 'var(--purple-bg)', color: 'var(--purple)',
                                  font: '500 10px var(--font)',
                                }}>{c}</span>
                              )
                            })}
                          </div>
                        )}
                      </div>
                      <div style={{ font: '700 11px var(--font)', color: 'var(--purple)', flexShrink: 0 }}>
                        Open →
                      </div>
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={function () { setPhoneConfirmed(true) }}
                style={{
                  width: '100%', padding: '9px 0', borderRadius: 8,
                  border: '1.5px dashed var(--border)', background: 'none',
                  font: '600 12px var(--font)', color: 'var(--text2)', cursor: 'pointer',
                }}
              >
                ➕ Enrol as new student with this number anyway
              </button>
            </div>
          )}

          {/* ── Phase 2b: full form (no matches, or user confirmed new) ── */}
          {(phoneMatches.length === 0 || phoneConfirmed) && (<>

          {/* ── Section 1: Student basics ── */}
          <div className="form-grid">
            <label>Student Name *
              <input value={form.full_name} onChange={field('full_name')} placeholder="Full name" />
            </label>
            <label>Parent / Guardian
              <input value={form.parent_name} onChange={field('parent_name')} placeholder="Parent name" />
            </label>
            <label>Gender
              <select value={form.gender} onChange={field('gender')}>
                <option value="">— Select —</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <label>Date of Birth
              <input type="date" value={form.dob} onChange={field('dob')} />
            </label>
            <label>Date of Registration
              <input type="date" value={form.registered_at} onChange={field('registered_at')} />
            </label>
            <label>Parent Email *
              <input type="email" value={form.email} onChange={field('email')} placeholder="parent@email.com" />
            </label>
          </div>

          {/* ── Section 2: Centre ── */}
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, marginTop:12 }}>
            <div style={{ font:'600 12px var(--font)', color:'var(--text)', marginBottom:8 }}>
              Enrolment Centre *
            </div>
            {admin ? (() => {
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

          </>)}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          {(phoneMatches.length === 0 || phoneConfirmed) && (
            <button className="btn-p" onClick={save} disabled={saving}>
              {saving ? 'Adding…' : 'Add Student'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── StudentsPage ───────────────────────────────────────────────────────────────

export default function StudentsPage() {
  const { currentRole, currentFranchiseeId } = useAuth()
  const admin = isAdminRole(currentRole)

  const [students, setStudents]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [centreFilter, setCentreFilter] = useState('')
  const [exporting, setExporting] = useState(false)
  const [selected, setSelected] = useState(null)
  const [showAdd, setShowAdd] = useState(false)

  const showCentreCol = admin || currentRole === 'smf' || currentRole === 'cf'

  useEffect(() => {
    if (currentRole === null) return   // wait for auth to resolve
    async function load() {
      setLoading(true)
      let q = sb.from('students')
        .select('*, franchisees(business_name, city), enrollments(id, sku_id, completed_at, status, cert_emailed_at, cert_wa_sent_at, skus(level_name, courses(group_name)))')
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

  const centreOptions = showCentreCol
    ? [...new Map(
        students.filter(function (s) { return s.franchisees }).map(function (s) {
          return [s.franchisee_id, { id: s.franchisee_id, name: s.franchisees?.business_name, city: s.franchisees?.city }]
        })
      ).values()].sort(function (a, b) { return (a.name || '').localeCompare(b.name || '') })
    : []

  const filtered = students.filter(function (s) {
    const q = search.toLowerCase()
    const matchesSearch = !q || s.full_name?.toLowerCase().includes(q) || s.parent_name?.toLowerCase().includes(q) || s.phone?.includes(q)
    const matchesCentre = !centreFilter || s.franchisee_id === centreFilter
    return matchesSearch && matchesCentre
  })

  function handleSaved(updated) {
    if (updated === null) {
      // Student was deleted — remove from list and close modal
      setStudents(function (ss) { return ss.filter(function (s) { return s.id !== selected?.id }) })
      setSelected(null)
      return
    }
    setStudents(ss => ss.map(s => s.id === updated.id ? { ...s, ...updated } : s))
    setSelected(s => s && s.id === updated.id ? { ...s, ...updated } : s)
  }

  function handleAdded(st) {
    setStudents(ss => [{ ...st, enrollments: [] }, ...ss])
    setShowAdd(false)
  }

  function handleOpenExisting(st) {
    setShowAdd(false)
    setSelected(st)
  }

  // Tone index per course name (cycle through 8 tones)
  const courseList = [...new Set(students.flatMap(s => (s.enrollments || []).map(e => e.skus?.courses?.group_name).filter(Boolean)))]
  function courseTone(name) {
    const idx = courseList.indexOf(name)
    return (idx % 8) + 1
  }

  function exportCSV() {
    // Use the already-loaded, role-filtered students state
    if (!students.length) { showToast('No students to export.', 'warn'); return }
    setExporting(true)
    try {
      const date = new Date().toISOString().slice(0, 10)
      function esc(v) {
        if (v == null || v === '') return ''
        const s = String(v)
        return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s
      }
      const headers = ['Student Name','Parent Name','Phone','Email','City','State','Fee Total','Fee Paid','Payment Status','Courses']
      const rows    = students.map(function (r) {
        const courses = (r.enrollments || [])
          .map(function (e) { return e.skus?.courses?.group_name })
          .filter(Boolean)
          .filter(function (c, i, a) { return a.indexOf(c) === i })
          .join('; ')
        return [r.full_name, r.parent_name, r.phone, r.email, r.city, r.state, r.fee_total || 0, r.fee_paid || 0, r.payment_status, courses]
      })
      const csv  = headers.join(',') + '\n' + rows.map(function (r) { return r.map(esc).join(',') }).join('\n')
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'nlh-students-' + date + '.csv'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(rows.length + ' students exported ✓')
    } catch (err) {
      showToast('Export failed: ' + err.message, 'err')
    }
    setExporting(false)
  }

  return (
    <div className="pg">
      {/* Topbar */}
      <header className="tb">
        <div className="crumb">Operations <span className="sep">›</span> <b>Students</b></div>
        <div className="tb-r">
          {showCentreCol && centreOptions.length > 1 && (
            <select
              value={centreFilter}
              onChange={function (e) { setCentreFilter(e.target.value) }}
              style={{ fontSize: 12 }}
            >
              <option value="">All centres</option>
              {centreOptions.map(function (c) {
                return <option key={c.id} value={c.id}>{c.name}{c.city ? ' — ' + c.city : ''}</option>
              })}
            </select>
          )}
          <input
            className="search tb-search"
            placeholder="Search students by name or parent…"
            value={search}
            onChange={function (e) { setSearch(e.target.value) }}
          />
          <button className="btn btn-s" onClick={exportCSV} disabled={exporting} title="Export CSV">
            {exporting ? '…' : '↓'}<span className="btn-label">{exporting ? ' Exporting' : ' Export'}</span>
          </button>
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
              {currentRole === 'uf'
                ? <><b>{students.length} students</b> enrolled at your centre.</>
                : <><b>{students.length} students</b>{showCentreCol ? ' enrolled across your territory.' : ' enrolled across all centres.'}</>
              }
            </div>
          </div>
        </div>

        {/* Stats */}
        {(function() {
          const totalCharged  = students.reduce(function(s, r) { return s + (Number(r.fee_total) || 0) }, 0)
          const totalReceived = students.reduce(function(s, r) { return s + (Number(r.fee_paid)  || 0) }, 0)
          const totalBalance  = totalCharged - totalReceived
          return (
            <div className="mini-stats">
              <div className="mini">
                <div className="mini-ic" style={{ background: 'var(--purple-bg)' }}>🎓</div>
                <div className="mini-num">{students.length}</div>
                <div className="mini-lbl">Total enrolled</div>
              </div>
              <div className="mini">
                <div className="mini-ic" style={{ background: 'var(--sun-bg)' }}>💰</div>
                <div className="mini-num" style={{ fontSize: totalCharged >= 100000 ? 18 : undefined }}>₹{fmtAmt(totalCharged)}</div>
                <div className="mini-lbl">Fees charged</div>
              </div>
              <div className="mini">
                <div className="mini-ic" style={{ background: 'var(--green-bg)' }}>✅</div>
                <div className="mini-num" style={{ fontSize: totalReceived >= 100000 ? 18 : undefined }}>₹{fmtAmt(totalReceived)}</div>
                <div className="mini-lbl">Fees received</div>
              </div>
              <div className="mini">
                <div className="mini-ic" style={{ background: totalBalance > 0 ? 'var(--red-bg)' : 'var(--green-bg)' }}>⏳</div>
                <div className="mini-num" style={{ color: totalBalance > 0 ? 'var(--red, #dc2626)' : undefined, fontSize: totalBalance >= 100000 ? 18 : undefined }}>₹{fmtAmt(totalBalance)}</div>
                <div className="mini-lbl">Balance due</div>
              </div>
            </div>
          )
        })()}

        {/* Students table */}
        {loading ? (
          <div className="loading">Loading students…</div>
        ) : (
          <div className="card tbl-scroll" style={{ marginBottom: 0 }}>
            <table className="big-tbl">
              <thead>
                <tr>
                  <th>Student</th>
                  {showCentreCol && <th className="hide-mobile">Centre</th>}
                  <th className="hide-mobile">Parent</th>
                  <th>Courses</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Fee Total</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Fee Paid</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Balance</th>
                  <th>Status</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={showCentreCol ? 9 : 8} className="empty">No students found</td></tr>
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
                            {(s.registered_at || s.created_at) && (
                              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
                                Joined {new Date(s.registered_at || s.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      {showCentreCol && (
                        <td className="hide-mobile" style={{ color: 'var(--text2)', fontSize: 12 }}>
                          <div>{s.franchisees?.business_name || '—'}</div>
                          {s.franchisees?.city && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{s.franchisees.city}</div>}
                        </td>
                      )}
                      <td className="hide-mobile" style={{ color: 'var(--text2)' }}>
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
                      <td className="hide-mobile" style={{ textAlign: 'right' }}><div className="amt">₹{fmtAmt(s.fee_total)}</div></td>
                      <td className="hide-mobile" style={{ textAlign: 'right' }}><div className="amt" style={{ color: 'var(--green)' }}>₹{fmtAmt(s.fee_paid)}</div></td>
                      <td className="hide-mobile" style={{ textAlign: 'right' }}>
                        <div className="amt" style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}>₹{fmtAmt(balance)}</div>
                      </td>
                      <td><StatusBadge status={s.payment_status} /></td>
                      <td className="hide-mobile" style={{ textAlign: 'right' }}>
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
          onOpenExisting={handleOpenExisting}
        />
      )}
    </div>
  )
}

