import React, { useState, useEffect, useCallback } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtDate, showToast } from '../utils'

// ── helpers ─────────────────────────────────────────────────────────────────

const DAYS       = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const BLANK_BATCH = { name: '', days: [], time: '', start_date: '', is_individual: false, notes: '' }

// ── AttendanceModal ───────────────────────────────────────────────────────────

function AttendanceModal({ batch, onClose, onSaved }) {
  const activeStudents = (batch.batch_students || []).filter(function (bs) { return !bs.removed_at })

  const [sessionDate,   setSessionDate]   = useState(new Date().toISOString().split('T')[0])
  const [instructorId,  setInstructorId]  = useState(batch.instructor_id || '')
  const [isSubstitute,  setIsSubstitute]  = useState(false)
  const [makePermanent, setMakePermanent] = useState(false)
  const [eligibleCIs,   setEligibleCIs]   = useState([])
  const [attendance,    setAttendance]    = useState(function () {
    var map = {}
    activeStudents.forEach(function (bs) { map[bs.enrollment_id] = true })
    return map
  })
  const [saving,        setSaving]        = useState(false)
  const [sessionNum,    setSessionNum]    = useState(null)

  useEffect(function () {
    // Get next session number
    sb.from('batch_sessions').select('id', { count: 'exact', head: true }).eq('batch_id', batch.id)
      .then(function (res) { setSessionNum((res.count || 0) + 1) })

    // Load eligible CIs for this sku (for substitute picker)
    sb.from('instructor_courses')
      .select('instructor_id, instructors(id, full_name, status)')
      .eq('sku_id', batch.sku_id)
      .eq('status', 'active')
      .then(function (res) {
        var seen = {}
        var cis = (res.data || [])
          .map(function (r) { return r.instructors })
          .filter(function (i) { return i && i.status === 'active' })
          .filter(function (i) {
            if (seen[i.id]) return false
            seen[i.id] = true
            return true
          })
        setEligibleCIs(cis)
      })
  }, [])

  function toggleAll(present) {
    var map = {}
    activeStudents.forEach(function (bs) { map[bs.enrollment_id] = present })
    setAttendance(map)
  }

  function toggle(enrollmentId) {
    setAttendance(function (prev) {
      var next = Object.assign({}, prev)
      next[enrollmentId] = !prev[enrollmentId]
      return next
    })
  }

  async function save() {
    if (!sessionDate) { showToast('Select a date', 'warn'); return }
    setSaving(true)

    // Fresh count for session number (avoid race)
    var countRes = await sb.from('batch_sessions').select('id', { count: 'exact', head: true }).eq('batch_id', batch.id)
    var sNum = (countRes.count || 0) + 1

    var actualInstructorId = isSubstitute && instructorId ? instructorId : batch.instructor_id

    // Create the session record
    var sessRes = await sb.from('batch_sessions').insert({
      batch_id:       batch.id,
      session_date:   sessionDate,
      session_number: sNum,
      instructor_id:  actualInstructorId,
      is_substitute:  isSubstitute && actualInstructorId !== batch.instructor_id,
    }).select('id').single()

    if (sessRes.error) {
      showToast('Failed to create session: ' + sessRes.error.message, 'err')
      setSaving(false)
      return
    }

    // Insert attendance rows
    var attRows = activeStudents.map(function (bs) {
      return {
        session_id:    sessRes.data.id,
        enrollment_id: bs.enrollment_id,
        student_id:    bs.enrollments?.student_id || null,
        attended:      attendance[bs.enrollment_id] !== false,
      }
    })
    if (attRows.length > 0) {
      var attRes = await sb.from('session_attendance').insert(attRows)
      if (attRes.error) showToast('Attendance saved but some rows failed', 'warn')
    }

    // Increment sessions_done
    await sb.from('batches').update({ sessions_done: (batch.sessions_done || 0) + 1 }).eq('id', batch.id)

    // Permanent instructor change
    if (isSubstitute && makePermanent && instructorId && instructorId !== batch.instructor_id) {
      await sb.from('batches').update({ instructor_id: instructorId }).eq('id', batch.id)
    }

    setSaving(false)
    var presentCount = activeStudents.filter(function (bs) { return attendance[bs.enrollment_id] !== false }).length
    showToast('Session #' + sNum + ' marked — ' + presentCount + '/' + activeStudents.length + ' present ✓')
    onSaved()
  }

  var presentCount = activeStudents.filter(function (bs) { return attendance[bs.enrollment_id] !== false }).length
  var ciName = batch.instructors?.full_name || '—'

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="ch">
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{batch.name} — Attendance</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              Session #{sessionNum || '…'} &nbsp;·&nbsp; {batch.skus?.courses?.group_name} — {batch.skus?.level_name}
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Date */}
          <label style={{ font: '500 12px var(--font)', color: 'var(--text2)' }}>
            Session Date *
            <input type="date" value={sessionDate}
              onChange={function (e) { setSessionDate(e.target.value) }}
              style={{ marginTop: 4 }} />
          </label>

          {/* Instructor */}
          <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ font: '600 12px var(--font)', color: 'var(--text2)', marginBottom: 6 }}>
              Instructor
            </div>
            <div style={{ font: '500 13px var(--font)', color: 'var(--text)', marginBottom: 8 }}>
              {ciName}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, font: '500 12px var(--font)', color: 'var(--text2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={isSubstitute}
                onChange={function (e) {
                  setIsSubstitute(e.target.checked)
                  if (!e.target.checked) { setMakePermanent(false); setInstructorId(batch.instructor_id || '') }
                }} />
              Different instructor today (substitute / cover)
            </label>

            {isSubstitute && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <select
                  value={instructorId}
                  onChange={function (e) { setInstructorId(e.target.value) }}
                  style={{ fontSize: 13 }}
                >
                  <option value="">— Select CI —</option>
                  {eligibleCIs.map(function (ci) {
                    return <option key={ci.id} value={ci.id}>{ci.full_name}</option>
                  })}
                </select>
                {instructorId && instructorId !== batch.instructor_id && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, font: '500 12px var(--font)', color: 'var(--text2)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={makePermanent}
                      onChange={function (e) { setMakePermanent(e.target.checked) }} />
                    Make permanent — reassign this batch to the new instructor
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Student attendance */}
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
                    <div
                      key={bs.id}
                      onClick={function () { toggle(bs.enrollment_id) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                        border: present ? '1.5px solid var(--green)' : '1.5px solid var(--border)',
                        background: present ? 'var(--green-bg)' : 'var(--bg2)',
                        transition: 'all 0.12s',
                      }}
                    >
                      <div style={{
                        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                        background: present ? 'var(--green)' : 'var(--bg4)',
                        color: present ? '#fff' : 'var(--text3)',
                        fontWeight: 700, fontSize: 13,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {present ? '✓' : '✗'}
                      </div>
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

// ── ChangeInstructorModal ─────────────────────────────────────────────────────

function ChangeInstructorModal({ batch, onClose, onSaved }) {
  const [eligibleCIs,  setEligibleCIs]  = useState([])
  const [instructorId, setInstructorId] = useState('')
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)

  useEffect(function () {
    sb.from('instructor_courses')
      .select('instructor_id, instructors(id, full_name, status)')
      .eq('sku_id', batch.sku_id)
      .eq('status', 'active')
      .then(function (res) {
        var seen = {}
        var cis = (res.data || [])
          .map(function (r) { return r.instructors })
          .filter(function (i) { return i && i.status === 'active' })
          .filter(function (i) { if (seen[i.id]) return false; seen[i.id] = true; return true })
        setEligibleCIs(cis)
        setLoading(false)
      })
  }, [])

  async function save() {
    if (!instructorId) { showToast('Select an instructor', 'warn'); return }
    if (instructorId === batch.instructor_id) { showToast('That is already the current instructor', 'warn'); return }
    setSaving(true)
    var { error } = await sb.from('batches').update({ instructor_id: instructorId }).eq('id', batch.id)
    setSaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    showToast('Instructor updated ✓')
    onSaved()
  }

  var currentName = batch.instructors?.full_name || '—'

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="ch">
          <span style={{ fontWeight: 700 }}>Change Instructor — {batch.name}</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ font: '500 12px var(--font)', color: 'var(--text2)' }}>
            Current instructor: <strong>{currentName}</strong>
          </div>
          {loading ? (
            <div className="hint">Loading eligible CIs…</div>
          ) : eligibleCIs.length === 0 ? (
            <div className="hint" style={{ color: 'var(--red)' }}>
              No other active CIs are appointed for this level yet.
            </div>
          ) : (
            <label style={{ font: '500 12px var(--font)', color: 'var(--text2)' }}>
              New Instructor *
              <select value={instructorId} onChange={function (e) { setInstructorId(e.target.value) }}
                style={{ marginTop: 4, fontSize: 13 }}>
                <option value="">— Select CI —</option>
                {eligibleCIs
                  .filter(function (ci) { return ci.id !== batch.instructor_id })
                  .map(function (ci) { return <option key={ci.id} value={ci.id}>{ci.full_name}</option> })}
              </select>
            </label>
          )}
          <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', background: 'var(--sun-bg)', borderRadius: 6, padding: '8px 12px' }}>
            ⚠️ This permanently reassigns the batch. Past session records keep their original instructor.
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving || !instructorId || loading}>
            {saving ? 'Saving…' : 'Reassign Batch'}
          </button>
        </div>
      </div>
    </div>
  )
}

function avatar(name) {
  return (name || '?').split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()
}

// ── AddBatchModal ─────────────────────────────────────────────────────────────

function AddBatchModal({ instructorId, skuId, skuLabel, onClose, onSaved }) {
  const [form, setForm] = useState({ ...BLANK_BATCH })
  const [saving, setSaving] = useState(false)

  function fd(field) {
    return function (e) { setForm(function (f) { return { ...f, [field]: e.target.value } }) }
  }

  function toggleDay(day) {
    setForm(function (f) {
      const days = f.days.includes(day)
        ? f.days.filter(function (d) { return d !== day })
        : [...f.days, day]
      return { ...f, days }
    })
  }

  async function save() {
    if (!form.name.trim()) { showToast('Batch name required', 'err'); return }
    setSaving(true)
    const payload = {
      instructor_id:  instructorId,
      sku_id:         skuId,
      name:           form.name.trim(),
      is_individual:  form.is_individual,
      schedule_days:  form.days.join(', '),
      schedule_time:  form.time || null,
      start_date:     form.start_date || null,
      notes:          form.notes.trim() || null,
      is_active:      true,
      sessions_done:  0,
    }
    const { error } = await sb.from('batches').insert(payload)
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    showToast('Batch created')
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="ch">
          <span style={{ fontWeight: 700 }}>New Batch — {skuLabel}</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '16px 20px 20px' }}>
          <div className="form-grid">
            <label className="col-span-2">Batch Name *
              <input value={form.name} onChange={fd('name')} placeholder="e.g. Morning Batch A" />
            </label>

            <label className="col-span-2">Schedule Days
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {DAYS.map(function (d) {
                  const on = form.days.includes(d)
                  return (
                    <button key={d} type="button"
                      onClick={function () { toggleDay(d) }}
                      style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                        border: on ? '1.5px solid var(--purple)' : '1px solid var(--border)',
                        background: on ? 'var(--purple-bg)' : 'var(--bg2)',
                        color: on ? 'var(--purple)' : 'var(--text2)',
                        fontWeight: on ? 700 : 400,
                      }}>
                      {d}
                    </button>
                  )
                })}
              </div>
            </label>

            <label>Time
              <input type="time" value={form.time} onChange={fd('time')} />
            </label>
            <label>Start Date
              <input type="date" value={form.start_date} onChange={fd('start_date')} />
            </label>

            <label className="col-span-2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.is_individual}
                onChange={function (e) { setForm(function (f) { return { ...f, is_individual: e.target.checked } }) }} />
              Individual (1-on-1) session
            </label>

            <label className="col-span-2">Notes
              <input value={form.notes} onChange={fd('notes')} placeholder="Optional remarks…" />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn-p" onClick={save} disabled={saving}>
              {saving ? 'Creating…' : 'Create Batch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── RosterModal ───────────────────────────────────────────────────────────────

function RosterModal({ batch, nlhCentreId, onClose, onChange }) {
  const [students, setStudents] = useState(
    (batch.batch_students || []).filter(function (bs) { return !bs.removed_at })
  )
  const [eligible,    setEligible]    = useState([])
  const [showAdd,     setShowAdd]     = useState(false)
  const [selectedEnr, setSelectedEnr] = useState('')
  const [saving,      setSaving]      = useState(false)

  useEffect(function () {
    async function loadEligible() {
      const alreadyIn = students.map(function (bs) { return bs.enrollment_id })
      const { data } = await sb.from('enrollments')
        .select('id, student_id, students(id, full_name)')
        .eq('sku_id', batch.sku_id)
        .eq('franchisee_id', nlhCentreId)
        .eq('status', 'active')
      setEligible((data || []).filter(function (e) { return !alreadyIn.includes(e.id) }))
    }
    if (showAdd) loadEligible()
  }, [showAdd])

  async function assign() {
    if (!selectedEnr) return
    setSaving(true)
    const { data, error } = await sb.from('batch_students')
      .insert({ batch_id: batch.id, enrollment_id: selectedEnr })
      .select('id, enrollment_id, assigned_at, removed_at, enrollments(id, student_id, students(id, full_name))')
      .single()
    setSaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    setStudents(function (s) { return [...s, data] })
    setSelectedEnr('')
    setShowAdd(false)
    onChange()
    showToast('Student added')
  }

  async function remove(bsId) {
    const removed_at = new Date().toISOString()
    const { error } = await sb.from('batch_students').update({ removed_at }).eq('id', bsId)
    if (error) { showToast('Remove failed', 'err'); return }
    setStudents(function (s) { return s.filter(function (x) { return x.id !== bsId }) })
    onChange()
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="ch">
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{batch.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              {batch.instructor_name} · {batch.level_name}
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '0 20px 20px' }}>
          {students.length === 0 && (
            <p className="hint" style={{ marginBottom: 8 }}>No students assigned yet.</p>
          )}
          {students.map(function (bs) {
            return (
              <div key={bs.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
              }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{bs.enrollments?.students?.full_name || '—'}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>Since {fmtDate(bs.assigned_at)}</div>
                </div>
                <button className="btn" style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={function () { remove(bs.id) }}>
                  Remove
                </button>
              </div>
            )
          })}

          {/* Add student */}
          {showAdd ? (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              {eligible.length === 0
                ? <span style={{ fontSize: 12, color: 'var(--text3)' }}>No eligible enrolled students found.</span>
                : <>
                    <select style={{ flex: 1, fontSize: 13 }} value={selectedEnr}
                      onChange={function (e) { setSelectedEnr(e.target.value) }}>
                      <option value="">— Select student —</option>
                      {eligible.map(function (e) {
                        return <option key={e.id} value={e.id}>{e.students?.full_name || e.id}</option>
                      })}
                    </select>
                    <button className="btn-p" style={{ fontSize: 12 }}
                      onClick={assign} disabled={!selectedEnr || saving}>
                      {saving ? '…' : 'Add'}
                    </button>
                  </>
              }
              <button className="btn" style={{ fontSize: 12 }} onClick={function () { setShowAdd(false) }}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn-s" style={{ marginTop: 12 }} onClick={function () { setShowAdd(true) }}>
              + Add Student
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── BatchesPage ───────────────────────────────────────────────────────────────

export default function BatchesPage() {
  const [batches,       setBatches]       = useState([])
  const [instructors,   setInstructors]   = useState([])   // for filter dropdown
  const [allSkus,       setAllSkus]       = useState([])   // for new-batch dropdown
  const [nlhCentreId,   setNlhCentreId]   = useState(null)
  const [loading,       setLoading]       = useState(true)

  // Filters
  const [filterCI,      setFilterCI]      = useState('')
  const [filterCourse,  setFilterCourse]  = useState('')
  const [filterStatus,  setFilterStatus]  = useState('active')

  // Modals
  const [showAddBatch,       setShowAddBatch]       = useState(null) // { instructorId, skuId, skuLabel }
  const [rosterModal,        setRosterModal]        = useState(null) // batch object
  const [attendanceModal,    setAttendanceModal]    = useState(null) // batch object
  const [changeInstrModal,   setChangeInstrModal]   = useState(null) // batch object

  // ── load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async function () {
    setLoading(true)
    const { data: nlh } = await sb.from('franchisees').select('id').eq('tier', 'NLH').single()
    if (!nlh) { setLoading(false); return }
    setNlhCentreId(nlh.id)

    const [{ data: batchRows }, { data: ins }, { data: skuRows }] = await Promise.all([
      sb.from('batches')
        .select(`
          id, sku_id, instructor_id, name, is_individual, schedule_days, schedule_time,
          is_active, start_date, sessions_done, notes, created_at,
          skus(id, level_name, total_sessions, courses(group_name)),
          instructors(id, full_name),
          batch_students(id, enrollment_id, assigned_at, removed_at,
            enrollments(id, student_id, students(id, full_name)))
        `)
        .eq('instructors.franchisee_id', nlh.id)
        .order('created_at', { ascending: false }),
      sb.from('instructors')
        .select('id, full_name')
        .eq('franchisee_id', nlh.id)
        .eq('status', 'active')
        .order('full_name'),
      sb.from('skus')
        .select('id, level_name, total_sessions, courses(id, group_name)')
        .order('id'),
    ])

    // Filter out batches where instructor doesn't belong to NLH (join filtered nulls)
    setBatches((batchRows || []).filter(function (b) { return !!b.instructors }))
    setInstructors(ins || [])
    setAllSkus(skuRows || [])
    setLoading(false)
  }, [])

  useEffect(function () { load() }, [load])

  // ── session counter ───────────────────────────────────────────────────────

  async function adjustSessions(batch, delta) {
    const sessions_done = Math.max(0, (batch.sessions_done || 0) + delta)
    const { error } = await sb.from('batches').update({ sessions_done }).eq('id', batch.id)
    if (error) { showToast('Update failed', 'err'); return }
    setBatches(function (prev) {
      return prev.map(function (b) { return b.id === batch.id ? { ...b, sessions_done } : b })
    })
  }

  async function toggleActive(batch) {
    const is_active = !batch.is_active
    const { error } = await sb.from('batches').update({ is_active }).eq('id', batch.id)
    if (error) { showToast('Update failed', 'err'); return }
    setBatches(function (prev) {
      return prev.map(function (b) { return b.id === batch.id ? { ...b, is_active } : b })
    })
  }

  // ── filter ────────────────────────────────────────────────────────────────

  const courseNames = Array.from(new Set(
    batches.map(function (b) { return b.skus?.courses?.group_name }).filter(Boolean)
  )).sort()

  const filtered = batches.filter(function (b) {
    if (filterStatus === 'active'   && !b.is_active) return false
    if (filterStatus === 'inactive' && b.is_active)  return false
    if (filterCI && b.instructor_id !== filterCI)    return false
    if (filterCourse && b.skus?.courses?.group_name !== filterCourse) return false
    return true
  })

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="page">
      {/* ── Page header ── */}
      <div className="ph">
        <div>
          <div className="ph-title">Batches</div>
          <div className="ph-sub">All active batches across NLH Course Instructors</div>
        </div>
        <button className="btn-p" style={{ fontSize: 13 }}
          onClick={function () {
            // Open Add Batch with instructor+level picker
            setShowAddBatch({ mode: 'pick' })
          }}>
          + New Batch
        </button>
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={filterStatus} onChange={function (e) { setFilterStatus(e.target.value) }}
          style={{ fontSize: 13, minWidth: 110 }}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select value={filterCI} onChange={function (e) { setFilterCI(e.target.value) }}
          style={{ fontSize: 13, minWidth: 160 }}>
          <option value="">All Instructors</option>
          {instructors.map(function (i) {
            return <option key={i.id} value={i.id}>{i.full_name}</option>
          })}
        </select>
        <select value={filterCourse} onChange={function (e) { setFilterCourse(e.target.value) }}
          style={{ fontSize: 13, minWidth: 160 }}>
          <option value="">All Courses</option>
          {courseNames.map(function (c) {
            return <option key={c} value={c}>{c}</option>
          })}
        </select>
        <span style={{ fontSize: 13, color: 'var(--text3)', alignSelf: 'center' }}>
          {filtered.length} batch{filtered.length !== 1 ? 'es' : ''}
        </span>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="hint" style={{ padding: 32, textAlign: 'center' }}>Loading batches…</div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '48px 24px', color: 'var(--text3)', fontSize: 13,
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📦</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No batches found</div>
          <div>Create a batch by clicking "+ New Batch" above.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(function (batch) {
            const activeStudents = (batch.batch_students || []).filter(function (bs) { return !bs.removed_at })
            const totalSessions  = batch.skus?.total_sessions
            const sessLabel      = totalSessions
              ? (batch.sessions_done || 0) + ' / ' + totalSessions
              : String(batch.sessions_done || 0)
            const courseName     = batch.skus?.courses?.group_name || '—'
            const levelName      = batch.skus?.level_name || '—'
            const ciName         = batch.instructors?.full_name || '—'

            return (
              <div key={batch.id} style={{
                border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden',
                background: batch.is_active ? 'var(--bg)' : 'var(--bg3)',
                opacity: batch.is_active ? 1 : 0.72,
              }}>
                <div style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>

                    {/* CI avatar */}
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: batch.is_active ? 'var(--purple)' : 'var(--bg4)',
                      color: batch.is_active ? '#fff' : 'var(--text3)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 12, flexShrink: 0,
                    }}>
                      {avatar(ciName)}
                    </div>

                    {/* Main info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{batch.name}</span>
                        {batch.is_individual && (
                          <span className="badge bp" style={{ fontSize: 9 }}>1-on-1</span>
                        )}
                        <span className={`badge ${batch.is_active ? 'ba' : 'bd'}`} style={{ fontSize: 9 }}>
                          {batch.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>

                      {/* CI · Course · Level */}
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>{ciName}</span>
                        <span style={{ color: 'var(--text3)', margin: '0 4px' }}>·</span>
                        <span>{courseName}</span>
                        <span style={{ color: 'var(--text3)', margin: '0 4px' }}>—</span>
                        <span style={{ color: 'var(--text3)' }}>{levelName}</span>
                      </div>

                      {/* Schedule */}
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {batch.schedule_days || ''}
                        {batch.schedule_time ? ' · ' + batch.schedule_time.slice(0, 5) : ''}
                        {batch.start_date    ? ' · Started ' + fmtDate(batch.start_date) : ''}
                        {batch.notes         ? ' · ' + batch.notes : ''}
                      </div>
                    </div>

                    {/* Right controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>

                      {/* Sessions counter — undo button + label only; + replaced by Take Attendance */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          onClick={function () { adjustSessions(batch, -1) }}
                          disabled={!batch.sessions_done}
                          title="Undo last session"
                          style={{
                            width: 24, height: 24, borderRadius: 5, border: '1px solid var(--border)',
                            background: 'var(--bg2)', cursor: batch.sessions_done ? 'pointer' : 'not-allowed',
                            fontSize: 15, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            opacity: batch.sessions_done ? 1 : 0.35,
                          }}>−</button>
                        <div style={{
                          font: '600 11px var(--mono)', minWidth: 78, textAlign: 'center',
                          color: 'var(--purple)', whiteSpace: 'nowrap',
                        }}>
                          {sessLabel} sessions
                        </div>
                      </div>

                      {/* Take Attendance */}
                      {batch.is_active && (
                        <button className="btn-p" style={{ fontSize: 11, padding: '4px 12px' }}
                          onClick={function () { setAttendanceModal(batch) }}>
                          📋 Attendance
                        </button>
                      )}

                      {/* Students roster */}
                      <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }}
                        onClick={function () {
                          setRosterModal({
                            ...batch,
                            instructor_name: ciName,
                            level_name:      levelName,
                          })
                        }}>
                        👥 {activeStudents.length}
                      </button>

                      {/* Change instructor */}
                      {batch.is_active && (
                        <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }}
                          title="Change instructor"
                          onClick={function () { setChangeInstrModal(batch) }}>
                          👤 CI
                        </button>
                      )}

                      {/* Toggle active */}
                      <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }}
                        onClick={function () { toggleActive(batch) }}>
                        {batch.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── New Batch picker modal ── */}
      {showAddBatch && showAddBatch.mode === 'pick' && (
        <NewBatchPicker
          instructors={instructors}
          allSkus={allSkus}
          onPicked={function (instructorId, skuId, skuLabel) {
            setShowAddBatch({ mode: 'form', instructorId, skuId, skuLabel })
          }}
          onClose={function () { setShowAddBatch(null) }}
        />
      )}

      {showAddBatch && showAddBatch.mode === 'form' && (
        <AddBatchModal
          instructorId={showAddBatch.instructorId}
          skuId={showAddBatch.skuId}
          skuLabel={showAddBatch.skuLabel}
          onClose={function () { setShowAddBatch(null) }}
          onSaved={function () { setShowAddBatch(null); load() }}
        />
      )}

      {/* ── Roster modal ── */}
      {rosterModal && nlhCentreId && (
        <RosterModal
          batch={rosterModal}
          nlhCentreId={nlhCentreId}
          onClose={function () { setRosterModal(null) }}
          onChange={function () { load() }}
        />
      )}

      {/* ── Attendance modal ── */}
      {attendanceModal && (
        <AttendanceModal
          batch={attendanceModal}
          onClose={function () { setAttendanceModal(null) }}
          onSaved={function () { setAttendanceModal(null); load() }}
        />
      )}

      {/* ── Change instructor modal ── */}
      {changeInstrModal && (
        <ChangeInstructorModal
          batch={changeInstrModal}
          onClose={function () { setChangeInstrModal(null) }}
          onSaved={function () { setChangeInstrModal(null); load() }}
        />
      )}
    </div>
  )
}

// ── NewBatchPicker ─────────────────────────────────────────────────────────────
// Step-1 modal: pick instructor + level before opening the batch form

function NewBatchPicker({ instructors, allSkus, onPicked, onClose }) {
  const [ciId,    setCiId]    = useState('')
  const [skuId,   setSkuId]   = useState('')

  // Group SKUs by course for optgroup display
  const skuGroups = (function () {
    const map = {}
    allSkus.forEach(function (s) {
      const g = s.courses?.group_name || 'Other'
      if (!map[g]) map[g] = []
      map[g].push(s)
    })
    return Object.entries(map).map(function ([name, skus]) { return { name, skus } })
  })()

  const selectedSku = allSkus.find(function (s) { return s.id === skuId })
  const skuLabel    = selectedSku
    ? (selectedSku.courses?.group_name || '') + ' — ' + selectedSku.level_name
    : ''

  function proceed() {
    if (!ciId)  { showToast('Select a Course Instructor', 'err'); return }
    if (!skuId) { showToast('Select a course level', 'err'); return }
    onPicked(ciId, skuId, skuLabel)
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="ch">
          <span style={{ fontWeight: 700 }}>New Batch — Select CI &amp; Level</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '16px 20px 20px' }}>
          <div className="form-grid">
            <label className="col-span-2">Course Instructor *
              <select value={ciId} onChange={function (e) { setCiId(e.target.value) }}>
                <option value="">— Select CI —</option>
                {instructors.map(function (i) {
                  return <option key={i.id} value={i.id}>{i.full_name}</option>
                })}
              </select>
            </label>
            <label className="col-span-2">Course &amp; Level *
              <select value={skuId} onChange={function (e) { setSkuId(e.target.value) }}>
                <option value="">— Select level —</option>
                {skuGroups.map(function (g) {
                  return (
                    <optgroup key={g.name} label={g.name}>
                      {g.skus.map(function (s) {
                        return (
                          <option key={s.id} value={s.id}>
                            {s.level_name}{s.total_sessions ? ` (${s.total_sessions} sessions)` : ''}
                          </option>
                        )
                      })}
                    </optgroup>
                  )
                })}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn-p" onClick={proceed} disabled={!ciId || !skuId}>
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
