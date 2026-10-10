import { useState, useEffect } from 'react'
import { fmtDate, fmtAmt } from '../utils'
import { loadStudentLedger } from '../utils/studentLedger'

const PAGE_SIZE = 25

const STATUS_CHIP = {
  paid:   { label: 'Paid',   color: 'var(--green,#1D7A4F)', bg: 'var(--green-bg,#e6f4ec)' },
  part:   { label: 'Part',   color: '#a15c00',              bg: '#fff4e0' },
  unpaid: { label: 'Unpaid', color: 'var(--red,#dc2626)',   bg: 'var(--red-bg,#fef2f2)' },
}

// One student's account statement — every fee charged (with its invoice),
// every discount and every payment (with its receipt), running balance.
// The student counterpart of FranchiseeLedgerView.
//   onPrintInvoice(invoice, settlement)  onPrintReceipt(payment)
export default function StudentLedgerView({ studentId, reloadKey, onPrintInvoice, onPrintReceipt }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [category, setCategory] = useState('all')
  const [page, setPage] = useState(0)

  useEffect(function () {
    let cancelled = false
    setLoading(true)
    loadStudentLedger(studentId).then(function (res) {
      if (!cancelled) { setData(res); setLoading(false) }
    }).catch(function () { if (!cancelled) { setData(null); setLoading(false) } })
    return function () { cancelled = true }
  }, [studentId, reloadKey])

  useEffect(function () { setPage(0) }, [category])

  if (loading) return <div className="loading"><span className="spinner" />Loading account…</div>
  if (!data) return <div className="empty">Could not load this account.</div>

  const filtered = data.transactions.filter(function (t) { return category === 'all' || t.category === category })
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const curPage = Math.min(page, totalPages - 1)
  const rows = filtered.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE)
  const balance = data.balance

  const card = { padding: '12px 16px', borderRadius: 10, background: 'var(--bg2,#f5f4f0)', minWidth: 130, flex: '1 1 130px' }
  const lbl = { font: '600 10px var(--font)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={card}>
          <div style={lbl}>Total charged</div>
          <div style={{ font: '700 18px var(--mono)' }}>₹{fmtAmt(data.totalDebit)}</div>
        </div>
        <div style={card}>
          <div style={lbl}>Paid + adjusted</div>
          <div style={{ font: '700 18px var(--mono)', color: 'var(--green,#1D7A4F)' }}>₹{fmtAmt(data.totalCredit)}</div>
        </div>
        <div style={Object.assign({}, card, { background: balance > 0 ? 'var(--red-bg,#fef2f2)' : 'var(--purple-bg,#EDE9FF)' })}>
          <div style={lbl}>{balance > 0 ? 'Balance due' : 'Balance'}</div>
          <div style={{ font: '700 18px var(--mono)', color: balance > 0 ? 'var(--red,#dc2626)' : 'var(--purple)' }}>
            {balance > 0 ? '₹' + fmtAmt(balance) : '✓ Cleared'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <select value={category} onChange={function (e) { setCategory(e.target.value) }}
          style={{ font: '500 12px var(--font)', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border2, #d8d5cc)' }}>
          <option value="all">All transactions</option>
          <option value="invoice">Invoices only</option>
          <option value="payment">Payments only</option>
          <option value="adjustment">Discounts / adjustments</option>
        </select>
        <span style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>{filtered.length} entries</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No transactions {category !== 'all' ? 'match this filter' : 'yet'}.</div>
      ) : (
        <>
          <div className="card tbl-scroll" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="big-tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Reference</th>
                  <th style={{ textAlign: 'right' }}>Charged</th>
                  <th style={{ textAlign: 'right' }}>Paid / adj.</th>
                  <th style={{ textAlign: 'right' }}>Balance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(function (t) {
                  const st = t.doc && t.doc.type === 'invoice' ? data.settlement[t.doc.invoice.id] : null
                  const chip = st ? STATUS_CHIP[st.status] : null
                  return (
                    <tr key={t.id}>
                      <td className="mono" style={{ whiteSpace: 'nowrap', color: 'var(--text3)', fontSize: 11 }}>{fmtDate(t.date)}</td>
                      <td style={{ fontSize: 12 }}>
                        {t.desc}
                        {chip && (
                          <span style={{ marginLeft: 8, font: '700 10px var(--mono)', color: chip.color, background: chip.bg, borderRadius: 4, padding: '1px 6px' }}>
                            {chip.label}{st.status === 'part' ? ' · due ₹' + fmtAmt(st.due) : ''}
                          </span>
                        )}
                      </td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{t.ref || '—'}</td>
                      <td style={{ textAlign: 'right', font: '600 12px var(--mono)', color: t.debit ? 'var(--red,#dc2626)' : 'var(--text3)' }}>
                        {t.debit ? '₹' + fmtAmt(t.debit) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', font: '600 12px var(--mono)', color: t.credit ? 'var(--green,#1D7A4F)' : 'var(--text3)' }}>
                        {t.credit ? '₹' + fmtAmt(t.credit) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', font: '700 12px var(--mono)', color: t.balance > 0 ? 'var(--red,#dc2626)' : 'var(--text2)' }}>
                        ₹{fmtAmt(t.balance)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {t.doc && t.doc.type === 'invoice' && onPrintInvoice && (
                          <button className="btn-s" style={{ fontSize: 11, padding: '4px 8px' }}
                            onClick={function () { onPrintInvoice(t.doc.invoice, st) }}>🧾 Invoice</button>
                        )}
                        {t.doc && t.doc.type === 'receipt' && onPrintReceipt && (
                          <button className="btn-s" style={{ fontSize: 11, padding: '4px 8px' }}
                            onClick={function () { onPrintReceipt(t.doc.payment) }}>🧾 Receipt</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12 }}>
              <button className="btn-s" disabled={curPage === 0} onClick={function () { setPage(curPage - 1) }}>← Prev</button>
              <span style={{ font: '500 12px var(--font)', color: 'var(--text3)' }}>Page {curPage + 1} of {totalPages}</span>
              <button className="btn-s" disabled={curPage >= totalPages - 1} onClick={function () { setPage(curPage + 1) }}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
