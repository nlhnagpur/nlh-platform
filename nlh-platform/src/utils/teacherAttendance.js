// Teacher attendance codes in the attendance register.
//   P present · O off (planned leave) · A absent (did not come)
//   H holiday is NOT a teacher mark: it is the batch's holiday and is shown
//   from the day itself, so it needs no storage.
//
// 'A' needs the instructor_attendance status check to allow it (a migration
// that is prepared but not applied) — until then ABSENT_ENABLED stays false and
// the cell only steps blank → P → O → blank, exactly as before.
export const TEACHER_ABSENT_ENABLED = false

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
  if (holiday) return 'Holiday for this batch'
  if (status === 'P') return 'Teacher present'
  if (status === 'A') return 'Teacher absent'
  if (status === 'O') return 'Teacher off'
  return 'Teacher not marked'
}
