import React, { useState, useEffect, useCallback } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtDate, showToast } from '../utils'

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DAYS       = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const BLANK_BATCH = { name: '', days: [], time: '', start_date: '', is_individual: false, notes: '' }

function timeRange(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const end = ((h + 1) % 24).toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0')
  return t.slice(0, 5) + ' â€“ ' + end
}

// â”€â”€ BulkAttendanceModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function BulkAttendanceModal({ batch, instructors, onClose, onSaved }) {
  var today = new Date().toISOString().split('T')[0]

  // Fresh batch_students fetched on mount (so joining-date edits are reflected immediately)
  const [batchStudents, setBatchStudents] = useState(batch.batch_students || [])

  // All students currently in the batch (not removed)
  var activeStudents = batchStudents.filter(function (bs) { return !bs.removed_at })

  // Returns only students who had joined by `date` and not yet removed before `date`
  function studentsForDate(date) {
    return batchStudents.filter(function (bs) {
      var joined  = bs.assigned_at ? bs.assigned_at.slice(0, 10) : null
      var removed = bs.removed_at  ? bs.removed_at.slice(0, 10)  : null
      return (!joined || joined <= date) && (!removed || removed > date)
    })
  }

  function initAtt(date) {
    var map = {}
    studentsForDate(date).forEach(function (bs) { map[bs.enrollment_id] = true })
    return map
  }

  const [sessions,      setSessions]      = useState([])
  const [activeIdx,     setActiveIdx]     = useState(-1)
  const [addDateVal,    setAddDateVal]    = useState(today)
  const [existingDates, setExistingDates] = useState([])
  const [saving,        setSaving]        = useState(false)
  const [todayWarning,  setTodayWarning]  = useState(false)

  useEffect(function () {
    // Fetch fresh batch_students in case joining dates were edited after the page loaded
    sb.from('batch_students')
      .select('id, enrollment_id, assigned_at, removed_at, enrollments(id, student_id, sku_id, completed_at, status, students(id, full_name), skus(level_name, total_sessions, courses(group_name)))')
      .eq('batch_id', batch.id)
      .then(function (res) {
        if (res.data) setBatchStudents(res.data)
      })
    sb.from('batch_sessions').select('session_date').eq('batch_id', batch.id)
      .then(function (res) {
        var dates = (res.data || []).map(function (r) { return r.session_date })
        setExistingDates(dates)
        if (dates.includes(today)) setTodayWarning(true)
      })
  }, [])

  function addDate() {
    if (!addDateVal) { showToast('Pick a date', 'warn'); return }
    if (existingDates.includes(addDateVal)) {
      showToast('Session already recorded for ' + fmtDate(addDateVal), 'warn'); return
    }
    if (sessions.some(function (s) { return s.date === addDateVal })) {
      showToast('Date already in list', 'warn'); return
    }
    var newIdx = sessions.length
    setSessions(function (prev) {
      return [...prev, { date: addDateVal, attendance: initAtt(addDateVal), is_holiday: false, subMode: 'regular', subCiId: '', subManualName: '' }]
    })
    setActiveIdx(newIdx)
    setAddDateVal('')
  }

  function setSubField(field, value) {
    setSessions(function (prev) {
      return prev.map(function (s, i) {
        if (i !== activeIdx) return s
        return { ...s, [field]: value }
      })
    })
  }

  function removeDate(idx) {
    setSessions(function (prev) { return prev.filter(function (_, i) { return i !== idx }) })
    setActiveIdx(function (prev) {
      if (sessions.length <= 1) return -1
      if (prev === idx) return Math.max(0, idx - 1)
      if (prev > idx) return prev - 1
      return prev
    })
  }

  function toggle(enrollmentId) {
    setSessions(function (prev) {
      return prev.map(function (s, i) {
        if (i !== activeIdx) return s
        return { ...s, attendance: { ...s.attendance, [enrollmentId]: !s.attendance[enrollmentId] } }
      })
    })
  }

  function toggleAll(present) {
    if (!activeSession) return
    var map = {}
    studentsForDate(activeSession.date).forEach(function (bs) { map[bs.enrollment_id] = present })
    setSessions(function (prev) {
      return prev.map(function (s, i) {
        if (i !== activeIdx) return s
        return { ...s, attendance: map }
      })
    })
  }

  function toggleHoliday() {
    setSessions(function (prev) {
      return prev.map(function (s, i) {
        if (i !== activeIdx) return s
        return { ...s, is_holiday: !s.is_holiday }
      })
    })
  }

  async function saveAll() {
    if (sessions.length === 0) { showToast('No sessions to save', 'warn'); return }
    setSaving(true)

    var countRes = await sb.from('batch_sessions')
      .select('session_number').eq('batch_id', batch.id)
      .order('session_number', { ascending: false }).limit(1)
    var nextNum = (countRes.data?.[0]?.session_number || 0) + 1

    var ordered = [...sessions].sort(function (a, b) { return a.date < b.date ? -1 : 1 })
    var saved = 0, skipped = 0

    for (var ki = 0; ki < ordered.length; ki++) {
      var sess = ordered[ki]
      var { data: existing } = await sb.from('batch_sessions')
        .select('id').eq('batch_id', batch.id).eq('session_date', sess.date).maybeSingle()
      if (existing) { skipped++; continue }

      var instrId    = (sess.subMode === 'ci' && sess.subCiId) ? sess.subCiId : batch.instructor_id
      var isSub      = sess.subMode !== 'regular'
      var subNotes   = sess.subMode === 'manual' && sess.subManualName.trim()
        ? 'Substitute: ' + sess.subManualName.trim()
        : null

      var { data: sessRow, error: sessErr } = await sb.from('batch_sessions').insert({
        batch_id:       batch.id,
        session_date:   sess.date,
        session_number: nextNum,
        instructor_id:  instrId,
        is_substitute:  isSub,
        is_holiday:     sess.is_holiday || false,
        notes:          subNotes,
      }).select('id').single()
      if (sessErr) { skipped++; continue }

      // Only insert attendance rows for non-holiday sessions
      // Only include students who had joined by this session's date
      if (!sess.is_holiday) {
        var sessStudents = studentsForDate(sess.date)
        var attRows = sessStudents.map(function (bs) {
          return {
            session_id:    sessRow.id,
            enrollment_id: bs.enrollment_id,
            student_id:    bs.enrollments?.student_id || null,
            attended:      sess.attendance[bs.enrollment_id] !== false,
          }
        })
        if (attRows.length > 0) await sb.from('session_attendance').insert(attRows)
      }
      nextNum++
      saved++
    }

    // â”€â”€ Sync sessions_done to actual non-holiday count in DB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // (avoids stale-prop drift if a previous save wrote rows but failed to
    //  update sessions_done, which was the root cause of the "0 sessions" bug)
    var { count: realCount } = await sb.from('batch_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batch.id)
      .eq('is_holiday', false)
    await sb.from('batches').update({ sessions_done: realCount || 0 }).eq('id', batch.id)

    setSaving(false)
    var holidayCount = sessions.filter(function (s) { return s.is_holiday }).length
    var sessionCount = saved - holidayCount
    var parts = []
    if (sessionCount > 0) parts.push(sessionCount + ' session' + (sessionCount !== 1 ? 's' : '') + ' saved')
    if (holidayCount > 0) parts.push(holidayCount + ' holiday' + (holidayCount !== 1 ? 's' : '') + ' marked')
    if (skipped > 0) parts.push(skipped + ' skipped (already recorded)')
    showToast(parts.join(', ') + ' âœ“', skipped > 0 ? 'warn' : undefined)
    onSaved()
  }

  var activeSession    = sessions.length > 0 && activeIdx >= 0 ? sessions[activeIdx] : null
  var activeSessStuds  = activeSession ? studentsForDate(activeSession.date) : []
  var presentCount     = activeSession && !activeSession.is_holiday
    ? activeSessStuds.filter(function (bs) { return activeSession.attendance[bs.enrollment_id] !== false }).length
    : 0

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 1000, width: "96vw" }}>
        <div className="ch">
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{batch.name} â€” Mark Attendance</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              {batch.instructors?.full_name || 'â€”'} Â· {(batch.batch_students || []).filter(function (bs) { return !bs.removed_at }).length} student{(batch.batch_students || []).filter(function (bs) { return !bs.removed_at }).length !== 1 ? 's' : ''}
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>âœ•</button>
        </div>

        <div style={{ display: 'flex', minHeight: 320 }}>

          {/* â”€â”€ Left: date list â”€â”€ */}
          <div style={{
            width: 186, borderRight: '1px solid var(--border)',
            padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0,
          }}>
            <div style={{ font: '600 10px var(--font)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
              Sessions to mark
            </div>

            {sessions.length === 0 && (
              <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', padding: '4px 0' }}>
                {todayWarning
                  ? <span style={{ color: '#d97706' }}>Today already recorded.<br />Pick a past date â†“</span>
                  : 'Add a date below â†“'}
              </div>
            )}

            {sessions.map(function (s, i) {
              var sessStuds = studentsForDate(s.date)
              var cnt       = sessStuds.filter(function (bs) { return s.attendance[bs.enrollment_id] !== false }).length
              var isActive  = i === activeIdx
              var borderColor = isActive
                ? (s.is_holiday ? '#d97706' : 'var(--purple)')
                : 'var(--border)'
              var bgColor = isActive
                ? (s.is_holiday ? '#fff9f0' : 'var(--purple-bg)')
                : 'var(--bg2)'
              return (
                <div
                  key={s.date + '-' + i}
                  onClick={function () { setActiveIdx(i) }}
                  style={{
                    padding: '7px 9px', borderRadius: 7, cursor: 'pointer',
                    border: '1.5px solid ' + borderColor,
                    background: bgColor,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ font: '600 11px var(--font)', color: isActive ? (s.is_holiday ? '#d97706' : 'var(--purple)') : 'var(--text)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {s.is_holiday && <span>ðŸ–</span>}
                      {new Date(s.date + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </div>
                    <div style={{ font: '500 10px var(--mono)', color: 'var(--text3)' }}>
                      {s.is_holiday ? 'Holiday' : cnt + '/' + activeStudents.length + ' present'}
                    </div>
                  </div>
                  <button type="button"
                    onClick={function (e) { e.stopPropagation(); removeDate(i) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 16, lineHeight: 1, padding: '2px 4px' }}
                  >Ã—</button>
                </div>
              )
            })}

            {/* Add date */}
            <div style={{ marginTop: 4, borderTop: sessions.length > 0 ? '1px solid var(--border)' : 'none', paddingTop: sessions.length > 0 ? 8 : 0 }}>
              <input
                type="date" value={addDateVal}
                onChange={function (e) { setAddDateVal(e.target.value) }}
                max={today}
                style={{ fontSize: 11, padding: '5px 6px', width: '100%', marginBottom: 5 }}
              />
              <button type="button" className="btn-s"
                onClick={addDate} disabled={!addDateVal}
                style={{ fontSize: 11, width: '100%', textAlign: 'center' }}
              >+ Add Date</button>
            </div>
          </div>

          {/* â”€â”€ Right: student roster â”€â”€ */}
          <div style={{ flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!activeSession ? (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>ðŸ“…</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {activeStudents.length} student{activeStudents.length !== 1 ? 's' : ''} in this batch
                </div>
                <div>Pick a date on the left and click</div>
                <div style={{ marginTop: 4 }}>
                  <strong style={{ color: 'var(--purple)' }}>+ Add Date</strong>
                  {' '}to mark attendance
                </div>
              </div>
            ) : (
              <>
                {/* â”€â”€ Session header â”€â”€ */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                  <div>
                    <div style={{ font: '700 13px var(--font)', color: activeSession.is_holiday ? '#d97706' : 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {activeSession.is_holiday && <span>ðŸ–</span>}
                      {new Date(activeSession.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </div>
                    {!activeSession.is_holiday && (
                      <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', marginTop: 2 }}>
                        <span style={{ color: 'var(--green)', fontWeight: 700 }}>{presentCount}</span>/{activeSessStuds.length} present
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {/* Holiday toggle */}
                    <button
                      type="button"
                      onClick={toggleHoliday}
                      style={{
                        padding: '4px 10px', borderRadius: 6, border: '1.5px solid',
                        borderColor: activeSession.is_holiday ? '#d97706' : 'var(--border)',
                        background: activeSession.is_holiday ? '#fff9f0' : 'var(--bg)',
                        color: activeSession.is_holiday ? '#d97706' : 'var(--text3)',
                        font: '600 11px var(--font)', cursor: 'pointer',
                      }}
                    >
                      ðŸ– {activeSession.is_holiday ? 'Holiday (tap to undo)' : 'Mark Holiday'}
                    </button>
                    {!activeSession.is_holiday && (
                      <>
                        <button className="btn-s" style={{ fontSize: 11 }} onClick={function () { toggleAll(true) }}>All Present</button>
                        <button className="btn-s" style={{ fontSize: 11 }} onClick={function () { toggleAll(false) }}>All Absent</button>
                      </>
                    )}
                  </div>
                </div>

                {/* â”€â”€ Substitute teacher â”€â”€ */}
                {!activeSession.is_holiday && (
                  <div style={{
                    padding: '8px 12px', borderRadius: 8,
                    border: activeSession.subMode !== 'regular' ? '1.5px solid #7c3aed' : '1px solid var(--border)',
                    background: activeSession.subMode !== 'regular' ? '#f5f3ff' : 'var(--bg2)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ font: '600 11px var(--font)', color: 'var(--text3)', whiteSpace: 'nowrap' }}>Teacher:</span>

                      {/* Regular CI chip */}
                      <button type="button"
                        onClick={function () { setSubField('subMode', 'regular') }}
                        style={{
                          padding: '3px 10px', borderRadius: 20, border: '1.5px solid',
                          borderColor: activeSession.subMode === 'regular' ? 'var(--purple)' : 'var(--border)',
                          background: activeSession.subMode === 'regular' ? 'var(--purple-bg)' : 'var(--bg)',
                          color: activeSession.subMode === 'regular' ? 'var(--purple)' : 'var(--text3)',
                          font: '600 11px var(--font)', cursor: 'pointer',
                        }}>
                        {batch.instructors?.full_name || 'Regular CI'}
                      </button>

                      {/* Substitute from CI list */}
                      <button type="button"
                        onClick={function () { setSubField('subMode', 'ci') }}
                        style={{
                          padding: '3px 10px', borderRadius: 20, border: '1.5px solid',
                          borderColor: activeSession.subMode === 'ci' ? 'var(--purple)' : 'var(--border)',
                          background: activeSession.subMode === 'ci' ? 'var(--purple-bg)' : 'var(--bg)',
                          color: activeSession.subMode === 'ci' ? 'var(--purple)' : 'var(--text3)',
                          font: '600 11px var(--font)', cursor: 'pointer',
                        }}>
                        ðŸ”„ Sub from list
                      </button>

                      {/* Manual substitute */}
                      <button type="button"
                        onClick={function () { setSubField('subMode', 'manual') }}
                        style={{
                          padding: '3px 10px', borderRadius: 20, border: '1.5px solid',
                          borderColor: activeSession.subMode === 'manual' ? 'var(--purple)' : 'var(--border)',
                          background: activeSession.subMode === 'manual' ? 'var(--purple-bg)' : 'var(--bg)',
                          color: activeSession.subMode === 'manual' ? 'var(--purple)' : 'var(--text3)',
                          font: '600 11px var(--font)', cursor: 'pointer',
                        }}>
                        âœï¸ Enter manually
                      </button>
                    </div>

                    {/* CI picker */}
                    {activeSession.subMode === 'ci' && (
                      <select
                        value={activeSession.subCiId}
                        onChange={function (e) { setSubField('subCiId', e.target.value) }}
                        style={{ marginTop: 8, fontSize: 12, width: '100%', padding: '5px 8px' }}
                      >
                        <option value="">â€” Select substitute CI â€”</option>
                        {(instructors || [])
                          .filter(function (ci) { return ci.id !== batch.instructor_id })
                          .map(function (ci) {
                            return <option key={ci.id} value={ci.id}>{ci.full_name}</option>
                          })}
                      </select>
                    )}

                    {/* Manual name input */}
                    {activeSession.subMode === 'manual' && (
                      <input
                        type="text"
                        value={activeSession.subManualName}
                        onChange={function (e) { setSubField('subManualName', e.target.value) }}
                        placeholder="Substitute teacher name"
                        style={{ marginTop: 8, fontSize: 12, width: '100%', padding: '5px 8px' }}
                      />
                    )}
                  </div>
                )}

                {/* â”€â”€ Holiday card â”€â”€ */}
                {activeSession.is_holiday ? (
                  <div style={{
                    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 8, padding: '24px 16px', background: '#fff9f0', borderRadius: 10,
                    border: '1.5px dashed #d97706',
                  }}>
                    <div style={{ fontSize: 36 }}>ðŸ–</div>
                    <div style={{ font: '700 14px var(--font)', color: '#d97706' }}>Holiday â€” No Class</div>
                    <div style={{ font: '500 12px var(--font)', color: 'var(--text3)', textAlign: 'center' }}>
                      This day will be recorded as a holiday.<br />Attendance is not required.
                    </div>
                    <button type="button" onClick={toggleHoliday}
                      style={{ marginTop: 4, padding: '5px 14px', borderRadius: 6, border: '1.5px solid #d97706', background: 'none', color: '#d97706', font: '600 12px var(--font)', cursor: 'pointer' }}>
                      Undo â€” Mark as Regular Session
                    </button>
                  </div>
                ) : activeSessStuds.length === 0 ? (
                  <p className="hint">No students had joined by this date.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {activeSessStuds.map(function (bs) {
                      var present = activeSession.attendance[bs.enrollment_id] !== false
                      var name    = bs.enrollments?.students?.full_name || 'â€”'
                      return (
                        <div key={bs.id}
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
                          }}>{present ? 'âœ“' : 'âœ—'}</div>
                          <div style={{ flex: 1, font: '500 13px var(--font)', color: 'var(--text)' }}>{name}</div>
                          <div style={{ font: '600 11px var(--mono)', color: present ? 'var(--green)' : 'var(--text3)' }}>
                            {present ? 'Present' : 'Absent'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {sessions.length > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    <button className="btn" style={{ fontSize: 11 }}
                      onClick={function () { setActiveIdx(function (p) { return Math.max(0, p - 1) }) }}
                      disabled={activeIdx === 0}>â† Prev</button>
                    <span style={{ font: '500 11px var(--font)', color: 'var(--text3)', alignSelf: 'center' }}>
                      {activeIdx + 1} / {sessions.length}
                    </span>
                    <button className="btn" style={{ fontSize: 11 }}
                      onClick={function () { setActiveIdx(function (p) { return Math.min(sessions.length - 1, p + 1) }) }}
                      disabled={activeIdx === sessions.length - 1}>Next â†’</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={saveAll} disabled={saving || sessions.length === 0}>
            {saving ? 'Savingâ€¦' : 'Save ' + sessions.length + ' Session' + (sessions.length !== 1 ? 's' : '')}
          </button>
        </div>
      </div>
    </div>
  )
}

// â”€â”€ SessionHistoryModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function SessionHistoryModal({ batch, onClose }) {
  // Returns students who were active on a given date (joined â‰¤ date, not yet removed)
  function studentsForDate(date) {
    return (batch.batch_students || []).filter(function (bs) {
      var joined  = bs.assigned_at ? bs.assigned_at.slice(0, 10) : null
      var removed = bs.removed_at  ? bs.removed_at.slice(0, 10)  : null
      return (!joined || joined <= date) && (!removed || removed > date)
    })
  }

  const [sessions,       setSessions]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [openSess,       setOpenSess]       = useState(null)
  const [editSessId,     setEditSessId]     = useState(null)
  const [editAtt,        setEditAtt]        = useState({})
  const [savingEdit,     setSavingEdit]     = useState(false)
  const [confirmDelId,   setConfirmDelId]   = useState(null)  // session id pending delete confirm
  const [deleting,       setDeleting]       = useState(false)

  function loadSessions() {
    setLoading(true)
    sb.from('batch_sessions')
      .select('id, session_date, session_number, is_substitute, is_holiday, notes, instructor_id, instructors(full_name), session_attendance(id, enrollment_id, attended, students(full_name))')
      .eq('batch_id', batch.id)
      .order('session_date', { ascending: false })
      .then(function (res) { setSessions(res.data || []); setLoading(false) })
  }

  useEffect(function () { loadSessions() }, [])

  function startEdit(sess) {
    // Seed edit map from existing attendance; if none, default all present
    var map = {}
    if ((sess.session_attendance || []).length > 0) {
      sess.session_attendance.forEach(function (a) { map[a.enrollment_id] = !!a.attended })
    } else {
      studentsForDate(sess.session_date).forEach(function (bs) { map[bs.enrollment_id] = true })
    }
    setEditAtt(map)
    setEditSessId(sess.id)
    setOpenSess(sess.id)
  }

  function cancelEdit() { setEditSessId(null); setEditAtt({}) }

  function toggleEdit(enrollmentId) {
    setEditAtt(function (prev) { return { ...prev, [enrollmentId]: !prev[enrollmentId] } })
  }

  async function saveEdit(sess) {
    setSavingEdit(true)
    // Delete existing attendance for this session then re-insert
    // Only include students who were in the batch on this session's date
    await sb.from('session_attendance').delete().eq('session_id', sess.id)
    var rows = studentsForDate(sess.session_date).map(function (bs) {
      return {
        session_id:    sess.id,
        enrollment_id: bs.enrollment_id,
        student_id:    bs.enrollments?.student_id || null,
        attended:      editAtt[bs.enrollment_id] !== false,
      }
    })
    if (rows.length > 0) {
      var { error } = await sb.from('session_attendance').insert(rows)
      if (error) { showToast('Save failed: ' + error.message, 'err'); setSavingEdit(false); return }
    }
    showToast('Attendance updated âœ“')
    setEditSessId(null)
    setEditAtt({})
    setSavingEdit(false)
    loadSessions()
  }

  async function deleteSession(sess) {
    // First click â†’ ask for confirmation inline (window.confirm is blocked in iframes)
    if (confirmDelId !== sess.id) { setConfirmDelId(sess.id); return }
    // Second click (confirmed) â†’ proceed
    setConfirmDelId(null)
    setDeleting(true)
    // Delete attendance first (cascade should handle it, but explicit is safer)
    await sb.from('session_attendance').delete().eq('session_id', sess.id)
    var { error } = await sb.from('batch_sessions').delete().eq('id', sess.id)
    if (error) { showToast('Delete failed: ' + error.message, 'err'); setDeleting(false); return }
    // Re-sync sessions_done to actual non-holiday count
    var { count } = await sb.from('batch_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batch.id)
      .eq('is_holiday', false)
    await sb.from('batches').update({ sessions_done: count || 0 }).eq('id', batch.id)
    showToast('Session deleted âœ“')
    setDeleting(false)
    loadSessions()
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="ch">
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{batch.name} â€” Session History</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              {loading ? 'â€¦' : (function () {
                var hols = sessions.filter(function (s) { return s.is_holiday }).length
                var sess = sessions.length - hols
                var parts = []
                if (sess > 0) parts.push(sess + ' session' + (sess !== 1 ? 's' : ''))
                if (hols > 0) parts.push(hols + ' holiday' + (hols !== 1 ? 's' : ''))
                return parts.length ? parts.join(' Â· ') : 'No sessions yet'
              })()}
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>âœ•</button>
        </div>

        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px 20px 16px' }}>
          {loading ? (
            <div className="hint" style={{ padding: '20px 0', textAlign: 'center' }}>Loadingâ€¦</div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text3)', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>ðŸ“‹</div>
              No sessions recorded yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sessions.map(function (sess) {
                var present   = (sess.session_attendance || []).filter(function (a) { return a.attended })
                var absent    = (sess.session_attendance || []).filter(function (a) { return !a.attended })
                var isOpen    = openSess === sess.id
                var isHol     = !!sess.is_holiday
                var isEditing = editSessId === sess.id
                var noData    = !isHol && (sess.session_attendance || []).length === 0

                return (
                  <div key={sess.id} style={{
                    border: '1px solid ' + (isHol ? '#f3d996' : isEditing ? 'var(--purple)' : 'var(--border)'),
                    borderRadius: 8, overflow: 'hidden',
                    background: isHol ? '#fffbf0' : isEditing ? 'var(--purple-bg)' : 'var(--bg)',
                  }}>
                    {/* â”€â”€ Row header â”€â”€ */}
                    <div
                      onClick={function () { if (!isHol && !isEditing) setOpenSess(isOpen ? null : sess.id) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: isHol || isEditing ? 'default' : 'pointer' }}
                    >
                      <div style={{ font: '700 11px var(--mono)', color: isHol ? '#d97706' : 'var(--purple)', minWidth: 30 }}>
                        #{sess.session_number}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ font: '600 13px var(--font)', color: isHol ? '#d97706' : 'var(--text)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          {isHol && <span>ðŸ–</span>}
                          {new Date(sess.session_date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                        <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', marginTop: 1 }}>
                          {isHol
                            ? <span style={{ color: '#d97706', fontWeight: 600 }}>Holiday â€” No Class</span>
                            : (function () {
                                var manualName = sess.notes && sess.notes.startsWith('Substitute: ')
                                  ? sess.notes.slice('Substitute: '.length) : null
                                var displayName = manualName || sess.instructors?.full_name || 'â€”'
                                return <>
                                  {displayName}
                                  {sess.is_substitute && (
                                    <span style={{ color: '#7c3aed', marginLeft: 6, fontWeight: 600 }}>
                                      Â· {manualName ? 'Sub (guest)' : 'Substitute'}
                                    </span>
                                  )}
                                </>
                              })()
                          }
                        </div>
                      </div>
                      {isHol && (
                        confirmDelId === sess.id ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              type="button"
                              onClick={function (e) { e.stopPropagation(); deleteSession(sess) }}
                              disabled={deleting}
                              style={{
                                padding: '2px 8px', borderRadius: 5, border: '1px solid #dc2626',
                                background: '#dc2626', color: '#fff',
                                font: '600 10px var(--font)', cursor: 'pointer',
                              }}
                            >{deleting ? 'â€¦' : 'Confirm?'}</button>
                            <button
                              type="button"
                              onClick={function (e) { e.stopPropagation(); setConfirmDelId(null) }}
                              style={{
                                padding: '2px 6px', borderRadius: 5, border: '1px solid var(--border)',
                                background: 'var(--bg2)', color: 'var(--text3)',
                                font: '500 10px var(--font)', cursor: 'pointer',
                              }}
                            >âœ•</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={function (e) { e.stopPropagation(); deleteSession(sess) }}
                            style={{
                              padding: '2px 8px', borderRadius: 5, border: '1px solid #f3d996',
                              background: 'transparent', color: '#d97706',
                              font: '500 10px var(--font)', cursor: 'pointer',
                            }}
                          >ðŸ—‘</button>
                        )
                      )}
                      {!isHol && !isEditing && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {noData
                            ? <span style={{ fontSize: 10, color: '#d97706', fontWeight: 600 }}>No data</span>
                            : <>
                                <span style={{ font: '700 11px var(--mono)', color: 'var(--green)' }}>{present.length}âœ“</span>
                                {absent.length > 0 && <span style={{ font: '700 11px var(--mono)', color: 'var(--red)' }}>{absent.length}âœ—</span>}
                              </>
                          }
                          <button
                            type="button"
                            onClick={function (e) { e.stopPropagation(); startEdit(sess) }}
                            style={{
                              padding: '2px 8px', borderRadius: 5, border: '1px solid var(--border)',
                              background: 'var(--bg2)', color: 'var(--text3)',
                              font: '500 10px var(--font)', cursor: 'pointer',
                            }}
                          >âœï¸ Edit</button>
                          {confirmDelId === sess.id ? (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                type="button"
                                onClick={function (e) { e.stopPropagation(); deleteSession(sess) }}
                                disabled={deleting}
                                style={{
                                  padding: '2px 8px', borderRadius: 5, border: '1px solid #dc2626',
                                  background: '#dc2626', color: '#fff',
                                  font: '600 10px var(--font)', cursor: 'pointer',
                                }}
                              >{deleting ? 'â€¦' : 'Confirm?'}</button>
                              <button
                                type="button"
                                onClick={function (e) { e.stopPropagation(); setConfirmDelId(null) }}
                                style={{
                                  padding: '2px 6px', borderRadius: 5, border: '1px solid var(--border)',
                                  background: 'var(--bg2)', color: 'var(--text3)',
                                  font: '500 10px var(--font)', cursor: 'pointer',
                                }}
                              >âœ•</button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={function (e) { e.stopPropagation(); deleteSession(sess) }}
                              style={{
                                padding: '2px 8px', borderRadius: 5, border: '1px solid var(--border)',
                                background: 'var(--bg2)', color: 'var(--red, #dc2626)',
                                font: '500 10px var(--font)', cursor: 'pointer',
                              }}
                            >ðŸ—‘</button>
                          )}
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{isOpen ? 'â–²' : 'â–¼'}</span>
                        </div>
                      )}
                    </div>

                    {/* â”€â”€ View mode (expanded) â”€â”€ */}
                    {isOpen && !isHol && !isEditing && (
                      <div style={{ padding: '8px 14px 12px', background: 'var(--bg2)', borderTop: '1px solid var(--border)' }}>
                        {noData ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="hint" style={{ margin: 0 }}>No attendance recorded for this session.</span>
                            <button type="button" className="btn-s" style={{ fontSize: 11 }}
                              onClick={function () { startEdit(sess) }}>Mark Now</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                            {present.length > 0 && (
                              <div style={{ minWidth: 110 }}>
                                <div style={{ font: '600 10px var(--mono)', color: 'var(--green)', marginBottom: 5, textTransform: 'uppercase' }}>Present ({present.length})</div>
                                {present.map(function (a) {
                                  return <div key={a.id} style={{ font: '500 12px var(--font)', color: 'var(--text)', marginBottom: 2 }}>âœ“ {a.students?.full_name || 'â€”'}</div>
                                })}
                              </div>
                            )}
                            {absent.length > 0 && (
                              <div style={{ minWidth: 110 }}>
                                <div style={{ font: '600 10px var(--mono)', color: 'var(--red)', marginBottom: 5, textTransform: 'uppercase' }}>Absent ({absent.length})</div>
                                {absent.map(function (a) {
                                  return <div key={a.id} style={{ font: '500 12px var(--font)', color: 'var(--text3)', marginBottom: 2 }}>âœ— {a.students?.full_name || 'â€”'}</div>
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* â”€â”€ Edit mode â”€â”€ */}
                    {isEditing && (function () {
                      var editStudents = studentsForDate(sess.session_date)
                      return (
                      <div style={{ padding: '10px 14px 14px', background: 'var(--purple-bg)', borderTop: '1px solid var(--purple)' }}>
                        <div style={{ font: '600 11px var(--font)', color: 'var(--purple)', marginBottom: 8 }}>
                          Mark attendance â€” tap to toggle
                        </div>
                        {editStudents.length === 0 ? (
                          <p className="hint">No students had joined by this date.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
                            {editStudents.map(function (bs) {
                              var pres = editAtt[bs.enrollment_id] !== false
                              var name = bs.enrollments?.students?.full_name || 'â€”'
                              return (
                                <div key={bs.id}
                                  onClick={function () { toggleEdit(bs.enrollment_id) }}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '7px 11px', borderRadius: 7, cursor: 'pointer',
                                    border: pres ? '1.5px solid var(--green)' : '1.5px solid var(--border)',
                                    background: pres ? 'var(--green-bg)' : 'var(--bg)',
                                    transition: 'all 0.1s',
                                  }}
                                >
                                  <div style={{
                                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                                    background: pres ? 'var(--green)' : 'var(--bg4)',
                                    color: pres ? '#fff' : 'var(--text3)',
                                    fontWeight: 700, fontSize: 12,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  }}>{pres ? 'âœ“' : 'âœ—'}</div>
                                  <span style={{ flex: 1, font: '500 12px var(--font)', color: 'var(--text)' }}>{name}</span>
                                  <span style={{ font: '600 10px var(--mono)', color: pres ? 'var(--green)' : 'var(--text3)' }}>
                                    {pres ? 'Present' : 'Absent'}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" className="btn" style={{ fontSize: 11 }}
                            onClick={cancelEdit} disabled={savingEdit}>Cancel</button>
                          <button type="button" className="btn-p" style={{ fontSize: 11 }}
                            onClick={function () { saveEdit(sess) }} disabled={savingEdit}>
                            {savingEdit ? 'Savingâ€¦' : 'Save Attendance'}
                          </button>
                        </div>
                      </div>
                    )})()}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-p" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// â”€â”€ ChangeInstructorModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ChangeInstructorModal({ batch, onClose, onSaved }) {
  const [eligibleCIs,  setEligibleCIs]  = useState([])
  const [instructorId, setInstructorId] = useState('')
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)

  useEffect(function () {
    // Load all active instructors at NLH centre (batch no longer tied to one SKU)
    sb.from('franchisees').select('id').eq('tier', 'NLH').single().then(function (nlhRes) {
      var nlhId = nlhRes.data?.id
      if (!nlhId) { setLoading(false); return }
      sb.from('instructors')
        .select('id, full_name, status')
        .eq('franchisee_id', nlhId)
        .eq('status', 'active')
        .order('full_name')
        .then(function (res) {
          setEligibleCIs(res.data || [])
          setLoading(false)
        })
    })
  }, [])

  async function save() {
    if (!instructorId) { showToast('Select an instructor', 'warn'); return }
    if (instructorId === batch.instructor_id) { showToast('That is already the current instructor', 'warn'); return }
    setSaving(true)
    var { error } = await sb.from('batches').update({ instructor_id: instructorId }).eq('id', batch.id)
    setSaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    showToast('Instructor updated âœ“')
    onSaved()
  }

  var currentName = batch.instructors?.full_name || 'â€”'

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="ch">
          <span style={{ fontWeight: 700 }}>Change Instructor â€” {batch.name}</span>
          <button className="btn-icon" onClick={onClose}>âœ•</button>
        </div>
        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ font: '500 12px var(--font)', color: 'var(--text2)' }}>
            Current instructor: <strong>{currentName}</strong>
          </div>
          {loading ? (
            <div className="hint">Loading eligible CIsâ€¦</div>
          ) : eligibleCIs.length === 0 ? (
            <div className="hint" style={{ color: 'var(--red)' }}>
              No other active CIs are appointed for this level yet.
            </div>
          ) : (
            <label style={{ font: '500 12px var(--font)', color: 'var(--text2)' }}>
              New Instructor *
              <select value={instructorId} onChange={function (e) { setInstructorId(e.target.value) }}
                style={{ marginTop: 4, fontSize: 13 }}>
                <option value="">â€” Select CI â€”</option>
                {eligibleCIs
                  .filter(function (ci) { return ci.id !== batch.instructor_id })
                  .map(function (ci) { return <option key={ci.id} value={ci.id}>{ci.full_name}</option> })}
              </select>
            </label>
          )}
          <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', background: 'var(--sun-bg)', borderRadius: 6, padding: '8px 12px' }}>
            âš ï¸ This permanently reassigns the batch. Past session records keep their original instructor.
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving || !instructorId || loading}>
            {saving ? 'Savingâ€¦' : 'Reassign Batch'}
          </button>
        </div>
      </div>
    </div>
  )
}

function avatar(name) {
  return (name || '?').split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()
}

// â”€â”€ EditBatchModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    showToast('Batch updated âœ“')
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="ch">
          <span style={{ fontWeight: 700 }}>Edit Batch â€” {batch.name}</span>
          <button className="btn-icon" onClick={onClose}>âœ•</button>
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
                placeholder="Optional remarksâ€¦" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn-p" onClick={save} disabled={saving}>{saving ? 'Savingâ€¦' : 'Save Changes'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// â”€â”€ AddBatchModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function AddBatchModal({ instructorId, onClose, onSaved }) {
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
      <div className="modal">
        <div className="ch">
          <span style={{ fontWeight: 700 }}>New Batch</span>
          <button className="btn-icon" onClick={onClose}>âœ•</button>
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
              <input value={form.notes} onChange={fd('notes')} placeholder="Optional remarksâ€¦" />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn-p" onClick={save} disabled={saving}>
              {saving ? 'Creatingâ€¦' : 'Create Batch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// â”€â”€ RosterModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function RosterModal({ batch, nlhCentreId, onClose, onChange }) {
  const [students, setStudents] = useState(
    (batch.batch_students || []).filter(function (bs) { return !bs.removed_at })
  )
  const [eligible,      setEligible]      = useState([])
  const [showAdd,       setShowAdd]       = useState(false)
  const [selectedEnr,   setSelectedEnr]   = useState('')
  const [addJoinDate,   setAddJoinDate]   = useState(new Date().toISOString().slice(0, 10))
  const [saving,        setSaving]        = useState(false)
  const [editingJoin,   setEditingJoin]   = useState(null)  // bsId being edited
  const [editJoinVal,   setEditJoinVal]   = useState('')

  useEffect(function () {
    async function loadEligible() {
      const alreadyIn = students.map(function (bs) { return bs.enrollment_id })

      // Only show students enrolled in SKUs this CI is actively appointed to teach
      const { data: appts } = await sb.from('instructor_courses')
        .select('sku_id')
        .eq('instructor_id', batch.instructor_id)
        .eq('status', 'active')
      const ciSkuIds = (appts || []).map(function (a) { return a.sku_id })

      if (ciSkuIds.length === 0) { setEligible([]); return }

      const { data } = await sb.from('enrollments')
        .select('id, student_id, sku_id, students(id, full_name, registered_at), skus(level_name, courses(group_name))')
        .eq('franchisee_id', nlhCentreId)
        .eq('status', 'active')
        .in('sku_id', ciSkuIds)
        .order('student_id')
      setEligible((data || []).filter(function (e) { return !alreadyIn.includes(e.id) }))
    }
    if (showAdd) loadEligible()
  }, [showAdd])

  async function assign() {
    if (!selectedEnr) return
    setSaving(true)
    const { data, error } = await sb.from('batch_students')
      .insert({ batch_id: batch.id, enrollment_id: selectedEnr, assigned_at: addJoinDate + 'T00:00:00+00:00' })
      .select('id, enrollment_id, assigned_at, removed_at, enrollments(id, student_id, sku_id, students(id, full_name), skus(level_name, courses(group_name)))')
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

  async function saveJoinDate(bsId) {
    if (!editJoinVal) return
    const { error } = await sb.from('batch_students')
      .update({ assigned_at: editJoinVal + 'T00:00:00+00:00' })
      .eq('id', bsId)
    if (error) { showToast('Update failed: ' + error.message, 'err'); return }
    setStudents(function (s) {
      return s.map(function (bs) {
        return bs.id === bsId ? { ...bs, assigned_at: editJoinVal + 'T00:00:00+00:00' } : bs
      })
    })
    setEditingJoin(null)
    showToast('Joining date updated âœ“')
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="ch">
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{batch.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              {batch.instructor_name} Â· {students.length} student{students.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>âœ•</button>
        </div>
        <div style={{ padding: '0 20px 20px' }}>
          {students.length === 0 && (
            <p className="hint" style={{ marginBottom: 8 }}>No students assigned yet.</p>
          )}
          {students.map(function (bs) {
            var isEditingThis = editingJoin === bs.id
            return (
              <div key={bs.id} style={{
                padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{bs.enrollments?.students?.full_name || 'â€”'}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                      {bs.enrollments?.skus?.courses?.group_name
                        ? bs.enrollments.skus.courses.group_name + ' Â· ' + (bs.enrollments.skus.level_name || '')
                        : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className="btn" style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={function () { remove(bs.id) }}>
                      Remove
                    </button>
                  </div>
                </div>
                {/* Joining date row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>Joined:</span>
                  {isEditingThis ? (
                    <>
                      <input type="date" value={editJoinVal}
                        onChange={function (e) { setEditJoinVal(e.target.value) }}
                        style={{ fontSize: 11, padding: '2px 5px' }} />
                      <button className="btn-p" style={{ fontSize: 10, padding: '2px 7px' }}
                        onClick={function () { saveJoinDate(bs.id) }}>Save</button>
                      <button className="btn" style={{ fontSize: 10, padding: '2px 7px' }}
                        onClick={function () { setEditingJoin(null) }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, color: 'var(--text)' }}>{fmtDate(bs.assigned_at)}</span>
                      <button className="btn" style={{ fontSize: 10, padding: '1px 6px' }}
                        onClick={function () { setEditingJoin(bs.id); setEditJoinVal(bs.assigned_at ? bs.assigned_at.slice(0, 10) : '') }}>
                        Edit
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {/* Add student */}
          {showAdd ? (
            <div style={{ marginTop: 12 }}>
              {eligible.length === 0
                ? <span style={{ fontSize: 12, color: 'var(--text3)' }}>No eligible enrolled students found.</span>
                : <>
                    <select style={{ width: '100%', fontSize: 13, marginBottom: 6 }} value={selectedEnr}
                      onChange={function (e) {
                        setSelectedEnr(e.target.value)
                        var enr = eligible.find(function (x) { return x.id === e.target.value })
                        var regDate = enr?.students?.registered_at
                        setAddJoinDate(regDate || new Date().toISOString().slice(0, 10))
                      }}>
                      <option value="">â€” Select student â€”</option>
                      {eligible.map(function (e) {
                        const course = e.skus?.courses?.group_name || ''
                        const level  = e.skus?.level_name || ''
                        const label  = e.students?.full_name || e.id
                        return (
                          <option key={e.id} value={e.id}>
                            {label}{course ? ' â€” ' + course + (level ? ' ' + level : '') : ''}
                          </option>
                        )
                      })}
                    </select>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>Joining date:</span>
                      <input type="date" value={addJoinDate}
                        onChange={function (e) { setAddJoinDate(e.target.value) }}
                        style={{ fontSize: 12, padding: '3px 6px', flex: 1 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn-p" style={{ fontSize: 12 }}
                        onClick={assign} disabled={!selectedEnr || !addJoinDate || saving}>
                        {saving ? 'â€¦' : 'Add'}
                      </button>
                      <button className="btn" style={{ fontSize: 12 }} onClick={function () { setShowAdd(false) }}>
                        Cancel
                      </button>
                    </div>
                  </>
              }
              {eligible.length === 0 && (
                <button className="btn" style={{ fontSize: 12, marginTop: 6 }} onClick={function () { setShowAdd(false) }}>
                  Cancel
                </button>
              )}
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

// â”€â”€ BatchesPage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // Inline roster toggle + per-batch attendance stats
  const [openRosters,  setOpenRosters]  = useState({})
  const [rosterStats,  setRosterStats]  = useState({}) // batchId â†’ { enrollmentId: attendedCount }

  // Modals
  const [showAddBatch,       setShowAddBatch]       = useState(null) // { instructorId, skuId, skuLabel }
  const [addStudentModal,    setAddStudentModal]    = useState(null) // batch object (for adding students only)
  const [attendanceModal,    setAttendanceModal]    = useState(null) // batch object
  const [historyModal,       setHistoryModal]       = useState(null) // batch object
  const [changeInstrModal,   setChangeInstrModal]   = useState(null) // batch object
  const [editBatchModal,     setEditBatchModal]     = useState(null) // batch object

  // â”€â”€ load â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
          instructors(id, full_name),
          batch_students(id, enrollment_id, assigned_at, removed_at,
            enrollments(id, student_id, sku_id, completed_at, status, students(id, full_name, phone, parent_name),
              skus(level_name, total_sessions, courses(group_name))))
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

  // â”€â”€ session counter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  async function removeFromBatch(bsId, batchId) {
    const { error } = await sb.from('batch_students')
      .update({ removed_at: new Date().toISOString() })
      .eq('id', bsId)
    if (error) { showToast('Remove failed', 'err'); return }
    setBatches(function (prev) {
      return prev.map(function (b) {
        if (b.id !== batchId) return b
        return {
          ...b,
          batch_students: b.batch_students.map(function (bs) {
            return bs.id === bsId ? { ...bs, removed_at: new Date().toISOString() } : bs
          }),
        }
      })
    })
    showToast('Student removed')
  }

  async function loadRosterStats(batchId) {
    var { data: sessions } = await sb.from('batch_sessions')
      .select('id')
      .eq('batch_id', batchId)
      .eq('is_holiday', false)
    if (!sessions || sessions.length === 0) {
      setRosterStats(function (prev) { return { ...prev, [batchId]: {} } })
      return
    }
    var sessionIds = sessions.map(function (s) { return s.id })
    var { data: att } = await sb.from('session_attendance')
      .select('enrollment_id')
      .in('session_id', sessionIds)
      .eq('attended', true)
    var map = {}
    ;(att || []).forEach(function (a) {
      map[a.enrollment_id] = (map[a.enrollment_id] || 0) + 1
    })
    setRosterStats(function (prev) { return { ...prev, [batchId]: map } })
  }

  var GOOGLE_REVIEW_URL = 'https://g.page/r/CQW0Giwe5ILEEBM/review'

  async function markComplete(enrollmentId, batchId, studentName, parentName, phone, courseName) {
    var completed_at = new Date().toISOString()
    var { error } = await sb.from('enrollments')
      .update({ completed_at, status: 'completed' })
      .eq('id', enrollmentId)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    showToast('Marked as completed âœ“')
    setBatches(function (prev) {
      return prev.map(function (b) {
        if (b.id !== batchId) return b
        return {
          ...b,
          batch_students: b.batch_students.map(function (bs) {
            if (bs.enrollments?.id !== enrollmentId) return bs
            return { ...bs, enrollments: { ...bs.enrollments, completed_at, status: 'completed' } }
          }),
        }
      })
    })
    // Send WhatsApp review request to parent
    if (phone) {
      var clean = phone.replace(/\D/g, '')
      if (clean.length === 10) clean = '91' + clean
      var msg = 'Dear ' + (parentName || 'Parent') + ',\n\n'
        + (studentName || 'Your child') + ' has successfully completed the *' + (courseName || 'course') + '* programme at *New Learning Horizons*! ðŸŽ‰\n\n'
        + 'We would love to hear your feedback. A quick Google Review would mean a lot to us:\n'
        + GOOGLE_REVIEW_URL + '\n\n'
        + 'Thank you for being part of the NLH family! ðŸŒŸ'
      window.open('https://wa.me/' + clean + '?text=' + encodeURIComponent(msg), '_blank')
    }
  }

  // â”€â”€ filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Derive course names per batch from enrolled students' SKUs
  function batchCourses(batch) {
    const active = (batch.batch_students || []).filter(function (bs) { return !bs.removed_at })
    const names  = active.map(function (bs) { return bs.enrollments?.skus?.courses?.group_name }).filter(Boolean)
    return [...new Set(names)]
  }

  const courseNames = Array.from(new Set(
    batches.flatMap(function (b) { return batchCourses(b) })
  )).sort()

  const filtered = batches.filter(function (b) {
    if (filterStatus === 'active'   && !b.is_active) return false
    if (filterStatus === 'inactive' && b.is_active)  return false
    if (filterCI && b.instructor_id !== filterCI)    return false
    if (filterCourse && !batchCourses(b).includes(filterCourse)) return false
    return true
  })

  const sorted = [...filtered].sort(function (a, b) {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
    const ta = a.schedule_time || 'ZZ'
    const tb = b.schedule_time || 'ZZ'
    if (ta !== tb) return ta < tb ? -1 : 1
    return (a.name || '').localeCompare(b.name || '')
  })

  // â”€â”€ render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <div className="page">
      {/* â”€â”€ Page header â”€â”€ */}
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

      {/* â”€â”€ Filters â”€â”€ */}
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

      {/* â”€â”€ Content â”€â”€ */}
      {loading ? (
        <div className="hint" style={{ padding: 32, textAlign: 'center' }}>Loading batchesâ€¦</div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '48px 24px', color: 'var(--text3)', fontSize: 13,
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>ðŸ“¦</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No batches found</div>
          <div>Create a batch by clicking "+ New Batch" above.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map(function (batch) {
            const activeStudents = (batch.batch_students || []).filter(function (bs) { return !bs.removed_at })
            const sessLabel      = String(batch.sessions_done || 0)
            const courses        = batchCourses(batch)
            const coursesLabel   = courses.length > 0 ? courses.join(', ') : 'â€”'
            const ciName         = batch.instructors?.full_name || 'â€”'

            const rosterOpen = !!openRosters[batch.id]

            return (
              <div key={batch.id} style={{
                border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden',
                background: batch.is_active ? 'var(--bg)' : 'var(--bg3)',
                opacity: batch.is_active ? 1 : 0.72,
              }}>
                {/* â”€â”€ Batch header row â”€â”€ */}
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

                      {/* CI Â· Courses */}
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>{ciName}</span>
                        {courses.length > 0 && (
                          <>
                            <span style={{ color: 'var(--text3)', margin: '0 4px' }}>Â·</span>
                            <span>{coursesLabel}</span>
                          </>
                        )}
                      </div>

                      {/* Schedule */}
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {batch.schedule_days || ''}
                        {batch.schedule_time ? ' Â· ' + timeRange(batch.schedule_time) : ''}
                        {batch.start_date    ? ' Â· Started ' + fmtDate(batch.start_date) : ''}
                        {batch.notes         ? ' Â· ' + batch.notes : ''}
                      </div>
                    </div>

                    {/* Right controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>

                      {/* Sessions counter */}
                      <div
                        title="Sessions conducted â€” click History to view dates"
                        style={{
                          font: '600 11px var(--mono)', padding: '3px 10px',
                          borderRadius: 6, border: '1px solid var(--border)',
                          background: 'var(--bg2)', color: 'var(--purple)',
                          whiteSpace: 'nowrap', cursor: 'default',
                        }}>
                        {sessLabel} sessions
                      </div>

                      {/* Take Attendance */}
                      {batch.is_active && (
                        <button className="btn-p" style={{ fontSize: 11, padding: '4px 12px' }}
                          onClick={function () { setAttendanceModal(batch) }}>
                          ðŸ“‹ Attendance
                        </button>
                      )}

                      {/* Session history */}
                      <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }}
                        title="View session history"
                        onClick={function () { setHistoryModal(batch) }}>
                        ðŸ—‚ History
                      </button>

                      {/* Students toggle â€” shows count, expands inline */}
                      <button
                        className={'btn' + (rosterOpen ? ' btn-active' : '')}
                        style={{ fontSize: 11, padding: '3px 10px', background: rosterOpen ? 'var(--purple-bg)' : '', borderColor: rosterOpen ? 'var(--purple)' : '', color: rosterOpen ? 'var(--purple)' : '' }}
                        onClick={function () {
                          var nowOpen = !openRosters[batch.id]
                          setOpenRosters(function (r) { return { ...r, [batch.id]: nowOpen } })
                          if (nowOpen) loadRosterStats(batch.id)
                        }}>
                        ðŸ‘¥ {activeStudents.length} {rosterOpen ? 'â–²' : 'â–¼'}
                      </button>

                      {/* Change instructor */}
                      {batch.is_active && (
                        <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }}
                          title="Change instructor"
                          onClick={function () { setChangeInstrModal(batch) }}>
                          ðŸ‘¤ CI
                        </button>
                      )}

                      {/* Edit batch */}
                      <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }}
                        title="Edit batch schedule"
                        onClick={function () { setEditBatchModal(batch) }}>
                        âœ Edit
                      </button>

                      {/* Toggle active */}
                      <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }}
                        onClick={function () { toggleActive(batch) }}>
                        {batch.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* â”€â”€ Inline student roster â”€â”€ */}
                {rosterOpen && (
                  <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg2)', padding: '10px 16px 14px' }}>
                    {activeStudents.length === 0 ? (
                      <div style={{ font: '500 12px var(--font)', color: 'var(--text3)', marginBottom: 8 }}>
                        No students assigned yet.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
                        {activeStudents.map(function (bs) {
                          const name        = bs.enrollments?.students?.full_name || 'â€”'
                          const course      = bs.enrollments?.skus?.courses?.group_name || ''
                          const level       = bs.enrollments?.skus?.level_name || ''
                          const initials    = name.split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()
                          const enrollId    = bs.enrollments?.id
                          const isCompleted = !!bs.enrollments?.completed_at
                          const attended    = (rosterStats[batch.id] || {})[bs.enrollment_id] || 0
                          const totalSess   = bs.enrollments?.skus?.total_sessions || 0
                          const statsLoaded = rosterStats[batch.id] !== undefined
                          return (
                            <div key={bs.id} style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '8px 10px', borderRadius: 8,
                              background: isCompleted ? 'var(--green-bg)' : 'var(--bg)',
                              border: '1px solid ' + (isCompleted ? 'var(--green)' : 'var(--border)'),
                            }}>
                              <div style={{
                                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                                background: isCompleted ? 'var(--green)' : 'var(--purple-bg)',
                                color: isCompleted ? '#fff' : 'var(--purple)',
                                fontWeight: 700, fontSize: 11,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}>{isCompleted ? 'âœ“' : initials}</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ font: '600 12px var(--font)', color: 'var(--text)' }}>{name}</div>
                                {(course || level) && (
                                  <div style={{ font: '500 10px var(--mono)', color: 'var(--text3)', marginTop: 1 }}>
                                    {course}{level ? ' Â· ' + level : ''}
                                  </div>
                                )}
                              </div>
                              {/* Sessions attended badge */}
                              {statsLoaded && (
                                <div style={{
                                  flexShrink: 0, textAlign: 'right',
                                  font: '600 11px var(--mono)',
                                  color: isCompleted ? 'var(--green)' : attended > 0 ? 'var(--text)' : 'var(--text3)',
                                }}>
                                  {attended}
                                  {totalSess > 0 && <span style={{ color: 'var(--text3)', fontWeight: 400 }}>/{totalSess}</span>}
                                  <div style={{ font: '500 9px var(--font)', color: 'var(--text3)', fontWeight: 400 }}>sessions</div>
                                </div>
                              )}
                              {/* Complete button / badge */}
                              {isCompleted ? (
                                <span style={{
                                  flexShrink: 0, font: '600 10px var(--font)', color: 'var(--green)',
                                  padding: '2px 8px', border: '1px solid var(--green)',
                                  borderRadius: 20, background: 'var(--green-bg)', whiteSpace: 'nowrap',
                                }}>âœ“ Completed</span>
                              ) : (
                                <button className="btn" style={{
                                  fontSize: 10, padding: '2px 8px', flexShrink: 0,
                                  color: 'var(--green)', borderColor: 'var(--green)',
                                  whiteSpace: 'nowrap',
                                }}
                                  onClick={function () {
                                    markComplete(
                                      enrollId, batch.id,
                                      bs.enrollments?.students?.full_name,
                                      bs.enrollments?.students?.parent_name,
                                      bs.enrollments?.students?.phone,
                                      course + (level ? ' ' + level : '')
                                    )
                                  }}>
                                  âœ“ Complete
                                </button>
                              )}
                              <button className="btn" style={{ fontSize: 10, padding: '2px 8px', flexShrink: 0 }}
                                onClick={function () { removeFromBatch(bs.id, batch.id) }}>
                                Remove
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {/* All-completed banner */}
                    {activeStudents.length > 0 && activeStudents.every(function (bs) { return !!bs.enrollments?.completed_at }) && (
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px', borderRadius: 8, marginBottom: 10,
                        background: 'var(--green-bg)', border: '1px solid var(--green)',
                        gap: 10, flexWrap: 'wrap',
                      }}>
                        <div>
                          <div style={{ font: '700 12px var(--font)', color: 'var(--green)' }}>ðŸŽ“ All students have completed the course!</div>
                          <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', marginTop: 2 }}>
                            Consider deactivating this batch since no more sessions are needed.
                          </div>
                        </div>
                        {batch.is_active && (
                          <button
                            className="btn"
                            style={{ fontSize: 11, borderColor: 'var(--green)', color: 'var(--green)', flexShrink: 0 }}
                            onClick={function () { toggleActive(batch) }}>
                            Deactivate Batch
                          </button>
                        )}
                      </div>
                    )}

                    <button className="btn-s" style={{ fontSize: 11 }}
                      onClick={function () { setAddStudentModal({ ...batch, instructor_name: ciName }) }}>
                      + Add Student
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* â”€â”€ New Batch picker modal â”€â”€ */}
      {showAddBatch && showAddBatch.mode === 'pick' && (
        <NewBatchPicker
          instructors={instructors}
          onPicked={function (instructorId) {
            setShowAddBatch({ mode: 'form', instructorId })
          }}
          onClose={function () { setShowAddBatch(null) }}
        />
      )}

      {showAddBatch && showAddBatch.mode === 'form' && (
        <AddBatchModal
          instructorId={showAddBatch.instructorId}
          onClose={function () { setShowAddBatch(null) }}
          onSaved={function () { setShowAddBatch(null); load() }}
        />
      )}

      {/* â”€â”€ Add Student modal (roster for adding only) â”€â”€ */}
      {addStudentModal && nlhCentreId && (
        <RosterModal
          batch={addStudentModal}
          nlhCentreId={nlhCentreId}
          onClose={function () { setAddStudentModal(null) }}
          onChange={function () { setAddStudentModal(null); load() }}
        />
      )}

      {/* â”€â”€ Bulk attendance modal â”€â”€ */}
      {attendanceModal && (
        <BulkAttendanceModal
          batch={attendanceModal}
          instructors={instructors}
          onClose={function () { setAttendanceModal(null) }}
          onSaved={function () { setAttendanceModal(null); load() }}
        />
      )}

      {/* â”€â”€ Session history modal â”€â”€ */}
      {historyModal && (
        <SessionHistoryModal
          batch={historyModal}
          onClose={function () { setHistoryModal(null) }}
        />
      )}

      {/* â”€â”€ Change instructor modal â”€â”€ */}
      {changeInstrModal && (
        <ChangeInstructorModal
          batch={changeInstrModal}
          onClose={function () { setChangeInstrModal(null) }}
          onSaved={function () { setChangeInstrModal(null); load() }}
        />
      )}

      {/* â”€â”€ Edit batch modal â”€â”€ */}
      {editBatchModal && (
        <EditBatchModal
          batch={editBatchModal}
          onClose={function () { setEditBatchModal(null) }}
          onSaved={function () { setEditBatchModal(null); load() }}
        />
      )}
    </div>
  )
}

// â”€â”€ NewBatchPicker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Step-1 modal: pick instructor + level before opening the batch form

function NewBatchPicker({ instructors, onPicked, onClose }) {
  const [ciId, setCiId] = useState('')

  function proceed() {
    if (!ciId) { showToast('Select a Course Instructor', 'err'); return }
    onPicked(ciId)
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="ch">
          <span style={{ fontWeight: 700 }}>New Batch â€” Select Instructor</span>
          <button className="btn-icon" onClick={onClose}>âœ•</button>
        </div>
        <div style={{ padding: '16px 20px 20px' }}>
          <div className="form-grid">
            <label className="col-span-2">Course Instructor *
              <select value={ciId} onChange={function (e) { setCiId(e.target.value) }}>
                <option value="">â€” Select CI â€”</option>
                {instructors.map(function (i) {
                  return <option key={i.id} value={i.id}>{i.full_name}</option>
                })}
              </select>
            </label>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            Students from any course can be added to the batch â€” one CI can teach different courses to different students in the same time slot.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn-p" onClick={proceed} disabled={!ciId}>
              Next â†’
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


