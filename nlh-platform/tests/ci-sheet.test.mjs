import test from 'node:test'
import assert from 'node:assert/strict'
import { ciPaymentSheetHtml } from '../src/components/ciPaymentSheet.js'
import { sheetRowFor } from '../src/utils/ciPayroll.js'

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
  assert.equal(row.description, 'Phonics — 3 of 7 classes taken by the CI')
  const lv = sheetRowFor({ label: 'Sai — level in progress', amount: 500, meta: { kind: 'level', course: 'Phonics', sid: 'child:x', from: '2026-10-01', to: '2026-10-09', count: 3, total: 20, rate: 3000 } }, ctx)
  assert.equal(lv.description, 'Phonics — 3 of 20 classes of the level taken by the CI')
  assert.deepEqual(sheetRowFor({ label: 'Conveyance', amount: 120 }, ctx), { particular: 'Conveyance', description: '', amount: 120 })
})
