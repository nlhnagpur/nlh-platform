import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtDate, showToast } from '../utils'
import { isAdminRole } from '../constants/roles'

// ── helpers ────────────────────────────────────────────────────────────────────

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function timeRange(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const end = ((h + 1) % 24).toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0')
  return t.slice(0, 5) + ' – ' + end
}

function StatusBadge({ status }) {
  const map = { active: 'ba', inactive: 'bd', resigned: 'bd', terminated: 'br' }
  return <span className={`badge ${map[status] || 'br'}`}>{status || '—'}</span>
}

function CautionBadge({ status }) {
  const map = { held: 'bp', refunded: 'ba', forfeited: 'bd', partial: 'br' }
  return <span className={`badge ${map[status] || 'bp'}`}>{status || 'held'}</span>
}

function avatar(name) {
  return (name || '?').split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()
}

const REMUN_LABELS = {
  per_student: 'Per Student (on completion)',
  per_session: 'Per Session (1 hr)',
  monthly:     'Monthly Fixed',
}

const REMUN_SUFFIX = {
  per_student: '/ student',
  per_session: '/ session',
  monthly:     '/ month',
}

// ── InstructorDetailModal ──────────────────────────────────────────────────────

// Group flat SKU list into [{courseName, skus:[]}] for optgroup dropdowns
function groupSkus(allSkus) {
  const map = {}
  allSkus.forEach(function (s) {
    const g = s.courses?.group_name || 'Other'
    if (!map[g]) map[g] = []
    map[g].push(s)
  })
  return Object.entries(map).map(function ([name, skus]) { return { name, skus } })
}

const BLANK_BATCH = { name: '', days: [], time: '', start_date: '', is_individual: false, notes: '' }

function InstructorDetailModal({ instructor, allSkus, nlhCentreId, onClose, onSaved, inline }) {
  const [tab, setTab]           = useState('profile')
  const [tabLoaded, setTabLoaded] = useState({ profile: true, caution: false, courses: false, batches: false, payroll: false })
  const [saving, setSaving]     = useState(false)

  // ── Payroll state ──
  const [payrollMonth,       setPayrollMonth]       = useState(new Date().toISOString().slice(0, 7))
  const [payrollSessions,    setPayrollSessions]    = useState([])
  const [payrollAppts,       setPayrollAppts]       = useState([])
  const [payrollCompletions, setPayrollCompletions] = useState({}) // batchId → count completed this month
  const [payrollTotalSess,   setPayrollTotalSess]   = useState({}) // batchId → total non-holiday sessions (incl. subs)
  const [payrollOverride,    setPayrollOverride]    = useState(null)  // { id, final_amount, notes } or null
  const [overrideEdit,       setOverrideEdit]       = useState(false) // editing override inline
  const [overrideForm,       setOverrideForm]       = useState({ amount: '', notes: '' })
  const [savingOverride,     setSavingOverride]     = useState(false)
  const [payrollLoading,     setPayrollLoading]     = useState(false)
  const [coursesCount, setCoursesCount] = useState(null)
  const [batchesCount, setBatchesCount] = useState(null)

  useEffect(function () {
    sb.from('instructor_courses').select('id', { count: 'exact', head: true })
      .eq('instructor_id', instructor.id)
      .then(function ({ count }) { setCoursesCount(count || 0) })
    sb.from('batches').select('id', { count: 'exact', head: true })
      .eq('instructor_id', instructor.id)
      .then(function ({ count }) { setBatchesCount(count || 0) })
  }, [instructor.id])

  // ── Profile form ──
  const [form, setForm] = useState({
    full_name:  instructor.full_name  || '',
    phone:      instructor.phone      || '',
    email:      instructor.email      || '',
    address:    instructor.address    || '',
    area:       instructor.area       || '',
    city:       instructor.city       || '',
    state:      instructor.state      || '',
    pincode:    instructor.pincode    || '',
    joined_at:  instructor.joined_at  || '',
    left_at:    instructor.left_at    || '',
    status:     instructor.status     || 'active',
    notes:      instructor.notes      || '',
  })

  // ── Caution form ──
  const [caution, setCaution] = useState({
    caution_amount:            instructor.caution_amount            ?? 0,
    caution_paid_at:           instructor.caution_paid_at           || '',
    caution_mode:              instructor.caution_mode              || '',
    caution_status:            instructor.caution_status            || 'held',
    caution_settled_at:        instructor.caution_settled_at        || '',
    caution_settlement_amount: instructor.caution_settlement_amount ?? '',
    caution_notes:             instructor.caution_notes             || '',
  })

  // ── Courses state ──
  const [appointments,  setAppointments]  = useState([])
  const [showAddCourse, setShowAddCourse] = useState(false)
  const [newAppt, setNewAppt] = useState({
    course_name: '', selectedSkuIds: [],
    trained_by_nlh: false, training_fee: '', training_date: '',
    remuneration_mode: 'per_student', remuneration_rate: '',
    appointed_at: new Date().toISOString().split('T')[0], notes: '',
  })
  const [editApptId,   setEditApptId]   = useState(null)
  const [editApptForm, setEditApptForm] = useState({})

  // ── Batches state ──
  const [batchList,     setBatchList]     = useState([])   // flat list of batches
  const [openRoster,    setOpenRoster]    = useState({})   // { batch_id: bool }
  const [showAddBatch,  setShowAddBatch]  = useState(false)
  const [batchForm,     setBatchForm]     = useState({ ...BLANK_BATCH })
  const [addStudentFor, setAddStudentFor] = useState(null) // batch_id | null
  const [eligibleEnr,   setEligibleEnr]   = useState([])
  const [batchSaving,     setBatchSaving]     = useState(false)
  const [editBatchModal,  setEditBatchModal]  = useState(null) // batch object
  const [attendanceBatch, setAttendanceBatch] = useState(null) // batch object

  function fld(k)  { return function (e) { setForm(f    => ({ ...f, [k]: e.target.value })) } }
  function cfd(k)  { return function (e) { setCaution(c => ({ ...c, [k]: e.target.value })) } }
  function nfd(k)  { return function (e) { setNewAppt(a => ({ ...a, [k]: e.target.value })) } }

  async function loadTab(t) {
    setTab(t)
    if (tabLoaded[t]) return
    setTabLoaded(tl => ({ ...tl, [t]: true }))
    if (t === 'courses') {
      const { data } = await sb.from('instructor_courses')
        .select('*, skus(id,level_name,total_sessions,courses(group_name))')
        .eq('instructor_id', instructor.id)
        .order('appointed_at', { ascending: false })
      setAppointments(data || [])
    }
    if (t === 'batches') {
      const { data: batchRows } = await sb.from('batches')
        .select(`id, instructor_id, name, is_individual, schedule_days, schedule_time,
                 is_active, start_date, sessions_done, notes, created_at,
                 batch_students(id, enrollment_id, assigned_at, removed_at,
                   enrollments(id, student_id, sku_id, students(id, full_name),
                     skus(level_name, courses(group_name))))`)
        .eq('instructor_id', instructor.id)
        .order('is_active', { ascending: false })
        .order('created_at')
      setBatchList(batchRows || [])
    }
  }

  // ── Payroll loader (re-runs on month change) ──
  useEffect(function () {
    if (tab !== 'payroll') return
    async function loadPayroll() {
      setPayrollLoading(true)
      var parts    = payrollMonth.split('-')
      var yr       = parseInt(parts[0]), mo = parseInt(parts[1])
      var startDate = parts[0] + '-' + parts[1] + '-01'
      var lastDay   = new Date(yr, mo, 0).getDate()
      var endDate   = parts[0] + '-' + parts[1] + '-' + String(lastDay).padStart(2, '0')
      var [sessRes, apptRes] = await Promise.all([
        sb.from('batch_sessions')
          .select('id, session_date, batch_id, batches(id, name, sku_id, skus(level_name, courses(group_name)))')
          .eq('instructor_id', instructor.id)
          .eq('is_substitute', false)
          .gte('session_date', startDate)
          .lte('session_date', endDate),
        sb.from('instructor_courses')
          .select('id, sku_id, remuneration_mode, remuneration_rate, skus(level_name, courses(group_name))')
          .eq('instructor_id', instructor.id)
          .eq('status', 'active'),
      ])

      // ── Per-student completions: count enrollments completed this month per batch ──
      var batchIds = [...new Set((sessRes.data || []).map(function (s) { return s.batch_id }))]
      var completionMap = {}
      var totalSessMap  = {}

      if (batchIds.length > 0) {
        // Completions in month
        var { data: bsRows } = await sb.from('batch_students')
          .select('batch_id, enrollments(id, completed_at)')
          .in('batch_id', batchIds)
        ;(bsRows || []).forEach(function (bs) {
          var ca = bs.enrollments?.completed_at
          if (ca) {
            var caDate = ca.slice(0, 10)
            if (caDate >= startDate && caDate <= endDate) {
              completionMap[bs.batch_id] = (completionMap[bs.batch_id] || 0) + 1
            }
          }
        })

        // Total non-holiday sessions per batch in the month (includes substitutes)
        // Used to prorate per-student pay: CI taught ciSessions/totalSessions of the batch
        var { data: allSessRows } = await sb.from('batch_sessions')
          .select('batch_id')
          .in('batch_id', batchIds)
          .eq('is_holiday', false)
          .gte('session_date', startDate)
          .lte('session_date', endDate)
        ;(allSessRows || []).forEach(function (s) {
          totalSessMap[s.batch_id] = (totalSessMap[s.batch_id] || 0) + 1
        })
      }

      // ── Fetch any saved override for this instructor + month ──
      var { data: ovRow } = await sb.from('payroll_overrides')
        .select('id, final_amount, notes')
        .eq('instructor_id', instructor.id)
        .eq('month', payrollMonth)
        .maybeSingle()

      setPayrollSessions(sessRes.data || [])
      setPayrollAppts(apptRes.data || [])
      setPayrollCompletions(completionMap)
      setPayrollTotalSess(totalSessMap)
      setPayrollOverride(ovRow || null)
      setOverrideEdit(false)
      setPayrollLoading(false)
    }
    loadPayroll()
  }, [tab, payrollMonth])

  // ── Payroll override save/clear ──
  async function saveOverride(grandTotal) {
    var amt = parseInt(overrideForm.amount, 10)
    if (isNaN(amt) || amt < 0) { showToast('Enter a valid amount', 'warn'); return }
    setSavingOverride(true)
    if (payrollOverride) {
      // Update existing
      var { error } = await sb.from('payroll_overrides')
        .update({ final_amount: amt, notes: overrideForm.notes.trim() || null, updated_at: new Date().toISOString() })
        .eq('id', payrollOverride.id)
      if (error) { showToast('Save failed: ' + error.message, 'err'); setSavingOverride(false); return }
      setPayrollOverride({ ...payrollOverride, final_amount: amt, notes: overrideForm.notes.trim() || null })
    } else {
      // Insert new
      var { data: newRow, error: insErr } = await sb.from('payroll_overrides')
        .insert({ instructor_id: instructor.id, month: payrollMonth, final_amount: amt, notes: overrideForm.notes.trim() || null })
        .select('id, final_amount, notes').single()
      if (insErr) { showToast('Save failed: ' + insErr.message, 'err'); setSavingOverride(false); return }
      setPayrollOverride(newRow)
    }
    setOverrideEdit(false)
    setSavingOverride(false)
    showToast('Agreed amount saved ✓')
  }

  async function clearOverride() {
    if (!payrollOverride) return
    var { error } = await sb.from('payroll_overrides').delete().eq('id', payrollOverride.id)
    if (error) { showToast('Clear failed: ' + error.message, 'err'); return }
    setPayrollOverride(null)
    setOverrideEdit(false)
    showToast('Override cleared — showing calculated amount')
  }

  // ── Save profile ──
  async function saveProfile() {
    if (!form.full_name.trim()) { showToast('Name is required', 'warn'); return }
    setSaving(true)
    const payload = {
      full_name: form.full_name.trim(),
      phone:     form.phone.trim()   || null,
      email:     form.email.trim()   || null,
      address:   form.address.trim() || null,
      area:      form.area.trim()    || null,
      city:      form.city.trim()    || null,
      state:     form.state.trim()   || null,
      pincode:   form.pincode.trim() || null,
      joined_at: form.joined_at      || null,
      left_at:   form.left_at        || null,
      status:    form.status,
      notes:     form.notes.trim()   || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await sb.from('instructors').update(payload).eq('id', instructor.id)
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    showToast('Profile saved')
    onSaved({ ...instructor, ...payload })
  }

  // ── Save caution ──
  async function saveCaution() {
    setSaving(true)
    const payload = {
      caution_amount:            Number(caution.caution_amount) || 0,
      caution_paid_at:           caution.caution_paid_at           || null,
      caution_mode:              caution.caution_mode              || null,
      caution_status:            caution.caution_status,
      caution_settled_at:        caution.caution_settled_at        || null,
      caution_settlement_amount: caution.caution_settlement_amount !== ''
                                   ? Number(caution.caution_settlement_amount) : null,
      caution_notes:             caution.caution_notes.trim()      || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await sb.from('instructors').update(payload).eq('id', instructor.id)
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    showToast('Caution deposit saved')
    onSaved({ ...instructor, ...payload })
  }

  // ── Add course appointment (multi-level) ──
  async function addAppointment() {
    if (!newAppt.course_name)              { showToast('Select a course', 'warn');              return }
    if (!newAppt.selectedSkuIds.length)    { showToast('Select at least one level', 'warn');    return }
    if (!newAppt.remuneration_rate)        { showToast('Enter remuneration rate', 'warn');      return }
    setSaving(true)
    const rows = newAppt.selectedSkuIds.map(function (skuId) {
      return {
        instructor_id:     instructor.id,
        sku_id:            skuId,
        trained_by_nlh:    newAppt.trained_by_nlh,
        training_fee:      newAppt.trained_by_nlh && newAppt.training_fee ? Number(newAppt.training_fee) : null,
        training_date:     newAppt.trained_by_nlh && newAppt.training_date ? newAppt.training_date : null,
        remuneration_mode: newAppt.remuneration_mode,
        remuneration_rate: Number(newAppt.remuneration_rate),
        appointed_at:      newAppt.appointed_at,
        notes:             newAppt.notes.trim() || null,
      }
    })
    const { data, error } = await sb.from('instructor_courses')
      .insert(rows)
      .select('*, skus(id,level_name,total_sessions,courses(group_name))')
    setSaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    setAppointments(function (a) { return [...(data || []), ...a] })
    setShowAddCourse(false)
    setNewAppt({
      course_name: '', selectedSkuIds: [],
      trained_by_nlh: false, training_fee: '', training_date: '',
      remuneration_mode: 'per_student', remuneration_rate: '',
      appointed_at: new Date().toISOString().split('T')[0], notes: '',
    })
    showToast((data || []).length + ' level' + ((data || []).length !== 1 ? 's' : '') + ' appointed')
  }

  // ── Toggle appointment active/inactive ──
  async function toggleApptStatus(appt) {
    const newStatus  = appt.status === 'active' ? 'inactive' : 'active'
    const removed_at = newStatus === 'inactive' ? new Date().toISOString().split('T')[0] : null
    const { error }  = await sb.from('instructor_courses')
      .update({ status: newStatus, removed_at }).eq('id', appt.id)
    if (error) { showToast('Update failed', 'err'); return }
    setAppointments(function (a) { return a.map(function (x) { return x.id === appt.id ? { ...x, status: newStatus, removed_at } : x }) })
    showToast(newStatus === 'active' ? 'Reactivated' : 'Deactivated')
  }

  // ── Edit existing appointment ──
  function startEditAppt(appt) {
    setEditApptId(appt.id)
    setEditApptForm({
      remuneration_mode: appt.remuneration_mode,
      remuneration_rate: appt.remuneration_rate,
      trained_by_nlh:    appt.trained_by_nlh,
      training_fee:      appt.training_fee  ?? '',
      training_date:     appt.training_date || '',
      notes:             appt.notes         || '',
    })
  }

  async function saveEditAppt() {
    if (!editApptForm.remuneration_rate) { showToast('Rate is required', 'warn'); return }
    setSaving(true)
    const payload = {
      remuneration_mode: editApptForm.remuneration_mode,
      remuneration_rate: Number(editApptForm.remuneration_rate),
      trained_by_nlh:    editApptForm.trained_by_nlh,
      training_fee:      editApptForm.trained_by_nlh && editApptForm.training_fee ? Number(editApptForm.training_fee) : null,
      training_date:     editApptForm.trained_by_nlh && editApptForm.training_date ? editApptForm.training_date : null,
      notes:             editApptForm.notes?.trim() || null,
    }
    const { error } = await sb.from('instructor_courses').update(payload).eq('id', editApptId)
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    setAppointments(function (a) { return a.map(function (x) { return x.id === editApptId ? { ...x, ...payload } : x }) })
    setEditApptId(null)
    showToast('Appointment updated')
  }

  // ── Batch functions ──────────────────────────────────────────────────────────

  function updateBatch(id, patch) {
    setBatchList(function (prev) { return prev.map(function (b) { return b.id === id ? { ...b, ...patch } : b }) })
  }

  async function saveBatch() {
    if (!batchForm.name.trim()) { showToast('Batch name is required', 'warn'); return }
    setBatchSaving(true)
    const { data, error } = await sb.from('batches').insert({
      instructor_id:  instructor.id,
      franchisee_id:  nlhCentreId || null,
      name:           batchForm.name.trim(),
      is_individual:  batchForm.is_individual,
      schedule_days:  batchForm.days.length ? batchForm.days.join(', ') : null,
      schedule_time:  batchForm.time || null,
      start_date:     batchForm.start_date || null,
      is_active:      true,
      sessions_done:  0,
      notes:          batchForm.notes.trim() || null,
    }).select(`id, instructor_id, name, is_individual, schedule_days, schedule_time,
               is_active, start_date, sessions_done, notes, created_at,
               batch_students(id, enrollment_id, assigned_at, removed_at,
                 enrollments(id, student_id, sku_id, students(id, full_name),
                   skus(level_name, courses(group_name))))`).single()
    setBatchSaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    setBatchList(function (prev) { return [data, ...prev] })
    setShowAddBatch(false)
    setBatchForm({ ...BLANK_BATCH })
    showToast('Batch created')
  }

  async function toggleBatchActive(batch) {
    const is_active = !batch.is_active
    const { error } = await sb.from('batches').update({ is_active }).eq('id', batch.id)
    if (error) { showToast('Update failed', 'err'); return }
    updateBatch(batch.id, { is_active })
  }

  async function adjustSessions(batch, delta) {
    const sessions_done = Math.max(0, (batch.sessions_done || 0) + delta)
    const { error } = await sb.from('batches').update({ sessions_done }).eq('id', batch.id)
    if (error) { showToast('Update failed', 'err'); return }
    updateBatch(batch.id, { sessions_done })
  }

  async function openAddStudentPanel(batch) {
    setAddStudentFor(batch.id)
    // Fresh fetch — don't rely on stale batchList for "already in" check
    const { data: freshBS } = await sb.from('batch_students')
      .select('enrollment_id')
      .eq('batch_id', batch.id)
      .is('removed_at', null)
    const alreadyIn = (freshBS || []).map(function (bs) { return bs.enrollment_id })

    // Only show students enrolled in SKUs this CI is actively appointed to teach
    const { data: appts } = await sb.from('instructor_courses')
      .select('sku_id')
      .eq('instructor_id', instructor.id)
      .eq('status', 'active')
    const ciSkuIds = (appts || []).map(function (a) { return a.sku_id })

    if (ciSkuIds.length === 0) { setEligibleEnr([]); return }

    const { data } = await sb.from('enrollments')
      .select('id, student_id, sku_id, students(id, full_name), skus(level_name, courses(group_name))')
      .eq('franchisee_id', nlhCentreId)
      .eq('status', 'active')
      .in('sku_id', ciSkuIds)
    setEligibleEnr((data || []).filter(function (e) { return !alreadyIn.includes(e.id) }))
  }

  async function assignStudent(batch_id, enrollment_id) {
    const { data, error } = await sb.from('batch_students')
      .insert({ batch_id, enrollment_id })
      .select('id, enrollment_id, assigned_at, removed_at, enrollments(id, student_id, sku_id, students(id, full_name), skus(level_name, courses(group_name)))')
      .single()
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    setBatchList(function (prev) {
      return prev.map(function (b) {
        if (b.id !== batch_id) return b
        return { ...b, batch_students: [...(b.batch_students || []), data] }
      })
    })
    setEligibleEnr(function (e) { return e.filter(function (x) { return x.id !== enrollment_id }) })
    setAddStudentFor(null)
    showToast('Student added to batch')
  }

  async function removeStudentFromBatch(batch_id, bs_id) {
    const removed_at = new Date().toISOString()
    const { error } = await sb.from('batch_students').update({ removed_at }).eq('id', bs_id)
    if (error) { showToast('Remove failed', 'err'); return }
    setBatchList(function (prev) {
      return prev.map(function (b) {
        if (b.id !== batch_id) return b
        return { ...b, batch_students: b.batch_students.map(function (bs) {
          return bs.id === bs_id ? { ...bs, removed_at } : bs
        })}
      })
    })
  }

  const appointedSkuIds  = appointments.filter(function (a) { return a.status === 'active' }).map(function (a) { return a.sku_id })
  const availableSkus    = allSkus.filter(function (s) { return !appointedSkuIds.includes(s.id) })
  // Course names that still have at least one unapppointed level
  const availableCourseNames = Array.from(new Set(
    availableSkus.map(function (s) { return s.courses?.group_name }).filter(Boolean)
  )).sort()
  function levelsForCourse(courseName) {
    return availableSkus.filter(function (s) { return s.courses?.group_name === courseName })
  }
  const showSettlement   = ['refunded', 'partial', 'forfeited'].includes(caution.caution_status)

  return (
    <div className={inline ? '' : 'modal-bg'} onClick={inline ? undefined : function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className={inline ? '' : 'modal'}
        style={inline ? { width: '100%', background: 'var(--card, #fff)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.05)' } : { width: 700, maxWidth: '96vw' }}>

        {/* Hero header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '18px 20px 14px', background: 'linear-gradient(135deg,#f5f3ff,#ede9fe)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ width: 50, height: 50, borderRadius: 13, flexShrink: 0, background: '#ede9fe', color: '#6d28d9', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 17px var(--font)' }}>
            {avatar(instructor.full_name)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 2 }}>
              <span style={{ font: '700 15px var(--font)', color: 'var(--text)' }}>{instructor.full_name}</span>
              <StatusBadge status={instructor.status} />
            </div>
            {(instructor.city || instructor.area) && (
              <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>
                📍 {[instructor.area, instructor.city].filter(Boolean).join(', ')}
              </div>
            )}
          </div>
          <button className="btn-icon" onClick={onClose} style={{ flexShrink: 0, marginTop: -2 }}>✕</button>
        </div>

        {/* Stats strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
          {[
            { label: 'Batches',  val: batchesCount  === null ? '…' : String(batchesCount),  color: 'var(--purple)' },
            { label: 'Courses',  val: coursesCount  === null ? '…' : String(coursesCount),  color: 'var(--blue)' },
            { label: 'Since',    val: instructor.joined_at ? new Date(instructor.joined_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—', color: 'var(--text2)' },
            { label: 'Caution',  val: form.caution_status ? (form.caution_status.charAt(0).toUpperCase() + form.caution_status.slice(1)) : '—', color: form.caution_status === 'held' ? '#b45309' : form.caution_status === 'refunded' ? 'var(--green)' : 'var(--text3)' },
          ].map(function (st, i) {
            return (
              <div key={i} style={{ padding: '9px 14px', borderRight: i < 3 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ font: '500 9px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>{st.label}</div>
                <div style={{ font: '700 14px var(--font)', color: st.color }}>{st.val}</div>
              </div>
            )
          })}
        </div>

        {/* tabs */}
        <div className="tabs">
          {[['profile','👤 Profile'],['caution','🔒 Caution'],['courses','📚 Courses'],['batches','📦 Batches'],['payroll','💰 Payroll']].map(function ([id, label]) {
            return (
              <button key={id}
                className={'tab ' + (tab === id ? 'active' : '')}
                onClick={function () { loadTab(id) }}>
                {label}
              </button>
            )
          })}
        </div>

        {/* ══ Profile tab ══════════════════════════════════════════════════════ */}
        {tab === 'profile' && (
          <div>
            <div className="form-grid">
              <label className="col-span-2">Full Name *
                <input value={form.full_name} onChange={fld('full_name')} placeholder="Instructor's full name" />
              </label>
              <label>Phone
                <input value={form.phone} onChange={fld('phone')} placeholder="Mobile number" />
              </label>
              <label>Email
                <input type="email" value={form.email} onChange={fld('email')} placeholder="Email address" />
              </label>
              <label>City
                <input value={form.city} onChange={fld('city')} placeholder="Nagpur" />
              </label>
              <label>Area / Locality
                <input value={form.area} onChange={fld('area')} placeholder="Sadar, Dharampeth…" />
              </label>
              <label>State
                <input value={form.state} onChange={fld('state')} placeholder="Maharashtra" />
              </label>
              <label>PIN Code
                <input value={form.pincode} onChange={fld('pincode')} placeholder="440001" />
              </label>
              <label className="col-span-2">Street / Building Address
                <input value={form.address} onChange={fld('address')} placeholder="Flat / building / street" />
              </label>
              <label>Status
                <select value={form.status} onChange={fld('status')}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="resigned">Resigned</option>
                  <option value="terminated">Terminated</option>
                </select>
              </label>
              <label>Joined Date
                <input type="date" value={form.joined_at} onChange={fld('joined_at')} />
              </label>
              <label>Left Date
                <input type="date" value={form.left_at} onChange={fld('left_at')} />
              </label>
              <label className="col-span-2">Notes / Remarks
                <textarea value={form.notes} onChange={fld('notes')} rows={2}
                  placeholder="Any internal notes…" style={{ resize: 'vertical' }} />
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn-p" onClick={saveProfile} disabled={saving}>
                {saving ? 'Saving…' : 'Save Profile'}
              </button>
            </div>
          </div>
        )}

        {/* ══ Caution tab ══════════════════════════════════════════════════════ */}
        {tab === 'caution' && (
          <div>
            {/* summary bar */}
            <div style={{
              margin: '0 20px 14px', padding: '10px 14px', borderRadius: 8,
              background: 'var(--purple-bg)', border: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>Caution held</div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>
                  ₹{Number(caution.caution_amount || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <CautionBadge status={caution.caution_status} />
            </div>

            <div className="form-grid">
              <label>Amount (₹) *
                <input type="number" value={caution.caution_amount} onChange={cfd('caution_amount')} placeholder="0" />
              </label>
              <label>Collection Mode
                <select value={caution.caution_mode} onChange={cfd('caution_mode')}>
                  <option value="">— Select —</option>
                  <option value="upfront">Paid upfront on joining</option>
                  <option value="deducted">Deducted from first payment</option>
                  <option value="waived">Waived</option>
                </select>
              </label>
              <label>Date Paid / Deducted
                <input type="date" value={caution.caution_paid_at} onChange={cfd('caution_paid_at')} />
              </label>
              <label>Deposit Status
                <select value={caution.caution_status} onChange={cfd('caution_status')}>
                  <option value="held">Held (active)</option>
                  <option value="refunded">Refunded in full</option>
                  <option value="partial">Partially refunded</option>
                  <option value="forfeited">Forfeited</option>
                </select>
              </label>
              {showSettlement && (
                <>
                  <label>Settlement Date
                    <input type="date" value={caution.caution_settled_at} onChange={cfd('caution_settled_at')} />
                  </label>
                  <label>Settlement Amount (₹)
                    <input type="number" value={caution.caution_settlement_amount}
                      onChange={cfd('caution_settlement_amount')}
                      placeholder="Amount returned / forfeited" />
                  </label>
                </>
              )}
              <label className="col-span-2">Notes
                <textarea value={caution.caution_notes} onChange={cfd('caution_notes')} rows={2}
                  placeholder="Notes on the deposit…" style={{ resize: 'vertical' }} />
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn-p" onClick={saveCaution} disabled={saving}>
                {saving ? 'Saving…' : 'Save Caution'}
              </button>
            </div>
          </div>
        )}

        {/* ══ Courses tab ══════════════════════════════════════════════════════ */}
        {tab === 'courses' && (
          <div>
            <div style={{ padding: '0 20px 12px' }}>

              {/* ── Progression view ─────────────────────────────────────────── */}
              {(function () {
                // Build: courseName → [{sku, appt|null}] preserving sort_order
                const courseMap = {}
                allSkus.forEach(function (s) {
                  const g = s.courses?.group_name || 'Other'
                  if (!courseMap[g]) courseMap[g] = []
                  const appt = appointments.find(function (a) { return a.sku_id === s.id }) || null
                  courseMap[g].push({ sku: s, appt })
                })

                // Only render courses where CI has at least one appointment record
                const appointedCourses = Object.entries(courseMap)
                  .filter(function ([, levels]) { return levels.some(function (l) { return l.appt }) })
                  .map(function ([name, levels]) { return { name, levels } })

                if (appointedCourses.length === 0) {
                  return (
                    <p className="hint" style={{ marginBottom: 10 }}>
                      No course appointments yet. Use the button below to appoint this CI to a course level.
                    </p>
                  )
                }

                return appointedCourses.map(function (course) {
                  const activeCount = course.levels.filter(function (l) { return l.appt?.status === 'active' }).length

                  return (
                    <div key={course.name} style={{
                      marginBottom: 12, borderRadius: 8,
                      border: '1px solid var(--border)', padding: '12px 14px',
                    }}>
                      {/* Course header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{course.name}</div>
                        <div style={{ font: '400 11px var(--mono)', color: 'var(--text3)' }}>
                          {activeCount} active · {course.levels.length} levels
                        </div>
                      </div>

                      {/* Level chips */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                        {course.levels.map(function ({ sku, appt: a }) {
                          const isActive   = a?.status === 'active'
                          const isInactive = a && a.status !== 'active'
                          const notApptd   = !a

                          const chipTitle = isActive
                            ? ('Appointed: ' + fmtDate(a.appointed_at) + ' · ' + REMUN_LABELS[a.remuneration_mode] + ' · ₹' + Number(a.remuneration_rate).toLocaleString('en-IN'))
                            : isInactive
                            ? ('Removed: ' + fmtDate(a.removed_at || ''))
                            : 'Click + to appoint this level'

                          return (
                            <div
                              key={sku.id}
                              title={chipTitle}
                              onClick={notApptd ? function () {
                                setNewAppt(function (prev) { return { ...prev, course_name: sku.courses?.group_name || '', selectedSkuIds: [sku.id] } })
                                setShowAddCourse(true)
                              } : undefined}
                              style={{
                                padding: '4px 10px', borderRadius: 20,
                                fontSize: 11, fontWeight: 600,
                                border: '1.5px solid',
                                borderColor: isActive ? 'var(--green)' : 'var(--border)',
                                background:  isActive ? 'var(--green-bg)' : isInactive ? 'var(--bg3)' : 'var(--bg2)',
                                color:       isActive ? 'var(--green)' : isInactive ? 'var(--text3)' : 'var(--text3)',
                                display: 'flex', alignItems: 'center', gap: 4,
                                cursor:        notApptd ? 'pointer' : 'default',
                                textDecoration: isInactive ? 'line-through' : 'none',
                                opacity:       isInactive ? 0.55 : 1,
                              }}
                            >
                              {isActive   && <span style={{ fontSize: 8, color: 'var(--green)' }}>●</span>}
                              {isInactive && <span style={{ fontSize: 9 }}>✕</span>}
                              {notApptd   && <span style={{ fontSize: 10, color: 'var(--purple)', lineHeight: 1 }}>+</span>}
                              <span>{sku.level_name}</span>
                              {sku.total_sessions
                                ? <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.7 }}>{sku.total_sessions}s</span>
                                : null
                              }
                            </div>
                          )
                        })}
                      </div>

                      {/* Detail rows for every appointment record in this course */}
                      {course.levels
                        .filter(function (l) { return l.appt })
                        .map(function ({ sku, appt: a }) {
                          const isEditing = editApptId === a.id
                          return (
                            <div key={a.id} style={{
                              padding: '8px 10px', marginBottom: 4, borderRadius: 6,
                              background: a.status === 'active' ? 'var(--purple-bg)' : 'var(--bg3)',
                              opacity: a.status !== 'active' ? 0.6 : 1,
                            }}>
                              {isEditing ? (
                                /* ── Inline edit form ── */
                                <div>
                                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>{sku.level_name}</div>
                                  <div className="form-grid">
                                    <label>Mode
                                      <select value={editApptForm.remuneration_mode}
                                        onChange={function (e) { setEditApptForm(function (f) { return { ...f, remuneration_mode: e.target.value } }) }}>
                                        <option value="per_session">Per Session (₹ / hr)</option>
                                        <option value="per_student">Per Student (₹ on completion)</option>
                                        <option value="monthly">Monthly Fixed (₹ / month)</option>
                                      </select>
                                    </label>
                                    <label>Rate (₹)
                                      <input type="number" value={editApptForm.remuneration_rate}
                                        onChange={function (e) { setEditApptForm(function (f) { return { ...f, remuneration_rate: e.target.value } }) }} />
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 18 }}>
                                      <input type="checkbox" checked={!!editApptForm.trained_by_nlh}
                                        onChange={function (e) { setEditApptForm(function (f) { return { ...f, trained_by_nlh: e.target.checked } }) }} />
                                      Trained by NLH
                                    </label>
                                    {editApptForm.trained_by_nlh && (
                                      <>
                                        <label>Training Fee (₹)
                                          <input type="number" value={editApptForm.training_fee}
                                            onChange={function (e) { setEditApptForm(function (f) { return { ...f, training_fee: e.target.value } }) }}
                                            placeholder="0 if waived" />
                                        </label>
                                        <label>Training Date
                                          <input type="date" value={editApptForm.training_date}
                                            onChange={function (e) { setEditApptForm(function (f) { return { ...f, training_date: e.target.value } }) }} />
                                        </label>
                                      </>
                                    )}
                                    <label className="col-span-2">Notes
                                      <input value={editApptForm.notes}
                                        onChange={function (e) { setEditApptForm(function (f) { return { ...f, notes: e.target.value } }) }}
                                        placeholder="Remarks…" />
                                    </label>
                                  </div>
                                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                    <button className="btn" style={{ fontSize: 11 }} onClick={function () { setEditApptId(null) }}>Cancel</button>
                                    <button className="btn-p" style={{ fontSize: 11 }} onClick={saveEditAppt} disabled={saving}>
                                      {saving ? 'Saving…' : 'Save Changes'}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                /* ── Read-only row ── */
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div style={{ fontSize: 11, lineHeight: 1.5 }}>
                                    <span style={{ fontWeight: 600 }}>{sku.level_name}</span>
                                    <span style={{ color: 'var(--text3)', marginLeft: 8 }}>
                                      {REMUN_LABELS[a.remuneration_mode]}
                                      {' · '}₹{Number(a.remuneration_rate).toLocaleString('en-IN')} {REMUN_SUFFIX[a.remuneration_mode]}
                                    </span>
                                    {a.trained_by_nlh && (
                                      <span style={{ color: 'var(--green)', marginLeft: 8, fontSize: 10 }}>
                                        ✅ NLH Trained
                                        {a.training_date ? ' ' + fmtDate(a.training_date) : ''}
                                        {a.training_fee  ? ' · ₹' + Number(a.training_fee).toLocaleString('en-IN') : ''}
                                      </span>
                                    )}
                                    <span style={{ color: 'var(--text3)', marginLeft: 8, fontSize: 10 }}>
                                      Since {fmtDate(a.appointed_at)}
                                      {a.removed_at ? ' · Removed ' + fmtDate(a.removed_at) : ''}
                                    </span>
                                    {a.notes && (
                                      <span style={{ color: 'var(--text3)', marginLeft: 8, fontSize: 10 }}>
                                        · {a.notes}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                                    {a.status === 'active' && (
                                      <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }}
                                        onClick={function () { startEditAppt(a) }}>
                                        Edit
                                      </button>
                                    )}
                                    <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }}
                                      onClick={function () { toggleApptStatus(a) }}>
                                      {a.status === 'active' ? 'Deactivate' : 'Reactivate'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })
                      }
                    </div>
                  )
                })
              })()}

              {/* Add appointment form */}
              {showAddCourse ? (
                <div style={{ border: '1.5px dashed var(--purple)', borderRadius: 8, padding: '14px', marginTop: 8 }}>
                  <div style={{ font: '600 12px var(--font)', color: 'var(--purple)', marginBottom: 10 }}>
                    New Course Appointment
                  </div>
                  <div className="form-grid">

                    {/* Step 1: Course */}
                    <label className="col-span-2">Course *
                      <select value={newAppt.course_name}
                        onChange={function (e) {
                          setNewAppt(function (a) { return { ...a, course_name: e.target.value, selectedSkuIds: [] } })
                        }}>
                        <option value="">— Select course —</option>
                        {availableCourseNames.map(function (cn) {
                          return <option key={cn} value={cn}>{cn}</option>
                        })}
                      </select>
                    </label>

                    {/* Step 2: Level checkboxes */}
                    {newAppt.course_name && (
                      <div className="col-span-2">
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>
                          Levels * — select one or more
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {levelsForCourse(newAppt.course_name).map(function (s) {
                            const checked = newAppt.selectedSkuIds.includes(s.id)
                            return (
                              <button key={s.id} type="button"
                                onClick={function () {
                                  setNewAppt(function (a) {
                                    const ids = checked
                                      ? a.selectedSkuIds.filter(function (id) { return id !== s.id })
                                      : [...a.selectedSkuIds, s.id]
                                    return { ...a, selectedSkuIds: ids }
                                  })
                                }}
                                style={{
                                  padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                                  border: checked ? '1.5px solid var(--purple)' : '1px solid var(--border)',
                                  background: checked ? 'var(--purple-bg)' : 'var(--bg2)',
                                  color: checked ? 'var(--purple)' : 'var(--text2)',
                                  fontWeight: checked ? 700 : 400,
                                }}>
                                {checked ? '✓ ' : ''}{s.level_name}
                                {s.total_sessions ? <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>{s.total_sessions}s</span> : null}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <label>Remuneration Mode *
                      <select value={newAppt.remuneration_mode} onChange={nfd('remuneration_mode')}>
                        <option value="per_student">Per Student (₹ on completion)</option>
                        <option value="per_session">Per Session (₹ / hour)</option>
                        <option value="monthly">Monthly Fixed (₹ / month)</option>
                      </select>
                    </label>
                    <label>Rate (₹) *
                      <input type="number" value={newAppt.remuneration_rate}
                        onChange={nfd('remuneration_rate')}
                        placeholder={
                          newAppt.remuneration_mode === 'per_session' ? 'e.g. 150' :
                          newAppt.remuneration_mode === 'monthly'     ? 'e.g. 5000' : 'e.g. 750'
                        } />
                    </label>
                    <label>Appointed From
                      <input type="date" value={newAppt.appointed_at} onChange={nfd('appointed_at')} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                      <input type="checkbox" checked={newAppt.trained_by_nlh}
                        onChange={function (e) { setNewAppt(function (a) { return { ...a, trained_by_nlh: e.target.checked } }) }} />
                      Trained by NLH
                    </label>
                    {newAppt.trained_by_nlh && (
                      <>
                        <label>Training Fee Paid (₹)
                          <input type="number" value={newAppt.training_fee} onChange={nfd('training_fee')}
                            placeholder="0 if waived" />
                        </label>
                        <label>Training Date
                          <input type="date" value={newAppt.training_date} onChange={nfd('training_date')} />
                        </label>
                      </>
                    )}
                    <label className="col-span-2">Notes
                      <input value={newAppt.notes} onChange={nfd('notes')}
                        placeholder="Remarks on this appointment…" />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                    <button className="btn" onClick={function () { setShowAddCourse(false) }}>Cancel</button>
                    <button className="btn-p" onClick={addAppointment} disabled={saving || !newAppt.selectedSkuIds.length}>
                      {saving ? 'Saving…' : 'Appoint' + (newAppt.selectedSkuIds.length > 1 ? ' ' + newAppt.selectedSkuIds.length + ' Levels' : ' to Level')}
                    </button>
                    {newAppt.selectedSkuIds.length > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {newAppt.selectedSkuIds.length} level{newAppt.selectedSkuIds.length > 1 ? 's' : ''} selected
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <button className="btn-s" style={{ marginTop: 4 }}
                  onClick={function () { setShowAddCourse(true) }}
                  disabled={availableSkus.length === 0}>
                  + Appoint to Course / Level
                </button>
              )}
              {availableSkus.length === 0 && appointments.filter(function (a) { return a.status === 'active' }).length > 0 && (
                <p className="hint" style={{ marginTop: 6 }}>All course levels are already appointed.</p>
              )}
            </div>
          </div>
        )}

        {/* ══ Batches tab ══════════════════════════════════════════════════════ */}
        {tab === 'batches' && (
          <div style={{ padding: '0 20px 16px' }}>

            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                {batchList.filter(function (b) { return b.is_active }).length} active batch{batchList.filter(function (b) { return b.is_active }).length !== 1 ? 'es' : ''}
              </span>
              {!showAddBatch && (
                <button className="btn-s" style={{ fontSize: 11 }}
                  onClick={function () { setShowAddBatch(true); setBatchForm({ ...BLANK_BATCH }) }}>
                  + New Batch
                </button>
              )}
            </div>

            {batchList.length === 0 && !showAddBatch && (
              <p className="hint">No batches yet. Students from any of this CI's appointed courses can be added to a batch.</p>
            )}

            {/* ── Batch cards (flat list) ── */}
            {[...batchList].sort(function (a, b) {
              if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
              const ta = a.schedule_time || 'ZZ'
              const tb = b.schedule_time || 'ZZ'
              if (ta !== tb) return ta < tb ? -1 : 1
              return (a.name || '').localeCompare(b.name || '')
            }).map(function (batch) {
              const activeStudents = (batch.batch_students || []).filter(function (bs) { return !bs.removed_at })
              const rosterOpen     = !!openRoster[batch.id]
              const sessLabel      = (batch.sessions_done || 0) + ' sessions'
              // Derive courses from enrolled students
              const courseNames = [...new Set(
                activeStudents.map(function (bs) { return bs.enrollments?.skus?.courses?.group_name }).filter(Boolean)
              )]

              return (
                <div key={batch.id} style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>

                  {/* Batch summary row */}
                  <div style={{
                    padding: '10px 14px',
                    background: batch.is_active ? 'var(--bg)' : 'var(--bg3)',
                    opacity: batch.is_active ? 1 : 0.75,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      {/* Left: name + badges */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 13 }}>{batch.name}</span>
                          {batch.is_individual && (
                            <span className="badge bp" style={{ fontSize: 9 }}>1-on-1</span>
                          )}
                          <span className={`badge ${batch.is_active ? 'ba' : 'bd'}`} style={{ fontSize: 9 }}>
                            {batch.is_active ? 'Active' : 'Inactive'}
                          </span>
                          {courseNames.map(function (cn) {
                            return <span key={cn} className="badge" style={{ fontSize: 9, background: 'var(--amber-bg)', color: 'var(--amber)' }}>{cn}</span>
                          })}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                          {batch.schedule_days || ''}
                          {batch.schedule_time ? ' · ' + timeRange(batch.schedule_time) : ''}
                          {batch.start_date    ? ' · Started ' + fmtDate(batch.start_date) : ''}
                        </div>
                      </div>

                      {/* Right: sessions counter + actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button
                            onClick={function () { adjustSessions(batch, -1) }}
                            disabled={!batch.sessions_done}
                            style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--border)',
                              background: 'var(--bg2)', cursor: batch.sessions_done ? 'pointer' : 'not-allowed',
                              fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              opacity: batch.sessions_done ? 1 : 0.35 }}>
                            −
                          </button>
                          <span style={{ font: '600 11px var(--mono)', minWidth: 70, textAlign: 'center', color: 'var(--purple)' }}>
                            {sessLabel}
                          </span>
                        </div>
                        {batch.is_active && (
                          <button className="btn-p" style={{ fontSize: 10, padding: '3px 10px' }}
                            onClick={function () { setAttendanceBatch({ ...batch, instructors: { full_name: instructor.full_name } }) }}>
                            📋 Attendance
                          </button>
                        )}
                        <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }}
                          onClick={function () { setEditBatchModal(batch) }}>
                          ✏ Edit
                        </button>
                        <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }}
                          onClick={function () { toggleBatchActive(batch) }}>
                          {batch.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }}
                          onClick={function () {
                            var nowOpen = !openRoster[batch.id]
                            setOpenRoster(function (r) { return { ...r, [batch.id]: nowOpen } })
                            if (nowOpen) {
                              // Refresh batch_students so students added externally are visible
                              sb.from('batch_students')
                                .select('id, enrollment_id, assigned_at, removed_at, enrollments(id, student_id, sku_id, students(id, full_name), skus(level_name, courses(group_name)))')
                                .eq('batch_id', batch.id)
                                .then(function (res) {
                                  if (res.data) setBatchList(function (prev) {
                                    return prev.map(function (b) { return b.id === batch.id ? { ...b, batch_students: res.data } : b })
                                  })
                                })
                            }
                          }}>
                          {activeStudents.length} student{activeStudents.length !== 1 ? 's' : ''} {rosterOpen ? '▲' : '▼'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Roster panel (expandable) */}
                  {rosterOpen && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', background: 'var(--bg2)' }}>
                      {activeStudents.length === 0 && (
                        <p className="hint" style={{ marginBottom: 8 }}>No students assigned yet.</p>
                      )}
                      {activeStudents.map(function (bs) {
                        const course = bs.enrollments?.skus?.courses?.group_name
                        const level  = bs.enrollments?.skus?.level_name
                        return (
                          <div key={bs.id} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 12,
                          }}>
                            <div>
                              <span style={{ fontWeight: 500 }}>{bs.enrollments?.students?.full_name || '—'}</span>
                              {course && <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 6 }}>{course}{level ? ' · ' + level : ''}</span>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Since {fmtDate(bs.assigned_at)}</span>
                              <button className="btn" style={{ fontSize: 10, padding: '2px 6px' }}
                                onClick={function () { removeStudentFromBatch(batch.id, bs.id) }}>
                                Remove
                              </button>
                            </div>
                          </div>
                        )
                      })}

                      {/* Add student */}
                      {addStudentFor === batch.id ? (
                        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                          {eligibleEnr.length === 0
                            ? <span style={{ fontSize: 12, color: 'var(--text3)' }}>No eligible enrolled students found.</span>
                            : <select style={{ flex: 1, fontSize: 12 }} defaultValue=""
                                onChange={function (e) { if (e.target.value) assignStudent(batch.id, e.target.value) }}>
                                <option value="">— Select student to add —</option>
                                {eligibleEnr.map(function (e) {
                                  const course = e.skus?.courses?.group_name || ''
                                  const level  = e.skus?.level_name || ''
                                  return (
                                    <option key={e.id} value={e.id}>
                                      {e.students?.full_name || '—'}{course ? ' — ' + course + (level ? ' ' + level : '') : ''}
                                    </option>
                                  )
                                })}
                              </select>
                          }
                          <button className="btn" style={{ fontSize: 11 }}
                            onClick={function () { setAddStudentFor(null); setEligibleEnr([]) }}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button className="btn-s" style={{ marginTop: 8, fontSize: 11 }}
                          onClick={function () { openAddStudentPanel(batch) }}>
                          + Add Student
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* ── New batch form ── */}
            {showAddBatch && (
              <div style={{ border: '1.5px dashed var(--purple)', borderRadius: 8, padding: 14, marginTop: 8 }}>
                <div style={{ font: '600 12px var(--font)', color: 'var(--purple)', marginBottom: 12 }}>New Batch</div>
                <div className="form-grid">
                  <label className="col-span-2">Batch Name *
                    <input value={batchForm.name} autoFocus
                      onChange={function (e) { setBatchForm(function (f) { return { ...f, name: e.target.value } }) }}
                      placeholder="e.g. Morning Batch A, 1-on-1 Riya" />
                  </label>
                  <label>Start Date
                    <input type="date" value={batchForm.start_date}
                      onChange={function (e) { setBatchForm(function (f) { return { ...f, start_date: e.target.value } }) }} />
                  </label>
                  <label>Time
                    <input type="time" value={batchForm.time}
                      onChange={function (e) { setBatchForm(function (f) { return { ...f, time: e.target.value } }) }} />
                  </label>
                  <label className="col-span-2">Schedule Days
                    <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                      {DAYS.map(function (d) {
                        const checked = batchForm.days.includes(d)
                        return (
                          <label key={d} style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                            fontSize: 11, cursor: 'pointer', fontWeight: checked ? 700 : 400,
                            color: checked ? 'var(--purple)' : 'var(--text2)',
                          }}>
                            <input type="checkbox" checked={checked}
                              onChange={function (e) {
                                setBatchForm(function (f) {
                                  return { ...f, days: e.target.checked ? [...f.days, d] : f.days.filter(function (x) { return x !== d }) }
                                })
                              }} />
                            {d}
                          </label>
                        )
                      })}
                    </div>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
                    <input type="checkbox" checked={batchForm.is_individual}
                      onChange={function (e) { setBatchForm(function (f) { return { ...f, is_individual: e.target.checked } }) }} />
                    <span style={{ fontSize: 12 }}>Individual (1-on-1) session</span>
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn" onClick={function () { setShowAddBatch(false) }}>Cancel</button>
                  <button className="btn-p" onClick={saveBatch} disabled={batchSaving}>
                    {batchSaving ? 'Creating…' : 'Create Batch'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      {/* ── Edit Batch Modal ── */}
      {editBatchModal && (
        <EditBatchModal
          batch={editBatchModal}
          onClose={function () { setEditBatchModal(null) }}
          onSaved={function () { setEditBatchModal(null); setTabLoaded(function(tl) { return { ...tl, batches: false } }); loadTab('batches') }}
        />
      )}

      {/* ── Attendance Modal ── */}
      {attendanceBatch && (
        <AttendanceModal
          batch={attendanceBatch}
          onClose={function () { setAttendanceBatch(null) }}
          onSaved={function () { setAttendanceBatch(null); setTabLoaded(function(tl) { return { ...tl, batches: false } }); loadTab('batches') }}
        />
      )}

        {/* ══ Payroll tab ══════════════════════════════════════════════════════ */}
        {tab === 'payroll' && (
          <div style={{ padding: '0 20px 20px' }}>
            {/* Month picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <label style={{ font: '500 12px var(--font)', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                Month:
                <input type="month" value={payrollMonth}
                  onChange={function (e) { setPayrollMonth(e.target.value) }}
                  style={{ fontSize: 13, padding: '4px 8px' }} />
              </label>
              <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>
                {payrollLoading ? 'Loading…' : payrollSessions.length + ' session' + (payrollSessions.length !== 1 ? 's' : '') + ' conducted'}
              </div>
            </div>

            {payrollLoading ? (
              <div className="hint" style={{ textAlign: 'center', padding: '24px 0' }}>Calculating…</div>
            ) : (function () {
              // Group sessions by batch
              var batchMap = {}
              payrollSessions.forEach(function (sess) {
                var bid = sess.batch_id
                if (!batchMap[bid]) batchMap[bid] = { batch: sess.batches, sessions: [] }
                batchMap[bid].sessions.push(sess)
              })

              // Build per-batch payment rows
              var perSessionRows = []
              var perStudentRows = []
              var monthlyRows    = []

              Object.entries(batchMap).forEach(function (entry) {
                var batchId = entry[0]
                var data    = entry[1]
                var skuId   = data.batch?.sku_id
                var appt    = skuId ? payrollAppts.find(function (a) { return a.sku_id === skuId }) : payrollAppts[0]
                var mode    = appt?.remuneration_mode || 'per_session'
                var rate    = appt?.remuneration_rate || 0
                var course  = data.batch?.skus?.courses?.group_name || data.batch?.name || '—'
                var level   = data.batch?.skus?.level_name || ''
                var completions  = mode === 'per_student' ? (payrollCompletions[batchId] || 0) : 0
                var ciSessions   = data.sessions.length
                var totalSessions = payrollTotalSess[batchId] || ciSessions
                var subSessions  = Math.max(0, totalSessions - ciSessions)
                // Prorate per-student pay by fraction of sessions the CI actually taught
                var proration    = totalSessions > 0 ? ciSessions / totalSessions : 1
                var row = {
                  batchId,
                  batchName: data.batch?.name || '—',
                  course, level,
                  sessionCount: ciSessions,
                  totalSessions, subSessions,
                  proration,
                  mode, rate,
                  completions,
                  amount: mode === 'per_session' ? ciSessions * rate
                        : mode === 'per_student' ? Math.round(completions * rate * proration)
                        : 0,
                }
                if (mode === 'per_session') perSessionRows.push(row)
                else if (mode === 'per_student') perStudentRows.push(row)
              })

              // Monthly appointments (not per-batch)
              payrollAppts.forEach(function (a) {
                if (a.remuneration_mode === 'monthly') monthlyRows.push(a)
              })

              var sessionTotal  = perSessionRows.reduce(function (s, r) { return s + r.amount }, 0)
              var studentTotal  = perStudentRows.reduce(function (s, r) { return s + r.amount }, 0)
              var monthlyTotal  = monthlyRows.reduce(function (s, a) { return s + (a.remuneration_rate || 0) }, 0)
              var grandTotal    = sessionTotal + studentTotal + monthlyTotal

              if (perSessionRows.length === 0 && monthlyRows.length === 0 && perStudentRows.length === 0) {
                return (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text3)', fontSize: 13 }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>💰</div>
                    No sessions recorded for this month.
                  </div>
                )
              }

              return (
                <>
                  {/* Per-session batches */}
                  {perSessionRows.length > 0 && (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
                      <div style={{ padding: '8px 14px', background: 'var(--bg3)', font: '600 11px var(--font)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Per Session
                      </div>
                      {perSessionRows.map(function (row, i) {
                        return (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', padding: '10px 14px',
                            borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                          }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>{row.batchName}</div>
                              <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', marginTop: 2 }}>
                                {row.course}{row.level ? ' · ' + row.level : ''} · {row.sessionCount} session{row.sessionCount !== 1 ? 's' : ''} × ₹{row.rate.toLocaleString('en-IN')}
                              </div>
                            </div>
                            <div style={{ font: '700 14px var(--font)', color: 'var(--text)' }}>
                              ₹{row.amount.toLocaleString('en-IN')}
                            </div>
                          </div>
                        )
                      })}
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', padding: '8px 14px',
                        borderTop: '1px solid var(--border)', background: 'var(--purple-bg)',
                      }}>
                        <span style={{ font: '600 12px var(--font)', color: 'var(--purple)' }}>Session Sub-total</span>
                        <span style={{ font: '700 14px var(--font)', color: 'var(--purple)' }}>₹{sessionTotal.toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  )}

                  {/* Monthly fixed */}
                  {monthlyRows.length > 0 && (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
                      <div style={{ padding: '8px 14px', background: 'var(--bg3)', font: '600 11px var(--font)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Monthly Fixed
                      </div>
                      {monthlyRows.map(function (a, i) {
                        return (
                          <div key={a.id} style={{
                            display: 'flex', alignItems: 'center', padding: '10px 14px',
                            borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                          }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>
                                {a.skus?.courses?.group_name || '—'}{a.skus?.level_name ? ' · ' + a.skus.level_name : ''}
                              </div>
                              <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', marginTop: 2 }}>Monthly rate</div>
                            </div>
                            <div style={{ font: '700 14px var(--font)', color: 'var(--text)' }}>
                              ₹{(a.remuneration_rate || 0).toLocaleString('en-IN')}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Per-student (completion-based) */}
                  {perStudentRows.length > 0 && (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
                      <div style={{ padding: '8px 14px', background: 'var(--bg3)', font: '600 11px var(--font)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Per Student (on completion)
                      </div>
                      {perStudentRows.map(function (row, i) {
                        var hasSubs = row.subSessions > 0
                        var pct     = Math.round(row.proration * 100)
                        return (
                          <div key={i} style={{
                            padding: '10px 14px',
                            borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>{row.batchName}</div>
                                <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', marginTop: 2 }}>
                                  {row.course}{row.level ? ' · ' + row.level : ''}
                                </div>
                                {/* Sessions breakdown */}
                                <div style={{ display: 'flex', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
                                  <span style={{
                                    font: '600 10px var(--font)', padding: '1px 7px', borderRadius: 20,
                                    background: 'var(--purple-bg)', color: 'var(--purple)',
                                  }}>
                                    {row.sessionCount} sessions by CI
                                  </span>
                                  {hasSubs && (
                                    <span style={{
                                      font: '600 10px var(--font)', padding: '1px 7px', borderRadius: 20,
                                      background: '#fff3cd', color: '#92400e',
                                    }}>
                                      {row.subSessions} by substitute
                                    </span>
                                  )}
                                  <span style={{
                                    font: '600 10px var(--font)', padding: '1px 7px', borderRadius: 20,
                                    background: row.completions > 0 ? 'var(--green-bg)' : 'var(--bg3)',
                                    color: row.completions > 0 ? 'var(--green)' : 'var(--text3)',
                                  }}>
                                    {row.completions} student{row.completions !== 1 ? 's' : ''} completed
                                  </span>
                                </div>
                                {/* Calculation breakdown */}
                                <div style={{ font: '500 10px var(--font)', color: 'var(--text3)', marginTop: 4 }}>
                                  {row.completions} × ₹{row.rate.toLocaleString('en-IN')}
                                  {hasSubs
                                    ? <> × <span style={{ color: '#92400e', fontWeight: 700 }}>{pct}%</span> (CI taught {pct}% of sessions)</>
                                    : null
                                  }
                                  {' = '}
                                  <strong style={{ color: row.amount > 0 ? 'var(--text)' : 'var(--text3)' }}>
                                    ₹{row.amount.toLocaleString('en-IN')}
                                  </strong>
                                </div>
                              </div>
                              <div style={{ font: '700 16px var(--font)', color: row.amount > 0 ? 'var(--text)' : 'var(--text3)', marginLeft: 12, marginTop: 2 }}>
                                {row.amount > 0 ? '₹' + row.amount.toLocaleString('en-IN') : '—'}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      {studentTotal > 0 && (
                        <div style={{
                          display: 'flex', justifyContent: 'space-between', padding: '8px 14px',
                          borderTop: '1px solid var(--border)', background: 'var(--green-bg)',
                        }}>
                          <span style={{ font: '600 12px var(--font)', color: 'var(--green)' }}>Completion Sub-total</span>
                          <span style={{ font: '700 14px var(--font)', color: 'var(--green)' }}>₹{studentTotal.toLocaleString('en-IN')}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Grand total + override ── */}
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginTop: 4 }}>

                    {/* Calculated total row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: 'var(--bg2)' }}>
                      <span style={{ font: '500 12px var(--font)', color: 'var(--text3)' }}>
                        Amount Calculated
                      </span>
                      <span style={{
                        font: '600 14px var(--font)',
                        color: payrollOverride ? 'var(--text3)' : 'var(--text)',
                        textDecoration: payrollOverride ? 'line-through' : 'none',
                      }}>₹{grandTotal.toLocaleString('en-IN')}</span>
                    </div>

                    {/* Override edit form */}
                    {overrideEdit ? (
                      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: '#fffbf0' }}>
                        <div style={{ font: '600 11px var(--font)', color: '#92400e', marginBottom: 8 }}>
                          ✏️ Set amount paid
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>₹</span>
                            <input
                              type="number" min="0"
                              value={overrideForm.amount}
                              onChange={function (e) { setOverrideForm(function (f) { return { ...f, amount: e.target.value } }) }}
                              placeholder={grandTotal}
                              style={{ width: 120, fontSize: 14, fontWeight: 700, padding: '5px 8px' }}
                              autoFocus
                            />
                          </div>
                          <input
                            type="text"
                            value={overrideForm.notes}
                            onChange={function (e) { setOverrideForm(function (f) { return { ...f, notes: e.target.value } }) }}
                            placeholder="Reason / note (optional)"
                            style={{ flex: 1, minWidth: 160, fontSize: 12, padding: '5px 8px' }}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button className="btn" style={{ fontSize: 11 }}
                            onClick={function () { setOverrideEdit(false) }} disabled={savingOverride}>
                            Cancel
                          </button>
                          <button className="btn-p" style={{ fontSize: 11 }}
                            onClick={function () { saveOverride(grandTotal) }} disabled={savingOverride}>
                            {savingOverride ? 'Saving…' : 'Save Amount Paid'}
                          </button>
                        </div>
                      </div>
                    ) : payrollOverride ? (
                      /* Override active — show agreed amount */
                      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: '#f0fdf4' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ font: '600 11px var(--font)', color: 'var(--green)', marginBottom: 2 }}>
                              ✓ Amount Paid
                            </div>
                            {payrollOverride.notes && (
                              <div style={{ font: '500 10px var(--font)', color: 'var(--text3)' }}>
                                {payrollOverride.notes}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ font: '700 18px var(--font)', color: 'var(--green)' }}>
                              ₹{payrollOverride.final_amount.toLocaleString('en-IN')}
                            </span>
                            <button className="btn" style={{ fontSize: 10, padding: '2px 7px' }}
                              onClick={function () {
                                setOverrideForm({ amount: payrollOverride.final_amount, notes: payrollOverride.notes || '' })
                                setOverrideEdit(true)
                              }}>✏️</button>
                            <button className="btn" style={{ fontSize: 10, padding: '2px 7px', color: 'var(--red)' }}
                              onClick={clearOverride}>✕</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* No override — show edit prompt */
                      <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>
                          Enter amount actually paid?
                        </span>
                        <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }}
                          onClick={function () {
                            setOverrideForm({ amount: grandTotal, notes: '' })
                            setOverrideEdit(true)
                          }}>
                          ✏️ Override
                        </button>
                      </div>
                    )}

                    {/* Final payable banner */}
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '12px 16px',
                      background: payrollOverride ? 'var(--green)' : 'var(--purple)',
                      color: '#fff',
                    }}>
                      <span style={{ font: '700 14px var(--font)' }}>
                        {payrollOverride ? 'Amount Paid' : 'Amount Calculated'} — {new Date(payrollMonth + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                      </span>
                      <span style={{ font: '700 20px var(--font)' }}>
                        ₹{(payrollOverride ? payrollOverride.final_amount : grandTotal).toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>
                </>
              )
            })()}
          </div>
        )}

      </div>
    </div>
  )
}

// ── EditBatchModal ─────────────────────────────────────────────────────────────

function EditBatchModal({ batch, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:          batch.name || '',
    days:          batch.schedule_days ? batch.schedule_days.split(', ').filter(Boolean) : [],
    time:          batch.schedule_time ? batch.schedule_time.slice(0, 5) : '',
    start_date:    batch.start_date || '',
    notes:         batch.notes || '',
    is_individual: batch.is_individual || false,
  })
  const [saving, setSaving] = useState(false)

  function toggleDay(day) {
    setForm(function (f) {
      const days = f.days.includes(day) ? f.days.filter(function (d) { return d !== day }) : [...f.days, day]
      return { ...f, days }
    })
  }

  async function save() {
    if (!form.name.trim()) { showToast('Batch name required', 'err'); return }
    setSaving(true)
    const { error } = await sb.from('batches').update({
      name:          form.name.trim(),
      is_individual: form.is_individual,
      schedule_days: form.days.join(', '),
      schedule_time: form.time || null,
      start_date:    form.start_date || null,
      notes:         form.notes.trim() || null,
    }).eq('id', batch.id)
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    showToast('Batch updated ✓')
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="ch">
          <span style={{ fontWeight: 700 }}>Edit Batch — {batch.name}</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '16px 20px 20px' }}>
          <div className="form-grid">
            <label className="col-span-2">Batch Name *
              <input value={form.name} onChange={function (e) { setForm(function (f) { return { ...f, name: e.target.value } }) }} />
            </label>
            <label className="col-span-2">Schedule Days
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {DAYS.map(function (d) {
                  const on = form.days.includes(d)
                  return (
                    <button key={d} type="button" onClick={function () { toggleDay(d) }}
                      style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                        border: on ? '1.5px solid var(--purple)' : '1px solid var(--border)',
                        background: on ? 'var(--purple-bg)' : 'var(--bg2)',
                        color: on ? 'var(--purple)' : 'var(--text2)',
                        fontWeight: on ? 700 : 400,
                      }}>{d}</button>
                  )
                })}
              </div>
            </label>
            <label>Start Time
              <input type="time" value={form.time}
                onChange={function (e) { setForm(function (f) { return { ...f, time: e.target.value } }) }} />
              {form.time && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Session: {timeRange(form.time)} (1 hr)</div>}
            </label>
            <label>Start Date
              <input type="date" value={form.start_date}
                onChange={function (e) { setForm(function (f) { return { ...f, start_date: e.target.value } }) }} />
            </label>
            <label className="col-span-2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.is_individual}
                onChange={function (e) { setForm(function (f) { return { ...f, is_individual: e.target.checked } }) }} />
              Individual (1-on-1) session
            </label>
            <label className="col-span-2">Notes
              <input value={form.notes}
                onChange={function (e) { setForm(function (f) { return { ...f, notes: e.target.value } }) }}
                placeholder="Optional remarks…" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn-p" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── AttendanceModal (Instructors context) ──────────────────────────────────────

function AttendanceModal({ batch, onClose, onSaved }) {
  const [batchStudents, setBatchStudents] = useState(batch.batch_students || [])
  const activeStudents = batchStudents.filter(function (bs) { return !bs.removed_at })
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0])
  const [attendance,  setAttendance]  = useState(function () {
    var map = {}
    ;(batch.batch_students || []).filter(function (bs) { return !bs.removed_at })
      .forEach(function (bs) { map[bs.enrollment_id] = true })
    return map
  })
  const [saving,     setSaving]     = useState(false)
  const [sessionNum, setSessionNum] = useState(null)

  useEffect(function () {
    sb.from('batch_sessions').select('id', { count: 'exact', head: true }).eq('batch_id', batch.id)
      .then(function (res) { setSessionNum((res.count || 0) + 1) })
    // Fresh fetch — students assigned after this tab loaded must appear in attendance
    sb.from('batch_students')
      .select('id, enrollment_id, assigned_at, removed_at, enrollments(id, student_id, sku_id, students(id, full_name), skus(level_name))')
      .eq('batch_id', batch.id)
      .is('removed_at', null)
      .then(function (res) {
        if (res.data) {
          setBatchStudents(res.data)
          setAttendance(function (prev) {
            var next = Object.assign({}, prev)
            res.data.forEach(function (bs) {
              if (!(bs.enrollment_id in next)) next[bs.enrollment_id] = true
            })
            return next
          })
        }
      })
  }, [])

  function toggle(enrollmentId) {
    setAttendance(function (prev) {
      var next = Object.assign({}, prev)
      next[enrollmentId] = !prev[enrollmentId]
      return next
    })
  }

  function toggleAll(present) {
    var map = {}
    activeStudents.forEach(function (bs) { map[bs.enrollment_id] = present })
    setAttendance(map)
  }

  async function save() {
    if (!sessionDate) { showToast('Select a date', 'warn'); return }
    setSaving(true)
    var countRes = await sb.from('batch_sessions').select('id', { count: 'exact', head: true }).eq('batch_id', batch.id)
    var sNum = (countRes.count || 0) + 1
    var sessRes = await sb.from('batch_sessions').insert({
      batch_id:       batch.id,
      session_date:   sessionDate,
      session_number: sNum,
      instructor_id:  batch.instructor_id,
      is_substitute:  false,
    }).select('id').single()
    if (sessRes.error) { showToast('Failed: ' + sessRes.error.message, 'err'); setSaving(false); return }
    var attRows = activeStudents.map(function (bs) {
      return {
        session_id:    sessRes.data.id,
        enrollment_id: bs.enrollment_id,
        student_id:    bs.enrollments?.student_id || null,
        attended:      attendance[bs.enrollment_id] !== false,
      }
    })
    if (attRows.length > 0) await sb.from('session_attendance').insert(attRows)
    await sb.from('batches').update({ sessions_done: (batch.sessions_done || 0) + 1 }).eq('id', batch.id)
    setSaving(false)
    var presentCount = activeStudents.filter(function (bs) { return attendance[bs.enrollment_id] !== false }).length
    showToast('Session #' + sNum + ' marked — ' + presentCount + '/' + activeStudents.length + ' present ✓')
    onSaved()
  }

  var presentCount = activeStudents.filter(function (bs) { return attendance[bs.enrollment_id] !== false }).length

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="ch">
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{batch.name} — Attendance</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              Session #{sessionNum || '…'} · {batch.instructors?.full_name}
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ font: '500 12px var(--font)', color: 'var(--text2)' }}>
            Session Date *
            <input type="date" value={sessionDate}
              onChange={function (e) { setSessionDate(e.target.value) }}
              style={{ marginTop: 4 }} />
          </label>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>
                Students &nbsp;
                <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{presentCount}</span>
                <span style={{ color: 'var(--text3)' }}>/{activeStudents.length} present</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-s" style={{ fontSize: 11, padding: '2px 10px' }}
                  onClick={function () { toggleAll(true) }}>All Present</button>
                <button className="btn-s" style={{ fontSize: 11, padding: '2px 10px' }}
                  onClick={function () { toggleAll(false) }}>All Absent</button>
              </div>
            </div>
            {activeStudents.length === 0 ? (
              <p className="hint">No students assigned to this batch yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {activeStudents.map(function (bs) {
                  var present = attendance[bs.enrollment_id] !== false
                  var name = bs.enrollments?.students?.full_name || '—'
                  return (
                    <div key={bs.id} onClick={function () { toggle(bs.enrollment_id) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                        border: present ? '1.5px solid var(--green)' : '1.5px solid var(--border)',
                        background: present ? 'var(--green-bg)' : 'var(--bg2)',
                        transition: 'all 0.12s',
                      }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                        background: present ? 'var(--green)' : 'var(--bg4)',
                        color: present ? '#fff' : 'var(--text3)',
                        fontWeight: 700, fontSize: 13,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{present ? '✓' : '✗'}</div>
                      <div style={{ flex: 1, font: '500 13px var(--font)', color: 'var(--text)' }}>{name}</div>
                      <div style={{ font: '600 11px var(--mono)', color: present ? 'var(--green)' : 'var(--text3)' }}>
                        {present ? 'Present' : 'Absent'}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Mark Attendance'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AddInstructorModal ─────────────────────────────────────────────────────────

const BLANK_COURSE_BLOCK = {
  group_name: '',
  remuneration_mode: 'per_session',
  trained_by_nlh: false,
  training_fee: '',
  training_date: '',
  checkedLevels: {},  // { [sku_id]: bool }
  levelRates: {},     // { [sku_id]: rate_string }
}

function AddInstructorModal({ nlhCentreId, allSkus, onClose, onSaved }) {
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '',
    city: '', area: '', state: '', pincode: '', address: '',
    joined_at: new Date().toISOString().split('T')[0],
    caution_amount: '', caution_mode: '', caution_paid_at: '',
    notes: '',
  })
  const [courseBlocks, setCourseBlocks] = useState([{ ...BLANK_COURSE_BLOCK }])
  const [saving, setSaving] = useState(false)

  function fld(k) { return function (e) { setForm(f => ({ ...f, [k]: e.target.value })) } }

  // All unique course names (group_name), in the order they appear in allSkus
  const allCourseNames = (function () {
    const seen = new Set()
    const out  = []
    allSkus.forEach(function (s) {
      const g = s.courses?.group_name
      if (g && !seen.has(g)) { seen.add(g); out.push(g) }
    })
    return out
  })()

  // SKUs belonging to a given course name
  function getLevels(group_name) {
    return allSkus.filter(function (s) { return s.courses?.group_name === group_name })
  }

  // Course names already selected in other blocks (to prevent duplicates)
  function usedCourseNames(excludeIdx) {
    return courseBlocks
      .filter(function (_, i) { return i !== excludeIdx })
      .map(function (b) { return b.group_name })
      .filter(Boolean)
  }

  function addCourseBlock() {
    setCourseBlocks(function (b) { return [...b, { ...BLANK_COURSE_BLOCK }] })
  }
  function removeCourseBlock(idx) {
    setCourseBlocks(function (b) { return b.filter(function (_, i) { return i !== idx }) })
  }

  function updateBlock(idx, key, val) {
    setCourseBlocks(function (blocks) {
      return blocks.map(function (b, i) {
        if (i !== idx) return b
        // Reset level selections when the course changes
        if (key === 'group_name') return { ...b, group_name: val, checkedLevels: {}, levelRates: {} }
        return { ...b, [key]: val }
      })
    })
  }

  function toggleLevel(blockIdx, skuId) {
    setCourseBlocks(function (blocks) {
      return blocks.map(function (b, i) {
        if (i !== blockIdx) return b
        const nowChecked = !b.checkedLevels[skuId]
        const newRates   = { ...b.levelRates }
        if (!nowChecked) delete newRates[skuId]   // clear rate when unchecking
        return { ...b, checkedLevels: { ...b.checkedLevels, [skuId]: nowChecked }, levelRates: newRates }
      })
    })
  }

  function setLevelRate(blockIdx, skuId, rate) {
    setCourseBlocks(function (blocks) {
      return blocks.map(function (b, i) {
        if (i !== blockIdx) return b
        return { ...b, levelRates: { ...b.levelRates, [skuId]: rate } }
      })
    })
  }

  async function save() {
    if (!form.full_name.trim()) { showToast('Name is required', 'warn'); return }

    // Flatten course blocks → individual appointment rows
    const validRows = []
    for (let bi = 0; bi < courseBlocks.length; bi++) {
      const block = courseBlocks[bi]
      if (!block.group_name) continue
      const checkedSkus = getLevels(block.group_name).filter(function (s) { return block.checkedLevels[s.id] })
      for (let li = 0; li < checkedSkus.length; li++) {
        const s = checkedSkus[li]
        if (!block.levelRates[s.id]) {
          showToast('Enter rate for ' + block.group_name + ' — ' + s.level_name, 'warn')
          return
        }
        validRows.push({
          sku_id:            s.id,
          remuneration_mode: block.remuneration_mode,
          remuneration_rate: Number(block.levelRates[s.id]),
          trained_by_nlh:    block.trained_by_nlh,
          training_fee:      block.trained_by_nlh && block.training_fee  ? Number(block.training_fee)  : null,
          training_date:     block.trained_by_nlh && block.training_date ? block.training_date          : null,
        })
      }
    }

    setSaving(true)

    // 1 — Insert instructor
    const { data: ins, error: insErr } = await sb.from('instructors').insert({
      franchisee_id:   nlhCentreId,
      full_name:       form.full_name.trim(),
      phone:           form.phone.trim()    || null,
      email:           form.email.trim()    || null,
      address:         form.address.trim()  || null,
      area:            form.area.trim()     || null,
      city:            form.city.trim()     || null,
      state:           form.state.trim()    || null,
      pincode:         form.pincode.trim()  || null,
      joined_at:       form.joined_at       || null,
      caution_amount:  form.caution_amount  ? Number(form.caution_amount) : 0,
      caution_mode:    form.caution_mode    || null,
      caution_paid_at: form.caution_paid_at || null,
      caution_status:  'held',
      notes:           form.notes.trim()    || null,
    }).select().single()

    if (insErr) { showToast('Failed: ' + insErr.message, 'err'); setSaving(false); return }

    // 2 — Insert course appointments
    if (validRows.length > 0) {
      const apptDate = form.joined_at || new Date().toISOString().split('T')[0]
      const { error: apptErr } = await sb.from('instructor_courses').insert(
        validRows.map(function (r) {
          return {
            instructor_id:     ins.id,
            sku_id:            r.sku_id,
            remuneration_mode: r.remuneration_mode,
            remuneration_rate: r.remuneration_rate,
            trained_by_nlh:    r.trained_by_nlh,
            training_fee:      r.training_fee,
            training_date:     r.training_date,
            appointed_at:      apptDate,
          }
        })
      )
      if (apptErr) showToast('CI added but course appointments failed: ' + apptErr.message, 'warn')
    }

    // Re-fetch with full joins so the list shows courses immediately
    const { data: fullIns } = await sb.from('instructors')
      .select('*, instructor_courses(id,status,remuneration_mode,remuneration_rate,skus(level_name,courses(group_name)))')
      .eq('id', ins.id)
      .single()
    setSaving(false)
    showToast(form.full_name.trim() + ' added as CI')
    onSaved(fullIns || ins)
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="ch">
          <span>➕ Add Course Instructor (CI)</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div>
          {/* ── Personal info ── */}
          <div className="form-grid">
            <label className="col-span-2">Full Name *
              <input value={form.full_name} onChange={fld('full_name')}
                placeholder="Instructor's full name" autoFocus />
            </label>
            <label>Phone
              <input value={form.phone} onChange={fld('phone')} placeholder="Mobile number" />
            </label>
            <label>Email
              <input type="email" value={form.email} onChange={fld('email')} placeholder="Email address" />
            </label>
            <label>City
              <input value={form.city} onChange={fld('city')} placeholder="Nagpur" />
            </label>
            <label>Area / Locality
              <input value={form.area} onChange={fld('area')} placeholder="Sadar, Dharampeth…" />
            </label>
            <label>State
              <input value={form.state} onChange={fld('state')} placeholder="Maharashtra" />
            </label>
            <label>PIN Code
              <input value={form.pincode} onChange={fld('pincode')} placeholder="440001" />
            </label>
            <label>Joined Date
              <input type="date" value={form.joined_at} onChange={fld('joined_at')} />
            </label>
          </div>

          {/* ── Course Appointments ── */}
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 20px 0', paddingTop: 12 }}>
            <div style={{ font: '600 12px var(--font)', color: 'var(--text)', marginBottom: 10 }}>
              📚 Course Appointments
              <span style={{ font: '400 11px var(--font)', color: 'var(--text3)', marginLeft: 6 }}>
                (select courses and tick the levels to appoint)
              </span>
            </div>

            {courseBlocks.map(function (block, idx) {
              const takenNames = usedCourseNames(idx)
              const levels     = block.group_name ? getLevels(block.group_name) : []
              const ratePlaceholder =
                block.remuneration_mode === 'per_session' ? '₹ per session' :
                block.remuneration_mode === 'monthly'     ? '₹ per month'   : '₹ per student'

              return (
                <div key={idx} style={{
                  border: '1px solid var(--border)', borderRadius: 8,
                  padding: '12px 14px', marginBottom: 8, background: 'var(--bg2)',
                }}>
                  {/* Block header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ font: '600 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      Course {idx + 1}
                    </span>
                    {courseBlocks.length > 1 && (
                      <button onClick={function () { removeCourseBlock(idx) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Course selector */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                    <label>Course *
                      <select value={block.group_name}
                        onChange={function (e) { updateBlock(idx, 'group_name', e.target.value) }}>
                        <option value="">— Select course —</option>
                        {allCourseNames
                          .filter(function (n) { return !takenNames.includes(n) })
                          .map(function (n) { return <option key={n} value={n}>{n}</option> })
                        }
                      </select>
                    </label>
                    <label>Remuneration Mode
                      <select value={block.remuneration_mode}
                        onChange={function (e) { updateBlock(idx, 'remuneration_mode', e.target.value) }}>
                        <option value="per_session">Per Session (₹ / hour)</option>
                        <option value="per_student">Per Student (₹ on completion)</option>
                        <option value="monthly">Monthly Fixed (₹ / month)</option>
                      </select>
                    </label>
                  </div>

                  {/* Level checkboxes — only shown once a course is selected */}
                  {block.group_name && (
                    <>
                      <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, fontWeight: 600 }}>
                        Levels to appoint <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(tick each level, enter its rate)</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
                        {levels.map(function (s) {
                          const checked = !!block.checkedLevels[s.id]
                          return (
                            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                              <input
                                type="checkbox" id={`lv-${idx}-${s.id}`}
                                checked={checked}
                                onChange={function () { toggleLevel(idx, s.id) }}
                                style={{ flexShrink: 0 }}
                              />
                              <label htmlFor={`lv-${idx}-${s.id}`}
                                style={{ fontSize: 12, cursor: 'pointer', flex: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                                {s.level_name}
                                {s.total_sessions
                                  ? <span style={{ font: '400 10px var(--mono)', color: 'var(--text3)' }}>({s.total_sessions}s)</span>
                                  : null
                                }
                              </label>
                              {checked && (
                                <input
                                  type="number" min="0"
                                  value={block.levelRates[s.id] || ''}
                                  onChange={function (e) { setLevelRate(idx, s.id, e.target.value) }}
                                  placeholder={ratePlaceholder}
                                  style={{ width: 130, fontSize: 12 }}
                                />
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {/* NLH Training */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <input type="checkbox" checked={block.trained_by_nlh}
                          onChange={function (e) { updateBlock(idx, 'trained_by_nlh', e.target.checked) }} />
                        <span style={{ fontSize: 12 }}>Trained by NLH for this course</span>
                      </label>
                      {block.trained_by_nlh && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <label style={{ fontSize: 12 }}>Training Fee (₹)
                            <input type="number" value={block.training_fee}
                              onChange={function (e) { updateBlock(idx, 'training_fee', e.target.value) }}
                              placeholder="0 if waived" />
                          </label>
                          <label style={{ fontSize: 12 }}>Training Date
                            <input type="date" value={block.training_date}
                              onChange={function (e) { updateBlock(idx, 'training_date', e.target.value) }} />
                          </label>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}

            <button className="btn-s" onClick={addCourseBlock}
              style={{ marginTop: 2 }}
              disabled={courseBlocks.some(function (b) { return !b.group_name }) || courseBlocks.length >= allCourseNames.length}>
              + Add Another Course
            </button>
            {courseBlocks.some(function (b) { return !b.group_name }) && (
              <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>
                Select a course above first
              </span>
            )}
          </div>

          {/* ── Caution Deposit ── */}
          <div style={{ borderTop: '1px solid var(--border)', margin: '12px 20px 0', paddingTop: 12 }}>
            <div style={{ font: '600 12px var(--font)', color: 'var(--text)', marginBottom: 8 }}>
              🔒 Caution Deposit
            </div>
            <div className="form-grid">
              <label>Amount (₹)
                <input type="number" value={form.caution_amount} onChange={fld('caution_amount')}
                  placeholder="0" />
              </label>
              <label>Collection Mode
                <select value={form.caution_mode} onChange={fld('caution_mode')}>
                  <option value="">— Select —</option>
                  <option value="upfront">Paid upfront on joining</option>
                  <option value="deducted">Deducted from first payment</option>
                  <option value="waived">Waived</option>
                </select>
              </label>
              {form.caution_mode && form.caution_mode !== 'waived' && (
                <label>Date Paid / Deducted
                  <input type="date" value={form.caution_paid_at} onChange={fld('caution_paid_at')} />
                </label>
              )}
            </div>
          </div>

          {/* ── Notes ── */}
          <div style={{ padding: '8px 20px 0' }}>
            <label>Notes
              <textarea value={form.notes} onChange={fld('notes')} rows={2}
                placeholder="Any internal notes…" style={{ resize: 'vertical', width: '100%' }} />
            </label>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>
            {saving ? 'Adding…' : 'Add Instructor'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── InstructorsPage ────────────────────────────────────────────────────────────

export default function InstructorsPage() {
  const { currentRole } = useAuth()
  const admin = isAdminRole(currentRole)

  const [instructors,   setInstructors]   = useState([])
  const [allSkus,       setAllSkus]       = useState([])
  const [nlhCentreId,   setNlhCentreId]   = useState(null)
  const [loading,       setLoading]        = useState(true)
  const [search,        setSearch]         = useState('')
  const [statusFilter,  setStatusFilter]   = useState('active')
  const [exporting,     setExporting]      = useState(false)
  const [selected,      setSelected]       = useState(null)
  const [showAdd,       setShowAdd]        = useState(false)

  useEffect(function () {
    async function load() {
      setLoading(true)

      // NLH Own Centre
      const { data: nlh } = await sb.from('franchisees').select('id').eq('tier', 'NLH').single()
      if (!nlh) { setLoading(false); return }
      setNlhCentreId(nlh.id)

      // Instructors with their active course appointments
      const { data: ins, error } = await sb.from('instructors')
        .select('*, instructor_courses(id,status,remuneration_mode,remuneration_rate,skus(level_name,courses(group_name)))')
        .eq('franchisee_id', nlh.id)
        .order('full_name')
      if (error) showToast('Load failed: ' + error.message, 'err')
      setInstructors(ins || [])

      // All SKUs for appointment dropdowns (sorted by curriculum order)
      const { data: skus } = await sb.from('skus')
        .select('id,level_name,total_sessions,course_id,courses(group_name)')
        .order('sort_order')
      setAllSkus(skus || [])

      setLoading(false)
    }
    load()
  }, [])

  const filtered = instructors.filter(function (ins) {
    if (statusFilter !== 'all' && ins.status !== statusFilter) return false
    const q = search.toLowerCase()
    return !q
      || ins.full_name?.toLowerCase().includes(q)
      || ins.phone?.includes(q)
      || ins.city?.toLowerCase().includes(q)
  })

  function handleSaved(updated) {
    setInstructors(function (prev) {
      return prev.map(function (i) { return i.id === updated.id ? { ...i, ...updated } : i })
    })
    setSelected(function (s) { return s && s.id === updated.id ? { ...s, ...updated } : s })
  }

  async function closeDetail() {
    const cur = selected
    if (cur) {
      // Re-fetch so the list reflects any appointment changes made in the detail
      const { data } = await sb.from('instructors')
        .select('*, instructor_courses(id,status,remuneration_mode,remuneration_rate,skus(level_name,courses(group_name)))')
        .eq('id', cur.id)
        .single()
      if (data) {
        setInstructors(function (prev) {
          return prev.map(function (i) { return i.id === data.id ? { ...i, ...data } : i })
        })
      }
    }
    setSelected(null)
  }

  function handleAdded(ins) {
    setInstructors(function (prev) {
      return [...prev, { ...ins, instructor_courses: [] }]
        .sort(function (a, b) { return (a.full_name || '').localeCompare(b.full_name || '') })
    })
    setShowAdd(false)
  }

  // summary counts
  const total       = instructors.length
  const activeCount = instructors.filter(function (i) { return i.status === 'active' }).length
  const inactiveCount = total - activeCount
  const totalCaution  = instructors.reduce(function (s, i) {
    return s + (i.caution_status === 'held' || i.caution_status === 'partial' ? (i.caution_amount || 0) : 0)
  }, 0)
  const coursesCovered = [...new Set(
    instructors.flatMap(function (i) {
      return (i.instructor_courses || [])
        .filter(function (c) { return c.status === 'active' })
        .map(function (c) { return c.skus?.courses?.group_name })
    }).filter(Boolean)
  )].length

  function exportCSV() {
    // Use the already-loaded instructors state
    if (!instructors.length) { showToast('No instructors to export.', 'warn'); return }
    setExporting(true)
    try {
      const date = new Date().toISOString().slice(0, 10)
      function esc(v) {
        if (v == null || v === '') return ''
        const s = String(v)
        return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s
      }
      const headers = ['Name','Phone','Email','Status','Courses']
      const rows    = instructors.map(function (r) {
        const courses = (r.instructor_courses || [])
          .filter(function (c) { return c.status === 'active' })
          .map(function (c) { return c.skus?.courses?.group_name })
          .filter(Boolean)
          .filter(function (c, i, a) { return a.indexOf(c) === i })
          .join('; ')
        return [r.full_name, r.phone, r.email, r.status, courses]
      })
      const csv  = headers.join(',') + '\n' + rows.map(function (r) { return r.map(esc).join(',') }).join('\n')
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'nlh-instructors-' + date + '.csv'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(rows.length + ' instructors exported ✓')
    } catch (err) {
      showToast('Export failed: ' + err.message, 'err')
    }
    setExporting(false)
  }

  return (
    <div className="pg">
      {/* topbar */}
      <header className="tb">
        <div className="crumb">Operations <span className="sep">›</span> <b>Instructors</b></div>
        <div className="tb-r">
          <input className="search tb-search" placeholder="Search by name, phone, city…"
            value={search} onChange={function (e) { setSearch(e.target.value) }} />
          <button className="btn btn-s" onClick={exportCSV} disabled={exporting} title="Export CSV">
            {exporting ? '…' : '↓'}<span className="btn-label">{exporting ? ' Exporting' : ' Export'}</span>
          </button>
          {admin && (
            <button className="btn btn-p" onClick={function () { setShowAdd(true) }}>+ Add CI</button>
          )}
        </div>
      </header>

      <div className="content">
        {/* page header */}
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>NLH Own Centre</div>
            <h1 className="ph-title">Course Instructors</h1>
            <div className="ph-sub">
              <b>{activeCount} active</b> instructor{activeCount !== 1 ? 's' : ''} covering {coursesCovered} course{coursesCovered !== 1 ? 's' : ''}.
            </div>
          </div>
        </div>

        {/* mini stats */}
        <div className="mini-stats">
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--purple-bg)' }}>👩‍🏫</div>
            <div className="mini-num">{activeCount}</div>
            <div className="mini-lbl">Active CIs</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--sun-bg)' }}>📚</div>
            <div className="mini-num">{coursesCovered}</div>
            <div className="mini-lbl">Courses covered</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--green-bg)' }}>🔒</div>
            <div className="mini-num">₹{totalCaution.toLocaleString('en-IN')}</div>
            <div className="mini-lbl">Caution held</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--bg4)' }}>💤</div>
            <div className="mini-num">{inactiveCount}</div>
            <div className="mini-lbl">Inactive / Left</div>
          </div>
        </div>

        {/* filter pills */}
        <div className="filter-pills" style={{ marginBottom: 12 }}>
          {[
            ['active',   'Active',        activeCount],
            ['all',      'All',           total],
            ['inactive', 'Inactive / Left', inactiveCount],
          ].map(function ([val, label, count]) {
            return (
              <button key={val}
                className={'pill ' + (statusFilter === val ? 'on' : '')}
                onClick={function () { setStatusFilter(val) }}>
                {label} <span className="pill-count">{count}</span>
              </button>
            )
          })}
        </div>

        {/* Inline instructor detail (opens in the main window) */}
        {selected ? (
          <div style={{ marginTop: 4 }}>
            <button className="btn" style={{ marginBottom: 12, fontSize: 13 }}
              onClick={closeDetail}>← Back to instructors</button>
            <InstructorDetailModal
              inline
              instructor={selected}
              allSkus={allSkus}
              nlhCentreId={nlhCentreId}
              onClose={closeDetail}
              onSaved={handleSaved}
            />
          </div>
        ) : loading ? (
          <div className="loading">Loading instructors…</div>
        ) : (
          <div className="card tbl-scroll" style={{ marginBottom: 0 }}>
            <table className="big-tbl">
              <thead>
                <tr>
                  <th>Instructor</th>
                  <th className="hide-mobile">Contact</th>
                  <th>Courses Appointed</th>
                  <th className="hide-mobile">Caution</th>
                  <th className="hide-mobile">Status</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="empty">No instructors found</td></tr>
                )}
                {filtered.map(function (ins) {
                  const activeCourses = (ins.instructor_courses || [])
                    .filter(function (c) { return c.status === 'active' })
                  return (
                    <tr key={ins.id} style={{ cursor: 'pointer' }}
                      onClick={function () { setSelected(ins) }}>
                      <td>
                        <div className="placer-cell">
                          <div className="placer-av" style={{ background: 'var(--purple)' }}>
                            {avatar(ins.full_name)}
                          </div>
                          <div>
                            <div className="placer-name">{ins.full_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                              {ins.joined_at ? 'Joined ' + fmtDate(ins.joined_at) : 'No join date'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hide-mobile" style={{ fontSize: 12, color: 'var(--text2)' }}>
                        <div>{ins.phone || '—'}</div>
                        <div style={{ color: 'var(--text3)' }}>{ins.city || ''}</div>
                      </td>
                      <td>
                        {activeCourses.length === 0
                          ? <span style={{ color: 'var(--text3)', fontSize: 12 }}>None appointed</span>
                          : activeCourses.map(function (c) {
                            return (
                              <span key={c.id} className="badge bp"
                                style={{ marginRight: 4, marginBottom: 2, fontSize: 10 }}>
                                {c.skus?.courses?.group_name || '—'} — {c.skus?.level_name || '?'}
                              </span>
                            )
                          })
                        }
                      </td>
                      <td className="hide-mobile" style={{ fontSize: 12 }}>
                        {ins.caution_amount > 0
                          ? <>
                              <div style={{ fontWeight: 600 }}>
                                ₹{Number(ins.caution_amount).toLocaleString('en-IN')}
                              </div>
                              <CautionBadge status={ins.caution_status} />
                            </>
                          : <span style={{ color: 'var(--text3)' }}>—</span>
                        }
                      </td>
                      <td className="hide-mobile"><StatusBadge status={ins.status} /></td>
                      <td className="hide-mobile" style={{ textAlign: 'right' }}>
                        <button className="row-action"
                          onClick={function (e) { e.stopPropagation(); setSelected(ins) }}>
                          View
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && nlhCentreId && (
        <AddInstructorModal
          nlhCentreId={nlhCentreId}
          allSkus={allSkus}
          onClose={function () { setShowAdd(false) }}
          onSaved={handleAdded}
        />
      )}
    </div>
  )
}
