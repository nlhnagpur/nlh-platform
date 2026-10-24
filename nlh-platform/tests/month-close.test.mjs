import test from 'node:test'
import assert from 'node:assert/strict'
import { unplacedEnrollments } from '../src/utils/batchHealth.js'
import { closeItems, monthIsPast } from '../src/utils/monthClose.js'

const en = function (o) { return { id: 'e1', student_id: 's1', student: 'Daksh', course: 'Phonics', enrolled_at: '2026-10-01', tier: 'NLH', ...o } }

test('enrolled, no batch: only HO students who are running, unplaced and past the grace days', () => {
  const today = '2026-10-24'
  assert.equal(unplacedEnrollments({ enrollments: [en()], placedIds: [], today }).length, 1)
  assert.equal(unplacedEnrollments({ enrollments: [en()], placedIds: ['e1'], today }).length, 0)            // on a batch
  assert.equal(unplacedEnrollments({ enrollments: [en({ tier: 'CF' })], placedIds: [], today }).length, 0)    // franchise centre: no batches
  assert.equal(unplacedEnrollments({ enrollments: [en({ completed_at: '2026-10-10' })], placedIds: [], today }).length, 0)
  assert.equal(unplacedEnrollments({ enrollments: [en({ status: 'dropped' })], placedIds: [], today }).length, 0)
  assert.equal(unplacedEnrollments({ enrollments: [en({ closed: true })], placedIds: [], today }).length, 0)
  assert.equal(unplacedEnrollments({ enrollments: [en({ enrolled_at: '2026-10-23' })], placedIds: [], today }).length, 0)   // just enrolled
  const one = unplacedEnrollments({ enrollments: [en()], placedIds: [], today })[0]
  assert.equal(one.code, 'enrolled_no_batch'); assert.equal(one.days, 23)
})

test('month close: payroll states, orders, certificates and batch issues in one list', () => {
  const cis = [{ id: 'a', full_name: 'Khushi' }, { id: 'b', full_name: 'Sabahat' }, { id: 'c', full_name: 'Sneha' }, { id: 'd', full_name: 'Old CI', left_at: '2026-08-01' }, { id: 'e', full_name: 'Paid CI' }]
  const runs = [{ instructor_id: 'b', status: 'draft', total: 3567 }, { instructor_id: 'c', status: 'posted', total: 1000 }, { instructor_id: 'e', status: 'paid', total: 500 }]
  const list = closeItems({ month: '2026-10', today: '2026-11-02', cis, runs, ordersToInvoice: 2, ordersToVerify: 1, certs: 3,
    health: [{ severity: 'error', code: 'no_ci', batch: 'B1', ci: '', message: 'Open batch with no CI.', action: 'x' }, { severity: 'warn', code: 'enrolled_no_batch', student: 'Daksh', message: 'm', action: 'y' }] })
  const pay = list.filter(function (i) { return i.group === 'CI payroll' })
  assert.deepEqual(pay.map(function (i) { return i.title }).sort(), ['Khushi', 'Sabahat', 'Sneha'])   // paid and long-gone CIs are not listed
  assert.ok(pay.every(function (i) { return i.severity === 'warn' }))                                  // past month: to do
  assert.equal(list[0].severity, 'error')
  assert.equal(list.find(function (i) { return i.title === 'Daksh' }).page, 'students')
  assert.equal(list.filter(function (i) { return i.group === 'Orders' }).length, 2)
  assert.equal(list.filter(function (i) { return i.group === 'Certificates' }).length, 1)
  // the running month is a note, not a to-do
  const now = closeItems({ month: '2026-11', today: '2026-11-02', cis: [{ id: 'a', full_name: 'Khushi' }], runs: [] })
  assert.equal(now[0].severity, 'info'); assert.equal(monthIsPast('2026-11', '2026-11-02'), false)
})

import { staffGuideHtml, STAFF_GUIDE } from '../src/utils/staffGuide.js'
test('staff guide prints every section on one sheet', () => {
  const html = staffGuideHtml()
  assert.ok(html.includes('NLH Platform — Staff Guide'))
  STAFF_GUIDE.events.forEach(function (e) { assert.ok(html.includes(e[0].replace(/&/g, '&amp;'))) })
  assert.ok(html.includes('Every month end') && html.includes('What a warning means') && html.includes('Rules to remember'))
})
