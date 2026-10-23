import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { showToast, fmtDate } from '../utils'
import { LEAVE_STATUSES, handoverDate, handoverBlockReason, validateLeave, leavePlan } from '../utils/ciLeave'
import { appointmentForCourse } from '../utils/ciPayroll'
import CloseBatchDialog from './CloseBatchDialog'

const BATCH_COLS = 'id, name, franchisee_id, schedule_time, schedule_days, batch_students(id, enrollment_id, removed_at, enrollments(id, completed_at, students(full_name), skus(courses(group_name))))'

// A CI leaves — one guided action. Every open batch is handed to another CI or closed first; then the CI is
// marked as left. Their appointments stay active so the final month's payroll still calculates.
export default function CiLeavesDialog({ instructor, onClose, onDone }) {
  const [status, setStatus] = useState('resigned')
  const [lastDay, setLastDay] = useState(new Date().toISOString().slice(0, 10))
  const [batches, setBatches] = useState(null)
  const [cis, setCis] = useState([])
  const [decisions, setDecisions] = useState({})
  const [closing, setClosing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(function () {
    let cancelled = false
    ;(async function () {
      const b = await sb.from('batches').select(BATCH_COLS).eq('instructor_id', instructor.id).eq('is_active', true).order('name')
      const i = await sb.from('instructors').select('id, full_name').eq('status', 'active').neq('id', instructor.id).order('full_name')
      const ids = (i.data || []).map(function (x) { return x.id })
      let appts = []
      if (ids.length) {
        const a = await sb.from('instructor_courses').select('instructor_id, remuneration_mode, appointed_at, skus(courses(group_name))').in('instructor_id', ids).eq('status', 'active')
        appts = a.data || []
      }
      if (cancelled) return
      setBatches(b.data || [])
      setCis((i.data || []).map(function (x) { return { ...x, appts: appts.filter(function (p) { return p.instructor_id === x.id }) } }))
    })()
    return function () { cancelled = true }
  }, [instructor.id, reload])

  const open = batches || []
  const programmesOf = function (b) {
    return Array.from(new Set((b.batch_students || []).filter(function (s) { return !s.removed_at && s.enrollments && !s.enrollments.completed_at })
      .map(function (s) { return s.enrollments.skus && s.enrollments.skus.courses && s.enrollments.skus.courses.group_name }).filter(Boolean)))
  }
  function setDecision(id, patch) { setDecisions(function (d) { return { ...d, [id]: { ...(d[id] || {}), ...patch } } }) }
  const check = validateLeave(open, decisions, { status: status, lastDay: lastDay })
  const from = handoverDate(lastDay)

  async function go() {
    if (!check.ok) { setError(check.problems[0]); return }
    setBusy(true); setError('')
    try {
      for (const op of leavePlan(instructor.id, open, decisions, { status: status, lastDay: lastDay })) {
        if (op.type === 'handover') {
          const r = await sb.from('batches').update({ instructor_id: op.newCiId, instructor_assigned_at: op.assigned_at }).eq('id', op.batchId)
          if (r.error) throw new Error(op.name + ': ' + r.error.message)
        } else if (op.type === 'mark_left') {
          const r = await sb.from('instructors').update({ status: op.status, left_at: op.left_at, updated_at: new Date().toISOString() }).eq('id', op.instructorId)
          if (r.error) throw new Error('the CI record: ' + r.error.message)
        }
      }
      showToast(instructor.full_name + ' marked as ' + LEAVE_STATUSES[status].toLowerCase() + ' ✓')
      onDone && onDone({ status: status, left_at: lastDay })
    } catch (e) {
      setError('Stopped part-way: ' + e.message + '. Batches already handed over stay with their new CI; run this again to finish.')
      setReload(function (n) { return n + 1 })
    }
    setBusy(false)
  }

  const lbl = { font: '600 11px var(--font)', color: 'var(--text2)' }
  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget && !busy && !closing) onClose() }}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div style={{ padding: '16px 20px 4px' }}>
          <div style={{ font: '700 16px var(--font)' }}>{instructor.full_name} is leaving</div>
          <div style={{ font: '500 12px var(--font)', color: 'var(--text3)', marginTop: 4 }}>
            Every open batch is handed to another CI or closed, then the CI is marked as left. Past classes keep their name.
          </div>
        </div>
        <div style={{ padding: '10px 20px', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '62vh', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lbl}>Why
              <select value={status} onChange={function (e) { setStatus(e.target.value) }} style={{ display: 'block', marginTop: 4, width: '100%' }}>
                {Object.keys(LEAVE_STATUSES).map(function (k) { return <option key={k} value={k}>{LEAVE_STATUSES[k]}</option> })}
              </select>
            </label>
            <label style={lbl}>Last day of work
              <input type="date" value={lastDay} onChange={function (e) { setLastDay(e.target.value) }} style={{ display: 'block', marginTop: 4, width: '100%' }} />
            </label>
          </div>
          {from && <div className="hint" style={{ margin: 0 }}>A new CI takes over from <b>{fmtDate(from)}</b>, the day after.</div>}

          <div style={{ font: '700 12px var(--font)', marginTop: 4 }}>Open batches</div>
          {batches === null ? <div className="loading">Loading…</div> : open.length === 0 && Object.keys(decisions).length === 0
            ? <div className="hint" style={{ margin: 0 }}>This CI has no open batches.</div>
            : open.map(function (b) {
              const d = decisions[b.id] || {}
              const progs = programmesOf(b)
              const n = (b.batch_students || []).filter(function (s) { return !s.removed_at && s.enrollments && !s.enrollments.completed_at }).length
              return (
                <div key={b.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ font: '700 13px var(--font)' }}>{b.name} <span style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>· {n} student{n !== 1 ? 's' : ''}{progs.length ? ' · ' + progs.join(', ') : ''}</span></div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <select value={d.choice || ''} onChange={function (e) { setDecision(b.id, { choice: e.target.value, newCiId: '' }) }} style={{ fontSize: 13 }}>
                      <option value="">— What happens? —</option>
                      <option value="handover">Hand over to another CI</option>
                    </select>
                    {d.choice === 'handover' && (
                      <select value={d.newCiId || ''} onChange={function (e) { setDecision(b.id, { newCiId: e.target.value }) }} style={{ fontSize: 13, flex: 1, minWidth: 220 }}>
                        <option value="">— Which CI? —</option>
                        {cis.map(function (c) {
                          const why = handoverBlockReason(progs, c.appts, appointmentForCourse, (from || lastDay).slice(0, 7) + '-31', c.full_name)
                          return <option key={c.id} value={c.id}>{c.full_name}{why ? ' ⚠ no appointment yet' : ''}</option>
                        })}
                      </select>
                    )}
                    <button className="btn" style={{ fontSize: 12 }} onClick={function () { setClosing(b) }}>Close this batch instead…</button>
                  </div>
                  {d.choice === 'handover' && d.newCiId && (function () {
                    const c = cis.find(function (x) { return x.id === d.newCiId })
                    const why = c && handoverBlockReason(progs, c.appts, appointmentForCourse, (from || lastDay).slice(0, 7) + '-31', c.full_name)
                    return why ? <div style={{ margin: '6px 0 0', padding: '6px 10px', borderRadius: 8, background: '#FFFBEB', border: '1px solid #FCD34D', font: '500 12px var(--font)', color: '#92400E' }}>⚠ {why}. You can still hand the batch over; give them the extra responsibility by appointing them for the programme (Instructors → CI → Courses) so payroll can pay for it.</div> : null
                  })()}
                </div>
              )
            })}
          {open.length === 0 && Object.keys(decisions).length > 0 && <div className="hint" style={{ margin: 0 }}>All batches dealt with.</div>}

          {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', font: '500 12px var(--font)' }}>{error}</div>}
          {!check.ok && !error && <div className="hint" style={{ margin: 0 }}>{check.problems[0]}{check.problems.length > 1 ? ' (+' + (check.problems.length - 1) + ' more)' : ''}</div>}
          <div className="hint" style={{ margin: 0 }}>The CI’s appointments stay active so the final month’s payroll can be calculated. After this, open their Payroll tab for the last month.</div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-p" onClick={go} disabled={busy || !check.ok || batches === null}>{busy ? 'Saving…' : 'Mark as left'}</button>
        </div>
      </div>
      {closing && (
        <CloseBatchDialog batch={closing} onClose={function () { setClosing(null) }}
          onDone={function () { setClosing(null); setReload(function (n) { return n + 1 }) }} />
      )}
    </div>
  )
}
