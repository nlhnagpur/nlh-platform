import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { fmtDate, showToast } from '../utils'
import { fetchAllRows } from '../utils/studentLifecycle'
import ModalHeader from './ModalHeader'

// Monthly attendance sheet, in two flavours:
//   mode="student"    one student: every course/class they were due to attend in
//                     the month, day by day, and which classes they attended.
//   mode="instructor" one CI: every class they actually took in the month
//                     (session.instructor_id, so substitute cover is counted
//                     for whoever covered), with the students in each batch.
// Cell codes: P present · A absent · N not marked (attendance never recorded)
// · H holiday · blank no class. S = sessions held, so S = P + A + N.

const DOW2 = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const TONE = {
  P: { color: '#166534', bg: '#dcfce7' },
  A: { color: '#991b1b', bg: '#fee2e2' },
  N: { color: '#92400e', bg: '#fef3c7' },
  H: { color: '#6b7280', bg: '#f3f4f6' },
}

function pad(n) { return String(n).padStart(2, '0') }
function thisMonth() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) }
function shiftMonth(ym, by) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1)
}
function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  return { start: ym + '-01', end: ym + '-' + pad(days), days: days, y: y, m: m }
}
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}
function dowOf(iso) { return new Date(iso + 'T00:00:00').getDay() }
function dayNum(iso) { return Number(iso.slice(8, 10)) }
function courseLabel(sku) { return (sku && sku.courses && sku.courses.group_name ? sku.courses.group_name : 'Course') + (sku && sku.level_name ? ' — ' + sku.level_name : '') }

// Was this enrolment in the batch on that date? (assigned_at / removed_at bound it.)
function memberOn(bs, dateIso) {
  const from = bs.assigned_at ? String(bs.assigned_at).slice(0, 10) : '0000-00-00'
  const to = bs.removed_at ? String(bs.removed_at).slice(0, 10) : '9999-12-31'
  return dateIso >= from && dateIso <= to
}

function tally(cells) {
  const t = { S: 0, P: 0, A: 0, N: 0 }
  cells.forEach(function (c) {
    if (!c || c.code === 'H') return
    t.S++
    t[c.code]++
  })
  return t
}

// Attendance rows for a set of sessions, chunked (URL length) and paged (1000-row cap).
async function fetchAttendance(sessionIds, enrolmentIds) {
  const map = new Map()   // `${session_id}:${enrollment_id}` -> attended
  for (let i = 0; i < sessionIds.length; i += 80) {
    const chunk = sessionIds.slice(i, i + 80)
    const rows = await fetchAllRows(function (from, to) {
      let q = sb.from('session_attendance').select('id, session_id, enrollment_id, attended').in('session_id', chunk)
      if (enrolmentIds) q = q.in('enrollment_id', enrolmentIds)
      return q.order('id').range(from, to)
    })
    rows.forEach(function (r) { map.set(r.session_id + ':' + r.enrollment_id, !!r.attended) })
  }
  return map
}

async function loadStudentSheet(student, ym) {
  const b = monthBounds(ym)
  const enrs = student.enrollments || []
  const enrIds = enrs.map(function (e) { return e.id })
  if (!enrIds.length) return { rows: [], attended: [] }
  const { data: bsRows, error } = await sb.from('batch_students')
    .select('enrollment_id, batch_id, assigned_at, removed_at, batches(name)').in('enrollment_id', enrIds)
  if (error) throw error
  const batchIds = Array.from(new Set((bsRows || []).map(function (r) { return r.batch_id }).filter(Boolean)))
  const sessions = batchIds.length ? await fetchAllRows(function (from, to) {
    return sb.from('batch_sessions').select('id, batch_id, session_date, is_holiday, is_substitute, instructors(full_name)')
      .in('batch_id', batchIds).gte('session_date', b.start).lte('session_date', b.end).order('id').range(from, to)
  }) : []
  const att = await fetchAttendance(sessions.map(function (s) { return s.id }), enrIds)

  const attended = []
  const rows = enrs.map(function (en) {
    const cells = {}
    ;(bsRows || []).filter(function (m) { return m.enrollment_id === en.id }).forEach(function (m) {
      sessions.filter(function (s) { return s.batch_id === m.batch_id && memberOn(m, s.session_date) }).forEach(function (s) {
        let code
        if (s.is_holiday) code = 'H'
        else { const a = att.get(s.id + ':' + en.id); code = a === true ? 'P' : a === false ? 'A' : 'N' }
        const day = dayNum(s.session_date)
        if (!cells[day] || cells[day].code === 'H') {
          cells[day] = { code: code, date: s.session_date, batch: m.batches && m.batches.name, ci: s.instructors && s.instructors.full_name, sub: s.is_substitute }
        }
      })
    })
    const list = Object.values(cells)
    list.filter(function (c) { return c.code === 'P' }).forEach(function (c) {
      attended.push({ date: c.date, course: courseLabel(en.skus), batch: c.batch, ci: c.ci, sub: c.sub })
    })
    return { id: en.id, label: courseLabel(en.skus), cells: cells, totals: tally(list) }
  }).filter(function (r) { return Object.keys(r.cells).length > 0 })
  attended.sort(function (a, c) { return a.date < c.date ? -1 : 1 })
  return { rows: rows, attended: attended }
}

async function loadInstructorSheet(instructor, ym) {
  const b = monthBounds(ym)
  const sessions = await fetchAllRows(function (from, to) {
    return sb.from('batch_sessions')
      .select('id, batch_id, session_date, is_holiday, is_substitute, batches(name, skus(level_name, courses(group_name)))')
      .eq('instructor_id', instructor.id).eq('is_holiday', false)
      .gte('session_date', b.start).lte('session_date', b.end).order('session_date').order('id').range(from, to)
  })
  if (!sessions.length) return { batches: [], sessionsTaught: 0, substitutes: 0, studentsTaught: 0 }
  const batchIds = Array.from(new Set(sessions.map(function (s) { return s.batch_id })))
  const { data: bsRows, error } = await sb.from('batch_students')
    .select('enrollment_id, batch_id, assigned_at, removed_at, enrollments(id, student_id, students(full_name), skus(level_name, courses(group_name)))')
    .in('batch_id', batchIds)
  if (error) throw error
  const att = await fetchAttendance(sessions.map(function (s) { return s.id }), null)

  const taught = new Set()
  const batches = batchIds.map(function (bid) {
    const bsess = sessions.filter(function (s) { return s.batch_id === bid })
    const members = {}   // enrollment_id -> { en, memberships[] }
    ;(bsRows || []).filter(function (r) { return r.batch_id === bid }).forEach(function (r) {
      if (!r.enrollments) return
      ;(members[r.enrollment_id] = members[r.enrollment_id] || { en: r.enrollments, ms: [] }).ms.push(r)
    })
    const students = Object.values(members).map(function (m) {
      const cells = {}
      bsess.forEach(function (s) {
        if (!m.ms.some(function (x) { return memberOn(x, s.session_date) })) return
        const a = att.get(s.id + ':' + m.en.id)
        cells[s.id] = { code: a === true ? 'P' : a === false ? 'A' : 'N', date: s.session_date }
      })
      const totals = tally(Object.values(cells))
      if (totals.P > 0) taught.add(m.en.student_id)
      return { id: m.en.id, name: (m.en.students && m.en.students.full_name) || 'Student', course: courseLabel(m.en.skus), cells: cells, totals: totals }
    }).filter(function (s) { return Object.keys(s.cells).length > 0 })
      .sort(function (a, c) { return a.name.localeCompare(c.name) })
    const first = bsess[0]
    return {
      id: bid, name: (first.batches && first.batches.name) || 'Batch',
      course: first.batches ? courseLabel(first.batches.skus) : '',
      sessions: bsess, students: students,
    }
  })
  return {
    batches: batches, sessionsTaught: sessions.length,
    substitutes: sessions.filter(function (s) { return s.is_substitute }).length,
    studentsTaught: taught.size,
  }
}

function Cell({ c }) {
  if (!c) return <td style={{ width: 24, minWidth: 24, border: '1px solid #e5e7eb' }}></td>
  const t = TONE[c.code]
  const tip = c.code === 'H' ? 'Holiday' : { P: 'Present', A: 'Absent', N: 'Not marked' }[c.code]
  return (
    <td title={tip + (c.date ? ' · ' + fmtDate(c.date) : '') + (c.ci ? ' · ' + c.ci + (c.sub ? ' (substitute)' : '') : '')}
      style={{ width: 24, minWidth: 24, textAlign: 'center', font: '700 11px var(--mono)', color: t.color, background: t.bg, border: '1px solid #e5e7eb' }}>
      {c.code}
    </td>
  )
}

function TotalsCells({ t }) {
  const base = { textAlign: 'center', font: '700 11px var(--mono)', border: '1px solid #e5e7eb', minWidth: 30, padding: '4px 4px' }
  return (
    <>
      <td style={Object.assign({}, base, { background: '#f9fafb' })}>{t.S}</td>
      <td style={Object.assign({}, base, { color: TONE.P.color })}>{t.P}</td>
      <td style={Object.assign({}, base, { color: TONE.A.color })}>{t.A}</td>
      <td style={Object.assign({}, base, { color: t.N > 0 ? TONE.N.color : '#9ca3af', background: t.N > 0 ? TONE.N.bg : undefined })}>{t.N}</td>
    </>
  )
}

function TotalsHead() {
  const th = { textAlign: 'center', font: '700 10px var(--mono)', border: '1px solid #e5e7eb', padding: '4px 4px', background: '#f3f4f6' }
  return (
    <>
      <th style={th} title="Sessions held">S</th>
      <th style={Object.assign({}, th, { color: TONE.P.color })} title="Present">P</th>
      <th style={Object.assign({}, th, { color: TONE.A.color })} title="Absent">A</th>
      <th style={Object.assign({}, th, { color: TONE.N.color })} title="Not marked">N</th>
    </>
  )
}

function csvEscape(v) {
  if (v == null || v === '') return ''
  const s = String(v)
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export default function AttendanceSheet({ mode, student, instructor, onClose }) {
  const [ym, setYm] = useState(thisMonth())
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const b = monthBounds(ym)
  const isStudent = mode === 'student'
  const subjectName = isStudent ? student.full_name : instructor.full_name

  useEffect(function () {
    let cancelled = false
    setLoading(true)
    const run = isStudent ? loadStudentSheet(student, ym) : loadInstructorSheet(instructor, ym)
    run.then(function (res) { if (!cancelled) { setData(res); setLoading(false) } })
      .catch(function (err) { if (!cancelled) { setLoading(false); showToast('Could not load attendance: ' + err.message, 'err') } })
    return function () { cancelled = true }
  }, [ym])   // eslint-disable-line react-hooks/exhaustive-deps

  const dayCols = []
  for (let d = 1; d <= b.days; d++) dayCols.push(d)

  function exportCSV() {
    if (!data) return
    const out = []
    out.push(['New Learning Horizons — Monthly Attendance Sheet'])
    out.push([(isStudent ? 'Student: ' : 'CI: ') + subjectName, 'Month: ' + monthLabel(ym)])
    out.push(['P present · A absent · N not marked · H holiday · S sessions held'])
    out.push([])
    if (isStudent) {
      out.push(['Course'].concat(dayCols.map(String), ['S', 'P', 'A', 'N']))
      data.rows.forEach(function (r) {
        out.push([r.label].concat(dayCols.map(function (d) { return r.cells[d] ? r.cells[d].code : '' }), [r.totals.S, r.totals.P, r.totals.A, r.totals.N]))
      })
      out.push([])
      out.push(['Classes attended'])
      out.push(['Date', 'Course', 'Batch', 'Taken by'])
      data.attended.forEach(function (a) { out.push([a.date, a.course, a.batch || '', (a.ci || '') + (a.sub ? ' (substitute)' : '')]) })
    } else {
      out.push(['Classes taught: ' + data.sessionsTaught, 'As substitute: ' + data.substitutes, 'Students taught: ' + data.studentsTaught])
      data.batches.forEach(function (bt) {
        out.push([])
        out.push([bt.name + ' — ' + bt.course])
        out.push(['Student', 'Course'].concat(bt.sessions.map(function (s) { return s.session_date }), ['S', 'P', 'A', 'N']))
        bt.students.forEach(function (st) {
          out.push([st.name, st.course].concat(bt.sessions.map(function (s) { return st.cells[s.id] ? st.cells[s.id].code : '' }), [st.totals.S, st.totals.P, st.totals.A, st.totals.N]))
        })
      })
    }
    const csv = out.map(function (r) { return r.map(csvEscape).join(',') }).join('\n')
    const blob = new Blob([String.fromCharCode(0xFEFF) + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'attendance-' + (isStudent ? 'student' : 'ci') + '-' + subjectName.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' + ym + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function printSheet() {
    const node = document.getElementById('att-sheet')
    if (!node) return
    const win = window.open('', '_blank', 'width=1100,height=800')
    win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Attendance — ' + subjectName + ' — ' + monthLabel(ym) + '</title>'
      + '<style>*{box-sizing:border-box}body{font-family:"DM Sans",system-ui,sans-serif;padding:18px;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
      + 'table{border-collapse:collapse;margin-bottom:14px}th,td{border:1px solid #d1d5db;padding:3px 5px;font-size:11px}'
      + 'h2{font-size:15px;margin:0 0 2px}.np{margin-bottom:12px}@page{size:A4 landscape;margin:10mm}@media print{.np{display:none}}</style></head><body>'
      + '<div class="np"><button onclick="window.print()" style="background:#534AB7;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font:600 13px sans-serif">Print / Save PDF</button></div>'
      + '<h2>New Learning Horizons — Monthly Attendance Sheet</h2>'
      + '<div style="margin-bottom:10px;font-size:12px">' + (isStudent ? 'Student: ' : 'CI: ') + '<b>' + subjectName + '</b> · ' + monthLabel(ym) + '</div>'
      + node.innerHTML + '</body></html>')
    win.document.close()
  }

  const thDay = function (d) {
    const w = dowOf(b.y + '-' + pad(b.m) + '-' + pad(d))
    return (
      <th key={d} style={{ width: 24, minWidth: 24, textAlign: 'center', font: '600 9px var(--mono)', border: '1px solid #e5e7eb', padding: '2px 0', background: w === 0 || w === 6 ? '#eef2ff' : '#f3f4f6' }}>
        <div>{d}</div><div style={{ color: '#6b7280' }}>{DOW2[w]}</div>
      </th>
    )
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 1180, width: '96vw', display: 'flex', flexDirection: 'column', maxHeight: '92vh' }}>
        <ModalHeader flush title={'Attendance sheet — ' + subjectName} subtitle={isStudent ? 'Which classes this student was due to attend, and attended' : 'Which classes this CI took, and which students were taught'} onClose={onClose} />
        <div style={{ padding: '4px 20px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-s" onClick={function () { setYm(shiftMonth(ym, -1)) }}>‹</button>
          <input type="month" value={ym} onChange={function (e) { if (e.target.value) setYm(e.target.value) }} style={{ fontSize: 13 }} />
          <button className="btn-s" onClick={function () { setYm(shiftMonth(ym, 1)) }}>›</button>
          <span style={{ font: '600 13px var(--font)', color: 'var(--text2)', marginLeft: 4 }}>{monthLabel(ym)}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn-s" onClick={exportCSV} disabled={!data || loading}>⬇ CSV</button>
            <button className="btn-s" onClick={printSheet} disabled={!data || loading}>🖨 Print / PDF</button>
          </span>
        </div>
        <div style={{ padding: '0 20px 6px', font: '500 11px var(--font)', color: 'var(--text3)' }}>
          <b style={{ color: TONE.P.color }}>P</b> present · <b style={{ color: TONE.A.color }}>A</b> absent · <b style={{ color: TONE.N.color }}>N</b> not marked (attendance never recorded) · <b>H</b> holiday · blank no class · <b>S</b> sessions held (S = P + A + N)
        </div>
        <div style={{ padding: '8px 20px 18px', overflow: 'auto', flex: 1 }}>
          {loading && <div className="loading"><span className="spinner" />Loading attendance…</div>}
          {!loading && data && (
            <div id="att-sheet">
              {isStudent && (
                data.rows.length === 0
                  ? <div className="empty">No classes scheduled for this student in {monthLabel(ym)}.</div>
                  : (
                    <>
                      <table style={{ borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', font: '700 10px var(--mono)', border: '1px solid #e5e7eb', padding: '4px 8px', background: '#f3f4f6', minWidth: 190 }}>COURSE</th>
                            {dayCols.map(thDay)}
                            <TotalsHead />
                          </tr>
                        </thead>
                        <tbody>
                          {data.rows.map(function (r) {
                            return (
                              <tr key={r.id}>
                                <td style={{ font: '600 12px var(--font)', border: '1px solid #e5e7eb', padding: '4px 8px', whiteSpace: 'nowrap' }}>{r.label}</td>
                                {dayCols.map(function (d) { return <Cell key={d} c={r.cells[d]} /> })}
                                <TotalsCells t={r.totals} />
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      <div style={{ font: '700 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', margin: '14px 0 6px' }}>
                        Classes attended in {monthLabel(ym)} ({data.attended.length})
                      </div>
                      {data.attended.length === 0
                        ? <div className="hint">No classes marked present this month.</div>
                        : (
                          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead><tr>{['Date', 'Course', 'Batch', 'Taken by'].map(function (h) {
                              return <th key={h} style={{ textAlign: 'left', font: '700 10px var(--mono)', border: '1px solid #e5e7eb', padding: '4px 10px', background: '#f3f4f6' }}>{h.toUpperCase()}</th>
                            })}</tr></thead>
                            <tbody>
                              {data.attended.map(function (a, i) {
                                return (
                                  <tr key={i}>
                                    <td style={{ border: '1px solid #e5e7eb', padding: '3px 10px', whiteSpace: 'nowrap' }}>{fmtDate(a.date)} · {DOW2[dowOf(a.date)]}</td>
                                    <td style={{ border: '1px solid #e5e7eb', padding: '3px 10px' }}>{a.course}</td>
                                    <td style={{ border: '1px solid #e5e7eb', padding: '3px 10px' }}>{a.batch || '—'}</td>
                                    <td style={{ border: '1px solid #e5e7eb', padding: '3px 10px' }}>{a.ci || '—'}{a.sub ? ' (substitute)' : ''}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                    </>
                  )
              )}

              {!isStudent && (
                data.batches.length === 0
                  ? <div className="empty">{subjectName} took no classes in {monthLabel(ym)}.</div>
                  : (
                    <>
                      <div style={{ font: '600 13px var(--font)', marginBottom: 12 }}>
                        {data.sessionsTaught} class{data.sessionsTaught === 1 ? '' : 'es'} taught
                        {data.substitutes > 0 ? ' (' + data.substitutes + ' as substitute)' : ''}
                        {' · '}{data.studentsTaught} student{data.studentsTaught === 1 ? '' : 's'} taught
                      </div>
                      {data.batches.map(function (bt) {
                        return (
                          <div key={bt.id} style={{ marginBottom: 18 }}>
                            <div style={{ font: '700 12px var(--font)', marginBottom: 6 }}>
                              {bt.name} <span style={{ color: 'var(--text3)', fontWeight: 500 }}>· {bt.course} · {bt.sessions.length} class{bt.sessions.length === 1 ? '' : 'es'} taught</span>
                            </div>
                            <table style={{ borderCollapse: 'collapse' }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: 'left', font: '700 10px var(--mono)', border: '1px solid #e5e7eb', padding: '4px 8px', background: '#f3f4f6', minWidth: 170 }}>STUDENT</th>
                                  {bt.sessions.map(function (s) {
                                    return (
                                      <th key={s.id} title={fmtDate(s.session_date) + (s.is_substitute ? ' · substitute' : '')}
                                        style={{ width: 24, minWidth: 24, textAlign: 'center', font: '600 9px var(--mono)', border: '1px solid #e5e7eb', padding: '2px 0', background: s.is_substitute ? '#fef9c3' : '#f3f4f6' }}>
                                        <div>{dayNum(s.session_date)}</div><div style={{ color: '#6b7280' }}>{DOW2[dowOf(s.session_date)]}</div>
                                      </th>
                                    )
                                  })}
                                  <TotalsHead />
                                </tr>
                              </thead>
                              <tbody>
                                {bt.students.map(function (st) {
                                  return (
                                    <tr key={st.id}>
                                      <td style={{ font: '600 12px var(--font)', border: '1px solid #e5e7eb', padding: '4px 8px', whiteSpace: 'nowrap' }}>{st.name}</td>
                                      {bt.sessions.map(function (s) { return <Cell key={s.id} c={st.cells[s.id]} /> })}
                                      <TotalsCells t={st.totals} />
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )
                      })}
                    </>
                  )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
