import test from 'node:test'
import assert from 'node:assert/strict'
import { monthLabel, cleanLines, sumLines, linesFromCalc, runStatus, lineEdited } from '../src/utils/ciPayrollRun.js'

test('month label', () => assert.equal(monthLabel('2026-10'), 'October 2026'))

test('calculated lines become editable lines with the same amount; editing shows as edited', () => {
  const lines = linesFromCalc([{ key: 'a', label: 'Parth', amount: 1000 }, { key: 'b', label: 'Aaisha', amount: 1000 }])
  assert.equal(sumLines(lines), 2000)
  assert.equal(lineEdited(lines[0]), false)
  lines[1].amount = 1100
  assert.equal(lineEdited(lines[1]), true)
  assert.equal(sumLines(lines), 2100)
})

test('an added line is never "edited" and counts in the total; blank lines are dropped; amounts are whole rupees', () => {
  const lines = cleanLines([{ key: 'a', label: 'Parth', calc: 1000, amount: '1000.4' }, { label: 'Extra', amount: 250, added: true }, { label: '', amount: 0 }])
  assert.equal(lines.length, 2)
  assert.equal(lines[0].amount, 1000)
  assert.equal(lineEdited(lines[1]), false)
  assert.equal(sumLines(lines), 1250)
})

test('a deduction is a negative line', () => assert.equal(sumLines([{ amount: 2000 }, { amount: -250 }]), 1750))

test('run status', () => {
  assert.equal(runStatus(null), 'none')
  assert.equal(runStatus({ status: 'draft' }), 'draft')
  assert.equal(runStatus({ status: 'paid' }), 'paid')
})
