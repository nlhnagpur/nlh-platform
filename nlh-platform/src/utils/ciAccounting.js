// CI payroll in the books.
//
//   Post the month's payroll:   Dr 6001 Staff Salaries        Cr  the CI's own account
//   Pay the CI (bank payment):  Dr the CI's own account       Cr  the bank
//
// The CI's own account is a liability account under "2500 Payable – Class Instructors",
// created for each CI the first time something is posted for them.

import { sb } from '../supabase'
import { allocatePayment } from './ciPayrollRun'

export const CI_CONTROL_CODE = '2500'
export const SALARY_CODE = '6001'

async function fiscalYearId() {
  const fy = await sb.from('fiscal_years').select('id').eq('is_current', true).single()
  if (fy.error || !fy.data) throw new Error('No current fiscal year is set in Accounting')
  return fy.data.id
}

async function accountByCode(code) {
  const r = await sb.from('accounts').select('id, code, name').eq('code', code).maybeSingle()
  if (r.error) throw r.error
  return r.data
}

// The CI's own ledger account (found by the instructor id kept in its description).
export async function findCiAccount(instructorId) {
  const r = await sb.from('accounts').select('id, code, name').eq('description', 'ci:' + instructorId).maybeSingle()
  if (r.error) throw r.error
  return r.data
}

export async function ensureCiAccount(instructor) {
  const existing = await findCiAccount(instructor.id)
  if (existing) return existing
  let control = await accountByCode(CI_CONTROL_CODE)
  if (!control) {
    const c = await sb.from('accounts').insert({ code: CI_CONTROL_CODE, name: 'Payable – Class Instructors', type: 'liability', subtype: 'payable', is_system: false })
      .select('id, code, name').single()
    if (c.error) throw c.error
    control = c.data
  }
  const used = await sb.from('accounts').select('code').like('code', '25%')
  const nums = (used.data || []).map(function (a) { return Number(a.code) }).filter(function (n) { return n > 2500 && n < 2600 })
  const next = String(nums.length ? Math.max.apply(null, nums) + 1 : 2501)
  const a = await sb.from('accounts').insert({
    code: next, name: 'CI – ' + instructor.full_name, type: 'liability', subtype: 'ci_payable',
    parent_id: control.id, description: 'ci:' + instructor.id, is_system: false,
  }).select('id, code, name').single()
  if (a.error) throw a.error
  return a.data
}

async function postEntry(o) {
  const no = await sb.rpc('next_journal_no')
  if (no.error) throw no.error
  const je = await sb.from('journal_entries').insert({
    entry_no: no.data, date: o.date, fiscal_year_id: await fiscalYearId(), description: o.description,
    source: o.source, source_ref_type: o.refType || null, source_ref_id: o.refId || null, created_by: o.userId || null,
  }).select('id, entry_no').single()
  if (je.error) throw je.error
  // both columns on every line: a bulk insert sends a missing column as null, not its default 0
  const jl = await sb.from('journal_lines').insert(o.lines.map(function (l) {
    return { journal_entry_id: je.data.id, account_id: l.accountId, debit: l.debit || 0, credit: l.credit || 0, description: o.description }
  }))
  if (jl.error) {
    await sb.from('journal_entries').delete().eq('id', je.data.id)   // never leave an empty entry behind
    throw jl.error
  }
  return je.data
}

// Month's payroll → Dr Staff Salaries / Cr the CI. Also writes the salary expense row so
// it shows in Expenses and the P&L. Returns the ids to store on the payroll run.
export async function postPayrollAccrual(o) {
  const salary = await accountByCode(SALARY_CODE)
  if (!salary) throw new Error('Ledger 6001 Staff Salaries is missing')
  const ci = await ensureCiAccount(o.instructor)
  const desc = 'CI payroll — ' + o.instructor.full_name + ' — ' + o.monthLabel
  const je = await postEntry({
    date: o.date, description: 'Expense: ' + desc, source: 'expense', refType: 'ci_payroll', refId: o.runId, userId: o.userId,
    lines: [{ accountId: salary.id, debit: o.amount }, { accountId: ci.id, credit: o.amount }],
  })
  const ex = await sb.from('expenses').insert({
    date: o.date, category: 'salary', description: desc, vendor_name: o.instructor.full_name,
    amount: o.amount, gst_amount: 0, total_amount: o.amount, expense_account_id: salary.id,
    is_recurring: false, journal_entry_id: je.id, created_by: o.userId || null,
  }).select('id').single()
  if (ex.error) {
    await sb.from('journal_lines').delete().eq('journal_entry_id', je.id)
    await sb.from('journal_entries').delete().eq('id', je.id)
    throw ex.error
  }
  return { journalId: je.id, entryNo: je.entry_no, expenseId: ex.data.id }
}

// Undo an unpaid posting: the entry is voided (kept on record), the salary expense removed.
export async function voidPayrollAccrual(run, reason, userId) {
  if (run.accrual_journal_id) {
    const v = await sb.from('journal_entries').update({ status: 'voided', voided_at: new Date().toISOString(), voided_by: userId || null, void_reason: reason || 'Payroll reopened' }).eq('id', run.accrual_journal_id)
    if (v.error) throw v.error
  }
  if (run.expense_id) {
    const d = await sb.from('expenses').delete().eq('id', run.expense_id)
    if (d.error) throw d.error
  }
}

// Bank payment to a CI → Dr the CI's account / Cr the bank. Marks the settled runs paid.
//   o: { instructor, amount, date, mode, ref, bankAccountId, runs:[{id,month,total}], userId }
export async function recordCiPayment(o) {
  const bank = await sb.from('bank_accounts').select('account_id, name').eq('id', o.bankAccountId).single()
  if (bank.error || !bank.data || !bank.data.account_id) throw new Error('That bank account has no ledger account linked in Accounting')
  const ci = await ensureCiAccount(o.instructor)
  const desc = 'Bank payment — ' + o.instructor.full_name + (o.ref ? ' — ' + o.ref : '')
  const je = await postEntry({
    date: o.date, description: desc, source: 'bank', refType: 'ci_payment', refId: o.instructor.id, userId: o.userId,
    lines: [{ accountId: ci.id, debit: o.amount }, { accountId: bank.data.account_id, credit: o.amount }],
  })
  const alloc = allocatePayment(o.runs, o.amount)
  for (const id of alloc.settled) {
    const run = (o.runs || []).find(function (r) { return r.id === id })
    const u = await sb.from('ci_payroll_runs').update({
      status: 'paid', paid_on: o.date, paid_amount: run.total, paid_mode: o.mode || null, paid_ref: o.ref || null,
      bank_account_id: o.bankAccountId, payment_journal_id: je.id, updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (u.error) throw u.error
  }
  return { journalId: je.id, entryNo: je.entry_no, settled: alloc.settled, leftover: alloc.leftover }
}
