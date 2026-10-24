// Loads what the batch health rules need and returns every issue — used by the Batch health check on the Batches page
// and by the Today / Month close page, so both always agree.
import { sb } from '../supabase'
import { fetchAllRows } from './studentLifecycle'
import { batchHealthIssues, unplacedEnrollments } from './batchHealth'

function isoDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export async function loadBatchHealthIssues() {
  const today = isoDaysAgo(0)
  const bRes = await sb.from('batches')
    .select('id, name, is_active, start_date, instructor_assigned_at, instructor_id, instructors(full_name, status)').eq('is_active', true)
  if (bRes.error) throw bRes.error
  const batches = bRes.data || []
  const ids = batches.map(function (b) { return b.id })
  const ciIds = Array.from(new Set(batches.map(function (b) { return b.instructor_id }).filter(Boolean)))

  let openRoster = [], recentSessions = [], appointments = []
  const placedIds = []
  if (ids.length) {
    const rRes = await sb.from('batch_students')
      .select('batch_id, enrollment_id, enrollments(student_id, completed_at, status, students(full_name), skus(course_id, courses(group_name)))')
      .in('batch_id', ids).is('removed_at', null)
    if (rRes.error) throw rRes.error
    ;(rRes.data || []).forEach(function (x) { placedIds.push(x.enrollment_id) })
    openRoster = (rRes.data || []).filter(function (x) {
      const e = x.enrollments
      return e && !e.completed_at && e.status !== 'dropped'      // a finished or dropped enrolment is not a current student
    }).map(function (x) {
      const e = x.enrollments
      return { batch_id: x.batch_id, student_id: e.student_id, student: e.students && e.students.full_name,
        course: e.skus && e.skus.courses && e.skus.courses.group_name }
    })
    recentSessions = await fetchAllRows(function (from, to) {
      return sb.from('batch_sessions').select('batch_id, session_date, instructor_id, is_substitute')
        .in('batch_id', ids).gte('session_date', isoDaysAgo(45)).order('id').range(from, to)
    })
    if (ciIds.length) {
      const aRes = await sb.from('instructor_courses').select('instructor_id, remuneration_mode, appointed_at, skus(courses(group_name))').in('instructor_id', ciIds).eq('status', 'active')
      if (aRes.error) throw aRes.error
      appointments = aRes.data || []
    }
  }

  // HO enrolments still running, wherever they are placed
  const eRes = await sb.from('enrollments')
    .select('id, student_id, enrolled_at, completed_at, status, students(full_name, closed_at, franchisees(tier)), skus(courses(group_name))')
    .is('completed_at', null).neq('status', 'dropped')
  if (eRes.error) throw eRes.error
  const enrs = (eRes.data || []).map(function (e) {
    return { id: e.id, student_id: e.student_id, student: e.students && e.students.full_name, course: e.skus && e.skus.courses && e.skus.courses.group_name,
      enrolled_at: e.enrolled_at, completed_at: e.completed_at, status: e.status, closed: !!(e.students && e.students.closed_at),
      tier: e.students && e.students.franchisees && e.students.franchisees.tier }
  })

  const issues = batchHealthIssues({ batches: batches, openRoster: openRoster, recentSessions: recentSessions, appointments: appointments, today: today })
    .concat(unplacedEnrollments({ enrollments: enrs, placedIds: placedIds, today: today }))
  const order = { error: 0, warn: 1, info: 2 }
  return issues.sort(function (a, b) { return order[a.severity] - order[b.severity] })
}
