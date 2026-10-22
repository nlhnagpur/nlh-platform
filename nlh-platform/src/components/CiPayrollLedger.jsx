import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { fmtDate } from '../utils'
import { monthLabel } from '../utils/ciPayrollRun'
import CiBankPaymentDialog from './CiBankPaymentDialog'

function rupees(n) {
  const v = Math.round(Number(n) || 0)
  return (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN')
}

const STATE = {
  none:   { label: 'Not prepared', color: 'var(--text3)' },
  draft:  { label: 'Saved, not posted', color: '#92400E' },
  posted: { label: 'Posted, unpaid', color: '#1D4ED8' },
  paid:   { label: 'Paid', color: 'var(--green)' },
}

// HO Accounting → CI Payroll: what each CI is owed for a month, whether it is posted to the
// books and paid, and each CI's account across months.
export default function CiPayrollLedger() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statementFor, setStatementFor] = useState(null)
  const [payFor, setPayFor] = useState(null)
  const [reload, setReload] = useState(0)

  useEffect(function () {
    let cancelled = false
    setLoading(true); setError('')
    ;(async function () {
      const [runs, ins] = await Promise.all([
        sb.from('ci_payroll_runs').select('*').eq('month', month),
        sb.from('instructors').select('id, full_name, status, left_at, joined_at').order('full_name'),
      ])
      if (cancelled) return
      if (runs.error) { setError(runs.error.message); setRows([]); setLoading(false); return }
      const runBy = {}
      ;(runs.data || []).forEach(function (r) { runBy[r.instructor_id] = r })
      const monthEnd = month + '-31'
      const list = (ins.data || []).filter(function (i) {
        if (runBy[i.id]) return true
        if (i.joined_at && String(i.joined_at).slice(0, 7) > month) return false
        return i.status === 'active' || (i.left_at && String(i.left_at).slice(0, 7) >= month && String(i.left_at) <= monthEnd + 'z')
      }).map(function (i) { return { ins: i, run: runBy[i.id] || null } })
      setRows(list); setLoading(false)
    })()
    return function () { cancelled = true }
  }, [month, reload])

  const stateOf = function (r) { return r.run ? r.run.status : 'none' }
  const sum = function (st, f) { return rows.filter(function (r) { return stateOf(r) === st }).reduce(function (t, r) { return t + f(r.run) }, 0) }
  const posted = sum('posted', function (x) { return x.total }) + sum('paid', function (x) { return x.total })
  const paid = sum('paid', function (x) { return x.paid_amount })
  const owed = sum('posted', function (x) { return x.total })
  const notPosted = rows.filter(function (r) { return stateOf(r) === 'none' || stateOf(r) === 'draft' }).length

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>Month{' '}
          <input type="month" value={month} onChange={function (e) { setMonth(e.target.value) }} style={{ marginLeft: 6, fontSize: 13 }} />
        </label>
        <span className="hint" style={{ margin: 0 }}>Prepare and post payroll under Instructors → CI → Payroll; pay it from here or from Bank Payments.</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[['Posted to books', rupees(posted), 'var(--text)'], ['Paid', rupees(paid), 'var(--green)'], ['Owed to CIs', rupees(owed), '#1D4ED8'], ['Not yet posted', String(notPosted) + ' CI' + (notPosted !== 1 ? 's' : ''), 'var(--text3)']].map(function (c) {
          return (
            <div key={c[0]} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', background: 'var(--card, #fff)' }}>
              <div style={{ font: '600 10px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{c[0]}</div>
              <div style={{ font: '700 20px var(--font)', color: c[2], marginTop: 4 }}>{c[1]}</div>
            </div>
          )
        })}
      </div>

      {error && <div className="hint" style={{ color: 'var(--red)' }}>Could not load CI payroll: {error}</div>}
      {loading ? <div className="loading">Loading…</div> : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflowX: 'auto', background: 'var(--card, #fff)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg3)', textAlign: 'left', font: '600 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase' }}>
                <th style={{ padding: '8px 14px' }}>CI</th><th style={{ padding: '8px 14px', textAlign: 'right' }}>Payroll</th>
                <th style={{ padding: '8px 14px' }}>Status</th><th style={{ padding: '8px 14px' }}>Paid on</th><th style={{ padding: '8px 14px' }}>How</th>
                <th style={{ padding: '8px 14px' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} style={{ padding: 18, textAlign: 'center', color: 'var(--text3)' }}>No CIs for this month.</td></tr>}
              {rows.map(function (r) {
                const st = STATE[stateOf(r)]
                return (
                  <tr key={r.ins.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 14px', font: '600 13px var(--font)' }}>{r.ins.full_name}{r.ins.status !== 'active' && <span style={{ font: '500 10px var(--font)', color: 'var(--text3)', marginLeft: 6 }}>{r.ins.status}</span>}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', font: '700 13px var(--mono)' }}>{r.run ? rupees(r.run.total) : '—'}</td>
                    <td style={{ padding: '8px 14px', color: st.color, font: '600 12px var(--font)' }}>● {st.label}</td>
                    <td style={{ padding: '8px 14px' }}>{r.run && r.run.paid_on ? fmtDate(r.run.paid_on) : '—'}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--text2)' }}>{r.run && r.run.status === 'paid' ? ((r.run.paid_mode || '').replace('_', ' ') + (r.run.paid_ref ? ' · ' + r.run.paid_ref : '')) : ''}</td>
                    <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                      {r.run && r.run.status === 'posted' && <button className="btn-p" style={{ fontSize: 11, marginRight: 6 }} onClick={function () { setPayFor(r.ins) }}>Pay</button>}
                      <button className="btn" style={{ fontSize: 11 }} onClick={function () { setStatementFor(r.ins) }}>Account</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {statementFor && <Statement ins={statementFor} onClose={function () { setStatementFor(null) }} />}
      {payFor && <CiBankPaymentDialog instructor={payFor} onClose={function () { setPayFor(null) }} onDone={function () { setPayFor(null); setReload(function (n) { return n + 1 }) }} />}
    </div>
  )
}

// The CI's own account: payroll posted (credit) and bank payments (debit), with the running balance owed.
function Statement({ ins, onClose }) {
  const [data, setData] = useState(null)
  useEffect(function () {
    let cancelled = false
    ;(async function () {
      const acc = await sb.from('accounts').select('id, code, name').eq('description', 'ci:' + ins.id).maybeSingle()
      const runs = await sb.from('ci_payroll_runs').select('month, total, status').eq('instructor_id', ins.id).order('month')
      let lines = []
      if (acc.data) {
        const l = await sb.from('journal_lines').select('debit, credit, description, journal_entries(entry_no, date, status)').eq('account_id', acc.data.id)
        lines = (l.data || []).filter(function (x) { return x.journal_entries && x.journal_entries.status !== 'voided' })
          .sort(function (a, b) { return String(a.journal_entries.date).localeCompare(String(b.journal_entries.date)) || String(a.journal_entries.entry_no).localeCompare(String(b.journal_entries.entry_no)) })
      }
      if (!cancelled) setData({ account: acc.data, runs: runs.data || [], lines: lines })
    })()
    return function () { cancelled = true }
  }, [ins.id])

  let bal = 0
  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 680 }}>
        <div style={{ padding: '16px 20px 4px' }}>
          <div style={{ font: '700 16px var(--font)' }}>{ins.full_name} — account</div>
          <div style={{ font: '500 12px var(--font)', color: 'var(--text3)', marginTop: 4 }}>{data && data.account ? data.account.code + ' · ' + data.account.name : 'No postings yet'}</div>
        </div>
        <div style={{ padding: '8px 20px 4px', overflowX: 'auto' }}>
          {!data ? <div className="loading">Loading…</div> : data.lines.length === 0 ? (
            <div className="hint">Nothing has been posted to this CI’s account yet.{data.runs.length ? ' Saved payroll: ' + data.runs.map(function (r) { return monthLabel(r.month) + ' ' + rupees(r.total) }).join(', ') + '.' : ''}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', font: '600 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase' }}>
                <th style={{ padding: '6px 8px' }}>Date</th><th style={{ padding: '6px 8px' }}>Entry</th><th style={{ padding: '6px 8px' }}>Particulars</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Debit (paid)</th><th style={{ padding: '6px 8px', textAlign: 'right' }}>Credit (owed)</th><th style={{ padding: '6px 8px', textAlign: 'right' }}>Balance owed</th>
              </tr></thead>
              <tbody>
                {data.lines.map(function (l, i) {
                  bal += (l.credit || 0) - (l.debit || 0)
                  return (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px' }}>{fmtDate(l.journal_entries.date)}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', fontSize: 12 }}>{l.journal_entries.entry_no}</td>
                      <td style={{ padding: '6px 8px' }}>{String(l.description || '').replace(/^Expense: /, '')}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{l.debit ? rupees(l.debit) : ''}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{l.credit ? rupees(l.credit) : ''}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700 }}>{rupees(bal)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="modal-actions"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}
