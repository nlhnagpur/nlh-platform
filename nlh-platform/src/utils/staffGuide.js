// The staff one-page guide (HO): which button to press for each real-world event, the month-end routine, and what
// each warning means. Kept next to the rulebook (docs/ops/student-lifecycle-rulebook.md) — change both together.

export const STAFF_GUIDE = {
  title: 'NLH Platform — Staff Guide',
  intro: 'Press the button for the event. Never fix a result by hand in several places — the button changes everything that belongs together.',
  events: [
    ['A child changes batch or CI', 'Batches → ⇄ Move beside the student. Pick the batch and the date it really happened.'],
    ['A child finishes a level and carries on', 'Students → the course → Move to next level.'],
    ['A child finishes the course', 'Students → the course → Complete (date). Then issue the certificate.'],
    ['A batch has ended', 'Batches → Close batch. Decide every student first (move or finish), then it locks.'],
    ['A CI is leaving', 'Instructors → 👋 CI is leaving…  Hand each open batch to another CI or close it, then the CI is marked left.'],
    ['A new CI starts', 'Instructors → add the CI → Courses: programme, pay basis, rate, start date.'],
    ['A CI changes pay basis', 'Add a new appointment for the programme with the new date. Do not edit the old one.'],
    ['Another CI covers a class', 'Mark it Substitute on the attendance register. The covering CI sees it in their payroll.'],
    ['A child stops one course', 'Students → the course → Discontinue course.'],
    ['A child leaves altogether', 'Students → Close / Withdraw.'],
    ['A student comes back for another course', 'Students → + Enrol Student → type the mobile number → Add courses →. Tick the courses and pick a batch for each.'],
    ['A fee is refunded', 'Never edit the paid amount. HO makes a voucher / journal entry in HO Accounting, with the reason.'],
  ],
  month: [
    'Open Today & Month close. Choose the month that just ended.',
    'Clear every Fix and Check — each line says what to do and has an Open button.',
    'Instructors → each CI → Payroll: read the Payroll check, adjust lines if needed, Save.',
    'Post to accounts, then Record bank payment once the transfer is made. Print the payment sheet for the CI.',
    'Re-check the page. When the CI payroll group shows All clear, the month is closed.',
  ],
  warnings: [
    ['No appointment', 'The CI has no pay set for that programme, so payroll shows nothing. Instructors → CI → Courses → add it.'],
    ['Enrolled, no batch', 'A child is enrolled but nobody is teaching them. Add them to a batch, or discontinue the course.'],
    ['Class by another CI, not a substitute', 'Batches → History: mark it Substitute, or correct the CI on the class.'],
    ['Payroll already saved or posted', 'A date you changed affects a month already saved. Open that month\'s payroll and re-check it.'],
    ['Agreement not signed', 'A unit franchise has no signed agreement. Franchisees → the centre → Agreement: generate and send it, or remind them to sign.'],
    ['Cycle in progress', 'A child\'s 25-class cycle is not finished. It is paid in the month it starts; nothing to fix.'],
  ],
  rules: [
    'A CI is paid for the programme (Phonics, Tuitions…), never for the level.',
    'Each CI is paid at their own rate for the classes they took of the child.',
    'A move is dated the day the child really moved: the old CI is paid up to the day before, the new CI from that day.',
    'A CI who leaves mid-level is paid for the classes taken; the takeover CI is paid the rest at completion.',
    'Closed batches are view-only. A completion cannot be reversed.',
  ],
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] })
}

export function staffGuideHtml() {
  const g = STAFF_GUIDE
  const rows = function (list) { return list.map(function (r) { return '<tr><td class="k">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>' }).join('') }
  const items = function (list) { return list.map(function (t) { return '<li>' + esc(t) + '</li>' }).join('') }
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(g.title) + '</title><style>' +
    '@page{size:A4;margin:10mm}body{font:10.5px/1.35 "DM Sans",Arial,sans-serif;color:#1a1a2e;margin:0}' +
    'h1{font-size:17px;margin:0 0 2px;color:#534AB7}h2{font-size:11px;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.08em;color:#534AB7;border-bottom:1px solid #d8d6f0;padding-bottom:2px}' +
    'p{margin:0 0 4px}table{border-collapse:collapse;width:100%}td{padding:2.5px 6px;vertical-align:top;border-bottom:1px solid #eee}' +
    'td.k{width:30%;font-weight:700}ol,ul{margin:0;padding-left:16px}li{margin:1px 0}' +
    '</style></head><body><h1>' + esc(g.title) + '</h1><p>' + esc(g.intro) + '</p>' +
    '<h2>When this happens, press this</h2><table>' + rows(g.events) + '</table>' +
    '<h2>Every month end</h2><ol>' + items(g.month) + '</ol>' +
    '<h2>What a warning means</h2><table>' + rows(g.warnings) + '</table>' +
    '<h2>Rules to remember</h2><ul>' + items(g.rules) + '</ul>' +
    '</body></html>'
}
