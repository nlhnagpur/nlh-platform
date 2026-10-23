import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { fetchAllRows } from '../utils/studentLifecycle'
import { batchHealthIssues } from '../utils/batchHealth'

const SEV = {
  error: { label: 'Fix', color: '#991B1B', bg: '#FEE2E2' },
  warn:  { label: 'Check', color: '#92400E', bg: '#FEF3C7' },
  info:  { label: 'Note', color: '#475569', bg: '#E2E8F0' },
}

function isoDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

// A standing check over the open batches (admins): CI no longer active, no CI, no students, classes before the batch
// start, classes by another CI, no recent class, a CI with no appointment for a course on the roster, and a student on
// two open batches for the same course. The rules live in utils/batchHealth.js.
export default function BatchHealthCheck() {
  const [issues, setIssues] = useState(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(function () {
    let cancelled = false
    ;(async function () {
      const today = isoDaysAgo(0)
      const bRes = await sb.from('batches')
        .select('id, name, is_active, start_date, instructor_assigned_at, instructor_id, instructors(full_name, status)').eq('is_active', true)
      if (bRes.error) throw bRes.error
      const batches = bRes.data || []
      const ids = batches.map(function (b) { return b.id })
      if (!ids.length) { if (!cancelled) setIssues([]); return }
      const ciIds = Array.from(new Set(batches.map(function (b) { return b.instructor_id }).filter(Boolean)))

      const rRes = await sb.from('batch_students')
        .select('batch_id, enrollments(student_id, completed_at, status, students(full_name), skus(course_id, courses(group_name)))')
        .in('batch_id', ids).is('removed_at', null)
      if (rRes.error) throw rRes.error
      const openRoster = (rRes.data || []).filter(function (x) {
        const e = x.enrollments
        return e && !e.completed_at && e.status !== 'dropped'      // a finished or dropped enrolment is not a current student
      }).map(function (x) {
        const e = x.enrollments
        return { batch_id: x.batch_id, student_id: e.student_id, student: e.students && e.students.full_name,
          course: e.skus && e.skus.courses && e.skus.courses.group_name }
      })

      const recentSessions = await fetchAllRows(function (from, to) {
        return sb.from('batch_sessions').select('batch_id, session_date, instructor_id, is_substitute')
          .in('batch_id', ids).gte('session_date', isoDaysAgo(45)).order('id').range(from, to)
      })
      let appointments = []
      if (ciIds.length) {
        const aRes = await sb.from('instructor_courses').select('instructor_id, remuneration_mode, appointed_at, skus(courses(group_name))').in('instructor_id', ciIds).eq('status', 'active')
        if (aRes.error) throw aRes.error
        appointments = aRes.data || []
      }
      if (!cancelled) setIssues(batchHealthIssues({ batches: batches, openRoster: openRoster, recentSessions: recentSessions, appointments: appointments, today: today }))
    })().catch(function (e) { if (!cancelled) { setError(e.message || 'Could not run the check'); setIssues([]) } })
    return function () { cancelled = true }
  }, [reload])

  if (issues === null) return null
  const count = function (s) { return issues.filter(function (i) { return i.severity === s }).length }
  const bad = count('error'), warn = count('warn')

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16, overflow: 'hidden', background: 'var(--card, #fff)' }}>
      <div onClick={function () { setOpen(!open) }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: bad ? '#FEF2F2' : warn ? '#FFFBEB' : 'var(--bg2)' }}>
        <span style={{ font: '700 13px var(--font)' }}>Batch health check</span>
        {issues.length === 0 && !error
          ? <span style={{ font: '600 12px var(--font)', color: 'var(--green)' }}>✓ All open batches look consistent</span>
          : <span style={{ font: '600 12px var(--font)', color: bad ? '#991B1B' : '#92400E' }}>
              {bad > 0 ? bad + ' to fix' : ''}{bad > 0 && warn > 0 ? ' · ' : ''}{warn > 0 ? warn + ' to check' : ''}{!bad && !warn ? count('info') + ' note' + (count('info') !== 1 ? 's' : '') : ''}
            </span>}
        <span style={{ marginLeft: 'auto', font: '500 11px var(--font)', color: 'var(--text3)' }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div>
          {error && <div className="hint" style={{ padding: '8px 14px', color: 'var(--red)' }}>{error}</div>}
          {issues.map(function (i, n) {
            return (
              <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 14px', borderTop: '1px solid var(--border)' }}>
                <span style={{ font: '700 10px var(--mono)', color: SEV[i.severity].color, background: SEV[i.severity].bg, borderRadius: 10, padding: '2px 8px', whiteSpace: 'nowrap', marginTop: 2 }}>{SEV[i.severity].label}</span>
                <div style={{ font: '500 12px var(--font)', color: 'var(--text2)' }}>
                  <b style={{ color: 'var(--text)' }}>{i.batch}</b>{i.ci ? ' · ' + i.ci : ''} — {i.message}
                  {i.action && <div style={{ marginTop: 2, color: 'var(--text3)' }}><b style={{ color: 'var(--text2)' }}>What to do:</b> {i.action}</div>}
                </div>
              </div>
            )
          })}
          <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', font: '500 10px var(--font)', color: 'var(--text3)' }}>
            <span>Looks at open batches, their students, and classes in the last 45 days.</span>
            <span style={{ cursor: 'pointer', color: 'var(--purple)' }} onClick={function () { setReload(function (n) { return n + 1 }) }}>↻ Re-run</span>
          </div>
        </div>
      )}
    </div>
  )
}
