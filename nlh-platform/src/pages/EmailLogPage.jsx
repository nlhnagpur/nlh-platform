import { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { fmtDate, showToast } from '../utils'

const TYPE_LABEL = {
  order_confirmation:        'Order confirmation',
  invoice_ready:             'Invoice',
  payment_reminder:          'Payment reminder',
  payment_verified:          'Payment confirmed',
  invite:                    'User invite',
  welcome:                   'Welcome / access',
  franchisee_welcome_letter: 'Franchisee letter',
  franchisee_cert:           'Franchisee certificate',
  student_cert:              'Student certificate',
}

function StatusBadge({ status }) {
  const ok = status === 'sent'
  return (
    <span style={{
      font: '600 10px var(--font)', whiteSpace: 'nowrap',
      color: ok ? 'var(--green)' : 'var(--red, #dc2626)',
      background: ok ? 'var(--green-bg)' : '#FEE2E2',
      border: '1px solid ' + (ok ? 'var(--green)' : '#FCA5A5'),
      borderRadius: 20, padding: '1px 9px',
    }}>{ok ? '✓ Sent' : '✗ Failed'}</span>
  )
}

export default function EmailLogPage() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [typeF, setTypeF]     = useState('')
  const [statusF, setStatusF] = useState('')

  useEffect(function () { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await sb.from('email_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) showToast('Failed to load email log: ' + error.message, 'err')
    setRows(data || [])
    setLoading(false)
  }

  const filtered = rows.filter(function (r) {
    const q = search.toLowerCase()
    const matchesQ = !q ||
      (r.recipient || '').toLowerCase().includes(q) ||
      (r.recipient_name || '').toLowerCase().includes(q) ||
      (r.subject || '').toLowerCase().includes(q)
    const matchesType = !typeF || r.type === typeF
    const matchesStatus = !statusF || r.status === statusF
    return matchesQ && matchesType && matchesStatus
  })

  const sentCount   = rows.filter(function (r) { return r.status === 'sent' }).length
  const failedCount = rows.length - sentCount
  const typesPresent = Array.from(new Set(rows.map(function (r) { return r.type }).filter(Boolean)))

  return (
    <div className="pg">
      <header className="tb">
        <div className="crumb">Operations <span className="sep">›</span> <b>Email log</b></div>
        <div className="tb-r">
          <input className="search tb-search" placeholder="Search recipient or subject…"
            value={search} onChange={function (e) { setSearch(e.target.value) }} />
        </div>
      </header>

      <div className="content">
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>Communications</div>
            <h1 className="ph-title">Email log</h1>
            <div className="ph-sub">
              <b>{rows.length} emails</b> · {sentCount} sent · {failedCount} failed.
              {' '}A copy of every email is also sent to admin@nlhnagpur.info.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <select value={typeF} onChange={function (e) { setTypeF(e.target.value) }} style={{ fontSize: 13, minWidth: 160 }}>
            <option value="">All types</option>
            {typesPresent.map(function (t) {
              return <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>
            })}
          </select>
          <select value={statusF} onChange={function (e) { setStatusF(e.target.value) }} style={{ fontSize: 13, minWidth: 130 }}>
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
          <button className="btn" style={{ fontSize: 13 }} onClick={load}>↻ Refresh</button>
          <span style={{ fontSize: 13, color: 'var(--text3)', alignSelf: 'center' }}>
            {filtered.length} shown
          </span>
        </div>

        {loading ? (
          <div className="loading">Loading email log…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">No emails found.</div>
        ) : (
          <div className="card tbl-scroll" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="big-tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Recipient</th>
                  <th>Subject</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(function (r) {
                  return (
                    <tr key={r.id}>
                      <td className="mono" style={{ whiteSpace: 'nowrap', color: 'var(--text3)', fontSize: 11 }}>
                        {new Date(r.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ fontSize: 12 }}>{TYPE_LABEL[r.type] || r.type || '—'}</td>
                      <td>
                        <div style={{ font: '600 12px var(--font)', color: 'var(--text)' }}>{r.recipient_name || r.recipient}</div>
                        {r.recipient_name && r.recipient && (
                          <div style={{ font: '500 10px var(--mono)', color: 'var(--text3)' }}>{r.recipient}</div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text2)', maxWidth: 320 }}>
                        {r.subject || '—'}
                        {r.status === 'failed' && r.error && (
                          <div style={{ font: '500 10px var(--font)', color: 'var(--red, #dc2626)', marginTop: 2 }}>{r.error}</div>
                        )}
                      </td>
                      <td><StatusBadge status={r.status} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
