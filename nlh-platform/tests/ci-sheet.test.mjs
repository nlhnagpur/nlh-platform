import test from 'node:test'
import assert from 'node:assert/strict'
import { ciPaymentSheetHtml } from '../src/components/ciPaymentSheet.js'

test('payment sheet: student lines, extra, total and words', () => {
  const dates = ['2026-09-29', '2026-09-30', '2026-10-01']
  const { html, total } = ciPaymentSheetHtml({
    ciName: 'Khushi Maidasani', date: new Date(2026, 9, 9),
    rows: [{ name: 'Parth', course: 'Tuition', blocks: [{ dates, count: 25, perCycle: 25, amount: 1000 }] },
           { name: 'Aaisha', course: 'Tuition', blocks: [{ dates, count: 25, perCycle: 25, amount: 1000 }] }],
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
  const { html } = ciPaymentSheetHtml({ ciName: 'Khushi Prem Maidasani', monthLabel: 'September 2026', rows: [], otherLines: [] })
  assert.equal(docFileTitle(html), 'CI Payment Sheet - Khushi Prem Maidasani - September 2026')
})

test('file-name title: entities decoded, characters Windows forbids replaced', () => {
  assert.equal(docFileTitle('<title>Invoice INV-2026/0042 - A &amp; B: Kids</title>'), 'Invoice INV-2026-0042 - A & B- Kids')
  assert.equal(docFileTitle('no title here'), '')
})
