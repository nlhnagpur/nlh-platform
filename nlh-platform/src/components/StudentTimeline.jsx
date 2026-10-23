import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { fmtDate } from '../utils'
import { fetchAllRows } from '../utils/studentLifecycle'
import { buildTimeline, timelineNow } from '../utils/studentTimeline'

const KIND = {
  admission: { icon: '🎓', color: '#534AB7' }, enrolled: { icon: '📚', color: '#534AB7' },
  batch: { icon: '📦', color: '#1D4ED8' }, batch_move: { icon: '⇄', color: '#1D4ED8' }, batch_end: { icon: '↩', color: '#64748B' },
  completed: { icon: '✓', color: '#166534' }, certificate: { icon: '🏅', color: '#166534' }, marks: { icon: '📝', color: '#166534' },
  payment: { icon: '₹', color: '#92400E' }, fee: { icon: '₹', color: '#92400E' },
  dropped: { icon: '⊘', color: '#991B1B' }, closed: { icon: '⊘', color: '#991B1B' },
}

// The student's timeline (HO): everything that has happened to the child — admission, batches and CIs, level
// changes, completions, certificates, payments — from records that already exist. Nothing is typed in.
export default function StudentTimeline({ student, enrollments }) {
  const [data, setData] = useState(null)
  const [newestFirst, setNewestFirst] = useState(true)
  const [error, setError] = useState('')

  useEffect(function () {
    let cancelled = false
    ;(async function () {
      const ids = (enrollments || []).map(function (e) { return e.id })
      const [mem, pay, fee] = await Promise.all([
        ids.length ? sb.from('batch_students').select('enrollment_id, assigned_at, removed_at, batches(id, name, instructors(full_name))').in('enrollment_id', ids) : { data: [] },
        sb.from('student_payments').select('paid_at, amount, receipt_no, mode').eq('student_id', student.id),
        sb.from('student_fee_events').select('at, field, old_value, new_value, delta, actor').eq('student_id', student.id).order('at', { ascending: false }).limit(60),
      ])
      const att = ids.length ? await fetchAllRows(function (from, to) {
        return sb.from('session_attendance')
          .select('enrollment_id, batch_sessions(session_date, batch_id, is_substitute, instructors(full_name), batches(name))')
          .in('enrollment_id', ids).eq('attended', true).order('id').range(from, to)
      }) : []
      if (cancelled) return
      setData({
        memberships: (mem.data || []).map(function (m) { return { enrollment_id: m.enrollment_id, assigned_at: m.assigned_at, removed_at: m.removed_at, batch: { name: m.batches && m.batches.name }, ci: m.batches && m.batches.instructors && m.batches.instructors.full_name } }),
        classes: (att || []).filter(function (a) { return a.batch_sessions }).map(function (a) {
          return { enrollment_id: a.enrollment_id, date: a.batch_sessions.session_date, batch_id: a.batch_sessions.batch_id, batch_name: a.batch_sessions.batches && a.batch_sessions.batches.name, ci: a.batch_sessions.instructors && a.batch_sessions.instructors.full_name, substitute: !!a.batch_sessions.is_substitute }
        }),
        payments: pay.data || [], feeEvents: fee.data || [],
      })
    })().catch(function (e) { if (!cancelled) { setError(e.message || 'Could not load the timeline'); setData({ memberships: [], classes: [], payments: [], feeEvents: [] }) } })
    return function () { cancelled = true }
  }, [student.id, (enrollments || []).map(function (e) { return e.id + (e.completed_at || '') }).join()])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="loading" style={{ padding: 24 }}>Loading timeline…</div>
  const ctx = { student: student, enrollments: enrollments || [], memberships: data.memberships, classes: data.classes, payments: data.payments, feeEvents: data.feeEvents }
  const events = buildTimeline(ctx)
  const shown = newestFirst ? events.slice().reverse() : events
  const now = timelineNow(ctx)

  return (
    <div style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ font: '700 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Now</div>
          {now.length === 0 ? <div style={{ font: '500 13px var(--font)', color: 'var(--text2)', marginTop: 2 }}>No course running</div>
            : now.map(function (n, i) { return <div key={i} style={{ font: '600 13px var(--font)', marginTop: 2 }}>{n}</div> })}
        </div>
        <button className="btn" style={{ fontSize: 11 }} onClick={function () { setNewestFirst(!newestFirst) }}>{newestFirst ? '↑ Oldest first' : '↓ Newest first'}</button>
      </div>
      {error && <div className="hint" style={{ color: 'var(--red)' }}>{error}</div>}
      {shown.length === 0 && <div className="hint">Nothing recorded yet.</div>}
      <div style={{ borderLeft: '2px solid var(--border)', marginLeft: 10, paddingLeft: 18 }}>
        {shown.map(function (e, i) {
          const k = KIND[e.kind] || { icon: '•', color: 'var(--text3)' }
          return (
            <div key={i} style={{ position: 'relative', paddingBottom: 14 }}>
              <span style={{ position: 'absolute', left: -31, top: -1, width: 22, height: 22, borderRadius: '50%', background: 'var(--bg)', border: '2px solid ' + k.color, color: k.color, font: '700 11px var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{k.icon}</span>
              <div style={{ font: '500 11px var(--mono)', color: 'var(--text3)' }}>{fmtDate(e.date)}</div>
              <div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>{e.title}</div>
              {e.detail && <div style={{ font: '500 12px var(--font)', color: 'var(--text2)', marginTop: 2 }}>{e.detail}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
