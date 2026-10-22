import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtDate, showToast } from '../utils'
import { cleanLines, sumLines, linesFromCalc, lineEdited, monthLabel } from '../utils/ciPayrollRun'
import { countInRange, amountForClasses, nextCycleStart } from '../utils/ciPayroll'
import { printCiPaymentSheet } from './ciPaymentSheet'

const PAY_MODES = [['bank_transfer', 'Bank transfer'], ['upi', 'UPI'], ['cash', 'Cash'], ['cheque', 'Cheque']]

function rupees(n) {
  const v = Math.round(Number(n) || 0)
  return (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN')
}

// Records the payment as an expense in HO Accounting: Dr expense ledger, Cr bank.
// Same posting the Accounting page's own "Add expense" uses.
async function postPayrollExpense(o) {
  const fy = await sb.from('fiscal_years').select('id').eq('is_current', true).single()
  let journalId = null
  if (fy.data && o.expenseAccountId && o.bankAccountId) {
    const bank = await sb.from('bank_accounts').select('account_id').eq('id', o.bankAccountId).single()
    if (bank.data && bank.data.account_id) {
      const no = await sb.rpc('next_journal_no')
      const je = await sb.from('journal_entries').insert({
        entry_no: no.data, date: o.date, fiscal_year_id: fy.data.id,
        description: 'Expense: ' + o.description, source: 'expense', source_ref_type: 'expense', created_by: o.userId,
      }).select('id').single()
      if (je.error) throw je.error
      journalId = je.data.id
      const jl = await sb.from('journal_lines').insert([
        { journal_entry_id: journalId, account_id: o.expenseAccountId, debit: o.amount, description: o.description },
        { journal_entry_id: journalId, account_id: bank.data.account_id, credit: o.amount, description: o.description },
      ])
      if (jl.error) throw jl.error
    }
  }
  const ex = await sb.from('expenses').insert({
    date: o.date, category: 'salary', description: o.description, vendor_name: o.vendorName || null,
    amount: o.amount, gst_amount: 0, total_amount: o.amount,
    payment_mode: o.mode || null, payment_ref: o.ref || null,
    bank_account_id: o.bankAccountId || null, expense_account_id: o.expenseAccountId || null,
    is_recurring: false, journal_entry_id: journalId, created_by: o.userId,
  }).select('id').single()
  if (ex.error) throw ex.error
  return ex.data.id
}

// The month's payroll for one CI: every line's amount can be edited (or added),
// saved as the month's payroll, and then marked paid.
//   calcLines: [{ key, label, amount }] — what the system calculated
//   run:       the saved ci_payroll_runs row for this CI + month, or null
export default function CiPayrollRun({ instructor, month, calcLines, run, canEdit, onChanged, datesBySid }) {
  const { currentUser } = useAuth()
  const calcSig = JSON.stringify(calcLines || [])
  const [lines, setLines] = useState([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  useEffect(function () {
    setLines(run && Array.isArray(run.lines) && run.lines.length ? run.lines.map(function (l) { return { ...l } }) : linesFromCalc(calcLines))
    setNotes((run && run.notes) || '')
  }, [month, run && run.id, run && run.updated_at, calcSig])   // eslint-disable-line react-hooks/exhaustive-deps

  const paid = !!run && run.status === 'paid'
  const editable = canEdit && !paid
  const total = sumLines(lines)
  const calcTotal = sumLines(linesFromCalc(calcLines))
  const savedTotal = run ? run.total : null
  const dirty = !run || savedTotal !== total || JSON.stringify(cleanLines(lines)) !== JSON.stringify(cleanLines(run.lines || [])) || (run.notes || '') !== notes

  function setAmount(i, v) { setLines(function (ls) { return ls.map(function (l, j) { return j === i ? { ...l, amount: v === '' ? '' : Number(v) } : l }) }) }
  function setLabel(i, v) { setLines(function (ls) { return ls.map(function (l, j) { return j === i ? { ...l, label: v } : l }) }) }
  function addLine() { setLines(function (ls) { return ls.concat([{ key: 'add' + Date.now(), label: '', calc: null, amount: 0, added: true }]) }) }
  function removeLine(i) { setLines(function (ls) { return ls.filter(function (_, j) { return j !== i }) }) }
  function resetToCalc() { setLines(linesFromCalc(calcLines)) }

  // Change the dates a student's line covers: the classes taught in that range are
  // counted again and the amount follows (full rate for a whole cycle, pro-rata
  // otherwise); the amount can still be typed over afterwards.
  function setRange(i, from, to) {
    setLines(function (ls) {
      return ls.map(function (l, j) {
        if (j !== i || !l.meta) return l
        const count = countInRange((datesBySid || {})[l.meta.sid] || [], from, to)
        return { ...l, meta: { ...l.meta, from: from, to: to, count: count }, amount: amountForClasses(l.meta.rate, count, l.meta.perCycle) }
      })
    })
  }

  function onPrint() {
    const clean = cleanLines(lines)
    const rows = []
    const others = []
    clean.forEach(function (l) {
      if (l.meta && l.meta.sid) {
        const all = (datesBySid || {})[l.meta.sid] || []
        const dates = all.filter(function (d) { return d >= l.meta.from && d <= l.meta.to })
        rows.push({ name: l.label, course: l.meta.course || '', blocks: [{ dates: dates, count: l.meta.count, perCycle: l.meta.perCycle, amount: l.amount, partial: l.meta.count < l.meta.perCycle }] })
      } else others.push({ label: l.label, amount: l.amount })
    })
    printCiPaymentSheet({ ciName: instructor.full_name, monthLabel: monthLabel(month), date: (run && run.paid_on) || new Date(), rows: rows, otherLines: others })
  }

  async function saveRun(extra) {
    const clean = cleanLines(lines)
    const row = {
      instructor_id: instructor.id, month: month, lines: clean, calculated_total: calcTotal, total: sumLines(clean),
      notes: notes.trim() || null, status: 'draft', updated_at: new Date().toISOString(),
    }
    if (extra) Object.assign(row, extra)
    const res = await sb.from('ci_payroll_runs').upsert(row, { onConflict: 'instructor_id,month' }).select('*').single()
    if (res.error) throw res.error
    return res.data
  }

  async function onSave() {
    if (total < 0) { showToast('The total cannot be negative', 'warn'); return }
    setSaving(true)
    try {
      const saved = await saveRun()
      showToast('Payroll saved for ' + monthLabel(month) + ' ✓')
      onChanged && onChanged(saved)
    } catch (e) { showToast('Save failed: ' + e.message, 'err') }
    setSaving(false)
  }

  async function reopen() {
    if (run && run.expense_id) { showToast('This payment is already posted to Accounting — it can’t be reopened here.', 'warn'); return }
    setSaving(true)
    const res = await sb.from('ci_payroll_runs').update({ status: 'draft', paid_on: null, paid_amount: null, paid_mode: null, paid_ref: null, bank_account_id: null, updated_at: new Date().toISOString() }).eq('id', run.id).select('*').single()
    setSaving(false)
    if (res.error) { showToast('Failed: ' + res.error.message, 'err'); return }
    onChanged && onChanged(res.data)
  }

  const headerStyle = { padding: '8px 14px', background: 'var(--bg3)', font: '600 11px var(--font)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginTop: 4 }}>
      <div style={headerStyle}>
        <span>Payment for {monthLabel(month)}</span>
        <span style={{ textTransform: 'none', letterSpacing: 0 }}>
          {paid ? <span style={{ color: 'var(--green)' }}>● Paid</span> : run ? <span style={{ color: '#92400e' }}>● Saved, not paid</span> : <span>Not saved yet — amounts below are the calculation</span>}
        </span>
      </div>

      {lines.map(function (l, i) {
        return (
          <div key={l.key + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editable && l.added
                ? <input value={l.label} placeholder="What is this for?" onChange={function (e) { setLabel(i, e.target.value) }} style={{ width: '100%', fontSize: 13 }} />
                : <div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>{l.label}</div>}
              {l.meta && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4, font: '500 11px var(--font)', color: 'var(--text3)' }}>
                  {editable
                    ? <>
                        <input type="date" value={l.meta.from} onChange={function (e) { setRange(i, e.target.value, l.meta.to) }} style={{ fontSize: 11 }} />
                        <span>to</span>
                        <input type="date" value={l.meta.to} onChange={function (e) { setRange(i, l.meta.from, e.target.value) }} style={{ fontSize: 11 }} />
                      </>
                    : <span>{fmtDate(l.meta.from)} to {fmtDate(l.meta.to)}</span>}
                  <span style={{ color: 'var(--text2)', fontWeight: 600 }}>· {l.meta.count} of {l.meta.perCycle} classes</span>
                </div>
              )}
              {lineEdited(l) && <div style={{ font: '500 10px var(--font)', color: '#92400e', marginTop: 2 }}>edited — calculated {rupees(l.calc)}{l.meta && l.meta.origFrom && (l.meta.from !== l.meta.origFrom || l.meta.to !== l.meta.origTo) ? ' for ' + fmtDate(l.meta.origFrom) + ' to ' + fmtDate(l.meta.origTo) : ''}</div>}
            </div>
            {editable
              ? <input type="number" value={l.amount} onChange={function (e) { setAmount(i, e.target.value) }}
                  style={{ width: 110, textAlign: 'right', fontSize: 14, fontWeight: 700, background: lineEdited(l) ? '#FFFBEB' : undefined }} />
              : <div style={{ font: '700 14px var(--font)', color: 'var(--text)' }}>{rupees(l.amount)}</div>}
            {editable && l.added && <button className="btn" style={{ fontSize: 10, padding: '2px 7px', color: 'var(--red)' }} onClick={function () { removeLine(i) }}>✕</button>}
          </div>
        )
      })}
      {lines.length === 0 && <div className="hint" style={{ padding: '12px 14px' }}>Nothing calculated for this month. Add a line to record a payment.</div>}

      {editable && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 14px', borderTop: '1px solid var(--border)', background: 'var(--bg2)' }}>
          <button className="btn" style={{ fontSize: 11 }} onClick={addLine}>+ Add line</button>
          <button className="btn" style={{ fontSize: 11 }} onClick={resetToCalc}>↺ Reset to calculated</button>
          <button className="btn" style={{ fontSize: 11 }} onClick={onPrint}>🖨 Payment sheet</button>
          <input value={notes} onChange={function (e) { setNotes(e.target.value) }} placeholder="Note for this month (optional)" style={{ flex: 1, minWidth: 160, fontSize: 12 }} />
        </div>
      )}
      {paid && run.notes && <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', font: '500 12px var(--font)', color: 'var(--text3)' }}>{run.notes}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: paid ? 'var(--green)' : 'var(--purple)', color: '#fff' }}>
        <span style={{ font: '700 14px var(--font)' }}>{paid ? 'Paid' : 'Payable'} — {monthLabel(month)}</span>
        <span style={{ font: '700 20px var(--font)' }}>{rupees(paid ? run.paid_amount : total)}</span>
      </div>
      {(function () {
        const ends = lines.filter(function (l) { return l.meta && l.meta.to }).map(function (l) { return l.meta.to }).sort()
        if (!ends.length) return null
        const last = ends[ends.length - 1]
        return (
          <div style={{ padding: '6px 16px', font: '500 11px var(--font)', color: 'var(--text2)', background: 'var(--bg2)' }}>
            {instructor.full_name} is paid up to <b>{fmtDate(last)}</b>. Next pay starts <b>{fmtDate(nextCycleStart(last))}</b>
            {' '}(the 1st of the next month if paid to the 30th/31st, otherwise the next day).
          </div>
        )
      })()}
      {total !== calcTotal && !paid && (
        <div style={{ padding: '6px 16px', font: '500 11px var(--font)', color: '#92400e', background: '#FFFBEB' }}>
          Differs from the calculated {rupees(calcTotal)} by {rupees(total - calcTotal)}.
        </div>
      )}

      {paid ? (
        <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, background: '#f0fdf4' }}>
          <div style={{ font: '500 12px var(--font)', color: 'var(--text2)' }}>
            Paid on <b>{fmtDate(run.paid_on)}</b>{run.paid_mode ? ' by ' + run.paid_mode.replace('_', ' ') : ''}{run.paid_ref ? ' · Ref ' + run.paid_ref : ''}
            {run.expense_id ? ' · posted to Accounting' : ' · not posted to Accounting'}
            {run.paid_amount !== run.total ? ' · payable was ' + rupees(run.total) : ''}
          </div>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ fontSize: 11 }} onClick={onPrint}>🖨 Payment sheet</button>
            {canEdit && !run.expense_id && <button className="btn" style={{ fontSize: 11 }} disabled={saving} onClick={reopen}>Reopen</button>}
          </span>
        </div>
      ) : canEdit && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
          <button className="btn-p" style={{ fontSize: 12 }} disabled={saving || !dirty} onClick={onSave}>{saving ? 'Saving…' : 'Save payroll'}</button>
          <button className="btn" style={{ fontSize: 12, borderColor: 'var(--green)', color: 'var(--green)' }} disabled={saving} onClick={function () { setPayOpen(true) }}>Mark as paid…</button>
        </div>
      )}

      {payOpen && (
        <MarkPaidDialog instructor={instructor} month={month} total={total} userId={currentUser && currentUser.id}
          onClose={function () { setPayOpen(false) }}
          onConfirm={async function (p) {
            const clean = cleanLines(lines)
            let expenseId = null
            if (p.post) {
              expenseId = await postPayrollExpense({
                date: p.date, amount: p.amount, mode: p.mode, ref: p.ref, bankAccountId: p.bankAccountId, expenseAccountId: p.expenseAccountId,
                description: 'CI payroll — ' + instructor.full_name + ' — ' + monthLabel(month), vendorName: instructor.full_name, userId: currentUser && currentUser.id,
              })
            }
            const saved = await saveRun({
              status: 'paid', lines: clean, total: sumLines(clean), paid_on: p.date, paid_amount: p.amount, paid_mode: p.mode,
              paid_ref: p.ref || null, bank_account_id: p.bankAccountId || null, expense_id: expenseId,
            })
            showToast('Marked as paid ✓')
            setPayOpen(false)
            onChanged && onChanged(saved)
          }} />
      )}
    </div>
  )
}

function MarkPaidDialog({ instructor, month, total, onClose, onConfirm }) {
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), amount: String(total), mode: 'bank_transfer', ref: '', post: false, bankAccountId: '', expenseAccountId: '' })
  const [banks, setBanks] = useState([])
  const [accts, setAccts] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(function () {
    sb.from('bank_accounts').select('id, name').then(function (r) { setBanks(r.data || []) })
    sb.from('accounts').select('id, code, name, type').order('code').then(function (r) {
      const list = (r.data || []).filter(function (a) { return a.type === 'expense' })
      setAccts(list)
      const sal = list.find(function (a) { return a.code === '6001' })
      if (sal) setForm(function (f) { return { ...f, expenseAccountId: sal.id } })
    })
  }, [])

  function set(k, v) { setForm(function (f) { return { ...f, [k]: v } }) }

  async function go() {
    const amt = Math.round(Number(form.amount))
    if (!isFinite(amt) || amt < 0) { showToast('Enter the amount paid', 'warn'); return }
    if (!form.date) { showToast('Enter the date paid', 'warn'); return }
    if (form.post && (!form.bankAccountId || !form.expenseAccountId)) { showToast('Choose the bank account and ledger to post to Accounting', 'warn'); return }
    setBusy(true)
    try { await onConfirm({ date: form.date, amount: amt, mode: form.mode, ref: form.ref.trim(), post: form.post, bankAccountId: form.bankAccountId, expenseAccountId: form.expenseAccountId }) }
    catch (e) { showToast('Failed: ' + e.message, 'err') }
    setBusy(false)
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div style={{ padding: '16px 20px 4px' }}>
          <div style={{ font: '700 16px var(--font)' }}>Mark {monthLabel(month)} as paid</div>
          <div style={{ font: '500 12px var(--font)', color: 'var(--text3)', marginTop: 4 }}>{instructor.full_name}</div>
        </div>
        <div style={{ padding: '10px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ font: '600 11px var(--font)', color: 'var(--text2)' }}>Date paid
              <input type="date" value={form.date} onChange={function (e) { set('date', e.target.value) }} style={{ display: 'block', marginTop: 4, width: '100%' }} />
            </label>
            <label style={{ font: '600 11px var(--font)', color: 'var(--text2)' }}>Amount paid (₹)
              <input type="number" value={form.amount} onChange={function (e) { set('amount', e.target.value) }} style={{ display: 'block', marginTop: 4, width: '100%', fontWeight: 700 }} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ font: '600 11px var(--font)', color: 'var(--text2)' }}>Paid by
              <select value={form.mode} onChange={function (e) { set('mode', e.target.value) }} style={{ display: 'block', marginTop: 4, width: '100%' }}>
                {PAY_MODES.map(function (m) { return <option key={m[0]} value={m[0]}>{m[1]}</option> })}
              </select>
            </label>
            <label style={{ font: '600 11px var(--font)', color: 'var(--text2)' }}>UTR / reference
              <input value={form.ref} onChange={function (e) { set('ref', e.target.value) }} placeholder="Optional" style={{ display: 'block', marginTop: 4, width: '100%' }} />
            </label>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', font: '500 12px var(--font)' }}>
            <input type="checkbox" checked={form.post} onChange={function (e) { set('post', e.target.checked) }} />
            Also record in HO Accounting (expense + journal entry)
          </label>
          {form.post && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ font: '600 11px var(--font)', color: 'var(--text2)' }}>Paid from bank account
                <select value={form.bankAccountId} onChange={function (e) { set('bankAccountId', e.target.value) }} style={{ display: 'block', marginTop: 4, width: '100%' }}>
                  <option value="">— Select —</option>
                  {banks.map(function (b) { return <option key={b.id} value={b.id}>{b.name}</option> })}
                </select>
              </label>
              <label style={{ font: '600 11px var(--font)', color: 'var(--text2)' }}>Expense ledger
                <select value={form.expenseAccountId} onChange={function (e) { set('expenseAccountId', e.target.value) }} style={{ display: 'block', marginTop: 4, width: '100%' }}>
                  <option value="">— Select —</option>
                  {accts.map(function (a) { return <option key={a.id} value={a.id}>{a.code} – {a.name}</option> })}
                </select>
              </label>
            </div>
          )}
          <div className="hint" style={{ margin: 0 }}>Leave "record in Accounting" off if this payment is already in the books.</div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-p" onClick={go} disabled={busy}>{busy ? 'Saving…' : 'Mark as paid'}</button>
        </div>
      </div>
    </div>
  )
}
