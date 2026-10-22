import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { showToast } from '../utils'
import { monthLabel, sumLines, allocatePayment } from '../utils/ciPayrollRun'
import { recordCiPayment } from '../utils/ciAccounting'

const PAY_MODES = [['bank_transfer', 'Bank transfer'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['cash', 'Cash']]

function rupees(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN') }

// A bank payment to a CI (Accounting → Bank Payments): Dr the CI's account / Cr the bank.
// Posted payroll months still unpaid are offered to be settled by it.
//   instructor: a fixed CI (from a payroll row), or leave out to choose one
export default function CiBankPaymentDialog({ instructor, onClose, onDone }) {
  const { currentUser } = useAuth()
  const [cis, setCis] = useState([])
  const [ciId, setCiId] = useState(instructor ? instructor.id : '')
  const [banks, setBanks] = useState([])
  const [runs, setRuns] = useState([])
  const [picked, setPicked] = useState({})
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), bankAccountId: '', mode: 'bank_transfer', ref: '', amount: '' })
  const [amountTouched, setAmountTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(function () {
    sb.from('bank_accounts').select('id, name, is_active').order('name').then(function (r) {
      const list = (r.data || []).filter(function (b) { return b.is_active !== false })
      setBanks(list)
      if (list.length === 1) setForm(function (f) { return { ...f, bankAccountId: list[0].id } })
    })
    if (!instructor) sb.from('instructors').select('id, full_name, status').order('full_name').then(function (r) { setCis(r.data || []) })
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(function () {
    if (!ciId) { setRuns([]); return }
    sb.from('ci_payroll_runs').select('id, month, total, status').eq('instructor_id', ciId).eq('status', 'posted').order('month').then(function (r) {
      const list = r.data || []
      setRuns(list)
      const all = {}
      list.forEach(function (x) { all[x.id] = true })
      setPicked(all)
    })
  }, [ciId])

  const chosen = runs.filter(function (r) { return picked[r.id] })
  const chosenTotal = chosen.reduce(function (t, r) { return t + r.total }, 0)
  useEffect(function () { if (!amountTouched) setForm(function (f) { return { ...f, amount: chosenTotal ? String(chosenTotal) : '' } }) }, [chosenTotal, amountTouched])

  function set(k, v) { setForm(function (f) { return { ...f, [k]: v } }) }
  const who = instructor || cis.find(function (c) { return c.id === ciId })
  const amount = Math.round(Number(form.amount))
  const alloc = allocatePayment(chosen, amount)

  async function go() {
    if (!who) { showToast('Choose the CI', 'warn'); return }
    if (!isFinite(amount) || amount <= 0) { showToast('Enter the amount paid', 'warn'); return }
    if (!form.bankAccountId) { showToast('Choose the bank account', 'warn'); return }
    if (!form.date) { showToast('Enter the date paid', 'warn'); return }
    setBusy(true)
    try {
      const res = await recordCiPayment({
        instructor: who, amount: amount, date: form.date, mode: form.mode, ref: form.ref.trim(), bankAccountId: form.bankAccountId,
        runs: chosen.map(function (r) { return { id: r.id, month: r.month, total: r.total } }), userId: currentUser && currentUser.id,
      })
      showToast('Bank payment ' + res.entryNo + ' recorded ✓')
      onDone && onDone(res)
    } catch (e) { showToast('Failed: ' + e.message, 'err') }
    setBusy(false)
  }

  const lbl = { font: '600 11px var(--font)', color: 'var(--text2)' }
  const fld = { display: 'block', marginTop: 4, width: '100%' }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div style={{ padding: '16px 20px 4px' }}>
          <div style={{ font: '700 16px var(--font)' }}>Bank payment to CI</div>
          <div style={{ font: '500 12px var(--font)', color: 'var(--text3)', marginTop: 4 }}>Debits the CI’s account, credits the bank.</div>
        </div>
        <div style={{ padding: '10px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {instructor
            ? <div style={{ font: '700 14px var(--font)' }}>{instructor.full_name}</div>
            : (
              <label style={lbl}>Pay to (CI)
                <select value={ciId} onChange={function (e) { setCiId(e.target.value); setAmountTouched(false) }} style={fld}>
                  <option value="">— Select —</option>
                  {cis.map(function (c) { return <option key={c.id} value={c.id}>{c.full_name}{c.status !== 'active' ? ' (' + c.status + ')' : ''}</option> })}
                </select>
              </label>
            )}

          {ciId && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '6px 12px', background: 'var(--bg3)', font: '600 10px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase' }}>Posted payroll awaiting payment</div>
              {runs.length === 0
                ? <div className="hint" style={{ padding: '8px 12px', margin: 0 }}>None. Post a month’s payroll from the CI’s Payroll tab first; a payment made now is held on the CI’s account.</div>
                : runs.map(function (r) {
                  return (
                    <label key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 12px', borderTop: '1px solid var(--border)', font: '500 13px var(--font)' }}>
                      <input type="checkbox" checked={!!picked[r.id]} onChange={function (e) { setPicked(function (p) { return { ...p, [r.id]: e.target.checked } }); setAmountTouched(false) }} />
                      <span style={{ flex: 1 }}>{monthLabel(r.month)}</span>
                      <b>{rupees(r.total)}</b>
                    </label>
                  )
                })}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lbl}>Date paid
              <input type="date" value={form.date} onChange={function (e) { set('date', e.target.value) }} style={fld} />
            </label>
            <label style={lbl}>Amount (₹)
              <input type="number" value={form.amount} onChange={function (e) { setAmountTouched(true); set('amount', e.target.value) }} style={{ ...fld, fontWeight: 700 }} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lbl}>Paid from bank account
              <select value={form.bankAccountId} onChange={function (e) { set('bankAccountId', e.target.value) }} style={fld}>
                <option value="">— Select —</option>
                {banks.map(function (b) { return <option key={b.id} value={b.id}>{b.name}</option> })}
              </select>
            </label>
            <label style={lbl}>Paid by
              <select value={form.mode} onChange={function (e) { set('mode', e.target.value) }} style={fld}>
                {PAY_MODES.map(function (m) { return <option key={m[0]} value={m[0]}>{m[1]}</option> })}
              </select>
            </label>
          </div>
          <label style={lbl}>UTR / cheque no. / reference
            <input value={form.ref} onChange={function (e) { set('ref', e.target.value) }} placeholder="Optional" style={fld} />
          </label>

          {chosen.length > 0 && amount > 0 && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg2)', font: '500 12px var(--font)', color: 'var(--text2)' }}>
              Settles {alloc.settled.length ? alloc.settled.map(function (id) { return monthLabel(chosen.find(function (r) { return r.id === id }).month) }).join(', ') : 'no month in full'}
              {alloc.leftover > 0 ? ' · ' + rupees(alloc.leftover) + ' stays on the CI’s account as a part payment' : ''}.
            </div>
          )}
          <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>
            Entry: Dr {who ? 'CI – ' + who.full_name : 'CI account'} {rupees(amount)} · Cr bank {rupees(amount)}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-p" onClick={go} disabled={busy}>{busy ? 'Posting…' : 'Record bank payment'}</button>
        </div>
      </div>
    </div>
  )
}
