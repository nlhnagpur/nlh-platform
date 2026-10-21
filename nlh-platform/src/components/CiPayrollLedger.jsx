import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { fmtDate } from '../utils'
import { monthLabel } from '../utils/ciPayrollRun'

function rupees(n) {
  const v = Math.round(Number(n) || 0)
  return (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN')
}

// HO Accounting → CI Payroll: what each CI is paid for a month, whether it has
// been paid, and each CI's statement across months.
export default function CiPayrollLedger() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statementFor, setStatementFor] = useState(null)

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
  }, [month])

  const payable = rows.reduce(function (t, r) { return t + (r.run ? r.run.total : 0) }, 0)
  const paid = rows.reduce(function (t, r) { return t + (r.run && r.run.status === 'paid' ? r.run.paid_amount : 0) }, 0)
  const unpaid = rows.reduce(function (t, r) { return t + (r.run && r.run.status !== 'paid' ? r.run.total : 0) }, 0)
  const notReady = rows.filter(function (r) { return !r.run }).length

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>Month{' '}
          <input type="month" value={month} onChange={function (e) { setMonth(e.target.value) }} style={{ marginLeft: 6, fontSize: 13 }} />
        </label>
        <span className="hint" style={{ margin: 0 }}>Prepare and mark payments under Instructors → CI → Payroll.</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[['Payable', rupees(payable), 'var(--text)'], ['Paid', rupees(paid), 'var(--green)'], ['Saved, unpaid', rupees(unpaid), '#92400E'], ['Not prepared', String(notReady) + ' CI' + (notReady !== 1 ? 's' : ''), 'var(--text3)']].map(function (c) {
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
                <th style={{ padding: '8px 14px' }}>CI</th><th style={{ padding: '8px 14px', textAlign: 'right' }}>Payable</th>
                <th style={{ padding: '8px 14px' }}>Status</th><th style={{ padding: '8px 14px' }}>Paid on</th><th style={{ padding: '8px 14px' }}>How</th>
                <th style={{ padding: '8px 14px' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} style={{ padding: 18, textAlign: 'center', color: 'var(--text3)' }}>No CIs for this month.</td></tr>}
              {rows.map(function (r) {
                const st = !r.run ? 'Not prepared' : r.run.status === 'paid' ? 'Paid' : 'Saved, unpaid'
                const col = !r.run ? 'var(--text3)' : r.run.status === 'paid' ? 'var(--green)' : '#92400E'
                return (
                  <tr key={r.ins.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 14px', font: '600 13px var(--font)' }}>{r.ins.full_name}{r.ins.status !== 'active' && <span style={{ font: '500 10px var(--font)', color: 'var(--text3)', marginLeft: 6 }}>{r.ins.status}</span>}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', font: '700 13px var(--mono)' }}>{r.run ? rupees(r.run.total) : '—'}</td>
                    <td style={{ padding: '8px 14px', color: col, font: '600 12px var(--font)' }}>● {st}</td>
                    <td style={{ padding: '8px 14px' }}>{r.run && r.run.paid_on ? fmtDate(r.run.paid_on) : '—'}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--text2)' }}>{r.run && r.run.status === 'paid' ? ((r.run.paid_mode || '').replace('_', ' ') + (r.run.paid_ref ? ' · ' + r.run.paid_ref : '') + (r.run.expense_id ? ' · in books' : '')) : ''}</td>
                    <td style={{ padding: '8px 14px' }}><button className="btn" style={{ fontSize: 11 }} onClick={function () { setStatementFor(r.ins) }}>Statement</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {statementFor && <Statement ins={statementFor} onClose={function () { setStatementFor(null) }} />}
    </div>
  )
}

function Statement({ ins, onClose }) {
  const [runs, setRuns] = useState(null)
  useEffect(function () {
    sb.from('ci_payroll_runs').select('*').eq('instructor_id', ins.id).order('month', { ascending: false }).then(function (r) { setRuns(r.data || []) })
  }, [ins.id])
  const payable = (runs || []).reduce(function (t, r) { return t + r.total }, 0)
  const paid = (runs || []).reduce(function (t, r) { return t + (r.status === 'paid' ? r.paid_amount : 0) }, 0)
  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div style={{ padding: '16px 20px 4px' }}>
          <div style={{ font: '700 16px var(--font)' }}>{ins.full_name} — payroll statement</div>
        </div>
        <div style={{ padding: '8px 20px 4px', overflowX: 'auto' }}>
          {!runs ? <div className="loading">Loading…</div> : runs.length === 0 ? <div className="hint">No payroll saved yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', font: '600 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase' }}>
                <th style={{ padding: '6px 8px' }}>Month</th><th style={{ padding: '6px 8px', textAlign: 'right' }}>Payable</th><th style={{ padding: '6px 8px', textAlign: 'right' }}>Paid</th><th style={{ padding: '6px 8px' }}>Paid on</th><th style={{ padding: '6px 8px' }}>Ref</th>
              </tr></thead>
              <tbody>
                {runs.map(function (r) {
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px', font: '600 13px var(--font)' }}>{monthLabel(r.month)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{rupees(r.total)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--mono)', color: r.status === 'paid' ? 'var(--green)' : '#92400E' }}>{r.status === 'paid' ? rupees(r.paid_amount) : 'unpaid'}</td>
                      <td style={{ padding: '6px 8px' }}>{r.paid_on ? fmtDate(r.paid_on) : '—'}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--text2)' }}>{r.paid_ref || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot><tr style={{ borderTop: '2px solid var(--border)', font: '700 13px var(--font)' }}>
                <td style={{ padding: '8px' }}>Total</td><td style={{ padding: '8px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{rupees(payable)}</td><td style={{ padding: '8px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{rupees(paid)}</td><td colSpan={2}></td>
              </tr></tfoot>
            </table>
          )}
        </div>
        <div className="modal-actions"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}
