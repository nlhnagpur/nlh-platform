import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { showToast, fmtDate } from '../utils'
import { CLOSE_CHOICES, validateClose, closeBatchPlan, targetBlockReason } from '../utils/batchClose'
import { appointmentForCourse } from '../utils/ciPayroll'

// Close a batch — one guided action. Every student on the batch is dealt with first (moved to another
// batch, marked finished, or taken off to be placed later); only then is the batch closed and locked.
export default function CloseBatchDialog({ batch, onClose, onDone }) {
  const students = (batch.batch_students || []).filter(function (bs) { return !bs.removed_at && bs.enrollments && !bs.enrollments.completed_at })
    .map(function (bs) {
      return {
        bsId: bs.id, enrollmentId: bs.enrollment_id,
        name: (bs.enrollments.students && bs.enrollments.students.full_name) || 'Student',
        programme: (bs.enrollments.skus && bs.enrollments.skus.courses && bs.enrollments.skus.courses.group_name) || '',
      }
    })
  const [decisions, setDecisions] = useState({})
  const [closeDate, setCloseDate] = useState(new Date().toISOString().slice(0, 10))
  const [lastClass, setLastClass] = useState('')
  const [targets, setTargets] = useState([])       // other open batches, with their CI's appointments
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(function () {
    sb.from('batch_sessions').select('session_date').eq('batch_id', batch.id).order('session_date', { ascending: false }).limit(1)
      .then(function (r) { const d = r.data && r.data[0] && r.data[0].session_date; if (d) { setLastClass(String(d).slice(0, 10)); setCloseDate(function (c) { return c < String(d).slice(0, 10) ? String(d).slice(0, 10) : c }) } })
    ;(async function () {
      let q = sb.from('batches').select('id, name, schedule_time, schedule_days, instructor_id, instructors(full_name)').eq('is_active', true).neq('id', batch.id)
      if (batch.franchisee_id) q = q.eq('franchisee_id', batch.franchisee_id)
      const b = await q
      const list = b.data || []
      const ciIds = Array.from(new Set(list.map(function (x) { return x.instructor_id }).filter(Boolean)))
      let appts = []
      if (ciIds.length) {
        const a = await sb.from('instructor_courses').select('instructor_id, remuneration_mode, appointed_at, skus(courses(group_name))').in('instructor_id', ciIds).eq('status', 'active')
        appts = a.data || []
      }
      setTargets(list.map(function (x) { return { ...x, appts: appts.filter(function (p) { return p.instructor_id === x.instructor_id }) } }))
    })()
  }, [batch.id])   // eslint-disable-line react-hooks/exhaustive-deps

  function setChoice(bsId, patch) { setDecisions(function (d) { return { ...d, [bsId]: { ...(d[bsId] || {}), ...patch } } }) }
  const check = validateClose(students, decisions, { closeDate: closeDate, lastClassDate: lastClass })

  async function go() {
    if (!check.ok) { setError(check.problems[0]); return }
    setBusy(true); setError('')
    const ops = closeBatchPlan(batch.id, students, decisions, { closeDate: closeDate })
    try {
      for (const op of ops) {
        if (op.type === 'take_off') {
          const r = await sb.from('batch_students').update({ removed_at: op.removed_at }).eq('id', op.bsId)
          if (r.error) throw new Error(op.name + ': ' + r.error.message)
        } else if (op.type === 'assign') {
          const r = await sb.from('batch_students').insert({ batch_id: op.batchId, enrollment_id: op.enrollmentId, assigned_at: op.assigned_at })
          if (r.error) throw new Error(op.name + ': ' + r.error.message)
        } else if (op.type === 'complete') {
          const r = await sb.from('enrollments').update({ completed_at: op.completed_at, status: 'completed' }).eq('id', op.enrollmentId)
          if (r.error) throw new Error(op.name + ': ' + r.error.message)
        } else if (op.type === 'close_batch') {
          const r = await sb.from('batches').update({ is_active: false }).eq('id', op.batchId)
          if (r.error) throw new Error('closing the batch: ' + r.error.message)
        }
      }
      showToast('Batch closed — ' + batch.name + ' is now view-only ✓')
      onDone && onDone()
    } catch (e) {
      setError('Stopped part-way: ' + e.message + '. The batch is still open; students already dealt with are off it. Run Close batch again to finish.')
    }
    setBusy(false)
  }

  const lbl = { font: '600 11px var(--font)', color: 'var(--text2)' }
  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div style={{ padding: '16px 20px 4px' }}>
          <div style={{ font: '700 16px var(--font)' }}>Close batch — {batch.name}</div>
          <div style={{ font: '500 12px var(--font)', color: 'var(--text3)', marginTop: 4 }}>
            Decide what happens to each student first. Once closed, the batch is view-only: no attendance, students or changes.
          </div>
        </div>
        <div style={{ padding: '10px 20px', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '60vh', overflowY: 'auto' }}>
          <label style={lbl}>Batch closes on
            <input type="date" value={closeDate} onChange={function (e) { setCloseDate(e.target.value) }} style={{ display: 'block', marginTop: 4 }} />
            {lastClass && <span style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}> Last class recorded: {fmtDate(lastClass)}</span>}
          </label>

          {students.length === 0
            ? <div className="hint" style={{ margin: 0 }}>No students are on this batch.</div>
            : students.map(function (s) {
              const d = decisions[s.bsId] || {}
              return (
                <div key={s.bsId} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ font: '700 13px var(--font)' }}>{s.name} <span style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>· {s.programme}</span></div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <select value={d.choice || ''} onChange={function (e) { setChoice(s.bsId, { choice: e.target.value, targetBatchId: '' }) }} style={{ fontSize: 13 }}>
                      <option value="">— What happens? —</option>
                      {Object.keys(CLOSE_CHOICES).map(function (k) { return <option key={k} value={k}>{CLOSE_CHOICES[k]}</option> })}
                    </select>
                    {d.choice === 'move' && (
                      <select value={d.targetBatchId || ''} onChange={function (e) { setChoice(s.bsId, { targetBatchId: e.target.value }) }} style={{ fontSize: 13, flex: 1, minWidth: 220 }}>
                        <option value="">— Which batch? —</option>
                        {targets.map(function (t) {
                          const why = targetBlockReason(t.appts, s.programme, appointmentForCourse, closeDate.slice(0, 7) + '-31', t.instructors && t.instructors.full_name)
                          return <option key={t.id} value={t.id} disabled={!!why}>{t.name} · {(t.instructors && t.instructors.full_name) || 'no CI'}{t.schedule_time ? ' · ' + String(t.schedule_time).slice(0, 5) : ''}{why ? ' — ' + why : ''}</option>
                        })}
                      </select>
                    )}
                  </div>
                  {d.choice === 'off' && <div className="hint" style={{ margin: '6px 0 0' }}>The student stays enrolled but is on no batch until you place them — do that from their record (Courses → Assign batch).</div>}
                  {d.choice === 'finished' && <div className="hint" style={{ margin: '6px 0 0' }}>The course is marked completed on the closing date. To discontinue a student instead, use Discontinue on their record.</div>}
                </div>
              )
            })}
          {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', font: '500 12px var(--font)' }}>{error}</div>}
          {!check.ok && !error && <div className="hint" style={{ margin: 0 }}>{check.problems[0]}{check.problems.length > 1 ? ' (+' + (check.problems.length - 1) + ' more)' : ''}</div>}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-p" onClick={go} disabled={busy || !check.ok}>{busy ? 'Closing…' : 'Close batch'}</button>
        </div>
      </div>
    </div>
  )
}
