import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { fmtDate, fmtAmt } from '../utils'
import { loadFranchiseeLedger } from '../utils/franchiseeLedger'
import { printFranchiseeEnrollmentInvoice, printFranchiseeReceipt, printOrderReceipt, printFranchiseeStatement } from './studentDocs'
import InvoiceView from './InvoiceView'

const PAGE_SIZE = 25

function esc(v) {
  if (v == null || v === '') return ''
  const s = String(v)
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s
}
// preambleLines: plain text lines identifying what the export is (NLH,
// which franchisee, what period) before the actual column headers/rows —
// a bare column dump doesn't say whose statement it is or what it covers.
function downloadCSV(preambleLines, headers, rows, filename) {
  const pre = (preambleLines || []).map(function (l) { return esc(l) }).join('\n')
  const csv = pre + (pre ? '\n\n' : '') + headers.join(',') + '\n' + rows.map(function (r) { return r.map(esc).join(',') }).join('\n')
  // Excel on Windows ignores the file's actual UTF-8 encoding and guesses a
  // legacy codepage unless a BOM is present — without it, the em dash and
  // middle dots in the header block above render as mojibake (confirmed:
  // "New Learning Horizons â€" Statement" instead of "—").
  const blob = new Blob([String.fromCharCode(0xFEFF) + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function periodLabel(from, to) {
  if (from && to) return fmtDate(from) + ' to ' + fmtDate(to)
  if (from) return 'From ' + fmtDate(from)
  if (to) return 'Up to ' + fmtDate(to)
  return 'All time'
}

const DOC_LABEL = {
  enrollment_invoice: 'Invoice',
  order_invoice:      'Invoice',
  fee_receipt:         'Receipt',
  order_receipt:       'Receipt',
}

// Combined "Accounts" ledger — every debit (franchise fee assessed, orders
// invoiced) and credit (payments received) for one franchisee, running
// balance included. Used both in the admin's franchisee detail view and in
// the franchisee's own self-service "My Account" page — same component,
// same numbers, whoever's looking at it.
export default function FranchiseeLedgerView({ franchiseeId, franchiseeName }) {
  const { currentRole, currentUser } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [category, setCategory] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const [viewOrder, setViewOrder] = useState(null)

  // Opens the real document behind a ledger row — the enrollment invoice,
  // a franchise fee/order receipt (studentDocs.js, same generator used
  // everywhere else in the app), or the actual order invoice (InvoiceView,
  // same modal Orders uses — not a re-implementation).
  function openLedgerDoc(doc) {
    if (!doc) return
    if (doc.type === 'enrollment_invoice') {
      printFranchiseeEnrollmentInvoice(doc.franchisee, doc.courseNames)
    } else if (doc.type === 'fee_receipt') {
      printFranchiseeReceipt(doc.franchisee, doc.payment, { total: Number(doc.franchisee?.enrollment_fee) || 0, paidToDate: doc.paidToDate })
    } else if (doc.type === 'order_receipt') {
      printOrderReceipt(Object.assign({}, doc.order, { placer: doc.franchisee }), doc.payment, { paidToDate: doc.paidToDate })
    } else if (doc.type === 'order_invoice') {
      setViewOrder(doc.order)
    }
  }

  useEffect(function () {
    let cancelled = false
    setLoading(true)
    loadFranchiseeLedger(franchiseeId).then(function (res) {
      if (!cancelled) { setData(res); setLoading(false) }
    })
    return function () { cancelled = true }
  }, [franchiseeId])

  useEffect(function () { setPage(0) }, [category, from, to])

  if (loading) return <div className="loading"><span className="spinner" />Loading account statement…</div>
  if (!data) return <div className="empty">Could not load this account.</div>

  const { transactions, totalDebit, totalCredit, balance } = data

  const filtered = transactions.filter(function (t) {
    if (category !== 'all' && t.category !== category) return false
    const d = String(t.date || '').slice(0, 10)
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const curPage = Math.min(page, totalPages - 1)
  // Oldest first, top to bottom — a statement of account reads in the order
  // things actually happened (enrollment, then orders, then payments), the
  // balance building down the page, not a reverse-chronological activity feed.
  const displayRows = filtered
  const pageRows = displayRows.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE)

  const card = { padding: '14px 18px', borderRadius: 10, background: 'var(--bg2,#f5f4f0)', minWidth: 140, flex: '1 1 140px' }
  const cardLbl = { font: '600 10px var(--font)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={card}>
          <div style={cardLbl}>Total Debit</div>
          <div style={{ font: '700 20px var(--mono)', color: 'var(--text)' }}>₹{fmtAmt(totalDebit)}</div>
        </div>
        <div style={card}>
          <div style={cardLbl}>Total Credit</div>
          <div style={{ font: '700 20px var(--mono)', color: 'var(--green,#1D7A4F)' }}>₹{fmtAmt(totalCredit)}</div>
        </div>
        <div style={Object.assign({}, card, { background: balance > 0 ? 'var(--red-bg,#fef2f2)' : 'var(--purple-bg,#EDE9FF)' })}>
          <div style={cardLbl}>{balance > 0 ? 'Balance Due' : 'Balance'}</div>
          <div style={{ font: '700 20px var(--mono)', color: balance > 0 ? 'var(--red,#dc2626)' : 'var(--purple)' }}>
            {balance > 0 ? '₹' + fmtAmt(balance) : '✓ Cleared'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select value={category} onChange={function (e) { setCategory(e.target.value) }}
            style={{ font: '500 12px var(--font)', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border2, #d8d5cc)' }}>
            <option value="all">All transactions</option>
            <option value="fee">Franchise fee only</option>
            <option value="order">Orders only</option>
          </select>
          <span style={{ font: '600 11px var(--font)', color: 'var(--text3)' }}>From</span>
          <input type="date" value={from} onChange={function (e) { setFrom(e.target.value) }}
            style={{ font: '500 12px var(--font)', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border2, #d8d5cc)' }} />
          <span style={{ font: '600 11px var(--font)', color: 'var(--text3)' }}>To</span>
          <input type="date" value={to} onChange={function (e) { setTo(e.target.value) }}
            style={{ font: '500 12px var(--font)', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border2, #d8d5cc)' }} />
          {(from || to || category !== 'all') && (
            <button className="btn-s" onClick={function () { setFrom(''); setTo(''); setCategory('all') }}>✕ Clear</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-s" onClick={function () {
            const name = franchiseeName || data.franchisee?.business_name || 'this franchisee'
            downloadCSV(
              [
                'New Learning Horizons — Statement of Account',
                'Franchisee: ' + name + (data.franchisee?.tier ? ' (' + data.franchisee.tier + ')' : ''),
                'Period: ' + periodLabel(from, to),
                'Generated: ' + fmtDate(new Date()),
                'Total Debit: ' + fmtAmt(totalDebit) + ' · Total Credit: ' + fmtAmt(totalCredit) + ' · ' + (balance > 0 ? 'Balance Due: ' + fmtAmt(balance) : 'Balance: Cleared'),
              ],
              ['Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance'],
              displayRows.map(function (t) {
                return [fmtDate(t.date), t.desc, t.ref || '', t.debit || '', t.credit || '', t.balance]
              }),
              'statement-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' + new Date().toISOString().slice(0, 10) + '.csv'
            )
          }}>⬇ CSV</button>
          <button className="btn-s" onClick={function () {
            printFranchiseeStatement(data.franchisee || { business_name: franchiseeName }, displayRows, {
              from: from || null, to: to || null,
              totalDebit: totalDebit, totalCredit: totalCredit, balance: balance,
            })
          }}>⬇ PDF</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No transactions {(from || to || category !== 'all') ? 'match this filter' : 'yet'}.</div>
      ) : (
        <>
          <div className="card tbl-scroll" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="big-tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Reference</th>
                  <th style={{ textAlign: 'right' }}>Debit</th>
                  <th style={{ textAlign: 'right' }}>Credit</th>
                  <th style={{ textAlign: 'right' }}>Balance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(function (t) {
                  return (
                    <tr key={t.id}>
                      <td className="mono" style={{ whiteSpace: 'nowrap', color: 'var(--text3)', fontSize: 11 }}>{fmtDate(t.date)}</td>
                      <td style={{ fontSize: 12 }}>{t.desc}</td>
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
                        {t.doc && (
                          <button className="btn-s" style={{ fontSize: 11, padding: '4px 8px' }}
                            onClick={function () { openLedgerDoc(t.doc) }}>
                            🧾 {DOC_LABEL[t.doc.type] || 'View'}
                          </button>
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

      {viewOrder && (
        <InvoiceView
          order={viewOrder}
          onClose={function () { setViewOrder(null) }}
          onCancelled={function () { setViewOrder(null); loadFranchiseeLedger(franchiseeId).then(setData) }}
          currentRole={currentRole}
          currentUser={currentUser}
        />
      )}
    </div>
  )
}
