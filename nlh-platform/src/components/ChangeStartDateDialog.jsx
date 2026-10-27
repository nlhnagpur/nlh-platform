import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { showToast, fmtDate } from '../utils'
import { validateStartDate, startDateWarnings, startDatePlan } from '../utils/startDate'
import { monthLabel } from '../utils/ciPayrollRun'

// Correct the date a course started (HO). One date; the enrolment, the batch placement made with it, the
// monthly cycle start and the invoice date that carried the old date all move together.
//   enrollment: { id, enrolled_at, cycle_started_at, completed_at, monthly, label }   student: { id, name }
export default function ChangeStartDateDialog({ enrollment, student, onClose, onDone }) {
  const today = new Date().toISOString().slice(0, 10)
  const [newDate, setNewDate] = useState('')
  const [mems, setMems] = useState([])
  const [invoices, setInvoices] = useState([])
  const [classesBefore, setClassesBefore] = useState(0)
  const [runs, setRuns] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(function () {
    ;(async function () {
      const m = await sb.from('batch_students').select('id, assigned_at, batches(instructor_id, instructors(full_name))').eq('enrollment_id', enrollment.id)
      setMems(m.data || [])
      const i = await sb.from('student_invoices').select('id, invoice_date, items').eq('student_id', student.id)
      setInvoices(i.data || [])
    })()
  }, [enrollment.id, student.id])

  useEffect(function () {
    if (!newDate) { setClassesBefore(0); setRuns([]); return }
    sb.from('session_attendance').select('id, batch_sessions!inner(session_date)', { count: 'exact', head: true })
      .eq('enrollment_id', enrollment.id).eq('attended', true).lt('batch_sessions.session_date', newDate)
      .then(function (r) { setClassesBefore(r.count || 0) })
    const a = String(enrollment.enrolled_at).slice(0, 7), b = newDate.slice(0, 7)
    const months = Array.from(new Set([a, b]))
    const cis = Array.from(new Set(mems.map(function (x) { return x.batches && x.batches.instructor_id }).filter(Boolean)))
    if (cis.length) {
      sb.from('ci_payroll_runs').select('instructor_id, month, status, instructors(full_name)').in('instructor_id', cis).in('month', months)
        .then(function (r) { setRuns((r.data || []).map(function (x) { return { ci: (x.instructors && x.instructors.full_name) || 'The CI', month: monthLabel(x.month), status: x.status === 'draft' ? 'saved' : x.status } })) })
    } else setRuns([])
  }, [newDate, mems.length])   // eslint-disable-line react-hooks/exhaustive-deps

  const check = validateStartDate(enrollment, newDate, today)
  const warnings = startDateWarnings(newDate, { today: today, classesBefore: classesBefore, savedRuns: runs })
  const plan = newDate ? startDatePlan(enrollment, newDate, mems, invoices) : []

  async function go() {
    if (!check.ok) { setError(check.problems[0]); return }
    setBusy(true); setError('')
    const table = { enrollment: 'enrollments', membership: 'batch_students', invoice: 'student_invoices' }
    try {
      for (const op of plan) {
        const r = await sb.from(table[op.type]).update(op.patch).eq('id', op.id)
        if (r.error) throw r.error
      }
      showToast(enrollment.label + ' now starts on ' + fmtDate(newDate) + ' ✓')
      onDone && onDone(plan.find(function (o) { return o.type === 'enrollment' }).patch)
    } catch (e) {
      setError('Stopped part-way: ' + e.message + '. Check the course start date on the student record before trying again.')
    }
    setBusy(false)
  }

  const lbl = { font: '600 11px var(--font)', color: 'var(--text2)' }
  const what = { enrollment: 'the enrolment', membership: 'the batch placement', invoice: 'the invoice date' }
  const changing = plan.map(function (o) { return what[o.type] + (o.type === 'enrollment' && o.patch.cycle_started_at ? ' and the cycle start' : '') })
  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal" style={{ maxWidth: 500 }}>
        <div style={{ padding: '16px 20px 4px' }}>
          <div style={{ font: '700 16px var(--font)' }}>Correct the start date</div>
          <div style={{ font: '500 12px var(--font)', color: 'var(--text3)', marginTop: 4 }}>
            {student.name} · <b>{enrollment.label}</b> — now recorded as started on <b>{fmtDate(String(enrollment.enrolled_at).slice(0, 10))}</b>.
          </div>
        </div>
        <div style={{ padding: '10px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={lbl}>The course really started on
            <input type="date" value={newDate} onChange={function (e) { setNewDate(e.target.value) }} style={{ display: 'block', marginTop: 4 }} />
          </label>
          {newDate && check.ok && (
            <div className="hint" style={{ margin: 0 }}>This changes together: {changing.join(', ')}. Classes already recorded stay as they are.</div>
          )}
          {warnings.map(function (w, i) {
            return <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#FFFBEB', border: '1px solid #FCD34D', font: '500 12px var(--font)', color: '#92400E' }}>⚠ {w}</div>
          })}
          {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', font: '500 12px var(--font)' }}>{error}</div>}
          {!check.ok && newDate && !error && <div className="hint" style={{ margin: 0 }}>{check.problems[0]}</div>}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-p" onClick={go} disabled={busy || !check.ok}>{busy ? 'Saving…' : 'Change start date'}</button>
        </div>
      </div>
    </div>
  )
}
