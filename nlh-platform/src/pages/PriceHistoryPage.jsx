import { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { fmtAmt, fmtDate, showToast } from '../utils'

export default function PriceHistoryPage() {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(function () {
    loadHistory()
  }, [])

  async function loadHistory() {
    setLoading(true)
    const { data, error } = await sb
      .from('kit_price_history')
      .select('*, skus(name, courses(name))')
      .order('changed_at', { ascending: false })
      .limit(200)
    if (error) {
      showToast('Failed to load price history: ' + error.message)
    } else {
      setHistory(data || [])
    }
    setLoading(false)
  }

  function rateChange(oldVal, newVal) {
    if (oldVal === newVal) return <span className="text-muted">No change</span>
    const diff = newVal - oldVal
    return (
      <span>
        {fmtAmt(oldVal)} → {fmtAmt(newVal)}{' '}
        <span className={diff > 0 ? 'text-green' : 'text-red'}>
          ({diff > 0 ? '+' : ''}{fmtAmt(diff)})
        </span>
      </span>
    )
  }

  if (loading) return <div className="loading"><span className="spinner" />Loading history…</div>

  return (
    <div className="pg">
      <div className="topbar">
        <h2>Price Change History</h2>
        <span className="badge">{history.length} records</span>
      </div>

      {history.length === 0 ? (
        <div className="empty">No price changes recorded yet.</div>
      ) : (
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>SKU</th>
                <th>Course</th>
                <th>UF Rate Change</th>
                <th>CF Rate Change</th>
                <th>SMF Rate Change</th>
                <th>Changed By</th>
              </tr>
            </thead>
            <tbody>
              {history.map(function (row) {
                return (
                  <tr key={row.id}>
                    <td className="mono">{fmtDate(row.changed_at)}</td>
                    <td>{row.skus?.name || row.sku_id}</td>
                    <td>{row.skus?.courses?.name || '—'}</td>
                    <td>{rateChange(row.old_uf_rate, row.new_uf_rate)}</td>
                    <td>{rateChange(row.old_cf_rate, row.new_cf_rate)}</td>
                    <td>{rateChange(row.old_smf_rate, row.new_smf_rate)}</td>
                    <td className="text-muted">{row.changed_by}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
