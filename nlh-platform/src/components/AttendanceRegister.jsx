import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { fmtDate, showToast } from '../utils'
import { todayIso } from '../utils/studentLifecycle'

// Monthly attendance register (Students → Attendance).
//
// The same layout as the student's monthly sheet, but editable: one block per
// batch, a row for each student in it, a column for each date. Click a cell to
// step it  blank → P → A → N → H → blank.
//   blank  not marked
//   P / A  present / absent
//   N      no class for this student that day (a personal off day — it is not
//          a class for them, so it is left out of their sessions and absences)
//   H      holiday for the whole batch (a property of the class, not of one
//          student)
//
// The teacher has a row too: P present, O off. A teacher's off day is theirs
// across every batch they take. When a student is marked present on a day the
// teacher is off, a list of teachers opens to pick the substitute who took the
// class (stored on the day's session: instructor_id + is_substitute).
// Saving writes the same batch_sessions / session_attendance rows the Batches
// page does, so both stay in step.

const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
const DAY2 = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const LOOKBACK = 14

function pad(n) { return String(n).padStart(2, '0') }
function dowSet(text) {
  const set = new Set()
  String(text || '').toLowerCase().split(/[^a-z]+/).forEach(function (t) {
    const k = t.slice(0, 3)
    if (k in DOW) set.add(DOW[k])
  })
  return set
}
function dowOf(iso) { return new Date(iso + 'T00:00:00').getDay() }
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
function thisMonth() { return todayIso().slice(0, 7) }
function shiftMonth(ym, by) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1)
}
function monthDays(ym) {
  const [y, m] = ym.split('-').map(Number)
  const n = new Date(y, m, 0).getDate()
  const out = []
  for (let i = 1; i <= n; i++) out.push(ym + '-' + pad(i))
  return out
}
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}
// A student can be taken out of a batch and put back (several batch_students
// rows for one enrolment): one row on the register, in the batch on any of
// its periods.
function collapseMembers(rows) {
  const byEnr = {}
  const out = []
  ;(rows || []).forEach(function (r) {
    const k = r.enrollment_id
    if (!byEnr[k]) { byEnr[k] = Object.assign({}, r, { periods: [] }); out.push(byEnr[k]) }
    byEnr[k].periods.push({ assigned_at: r.assigned_at, removed_at: r.removed_at })
  })
  return out
}
function memberOn(bs, date) {
  const periods = bs.periods || [{ assigned_at: bs.assigned_at, removed_at: bs.removed_at }]
  const inPeriod = periods.some(function (p) {
    const from = p.assigned_at ? String(p.assigned_at).slice(0, 10) : '0000-00-00'
    const to = p.removed_at ? String(p.removed_at).slice(0, 10) : '9999-12-31'
    return date >= from && date <= to
  })
  if (!inPeriod) return false
  const en = bs.enrollments
  if (en && en.completed_at && String(en.completed_at).slice(0, 10) < date) return false
  return true
}
function courseOf(b) {
  return (b.skus && b.skus.courses && b.skus.courses.group_name ? b.skus.courses.group_name : '') + (b.skus && b.skus.level_name ? ' — ' + b.skus.level_name : '')
}
// Nobody in the batch has a class that day (every student on its roster is
// marked N) — the class wasn't held, so there's nothing left to record.
function everyoneNoClass(b, date, entry) {
  const roster = (b.batch_students || []).filter(function (bs) { return memberOn(bs, date) })
  if (roster.length === 0) return false
  const nc = (entry && entry.nc) || {}
  return roster.every(function (bs) { return nc[bs.enrollment_id] })
}
function nameOf(bs) { return String(bs.enrollments && bs.enrollments.students ? bs.enrollments.students.full_name : '') }

const TONE = {
  P: { color: '#166534', bg: '#dcfce7' },
  A: { color: '#991b1b', bg: '#fee2e2' },
  H: { color: '#6b7280', bg: '#e5e7eb' },
  N: { color: '#1e40af', bg: '#dbeafe' },
  O: { color: '#9a3412', bg: '#ffedd5' },
}

export default function AttendanceRegister({ centreFilter, search, canEdit, students, onOpenSheet }) {
  const [ym, setYm] = useState(thisMonth())
  const [loading, setLoading] = useState(true)
  const [batches, setBatches] = useState([])
  const [saved, setSaved] = useState({})     // 'batch|date' -> { id, hol, marks: { enr: bool }, nc: { enr: true } }
  const [edits, setEdits] = useState({})     // 'batch|date' -> { hol, marks: { enr: bool|null }, nc: { enr: true } }
  const [pending, setPending] = useState([]) // scheduled, recent, never recorded
  const [savingId, setSavingId] = useState(null)
  const [reload, setReload] = useState(0)
  const [findQ, setFindQ] = useState('')
  const [tSaved, setTSaved] = useState({})   // 'instructor|date' -> 'P' | 'O'
  const [tEdits, setTEdits] = useState({})   // 'instructor|date' -> 'P' | 'O' | null (cleared)
  const [instructors, setInstructors] = useState([])   // active teachers, for the substitute list
  const [picker, setPicker] = useState(null) // { b, date, action } — choosing a substitute
  const [focus, setFocus] = useState(null)   // { batchId, date } — jumped to from the pending list

  const days = monthDays(ym)
  const today = todayIso()

  useEffect(function () {
    let cancelled = false
    setLoading(true)
    ;(async function () {
      let q = sb.from('batches')
        .select('id, name, franchisee_id, instructor_id, schedule_days, schedule_time, start_date, is_active, instructors(full_name), skus(level_name, courses(group_name)), batch_students(id, enrollment_id, assigned_at, removed_at, enrollments(id, student_id, completed_at, status, students(id, full_name)))')
        .eq('is_active', true)
      if (centreFilter) q = q.eq('franchisee_id', centreFilter)
      const bRes = await q
      if (bRes.error) throw bRes.error
      const list = (bRes.data || []).map(function (b) { return Object.assign({}, b, { batch_students: collapseMembers(b.batch_students) }) }).slice().sort(function (a, b) {
        return String(a.schedule_time || '').localeCompare(String(b.schedule_time || '')) || String(a.name || '').localeCompare(String(b.name || ''))
      })
      const ids = list.map(function (b) { return b.id })
      const lookFrom = addDays(today, -LOOKBACK)
      const from = days[0] < lookFrom ? days[0] : lookFrom
      const to = days[days.length - 1] > today ? days[days.length - 1] : today
      let sess = []
      if (ids.length) {
        const sRes = await sb.from('batch_sessions')
          .select('id, batch_id, session_date, is_holiday, instructor_id, is_substitute, session_attendance(enrollment_id, attended)')
          .in('batch_id', ids).gte('session_date', from).lte('session_date', to)
        if (sRes.error) throw sRes.error
        sess = sRes.data || []
      }
      // days a student has no class, for everyone in these batches this month
      const enrIds = Array.from(new Set(list.flatMap(function (b) { return (b.batch_students || []).map(function (bs) { return bs.enrollment_id }) })))
      let ncRows = []
      if (enrIds.length) {
        const nRes = await sb.from('student_no_class').select('enrollment_id, class_date, batch_id')
          .in('enrollment_id', enrIds).gte('class_date', days[0]).lte('class_date', days[days.length - 1])
        if (nRes.error) throw nRes.error
        ncRows = nRes.data || []
      }
      // teachers: who is active (for the substitute list) and who is off / present
      const tRes = await sb.from('instructor_attendance').select('instructor_id, att_date, status')
        .gte('att_date', days[0]).lte('att_date', days[days.length - 1])
      if (tRes.error) throw tRes.error
      const iRes = await sb.from('instructors').select('id, full_name, status').eq('status', 'active').order('full_name')
      if (cancelled) return

      const tMap = {}
      ;(tRes.data || []).forEach(function (r) { tMap[r.instructor_id + '|' + String(r.att_date).slice(0, 10)] = r.status })

      const sMap = {}
      sess.forEach(function (s) {
        const marks = {}
        ;(s.session_attendance || []).forEach(function (a) { marks[a.enrollment_id] = !!a.attended })
        sMap[s.batch_id + '|' + s.session_date] = {
          id: s.id, hol: !!s.is_holiday, marks: marks, nc: {},
          sub: s.is_substitute && s.instructor_id ? s.instructor_id : null,
        }
      })
      // a no-class day belongs to the enrolment; attach it to each batch the
      // student is in, whether or not a class was recorded that day
      ncRows.forEach(function (r) {
        const d = String(r.class_date).slice(0, 10)
        list.forEach(function (b) {
          if (!(b.batch_students || []).some(function (bs) { return bs.enrollment_id === r.enrollment_id })) return
          const k = b.id + '|' + d
          if (!sMap[k]) sMap[k] = { id: null, hol: false, marks: {}, nc: {}, sub: null }
          sMap[k].nc[r.enrollment_id] = true
        })
      })

      const miss = []
      list.forEach(function (b) {
        const dows = dowSet(b.schedule_days)
        if (dows.size === 0) return   // no class days set up — can't tell what was missed
        for (let i = 1; i <= LOOKBACK; i++) {
          const d = addDays(today, -i)
          if (b.start_date && d < String(b.start_date).slice(0, 10)) continue
          if (!dows.has(dowOf(d))) continue
          if (sMap[b.id + '|' + d] && sMap[b.id + '|' + d].id) continue
          if (!(b.batch_students || []).some(function (bs) { return memberOn(bs, d) })) continue
          if (everyoneNoClass(b, d, sMap[b.id + '|' + d])) continue   // class not held for anyone
          miss.push({ date: d, batch: b })
        }
      })
      miss.sort(function (a, b) { return a.date < b.date ? 1 : -1 })

      setBatches(list); setSaved(sMap); setEdits({}); setPending(miss)
      setTSaved(tMap); setTEdits({}); setInstructors(iRes.data || [])
      setLoading(false)
    })().catch(function (e) {
      if (!cancelled) { setLoading(false); showToast('Could not load attendance: ' + e.message, 'err') }
    })
    return function () { cancelled = true }
  }, [ym, centreFilter, reload])

  // Jump to a pending class: once the month has loaded, bring that batch and
  // date into view and highlight the column for a few seconds.
  useEffect(function () {
    if (!focus || loading) return
    if (focus.date.slice(0, 7) !== ym) return
    const t1 = setTimeout(function () {
      const th = document.getElementById('att-th-' + focus.batchId + '-' + focus.date)
      const block = document.getElementById('att-batch-' + focus.batchId)
      if (block) block.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (th) th.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }, 60)
    const t2 = setTimeout(function () { setFocus(null) }, 5000)
    return function () { clearTimeout(t1); clearTimeout(t2) }
  }, [focus, loading, ym])

  // What a cell currently shows: the edit if there is one, else what's saved.
  function dayState(bId, date) {
    const k = bId + '|' + date
    if (edits[k]) return edits[k]
    const s = saved[k]
    return s ? { hol: s.hol, marks: s.marks, nc: s.nc || {}, sub: s.sub || null } : { hol: false, marks: {}, nc: {}, sub: null }
  }
  // Teacher status for a day: P, O or null (blank).
  function tStatus(instrId, date) {
    if (!instrId) return null
    const k = instrId + '|' + date
    if (k in tEdits) return tEdits[k]
    return tSaved[k] || null
  }
  function anyPresent(b, date) {
    const st = dayState(b.id, date)
    return !st.hol && Object.keys(st.marks).some(function (e) { return st.marks[e] === true && !st.nc[e] })
  }
  function nameOfInstructor(id) {
    const i = instructors.find(function (x) { return x.id === id })
    return i ? i.full_name : ''
  }
  function cellOf(b, bs, date) {
    const st = dayState(b.id, date)
    if (st.hol) return 'H'
    if (st.nc[bs.enrollment_id]) return 'N'
    const v = st.marks[bs.enrollment_id]
    return v === true ? 'P' : v === false ? 'A' : null
  }
  function rosterOf(b) {
    const q = (search || '').trim().toLowerCase()
    return (b.batch_students || []).filter(function (bs) {
      return days.some(function (d) { return memberOn(bs, d) })
    }).sort(function (x, y) { return nameOf(x).localeCompare(nameOf(y)) })
      .filter(function (bs) { return !q || nameOf(bs).toLowerCase().includes(q) || (b.name || '').toLowerCase().includes(q) })
  }

  function editDay(b, date, fn) {
    setEdits(function (prev) {
      const k = b.id + '|' + date
      const base = prev[k] || (function () {
        const s = saved[k]
        return s ? { hol: s.hol, marks: Object.assign({}, s.marks), nc: Object.assign({}, s.nc || {}), sub: s.sub || null } : { hol: false, marks: {}, nc: {}, sub: null }
      })()
      const next = { hol: base.hol, marks: Object.assign({}, base.marks), nc: Object.assign({}, base.nc || {}), sub: base.sub || null }
      fn(next)
      return { ...prev, [k]: next }
    })
  }
  // Run `apply`, but first — if the class's teacher is off that day and no
  // substitute is set yet — ask who took it. Cancelling the list applies nothing.
  function withSubstitute(b, date, apply) {
    if (b.instructor_id && tStatus(b.instructor_id, date) === 'O' && !dayState(b.id, date).sub) {
      setPicker({ b: b, date: date, action: apply })
      return
    }
    apply()
  }
  function stepCell(b, bs, date) {
    if (!canEdit || date > today || !memberOn(bs, date)) return
    const st0 = dayState(b.id, date)
    const e0 = bs.enrollment_id
    const was = st0.hol ? 'H' : st0.nc[e0] ? 'N' : st0.marks[e0] === true ? 'P' : st0.marks[e0] === false ? 'A' : null
    const run = function () { doStep(b, bs, date) }
    if (was === null) withSubstitute(b, date, run)   // blank -> P is the present mark
    else run()
  }
  function doStep(b, bs, date) {
    editDay(b, date, function (st) {
      const e = bs.enrollment_id
      const cur = st.hol ? 'H' : st.nc[e] ? 'N' : st.marks[e] === true ? 'P' : st.marks[e] === false ? 'A' : null
      if (cur === null) { st.marks[e] = true }                           // blank -> P
      else if (cur === 'P') { st.marks[e] = false }                      // P -> A
      else if (cur === 'A') { delete st.marks[e]; st.nc[e] = true }      // A -> N (no class for this student)
      else if (cur === 'N') { delete st.nc[e]; st.hol = true; st.marks = {} }   // N -> H (whole batch)
      else { st.hol = false; st.marks = {} }                             // H -> blank
    })
  }
  function allPresent(b, date) {
    if (!canEdit || date > today) return
    withSubstitute(b, date, function () {
      editDay(b, date, function (st) {
        st.hol = false
        ;(b.batch_students || []).forEach(function (bs) {
          if (!memberOn(bs, date)) return
          if (st.nc[bs.enrollment_id]) return      // no class for them that day — leave it
          st.marks[bs.enrollment_id] = true
        })
      })
    })
  }

  // Teacher cell: blank -> P present -> O off -> blank. Off is the teacher's,
  // not the batch's, so it shows in every batch they take that day.
  function stepTeacher(b, date) {
    if (!canEdit || date > today || !b.instructor_id) return
    const cur = tStatus(b.instructor_id, date)
    const next = cur === null ? 'P' : cur === 'P' ? 'O' : null
    setTEdits(function (prev) { return { ...prev, [b.instructor_id + '|' + date]: next } })
    if (cur === 'O' && next !== 'O') {
      // no longer off: whoever was covering is no longer needed
      batches.filter(function (x) { return x.instructor_id === b.instructor_id }).forEach(function (x) {
        if (dayState(x.id, date).sub) editDay(x, date, function (st) { st.sub = null })
      })
    }
    if (next === 'O' && anyPresent(b, date) && !dayState(b.id, date).sub) setPicker({ b: b, date: date, action: null })
  }
  function chooseSubstitute(instrId) {
    const pk = picker
    if (!pk) return
    editDay(pk.b, pk.date, function (st) { st.sub = instrId })
    setPicker(null)
    if (pk.action) pk.action()
  }

  function dirtyDates(b) {
    const out = new Set()
    Object.keys(edits).forEach(function (k) { if (k.startsWith(b.id + '|')) out.add(k.slice(b.id.length + 1)) })
    if (b.instructor_id) Object.keys(tEdits).forEach(function (k) { if (k.startsWith(b.instructor_id + '|')) out.add(k.slice(b.instructor_id.length + 1)) })
    return Array.from(out)
  }

  async function saveBatch(b) {
    const dates = dirtyDates(b)
    if (!dates.length) return
    setSavingId(b.id)
    try {
      for (const date of dates) {
        // the teacher's own mark for the day (shared across their batches)
        const tk = (b.instructor_id || '') + '|' + date
        if (b.instructor_id && (tk in tEdits)) {
          const tv = tEdits[tk]
          if (tv) {
            const up = await sb.from('instructor_attendance').upsert({ instructor_id: b.instructor_id, att_date: date, status: tv }, { onConflict: 'instructor_id,att_date' })
            if (up.error) throw up.error
          } else {
            const dl = await sb.from('instructor_attendance').delete().eq('instructor_id', b.instructor_id).eq('att_date', date)
            if (dl.error) throw dl.error
          }
        }
        if (!edits[b.id + '|' + date]) continue     // only the teacher's mark changed
        const st = edits[b.id + '|' + date]
        const old = saved[b.id + '|' + date]
        const off = b.instructor_id && tStatus(b.instructor_id, date) === 'O'
        const sub = off ? (st.sub || null) : null
        const roster = (b.batch_students || []).filter(function (bs) { return memberOn(bs, date) })
        const rows = st.hol ? [] : roster.filter(function (bs) { return !st.nc[bs.enrollment_id] && (st.marks[bs.enrollment_id] === true || st.marks[bs.enrollment_id] === false) })
        // no-class days: replace this batch's students' rows for the date
        const rosterIds = roster.map(function (bs) { return bs.enrollment_id })
        if (rosterIds.length) {
          const dn = await sb.from('student_no_class').delete().in('enrollment_id', rosterIds).eq('class_date', date)
          if (dn.error) throw dn.error
          const ncIds = st.hol ? [] : rosterIds.filter(function (id) { return st.nc[id] })
          if (ncIds.length) {
            const ni = await sb.from('student_no_class').insert(ncIds.map(function (id) { return { enrollment_id: id, class_date: date, batch_id: b.id } }))
            if (ni.error) throw ni.error
          }
        }
        const empty = !st.hol && rows.length === 0
        if (empty) {
          // everything cleared: the class is simply not recorded
          if (old && old.id) {
            await sb.from('session_attendance').delete().eq('session_id', old.id)
            const d = await sb.from('batch_sessions').delete().eq('id', old.id)
            if (d.error) throw d.error
          }
          continue
        }
        let sessId = old && old.id
        if (sessId) {
          const patch = { is_holiday: st.hol }
          // The teacher's mark decides who took the class; a cover set on the
          // Batches page is left alone unless the teacher's day was edited here.
          if (off) { patch.instructor_id = sub || b.instructor_id || null; patch.is_substitute = !!sub }
          else if (tk in tEdits) { patch.instructor_id = b.instructor_id || null; patch.is_substitute = false }
          const u = await sb.from('batch_sessions').update(patch).eq('id', sessId)
          if (u.error) throw u.error
        } else {
          const last = await sb.from('batch_sessions').select('session_number').eq('batch_id', b.id).order('session_number', { ascending: false }).limit(1)
          const next = ((last.data && last.data[0] && last.data[0].session_number) || 0) + 1
          const ins = await sb.from('batch_sessions').insert({
            batch_id: b.id, session_date: date, session_number: next, instructor_id: sub || b.instructor_id || null,
            is_substitute: !!sub, is_holiday: st.hol,
          }).select('id').single()
          if (ins.error) throw ins.error
          sessId = ins.data.id
        }
        const del = await sb.from('session_attendance').delete().eq('session_id', sessId)
        if (del.error) throw del.error
        if (rows.length) {
          const r = await sb.from('session_attendance').insert(rows.map(function (bs) {
            return { session_id: sessId, enrollment_id: bs.enrollment_id, student_id: bs.enrollments ? bs.enrollments.student_id : null, attended: st.marks[bs.enrollment_id] === true }
          }))
          if (r.error) throw r.error
        }
      }
      // keep the batch's sessions-held count in step (holidays aren't classes)
      const cnt = await sb.from('batch_sessions').select('*', { count: 'exact', head: true }).eq('batch_id', b.id).eq('is_holiday', false)
      await sb.from('batches').update({ sessions_done: cnt.count || 0 }).eq('id', b.id)
      showToast('Attendance saved — ' + (b.name || 'batch') + ' ✓')
      setReload(function (n) { return n + 1 })
    } catch (e) {
      showToast('Save failed: ' + e.message, 'err')
    }
    setSavingId(null)
  }

  const findMatches = findQ.trim().length < 2 ? [] : (students || []).filter(function (s) {
    const t = findQ.trim().toLowerCase()
    return s.full_name?.toLowerCase().includes(t) || s.parent_name?.toLowerCase().includes(t) || s.phone?.includes(t)
  }).slice(0, 6)

  const th = { padding: '3px 0', textAlign: 'center', font: '700 10px var(--mono)', borderBottom: '1px solid var(--border)', minWidth: 26 }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className="btn-s" onClick={function () { setYm(shiftMonth(ym, -1)) }}>‹</button>
        <input type="month" value={ym} max={thisMonth()} onChange={function (e) { if (e.target.value) setYm(e.target.value) }}
          style={{ font: '600 13px var(--font)', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border2, #d8d5cc)' }} />
        <button className="btn-s" disabled={ym >= thisMonth()} onClick={function () { setYm(shiftMonth(ym, 1)) }}>›</button>
        {ym !== thisMonth() && <button className="btn-s" onClick={function () { setYm(thisMonth()) }}>This month</button>}
        <span style={{ font: '600 13px var(--font)', color: 'var(--text2)' }}>{monthLabel(ym)}</span>
      </div>
      <p className="hint" style={{ margin: '0 0 10px' }}>
        Click a cell to step it: blank (not marked) → <b style={{ color: TONE.P.color }}>P</b> present → <b style={{ color: TONE.A.color }}>A</b> absent → <b style={{ color: TONE.N.color }}>N</b> no class for that student → <b>H</b> holiday (whole batch) → blank.
        The ✓ under a date marks everyone present. <span style={{ color: '#92400e' }}>?n</span> after a student's N total is how many held classes are still not marked.
        The <b>Teacher</b> row steps blank → <b style={{ color: TONE.P.color }}>P</b> present → <b style={{ color: TONE.O.color }}>O</b> off → blank; when a student is marked present on a day the teacher is off, you pick the substitute who took the class.
      </p>

      {pending.length > 0 && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: '#FEF3C7', border: '1px solid #FCD34D' }}>
          <div style={{ font: '700 12px var(--font)', color: '#92400E', marginBottom: 6 }}>
            ⚠ {pending.length} class{pending.length > 1 ? 'es' : ''} in the last {LOOKBACK} days with no attendance recorded
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {pending.slice(0, 24).map(function (p) {
              return (
                <button key={p.date + p.batch.id} type="button" onClick={function () { setYm(p.date.slice(0, 7)); setFocus({ batchId: p.batch.id, date: p.date }) }}
                  style={{ font: '600 11px var(--font)', padding: '3px 9px', borderRadius: 20, border: '1px solid #FCD34D', background: '#fff', color: '#92400E', cursor: 'pointer' }}>
                  {DAY2[dowOf(p.date)]} {fmtDate(p.date)} · {p.batch.name}
                </button>
              )
            })}
            {pending.length > 24 && <span style={{ font: '500 11px var(--font)', color: '#92400E', alignSelf: 'center' }}>+{pending.length - 24} more</span>}
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading batches…</div>
      ) : batches.length === 0 ? (
        <div className="empty">No active batches.</div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {batches.map(function (b) {
            const roster = rosterOf(b)
            if (roster.length === 0) return null
            const dows = dowSet(b.schedule_days)
            const dirty = dirtyDates(b).length
            return (
              <div key={b.id} id={'att-batch-' + b.id} className="card" style={{ padding: 0, marginBottom: 0, boxShadow: focus && focus.batchId === b.id ? '0 0 0 2px #7c3aed' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--bg2, #f5f4f0)', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ font: '700 14px var(--font)' }}>{b.name}</div>
                    <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>
                      {[courseOf(b), b.schedule_days, b.schedule_time ? String(b.schedule_time).slice(0, 5) : '', b.instructors && b.instructors.full_name].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {canEdit && dirty > 0 && (
                    <button className="btn-p" style={{ fontSize: 12 }} disabled={savingId === b.id} onClick={function () { saveBatch(b) }}>
                      {savingId === b.id ? 'Saving…' : 'Save changes (' + dirty + ' day' + (dirty > 1 ? 's' : '') + ')'}
                    </button>
                  )}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ ...th, textAlign: 'left', padding: '6px 10px', minWidth: 170, position: 'sticky', left: 0, background: 'var(--bg)' }}>Student</th>
                        {days.map(function (d) {
                          const wd = dowOf(d)
                          const sched = dows.size ? dows.has(wd) : wd !== 0
                          const dayEntry = edits[b.id + '|' + d] || saved[b.id + '|' + d]
                          const missed = dows.size && sched && d < today && !(saved[b.id + '|' + d] && saved[b.id + '|' + d].id) && !edits[b.id + '|' + d] && !everyoneNoClass(b, d, dayEntry)
                          return (
                            <th key={d} id={'att-th-' + b.id + '-' + d} style={{ ...th, color: wd === 0 ? 'var(--text3)' : 'var(--text)', background: focus && focus.batchId === b.id && focus.date === d ? '#ddd6fe' : missed ? '#FEF3C7' : wd === 0 ? 'var(--bg2)' : 'var(--bg)', opacity: sched || wd !== 0 ? 1 : .6, outline: focus && focus.batchId === b.id && focus.date === d ? '2px solid #7c3aed' : undefined }}
                              title={missed ? 'Class scheduled — attendance not recorded' : fmtDate(d)}>
                              <div>{Number(d.slice(8, 10))}</div>
                              <div style={{ font: '500 9px var(--mono)', color: 'var(--text3)' }}>{DAY2[wd]}</div>
                            </th>
                          )
                        })}
                        <th style={{ ...th, padding: '0 6px' }}>S</th>
                        <th style={{ ...th, color: TONE.P.color }}>P</th>
                        <th style={{ ...th, color: TONE.A.color }}>A</th>
                        <th style={{ ...th, color: TONE.N.color }} title="Days with no class for the student">N</th>
                      </tr>
                      {canEdit && (
                        <tr>
                          <td style={{ padding: '2px 10px', font: '500 10px var(--font)', color: 'var(--text3)', position: 'sticky', left: 0, background: 'var(--bg)' }}>everyone present</td>
                          {days.map(function (d) {
                            return (
                              <td key={d} style={{ textAlign: 'center', padding: 0 }}>
                                {d <= today && (
                                  <button type="button" onClick={function () { allPresent(b, d) }} title={'Mark everyone present on ' + fmtDate(d)}
                                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: TONE.P.color, font: '700 11px var(--mono)', padding: '2px 0', width: 26 }}>✓</button>
                                )}
                              </td>
                            )
                          })}
                          <td colSpan={4}></td>
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {b.instructor_id && (
                        <>
                          <tr style={{ background: 'var(--bg2, #f5f4f0)' }}>
                            <td style={{ padding: '4px 10px', font: '700 12px var(--font)', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--bg2, #f5f4f0)', borderBottom: '1px solid var(--border)' }}>
                              Teacher · {b.instructors ? b.instructors.full_name : ''}
                            </td>
                            {days.map(function (d) {
                              const v = tStatus(b.instructor_id, d)
                              const tone = v ? TONE[v] : null
                              const disabled = !canEdit || d > today
                              return (
                                <td key={d} style={{ padding: 1, borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)', textAlign: 'center' }}>
                                  <button type="button" disabled={disabled} onClick={function () { stepTeacher(b, d) }}
                                    title={v === 'O' ? 'Teacher off' : v === 'P' ? 'Teacher present' : 'Teacher not marked'}
                                    style={{ width: 24, height: 24, borderRadius: 5, border: 'none', font: '700 11px var(--mono)', cursor: disabled ? 'default' : 'pointer', color: tone ? tone.color : 'var(--text3)', background: tone ? tone.bg : 'transparent', opacity: d > today ? .35 : 1 }}>
                                    {v || ''}
                                  </button>
                                </td>
                              )
                            })}
                            <td colSpan={4} style={{ borderBottom: '1px solid var(--border)' }}></td>
                          </tr>
                          {days.some(function (d) { return tStatus(b.instructor_id, d) === 'O' }) && (
                            <tr>
                              <td style={{ padding: '2px 10px', font: '500 10px var(--font)', color: 'var(--text3)', position: 'sticky', left: 0, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>cover (substitute)</td>
                              {days.map(function (d) {
                                const off = tStatus(b.instructor_id, d) === 'O'
                                const sub = dayState(b.id, d).sub
                                const need = off && !sub && anyPresent(b, d)
                                const label = sub ? nameOfInstructor(sub) : ''
                                return (
                                  <td key={d} style={{ padding: 1, borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)', textAlign: 'center' }}>
                                    {off && (
                                      <button type="button" disabled={!canEdit || d > today}
                                        onClick={function () { setPicker({ b: b, date: d, action: null }) }}
                                        title={sub ? 'Taken by ' + label + ' — click to change' : need ? 'Students were present — pick who took the class' : 'Pick the substitute'}
                                        style={{ width: 24, height: 22, borderRadius: 5, border: need ? '1.5px solid #f59e0b' : 'none', background: sub ? '#ede9fe' : need ? '#FEF3C7' : 'transparent', color: sub ? '#5b21b6' : '#92400e', font: '700 9px var(--mono)', cursor: 'pointer', padding: 0 }}>
                                        {sub ? label.split(/\s+/).map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase() : (need ? '?' : '+')}
                                      </button>
                                    )}
                                  </td>
                                )
                              })}
                              <td colSpan={4} style={{ borderBottom: '1px solid var(--border)' }}></td>
                            </tr>
                          )}
                        </>
                      )}
                      {roster.map(function (bs) {
                        let S = 0, P = 0, A = 0, N = 0, U = 0
                        const cells = days.map(function (d) {
                          const member = memberOn(bs, d)
                          const v = member ? cellOf(b, bs, d) : null
                          const st = dayState(b.id, d)
                          // a class was held that day (something recorded for the batch)
                          const held = !!member && !st.hol && (!!(saved[b.id + '|' + d] && saved[b.id + '|' + d].id) || Object.keys(st.marks).length > 0)
                          if (v === 'N') N++
                          else if (held && (dowOf(d) !== 0 || v)) {   // a Sunday nobody marked isn't a class for this student
                            S++
                            if (v === 'P') P++; else if (v === 'A') A++; else U++
                          }
                          return { d: d, member: member, v: v, held: held }
                        })
                        return (
                          <tr key={bs.id}>
                            <td style={{ padding: '4px 10px', font: '500 13px var(--font)', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                              {nameOf(bs) || '—'}
                            </td>
                            {cells.map(function (c) {
                              const tone = c.v ? TONE[c.v] : null
                              const disabled = !c.member || c.d > today || !canEdit
                              return (
                                <td key={c.d} style={{ padding: 1, borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)', textAlign: 'center', boxShadow: focus && focus.batchId === b.id && focus.date === c.d ? 'inset 0 0 0 2px #7c3aed' : undefined, background: !c.member ? 'repeating-linear-gradient(45deg,var(--bg2),var(--bg2) 4px,var(--bg) 4px,var(--bg) 8px)' : dowOf(c.d) === 0 ? 'var(--bg2)' : 'var(--bg)' }}>
                                  {c.member && (
                                    <button type="button" disabled={disabled} onClick={function () { stepCell(b, bs, c.d) }}
                                      style={{
                                        width: 24, height: 24, borderRadius: 5, border: 'none', font: '700 11px var(--mono)',
                                        cursor: disabled ? 'default' : 'pointer',
                                        color: tone ? tone.color : 'var(--text3)', background: tone ? tone.bg : 'transparent',
                                        opacity: c.d > today ? .35 : 1,
                                      }}>
                                      {c.v || ''}
                                    </button>
                                  )}
                                </td>
                              )
                            })}
                            <td style={{ textAlign: 'center', font: '700 11px var(--mono)', borderBottom: '1px solid var(--border)', padding: '0 6px' }}>{S}</td>
                            <td style={{ textAlign: 'center', font: '700 11px var(--mono)', color: TONE.P.color, borderBottom: '1px solid var(--border)' }}>{P}</td>
                            <td style={{ textAlign: 'center', font: '700 11px var(--mono)', color: TONE.A.color, borderBottom: '1px solid var(--border)' }}>{A}</td>
                            <td title={U > 0 ? U + ' class' + (U > 1 ? 'es' : '') + ' held but not marked' : undefined} style={{ textAlign: 'center', font: '700 11px var(--mono)', color: TONE.N.color, borderBottom: '1px solid var(--border)' }}>
                              {N}{U > 0 && <span style={{ color: '#92400e', marginLeft: 4 }}>?{U}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {picker && (
        <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) setPicker(null) }}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div style={{ padding: '16px 20px 6px' }}>
              <div style={{ font: '700 16px var(--font)' }}>Who took the class?</div>
              <div style={{ font: '500 12px var(--font)', color: 'var(--text3)', marginTop: 4 }}>
                {picker.b.instructors ? picker.b.instructors.full_name : 'The teacher'} is off on {fmtDate(picker.date)} — {picker.b.name}. Pick the substitute.
              </div>
            </div>
            <div style={{ padding: '8px 20px', maxHeight: '50vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {instructors.filter(function (i) { return i.id !== picker.b.instructor_id }).map(function (i) {
                const offThen = tStatus(i.id, picker.date) === 'O'
                return (
                  <button key={i.id} type="button" disabled={offThen} onClick={function () { chooseSubstitute(i.id) }}
                    style={{ textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: offThen ? 'not-allowed' : 'pointer', opacity: offThen ? .5 : 1, font: '600 13px var(--font)' }}>
                    {i.full_name}{offThen ? <span style={{ font: '500 11px var(--font)', color: TONE.O.color }}> · off that day</span> : null}
                  </button>
                )
              })}
              {instructors.length <= 1 && <p className="hint">No other active teachers.</p>}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={function () { setPicker(null) }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 18, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)' }}>
        <div style={{ font: '700 12px var(--font)', marginBottom: 6 }}>Monthly attendance sheet for one student (all their courses, with print / CSV)</div>
        <input value={findQ} onChange={function (e) { setFindQ(e.target.value) }} placeholder="Search student, parent or phone…"
          style={{ fontSize: 13, width: '100%', maxWidth: 360 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, maxWidth: 360 }}>
          {findMatches.map(function (s) {
            return (
              <button key={s.id} type="button" className="btn-s" style={{ textAlign: 'left' }} onClick={function () { onOpenSheet(s) }}>
                {s.full_name}{s.parent_name ? ' · ' + s.parent_name : ''}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
