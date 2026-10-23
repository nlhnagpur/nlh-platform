// A CI's payroll month, sanity-checked before the number is relied on. Pure functions.
// Each issue carries what to do about it.

export const PAYROLL_ACTIONS = {
  no_appointment: 'Instructors → this CI → Courses: add an appointment for that programme (rate and basis, from the date they started). Until then add a line for those students below, or the month will be short.',
  zero_pay: 'Look at the appointment basis for the programme. "Per Student" pays only when a student completes a level; "Per Student / Month" pays for students on the batch. If the basis is wrong, correct the appointment; if the pay is right, nothing to do.',
  basis_change: 'The latest appointment in force applies to the whole month. If part of the month should be paid on the earlier basis, edit the amounts or add a line below, and note why.',
  recalculated: 'Attendance, batches or appointments changed since this payroll was saved. Check the lines against the new calculation (Reset to calculated shows it), then save again — or leave as is if your figure is right.',
  substitute_classes: 'The amounts for substitute classes are approximate, worked out from this CI’s own appointment for the programme (zero where it cannot be estimated). Agree the figure and type it over.',
  cycle_in_progress: 'Nothing to do now. A cycle is paid when it completes (25 classes), or pro-rata if the student leaves. It will appear as a line in the month it started.',
  posted_differs: 'This month is already posted to the accounts, so nothing changes automatically. If the new calculation is right, reopen the month (until it is paid) or post the difference as an adjustment next month.',
}

function monthRange(month) { return [month + '-01', month + '-31'] }

//   month:        'YYYY-MM'
//   ciName:       string
//   classesTaken: classes the CI took this month (holidays and substitutes excluded)
//   classPay:     what the calculation pays for those classes (not conveyance / incentive / fixed extras)
//   unmatched:    [{ batch, course }] programmes on a roster the CI holds no appointment for
//   appts:        [{ remuneration_mode, appointed_at, skus: { courses: { group_name } } }]  the CI's active appointments
//   usedCourses:  programme names that produced pay rows (to look for a mid-month change of basis)
//   subs:         [{ batch, count, approx }] classes this CI took as a substitute this month
//   inProgress:   [{ name, count, perCycle, start, accrued }] cycles still running (not payable yet)
//   run:          saved ci_payroll_runs row or null
//   calcTotal:    the calculated total now
export function payrollCheckIssues(input) {
  const out = []
  const add = function (sev, code, message) { out.push({ severity: sev, code: code, message: message, action: PAYROLL_ACTIONS[code] || '' }) }
  const r = monthRange(input.month)
  const name = input.ciName || 'The CI'

  ;(input.unmatched || []).forEach(function (u) {
    add('error', 'no_appointment', 'No appointment covers ' + u.course + ' (' + u.batch + ') for ' + input.month + ', so nothing is calculated for those students.')
  })

  if ((input.classesTaken || 0) > 0 && (input.classPay || 0) === 0 && !(input.unmatched || []).length) {
    add('warn', 'zero_pay', name + ' took ' + input.classesTaken + ' class(es) this month but the calculation pays ₹0 for them.')
  }

  // an appointment for a programme that starts inside the month and changes the basis
  ;(input.usedCourses || []).forEach(function (course) {
    const key = String(course).trim().toLowerCase()
    const all = (input.appts || []).filter(function (a) {
      const c = a.skus && a.skus.courses && a.skus.courses.group_name
      return String(c || '').trim().toLowerCase() === key && a.appointed_at
    }).sort(function (x, y) { return String(x.appointed_at).localeCompare(String(y.appointed_at)) })
    all.forEach(function (a, i) {
      const on = String(a.appointed_at).slice(0, 10)
      if (on > r[0] && on <= r[1] && i > 0) {
        const prev = all[i - 1]
        if (prev.remuneration_mode !== a.remuneration_mode) {
          add('info', 'basis_change', course + ': the basis changes on ' + on + ' (' + prev.remuneration_mode.replace(/_/g, ' ') + ' → ' + a.remuneration_mode.replace(/_/g, ' ') + '); the month is calculated on the later one.')
        }
      }
    })
  })

  ;(input.subs || []).forEach(function (x) {
    add('info', 'substitute_classes', name + ' took ' + x.count + ' class' + (x.count !== 1 ? 'es' : '') + ' as a substitute in ' + x.batch + ' — approx ₹' + Math.round(x.approx) + ' included.')
  })

  ;(input.inProgress || []).forEach(function (c) {
    add('info', 'cycle_in_progress', c.name + ' — cycle in progress since ' + c.start + ': ' + c.count + ' of ' + c.perCycle + ' classes (₹' + c.accrued + ' so far), not payable yet.')
  })

  if (input.run && input.run.calculated_total != null && input.run.calculated_total !== input.calcTotal) {
    if (input.run.status === 'draft') add('warn', 'recalculated', 'The calculation is now ₹' + input.calcTotal + ', but this payroll was saved when it was ₹' + input.run.calculated_total + '.')
    else add('info', 'posted_differs', 'The calculation is now ₹' + input.calcTotal + '; the posted payroll used ₹' + input.run.calculated_total + '.')
  }

  const order = { error: 0, warn: 1, info: 2 }
  return out.sort(function (a, b) { return order[a.severity] - order[b.severity] })
}
