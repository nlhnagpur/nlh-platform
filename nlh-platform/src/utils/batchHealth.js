// Batch health: the rules that keep batches, their CIs, rosters and classes consistent, written once
// so every screen and the "Batch health check" agree. Pure functions — no database access here.

import { appointmentForCourse } from './ciPayroll.js'
import { teacherStartDay } from './teacherAttendance.js'

// Should a batch get a row in a given month's attendance view (register or a CI's payroll panel)?
// An open batch the CI had by the end of the month, or ANY batch that actually ran classes in it —
// never an old closed batch that had nothing happen that month.
export function batchListedInMonth(batch, hasClassesInMonth, monthEnd) {
  if (hasClassesInMonth) return true
  if (!batch || !batch.is_active) return false
  const start = teacherStartDay(batch)
  return !start || start <= String(monthEnd).slice(0, 10)
}

function dayCount(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)
}

// Issues across the OPEN batches.
//   batches:        [{ id, name, is_active, start_date, instructor_assigned_at, instructor_id, instructors: { full_name, status } }]
//   openRoster:     [{ batch_id, student_id, student, course_id, course }]        students currently on each batch
//   recentSessions: [{ batch_id, session_date, instructor_id, is_substitute }]    classes in the recent window
//   appointments:   [{ instructor_id, remuneration_mode, appointed_at, skus: { course_id } }]   active appointments
//   today:          'YYYY-MM-DD'
// Each issue: { severity: 'error' | 'warn' | 'info', code, batchId, batch, ci, message }
export function batchHealthIssues(input) {
  const batches = input.batches || []
  const roster = input.openRoster || []
  const sessions = input.recentSessions || []
  const appts = input.appointments || []
  const today = input.today
  const issues = []
  const add = function (sev, code, b, message) {
    issues.push({ severity: sev, code: code, batchId: b.id, batch: b.name, ci: (b.instructors && b.instructors.full_name) || '', message: message })
  }

  batches.filter(function (b) { return b.is_active }).forEach(function (b) {
    const ciName = (b.instructors && b.instructors.full_name) || 'The CI'
    const mine = roster.filter(function (r) { return r.batch_id === b.id })
    const classes = sessions.filter(function (s) { return s.batch_id === b.id })
    const start = teacherStartDay(b)

    if (!b.instructor_id) add('error', 'no_ci', b, 'Open batch with no CI.')
    else if (b.instructors && b.instructors.status && b.instructors.status !== 'active') {
      add('error', 'ci_not_active', b, ciName + ' is ' + b.instructors.status + ' but this batch is still open — reassign or close it.')
    }

    if (mine.length === 0) add('warn', 'no_students', b, 'Open batch with no students on it.')

    // classes dated before the batch (or this CI) began
    const early = classes.filter(function (s) { return b.start_date && s.session_date < String(b.start_date).slice(0, 10) })
    if (early.length) add('error', 'class_before_start', b, early.length + ' class(es) dated before the batch start (' + String(b.start_date).slice(0, 10) + ') — correct the start date.')

    // a class taken by someone other than the batch's CI, not marked as a substitute
    const stray = classes.filter(function (s) { return s.instructor_id && s.instructor_id !== b.instructor_id && !s.is_substitute && (!start || s.session_date >= start) })
    if (stray.length) add('warn', 'other_ci_class', b, stray.length + ' recent class(es) were taken by a different CI without being marked as a substitute.')

    // no class for a while
    const last = classes.reduce(function (m, s) { return s.session_date > m ? s.session_date : m }, '')
    if (mine.length && today && (!last || dayCount(last, today) > 14) && (!b.start_date || dayCount(String(b.start_date).slice(0, 10), today) > 14)) {
      add('info', 'no_recent_class', b, last ? 'No class recorded since ' + last + '.' : 'No class recorded in the recent window.')
    }

    // the CI must hold an appointment for every course on the roster, or payroll calculates nothing for those students
    const seen = {}
    mine.forEach(function (r) {
      if (!r.course_id || seen[r.course_id]) return
      seen[r.course_id] = true
      const ap = appointmentForCourse(appts.filter(function (a) { return a.instructor_id === b.instructor_id }), r.course_id, today)
      if (!ap) add('error', 'no_appointment', b, ciName + ' has no appointment for ' + (r.course || 'this course') + ', so payroll will calculate nothing for these students.')
    })
  })

  // the same student on two open batches for the same course
  const byStudentCourse = {}
  roster.forEach(function (r) {
    if (!r.student_id || !r.course_id) return
    const k = r.student_id + '|' + r.course_id
    ;(byStudentCourse[k] = byStudentCourse[k] || []).push(r)
  })
  Object.keys(byStudentCourse).forEach(function (k) {
    const rows = byStudentCourse[k]
    const ids = Array.from(new Set(rows.map(function (r) { return r.batch_id })))
    if (ids.length > 1) {
      const first = batches.find(function (b) { return b.id === ids[0] })
      if (first) add('warn', 'double_batch', first, (rows[0].student || 'A student') + ' is on ' + ids.length + ' open batches for ' + (rows[0].course || 'the same course') + '.')
    }
  })

  const order = { error: 0, warn: 1, info: 2 }
  return issues.sort(function (a, b) { return order[a.severity] - order[b.severity] || String(a.batch).localeCompare(String(b.batch)) })
}
