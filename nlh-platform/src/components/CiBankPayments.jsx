import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { fmtDate } from '../utils'
import CiBankPaymentDialog from './CiBankPaymentDialog'

function rupees(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN') }

// HO Accounting → Bank Payments: payments to CIs. Each one is Dr the CI's account / Cr the bank.
export default function CiBankPayments() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(function () {
    let cancelled = false
    setLoading(true); setError('')
    sb.from('journal_entries')
      .select('id, entry_no, date, description, status, created_at, journal_lines(debit, credit, accounts(code, name))')
      .eq('source', 'bank').eq('source_ref_type', 'ci_payment').order('date', { ascending: false }).order('created_at', { ascending: false })
      .then(function (res) {
        if (cancelled) return
        if (res.error) { setError(res.error.message); setRows([]) } else setRows(res.data || [])
        setLoading(false)
      })
    return function () { cancelled = true }
  }, [reload])

  const live = rows.filter(function (r) { return r.status !== 'voided' })
  const total = live.reduce(function (t, r) { return t + (r.journal_lines || []).reduce(function (a, l) { return a + (l.debit || 0) }, 0) }, 0)

  return (
    <div>
      <div className="tb-r" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>{live.length} payment{live.length !== 1 ? 's' : ''} · {rupees(total)} paid to CIs</div>
        <button className="btn btn-primary btn-s" onClick={function () { setOpen(true) }}>+ <span className="btn-label">New bank payment</span></button>
      </div>
      <div className="hint" style={{ margin: '0 0 12px' }}>
        A bank payment debits the CI’s account and credits the bank. The month’s payroll is posted first from the CI’s Payroll tab (Dr Staff Salaries / Cr the CI’s account).
      </div>

      {error && <div className="hint" style={{ color: 'var(--red)' }}>Could not load bank payments: {error}</div>}
      {loading ? <div className="loading">Loading…</div> : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflowX: 'auto', background: 'var(--card, #fff)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg3)', textAlign: 'left', font: '600 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase' }}>
                <th style={{ padding: '8px 14px' }}>Date</th><th style={{ padding: '8px 14px' }}>Entry</th><th style={{ padding: '8px 14px' }}>Paid to (Dr)</th>
                <th style={{ padding: '8px 14px' }}>From bank (Cr)</th><th style={{ padding: '8px 14px', textAlign: 'right' }}>Amount</th><th style={{ padding: '8px 14px' }}>Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} style={{ padding: 18, textAlign: 'center', color: 'var(--text3)' }}>No bank payments to CIs yet.</td></tr>}
              {rows.map(function (r) {
                const dr = (r.journal_lines || []).find(function (l) { return l.debit > 0 })
                const cr = (r.journal_lines || []).find(function (l) { return l.credit > 0 })
                const voided = r.status === 'voided'
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)', opacity: voided ? 0.5 : 1, textDecoration: voided ? 'line-through' : 'none' }}>
                    <td style={{ padding: '8px 14px' }}>{fmtDate(r.date)}</td>
                    <td style={{ padding: '8px 14px', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.entry_no}</td>
                    <td style={{ padding: '8px 14px', fontWeight: 600 }}>{dr && dr.accounts ? dr.accounts.name : '—'}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--text2)' }}>{cr && cr.accounts ? cr.accounts.name : '—'}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700 }}>{rupees(dr ? dr.debit : 0)}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--text2)' }}>{String(r.description || '').replace(/^Bank payment — [^—]*—?\s*/, '')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && <CiBankPaymentDialog onClose={function () { setOpen(false) }} onDone={function () { setOpen(false); setReload(function (n) { return n + 1 }) }} />}
    </div>
  )
}
