import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultEnd, batchHours, timeRange, hoursLabel } from '../src/utils/batchTime.js'
import { recountLine, sheetRowFor } from '../src/utils/ciPayroll.js'

test('batch time: the end follows the start by one hour until it is set', () => {
  assert.equal(defaultEnd('15:00'), '16:00')
  assert.equal(defaultEnd('23:30'), '00:30')
  assert.equal(defaultEnd(''), '')
  assert.equal(timeRange('15:00:00', ''), '15:00 – 16:00')
  assert.equal(timeRange('15:00', '17:00'), '15:00 – 17:00')
})

test('batch time: session length in hours (1 when unset or invalid)', () => {
  assert.equal(batchHours('15:00', '17:00'), 2)
  assert.equal(batchHours('15:00:00', '16:30:00'), 1.5)
  assert.equal(batchHours('15:00', null), 1)
  assert.equal(batchHours('15:00', '14:00'), 1)
  assert.equal(hoursLabel(2), '2 hrs'); assert.equal(hoursLabel(1), '1 hr')
})

test('an hourly CI is paid for the hours of a long class', () => {
  const line = { label: 'RC batch', amount: 0, meta: { kind: 'session', sid: 'b1', from: '2026-11-01', to: '2026-11-30', count: 0, rate: 300, hours: 2 } }
  const r = recountLine(line, '2026-11-01', '2026-11-30', { shareDates: { b1: { all: [], ci: ['2026-11-01', '2026-11-08', '2026-11-15'] } } })
  assert.equal(r.amount, 3 * 2 * 300)
  const row = sheetRowFor({ ...r, meta: { ...r.meta, course: 'Rubiks Cube' } }, { shareDates: { b1: { all: [], ci: ['2026-11-01', '2026-11-08', '2026-11-15'] } } })
  assert.equal(row.description, 'Rubiks Cube — 3 sessions of 2 hrs')
})
