import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { showToast, fmtDate } from '../utils'
import { validateMove, movePlan, moveWarnings, dayBefore } from '../utils/batchMove'
import { appointmentForCourse } from '../utils/ciPayroll'
import { monthLabel } from '../utils/ciPayrollRun'

// Move a child to another batch — one guided action with an effective date. The old membership ends the day
// before, the new one starts on the date; the child is on exactly one batch every day. The CI is not changed
// for anyone else, and a CI without an appointment for the programme is a warning, not a block.
//   student: { enrollmentId, name, programme }   current: { bsId, batchId, batchName, assigned_at, ciName, ciId, franchisee_id }
export default function MoveBatchDialog({ student, current, onClose, onDone }) {
  const today = new Date().toISOString().slice(0, 10)
  const [targets, setTargets] = useState([])
  const [targetId, setTargetId] = useState('')
  const [effective, setEffective] = useState(today)
  const [runs, setRuns] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(function () {
    ;(async function () {
      let q = sb.from('batches').select('id, name, schedule_time, schedule_days, instructor_id, instructors(full_name)').eq('is_active', true).neq('id', current.batchId)
      if (current.franchisee_id) q = q.eq('franchisee_id', current.franchisee_id)
      const b = await q
      const list = b.data || []
      const ids = Array.from(new Set(list.map(function (x) { return x.instructor_id }).filter(Boolean)))
      let appts = []
      if (ids.length) {
        const a = await sb.from('instructor_courses').select('instructor_id, remuneration_mode, appointed_at, skus(courses(group_name))').in('instructor_id', ids).eq('status', 'active')
        appts = a.data || []
      }
      setTargets(list.map(function (x) { return { ...x, appts: appts.filter(function (p) { return p.instructor_id === x.instructor_id }) } }))
    })()
  }, [current.batchId])   // eslint-disable-line react-hooks/exhaustive-deps

  const target = targets.find(function (t) { return t.id === targetId })

  // payroll months this move touches, for the two CIs: warn if they are already saved / posted / paid
  useEffect(function () {
    if (!target || !effective) { setRuns([]); return }
    const months = Array.from(new Set([dayBefore(effective).slice(0, 7), effective.slice(0, 7)])).filter(Boolean)
    const cis = [current.ciId, target.instructor_id].filter(Boolean)
    if (!cis.length || !months.length) return
    sb.from('ci_payroll_runs').select('instructor_id, month, status, instructors(full_name)').in('instructor_id', cis).in('month', months)
      .then(function (r) { setRuns((r.data || []).map(function (x) { return { ci: (x.instructors && x.instructors.full_name) || 'The CI', month: monthLabel(x.month), status: x.status === 'draft' ? 'saved' : x.status } })) })
  }, [targetId, effective])   // eslint-disable-line react-hooks/exhaustive-deps

  const noAppointment = !!(target && student.programme && !appointmentForCourse(target.appts, student.programme, effective.slice(0, 7) + '-31'))
  const check = validateMove(current, { targetBatchId: targetId, effective: effective })
  const warnings = moveWarnings({ effective: effective }, {
    today: today, noAppointment: noAppointment, ciNames: { old: current.ciName, new: target && target.instructors && target.instructors.full_name }, savedRuns: runs,
  })

  async function go() {
    if (!check.ok) { setError(check.problems[0]); return }
    setBusy(true); setError('')
    try {
      for (const op of movePlan({ bsId: current.bsId, enrollmentId: student.enrollmentId }, { targetBatchId: targetId, effective: effective })) {
        if (op.type === 'end_membership') {
          const r = await sb.from('batch_students').update({ removed_at: op.removed_at }).eq('id', op.bsId)
          if (r.error) throw r.error
        } else {
          // reuse an earlier row for this batch if the child was on it before
          const prior = await sb.from('batch_students').select('id').eq('batch_id', op.batchId).eq('enrollment_id', op.enrollmentId).order('assigned_at', { ascending: false }).limit(1).maybeSingle()
          const w = prior.data
            ? await sb.from('batch_students').update({ removed_at: null, assigned_at: op.assigned_at }).eq('id', prior.data.id)
            : await sb.from('batch_students').insert({ batch_id: op.batchId, enrollment_id: op.enrollmentId, assigned_at: op.assigned_at })
          if (w.error) throw w.error
        }
      }
      showToast(student.name + ' moved to ' + (target ? target.name : 'the new batch') + ' from ' + fmtDate(effective) + ' ✓')
      onDone && onDone()
    } catch (e) {
      setError('Stopped part-way: ' + e.message + '. Check the child’s batch on the student record before trying again.')
    }
    setBusy(false)
  }

  const lbl = { font: '600 11px var(--font)', color: 'var(--text2)' }
  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div style={{ padding: '16px 20px 4px' }}>
          <div style={{ font: '700 16px var(--font)' }}>Move {student.name} to another batch</div>
          <div style={{ font: '500 12px var(--font)', color: 'var(--text3)', marginTop: 4 }}>
            Now on <b>{current.batchName}</b>{current.ciName ? ' with ' + current.ciName : ''}. The child is counted once; each CI is paid for the classes they take.
          </div>
        </div>
        <div style={{ padding: '10px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={lbl}>Moves to
            <select value={targetId} onChange={function (e) { setTargetId(e.target.value) }} style={{ display: 'block', marginTop: 4, width: '100%' }}>
              <option value="">— Choose a batch —</option>
              {targets.map(function (t) {
                const noAp = student.programme && !appointmentForCourse(t.appts, student.programme, effective.slice(0, 7) + '-31')
                return <option key={t.id} value={t.id}>{t.name} · {(t.instructors && t.instructors.full_name) || 'no CI'}{t.schedule_time ? ' · ' + String(t.schedule_time).slice(0, 5) : ''}{noAp ? ' ⚠ no appointment yet' : ''}</option>
              })}
            </select>
          </label>
          <label style={lbl}>From this date
            <input type="date" value={effective} onChange={function (e) { setEffective(e.target.value) }} style={{ display: 'block', marginTop: 4 }} />
            <span style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}> Last day on the old batch: {effective ? fmtDate(dayBefore(effective)) : '—'}</span>
          </label>
          {warnings.map(function (w, i) {
            return <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#FFFBEB', border: '1px solid #FCD34D', font: '500 12px var(--font)', color: '#92400E' }}>⚠ {w}</div>
          })}
          {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', font: '500 12px var(--font)' }}>{error}</div>}
          {!check.ok && !error && <div className="hint" style={{ margin: 0 }}>{check.problems[0]}</div>}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-p" onClick={go} disabled={busy || !check.ok}>{busy ? 'Moving…' : 'Move child'}</button>
        </div>
      </div>
    </div>
  )
}
