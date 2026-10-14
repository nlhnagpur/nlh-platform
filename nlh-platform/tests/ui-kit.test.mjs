// Increment 1 — pure helpers behind the shared UI kit. (The React components
// themselves are checked in the browser; there is no component-test framework.)
import test from 'node:test'
import assert from 'node:assert/strict'

import { fmtMoney, fmtCount, fmtDate, fmtAmt } from '../src/utils/format.js'
import { matchesSearch } from '../src/utils/search.js'
import { toneForStatus, TONES } from '../src/components/ui/tones.js'

test('fmtMoney: Indian grouping, ₹ prefix, true minus sign', () => {
  assert.equal(fmtMoney(0), '₹0')
  assert.equal(fmtMoney(2000), '₹2,000')
  assert.equal(fmtMoney(1234567), '₹12,34,567')
  assert.equal(fmtMoney(-500), '−₹500')
  assert.equal(fmtMoney('1500'), '₹1,500')
})

test('fmtMoney: empty / invalid values read ₹0, never NaN', () => {
  for (const v of [null, undefined, '', 'abc', NaN]) assert.equal(fmtMoney(v), '₹0')
})

test('fmtMoney agrees with the long-standing fmtAmt for positive amounts', () => {
  for (const n of [0, 5, 999, 1000, 100000, 2500000]) assert.equal(fmtMoney(n), '₹' + fmtAmt(n))
})

test('fmtDate is the unchanged shared helper (dash for empty, same text otherwise)', () => {
  assert.equal(fmtDate(null), '—')
  assert.equal(fmtDate('2026-10-05'), new Date('2026-10-05').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }))
})

test('fmtCount: total only, or "shown of total" when filtered', () => {
  assert.equal(fmtCount(12, 12), '12')
  assert.equal(fmtCount(3, 12), '3 of 12')
  assert.equal(fmtCount(0, 7), '0 of 7')
})

test('matchesSearch: empty query matches everything', () => {
  assert.equal(matchesSearch(['OR-HO-2026-0019'], ''), true)
  assert.equal(matchesSearch([], '   '), true)
})

test('matchesSearch: case-insensitive, every word must match, ignores null parts', () => {
  const fields = ['OR-HO-2026-0019', 'Sunrise Abacus', null, undefined, 2500, 'INV-2026-0004']
  assert.equal(matchesSearch(fields, 'or-ho-2026-0019'), true)
  assert.equal(matchesSearch(fields, 'sunrise 2500'), true)
  assert.equal(matchesSearch(fields, 'sunrise 9999'), false)
  assert.equal(matchesSearch(fields, '0004'), true)
  assert.equal(matchesSearch(null, 'x'), false)
})

test('toneForStatus: known words map to tones, unknown/empty are neutral (never green)', () => {
  assert.equal(toneForStatus('approved'), 'success')
  assert.equal(toneForStatus('PAID'), 'success')
  assert.equal(toneForStatus('pending'), 'attention')
  assert.equal(toneForStatus('part_paid'), 'attention')
  assert.equal(toneForStatus('rejected'), 'danger')
  assert.equal(toneForStatus('overdue'), 'danger')
  assert.equal(toneForStatus('inactive'), 'neutral')
  assert.equal(toneForStatus('something-new'), 'neutral')
  assert.equal(toneForStatus(''), 'neutral')
  assert.equal(toneForStatus(null), 'neutral')
})

test('every tone name returned has a palette entry', () => {
  for (const s of ['approved', 'pending', 'rejected', 'inactive', 'x', '']) {
    assert.ok(TONES[toneForStatus(s)], s)
  }
})
