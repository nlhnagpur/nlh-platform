import test from 'node:test'
import assert from 'node:assert/strict'
import { ciPaymentSheetHtml } from '../src/components/ciPaymentSheet.js'
import { sheetRowFor, sheetRowsFor } from '../src/utils/ciPayroll.js'

test('payment sheet: student lines, extra, total and words', () => {
  const dates = ['2026-09-29', '2026-09-30', '2026-10-01']
  const ctx = { datesBySid: { p: dates, a: dates } }
  const cyc = function (name, sid) { return sheetRowFor({ label: name, amount: 1000, meta: { sid: sid, course: 'Tuition', from: '2026-09-29', to: '2026-10-01', count: 25, perCycle: 25 } }, ctx) }
  const { html, total } = ciPaymentSheetHtml({
    ciName: 'Khushi Maidasani', date: new Date(2026, 9, 9),
    rows: [cyc('Parth', 'p'), cyc('Aaisha', 'a')],
    extra: 250,
  })
  assert.equal(total, 2250)
  assert.ok(html.includes('CI Payment Sheet'))
  assert.ok(html.includes('09.10.2026'))
  assert.ok(html.includes('Tuition- Sessions-25'))
  assert.ok(html.includes('( Sept-2026, 29,30 ) ( Oct-2026, 1 )'))
  assert.ok(html.includes('2,250.00'))
  assert.ok(html.includes('Two Thousand Two Hundred Fifty Rupees Only'))
})

import { docFileTitle } from '../src/components/studentDocs.js'

test('the printed document names itself for the file name: CI + month for a payment sheet', () => {
  const { html } = ciPaymentSheetHtml({ ciName: 'Khushi Prem Maidasani', monthLabel: 'September 2026', rows: [] })
  assert.equal(docFileTitle(html), 'CI Payment Sheet - Khushi Prem Maidasani - September 2026')
})

test('file-name title: entities decoded, characters Windows forbids replaced', () => {
  assert.equal(docFileTitle('<title>Invoice INV-2026/0042 - A &amp; B: Kids</title>'), 'Invoice INV-2026-0042 - A & B- Kids')
  assert.equal(docFileTitle('no title here'), '')
})

test('every pay basis prints the same way: dates in Particular, programme and basis in Description', () => {
  const ctx = { shareDates: { 'child:x': { all: [], ci: ['2026-10-02', '2026-10-05', '2026-10-09'] } } }
  const row = sheetRowFor({ label: 'Ayesha Shaikh (Level 3)', amount: 1181, meta: { kind: 'share', course: 'Phonics', sid: 'child:x', from: '2026-10-01', to: '2026-10-31', count: 3, total: 7, rate: 2000 } }, ctx)
  assert.equal(row.particular, 'Ayesha Shaikh (Level 3) ( Oct-2026, 2,5,9 )')
  assert.equal(row.description, 'Phonics — 3 sessions')
  const lv = sheetRowFor({ label: 'Sai — level in progress', amount: 500, meta: { kind: 'level', course: 'Phonics', sid: 'child:x', from: '2026-10-01', to: '2026-10-09', count: 3, total: 20, rate: 3000 } }, ctx)
  assert.equal(lv.description, 'Phonics — 3 sessions')
  assert.deepEqual(sheetRowFor({ label: 'Conveyance', amount: 120 }, ctx), { particular: 'Conveyance', description: '', amount: 120 })
})

test('a month line tells the teacher sessions by level, never "of 22"', async () => {
  const { levelCounts } = await import('../src/utils/ciPayroll.js')
  const ci = ['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']
  const entries = [{ level: 'Level 2', from: '2026-09-05', to: '2026-10-14' }, { level: 'Level 3', from: '2026-10-15', to: '' }]
  const levels = levelCounts(ci, entries)
  assert.deepEqual(levels, [{ name: 'Level 2', count: 5 }, { name: 'Level 3', count: 2 }])
  const row = sheetRowFor({ label: 'Ayesha Shaikh', amount: 1432, meta: { kind: 'month', course: 'Phonics', sid: 'child:x', from: '2026-10-08', to: '2026-10-16', count: 7, total: 22, rate: 1500, levels } }, { shareDates: { 'child:x': { all: [], ci } } })
  assert.equal(row.description, 'Phonics — 5 sessions of Level 2, 2 sessions of Level 3')
  assert.ok(!/22/.test(row.description))
})

test('the printed sheet joins one child\'s months into one row; the payroll screen keeps them apart', () => {
  const ci = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']
  const ctx = { shareDates: { 'child:p': { all: [], ci } } }
  const a = { label: 'Parth Chaudhary', amount: 136, meta: { kind: 'month', course: 'Tuitions', sid: 'child:p', from: '2026-11-02', to: '2026-11-04', count: 3, total: 22, rate: 1000, levels: [] } }
  const b = { label: 'Parth Chaudhary', amount: 182, meta: { kind: 'month', course: 'Tuitions', sid: 'child:p', from: '2026-11-09', to: '2026-11-12', count: 4, total: 22, rate: 1000, levels: [] } }
  const rows = sheetRowsFor([a, b, { label: 'Conveyance', amount: 500 }], ctx)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].amount, 318)
  assert.equal(rows[0].particular, 'Parth Chaudhary ( Nov-2026, 2,3,4,9,10,11,12 )')
  assert.equal(rows[0].description, 'Tuitions — 7 sessions')
  assert.equal(rows[1].particular, 'Conveyance')
  // levels add up across the joined lines
  const l2 = { label: 'Ayesha', amount: 273, meta: { kind: 'month', course: 'Phonics', sid: 'child:a', from: '2026-11-02', to: '2026-11-04', count: 3, total: 22, rate: 1500, levels: [{ name: 'Level 2', count: 3 }] } }
  const l3 = { label: 'Ayesha', amount: 409, meta: { kind: 'month', course: 'Phonics', sid: 'child:a', from: '2026-11-09', to: '2026-11-12', count: 4, total: 22, rate: 1500, levels: [{ name: 'Level 2', count: 1 }, { name: 'Level 3', count: 3 }] } }
  const r2 = sheetRowsFor([l2, l3], { shareDates: { 'child:a': { all: [], ci } } })
  assert.equal(r2.length, 1)
  assert.equal(r2[0].description, 'Phonics — 4 sessions of Level 2, 3 sessions of Level 3')
})
