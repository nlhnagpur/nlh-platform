import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { resolveTeacherStatus } from '../utils/teacherAttendance'
import { monthLabel } from '../utils/ciPayrollRun'

// P present · A absent (was due, didn't come) · O weekly off · H general holiday
// · S the class was taken by a substitute. A plain P that was not marked on the
// register but where the CI took the class is shown dimmer.
const TONE = {
  P: { color: '#166534', bg: '#DCFCE7' },
  A: { color: '#991B1B', bg: '#FEE2E2' },
  O: { color: '#92400E', bg: '#FEF3C7' },
  H: { color: '#475569', bg: '#E2E8F0' },
  S: { color: '#5B21B6', bg: '#EDE9FE' },
}

function daysOf(month) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7))
  const n = new Date(y, m, 0).getDate()
  const out = []
  for (let d = 1; d <= n; d++) out.push(month + '-' + String(d).padStart(2, '0'))
  return out
}

// The CI's attendance for the month, by batch: what was marked on the register,
// else what the class records show (took the class / covered by a substitute).
export default function CiAttendanceMonth({ instructor, month }) {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(true)

  useEffect(function () {
    let cancelled = false
    setData(null)
    ;(async function () {
      const days = daysOf(month)
      const from = days[0], to = days[days.length - 1]
      const [att, mine, owned] = await Promise.all([
        sb.from('instructor_attendance').select('att_date, status, batch_id').eq('instructor_id', instructor.id).gte('att_date', from).lte('att_date', to),
        sb.from('batch_sessions').select('id, batch_id, session_date, is_holiday, is_substitute, instructor_id, batches(name)')
          .eq('instructor_id', instructor.id).gte('session_date', from).lte('session_date', to),
        sb.from('batches').select('id, name').eq('instructor_id', instructor.id),
      ])
      const ownIds = (owned.data || []).map(function (b) { return b.id })
      let others = []
      if (ownIds.length) {
        const r = await sb.from('batch_sessions').select('id, batch_id, session_date, is_holiday, is_substitute, instructor_id, batches(name)')
          .in('batch_id', ownIds).gte('session_date', from).lte('session_date', to)
        others = r.data || []
      }
      if (cancelled) return
      const sessById = {}
      ;(mine.data || []).concat(others).forEach(function (s) { sessById[s.id] = s })
      const sessions = Object.keys(sessById).map(function (k) { return sessById[k] })
      const names = {}
      ;(owned.data || []).forEach(function (b) { names[b.id] = b.name })
      sessions.forEach(function (s) { if (s.batches && s.batches.name) names[s.batch_id] = s.batches.name })
      const batchIds = Array.from(new Set(ownIds.concat(sessions.map(function (s) { return s.batch_id }))))
      setData({ days: days, att: att.data || [], sessions: sessions, names: names, batchIds: batchIds })
    })().catch(function () { if (!cancelled) setData({ days: daysOf(month), att: [], sessions: [], names: {}, batchIds: [], failed: true }) })
    return function () { cancelled = true }
  }, [instructor.id, month])

  if (!data) return <div className="hint" style={{ margin: '0 0 12px' }}>Loading attendance…</div>

  const dayMark = {}, batchMark = {}
  data.att.forEach(function (r) {
    const d = String(r.att_date).slice(0, 10)
    if (r.batch_id) batchMark[r.batch_id + '|' + d] = r.status
    else dayMark[d] = r.status
  })
  const sessAt = {}
  data.sessions.forEach(function (s) { sessAt[s.batch_id + '|' + String(s.session_date).slice(0, 10)] = s })

  function cell(batchId, d) {
    const s = sessAt[batchId + '|' + d]
    if (s && s.is_holiday) return { code: 'H', why: 'General holiday' }
    const mark = resolveTeacherStatus(batchMark[batchId + '|' + d], dayMark[d])
    if (mark) {
      const covered = s && s.is_substitute
      return { code: mark, why: { P: 'Present', A: 'Absent — was due but did not come', O: "Teacher's weekly off" }[mark] + (covered && mark !== 'P' ? ' · class covered by a substitute' : '') }
    }
    if (s && s.is_substitute) return { code: 'S', why: 'Class taken by a substitute' }
    if (s && s.instructor_id === instructor.id) return { code: 'P', dim: true, why: 'Took the class (not marked on the register)' }
    return null
  }

  const rows = data.batchIds.map(function (id) {
    const cells = data.days.map(function (d) { return cell(id, d) })
    return { id: id, name: data.names[id] || 'Batch', cells: cells }
  })

  // totals in days (a day counts once even if the CI has two batches)
  const tally = { P: new Set(), A: new Set(), O: new Set(), H: new Set(), S: new Set() }
  rows.forEach(function (r) { r.cells.forEach(function (c, i) { if (c) tally[c.code].add(data.days[i]) }) })
  const classesTaken = data.sessions.filter(function (s) { return s.instructor_id === instructor.id && !s.is_substitute && !s.is_holiday }).length

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      <div onClick={function () { setOpen(!open) }} style={{ padding: '8px 14px', background: 'var(--bg3)', font: '600 11px var(--font)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
        <span>CI attendance — {monthLabel(month)}</span>
        <span style={{ textTransform: 'none', letterSpacing: 0 }}>{open ? '▾' : '▸'}</span>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '8px 14px', font: '500 12px var(--font)', color: 'var(--text2)', borderTop: '1px solid var(--border)' }}>
        <span><b style={{ color: TONE.P.color }}>{tally.P.size}</b> present</span>
        <span><b style={{ color: TONE.A.color }}>{tally.A.size}</b> absent</span>
        <span><b style={{ color: TONE.O.color }}>{tally.O.size}</b> weekly off</span>
        <span><b style={{ color: TONE.H.color }}>{tally.H.size}</b> holidays</span>
        <span><b style={{ color: TONE.S.color }}>{tally.S.size}</b> covered by substitute</span>
        <span style={{ marginLeft: 'auto' }}>{classesTaken} class{classesTaken !== 1 ? 'es' : ''} taken</span>
      </div>
      {open && (rows.length === 0
        ? <div className="hint" style={{ padding: '10px 14px' }}>No classes or attendance recorded this month.</div>
        : (
          <div style={{ overflowX: 'auto', borderTop: '1px solid var(--border)' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 10px', position: 'sticky', left: 0, background: 'var(--bg)', font: '600 11px var(--font)' }}>Batch</th>
                  {data.days.map(function (d) {
                    const dow = new Date(d + 'T00:00:00').getDay()
                    return <th key={d} style={{ padding: '2px 0', minWidth: 22, font: '600 10px var(--mono)', color: dow === 0 ? 'var(--red)' : 'var(--text3)', background: dow === 0 ? 'var(--bg2)' : 'transparent' }}>{Number(d.slice(8, 10))}</th>
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(function (r) {
                  return (
                    <tr key={r.id}>
                      <td style={{ padding: '4px 10px', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--bg)', font: '500 12px var(--font)', borderTop: '1px solid var(--border)' }}>{r.name}</td>
                      {r.cells.map(function (c, i) {
                        const dow = new Date(data.days[i] + 'T00:00:00').getDay()
                        return (
                          <td key={i} title={c ? c.why : ''} style={{ textAlign: 'center', padding: 1, borderTop: '1px solid var(--border)', borderLeft: '1px solid var(--border)', background: dow === 0 ? 'var(--bg2)' : 'transparent' }}>
                            {c && <span style={{ display: 'inline-block', width: 20, height: 20, lineHeight: '20px', borderRadius: 4, font: '700 10px var(--mono)', color: TONE[c.code].color, background: TONE[c.code].bg, opacity: c.dim ? 0.55 : 1 }}>{c.code}</span>}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border)', font: '500 10px var(--font)', color: 'var(--text3)' }}>
        P present · A absent · O weekly off · H holiday · S covered by substitute. Dim P = took the class, not marked on the register.
      </div>
    </div>
  )
}
