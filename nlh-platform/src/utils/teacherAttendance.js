// Teacher attendance codes in the attendance register.
//   P present
//   O off     — the teacher's weekly off (a planned, regular day off)
//   A absent  — the teacher was due to come but did not (unplanned)
//   H holiday — a general holiday. NOT a teacher mark: it is the batch's
//               holiday and is shown from the day itself, so it needs no storage.
//
// 'A' is allowed by migration 20261018111422_instructor_attendance_allow_absent
// (applied). The flag stays so the cell can be put back to blank → P → O → blank
// if ever needed.
export const TEACHER_ABSENT_ENABLED = true

// A teacher who is off OR absent is not taking the class that day, so a
// substitute is needed if students were marked present.
export function isTeacherAway(status) {
  return status === 'O' || status === 'A'
}

// Next status when the teacher cell is clicked.
export function teacherNextStatus(current, absentEnabled) {
  const cur = current || null
  if (cur === null) return 'P'
  if (cur === 'P') return absentEnabled ? 'A' : 'O'
  if (cur === 'A') return 'O'
  return null            // 'O' (or anything else) clears the cell
}

export function teacherStatusTitle(status, holiday) {
  if (holiday) return 'General holiday'
  if (status === 'P') return 'Teacher present'
  if (status === 'A') return 'Teacher absent — was due but did not come'
  if (status === 'O') return "Teacher's weekly off"
  return 'Teacher not marked'
}

// ── per-batch marks ──────────────────────────────────────────────────────────
// A teacher can be absent for one batch and present for another, so P and A are
// stored per batch (batch_id set). O is the teacher's weekly off — the whole day
// — and is stored without a batch (batch_id null), as are older marks made
// before this existed. For a batch's cell the batch's own mark wins; otherwise
// the whole-day mark applies.
export function resolveTeacherStatus(batchMark, dayMark) {
  return batchMark || dayMark || null
}

// What saving a batch's teacher cell must do to instructor_attendance.
//   next      the status now showing in the cell ('P' | 'A' | 'O' | null)
//   hadDayRow whether a whole-day row exists for the teacher that date
export function teacherWritePlan(next, hadDayRow) {
  if (next === 'O') return { upsertDay: 'O', deleteBatch: true, deleteDay: false, upsertBatch: null }
  if (next === 'P' || next === 'A') return { upsertDay: null, deleteBatch: false, deleteDay: false, upsertBatch: next }
  return { upsertDay: null, deleteBatch: true, deleteDay: !!hadDayRow, upsertBatch: null }
}

// The first day the batch's CI is the one taking it: the later of the batch's own start
// and the day the current CI was assigned. Teacher marks before it make no sense.
export function teacherStartDay(batch, firstClass) {
  if (!batch) return ''
  const a = batch.start_date ? String(batch.start_date).slice(0, 10) : ''
  const b = batch.instructor_assigned_at ? String(batch.instructor_assigned_at).slice(0, 10) : ''
  const rule = a > b ? a : b
  // a class actually recorded earlier than the rule wins: the data says the CI was already there
  const f = firstClass ? String(firstClass).slice(0, 10) : ''
  return rule && f && f < rule ? f : rule
}
