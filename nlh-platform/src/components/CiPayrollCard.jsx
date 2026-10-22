import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { monthLabel } from '../utils/ciPayrollRun'

function rupees(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN') }

function prevMonth(m) {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7))
  return mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0')
}

// Dashboard card (HO admin): this month's CI payroll — paid, saved but unpaid,
// and CIs whose payroll isn't prepared yet — plus any unpaid month before it.
export default function CiPayrollCard({ onNavigate }) {
  const month = new Date().toISOString().slice(0, 7)
  const prev = prevMonth(month)
  const [data, setData] = useState(null)

  useEffect(function () {
    let cancelled = false
    ;(async function () {
      const [runs, ins] = await Promise.all([
        sb.from('ci_payroll_runs').select('instructor_id, month, total, status, paid_amount, instructors(full_name)').in('month', [prev, month]),
        sb.from('instructors').select('id, status').eq('status', 'active'),
      ])
      if (cancelled || runs.error) return    // table not there yet, or no access: show nothing
      setData({ runs: runs.data || [], active: (ins.data || []).length })
    })()
    return function () { cancelled = true }
  }, [month, prev])

  if (!data) return null
  const cur = data.runs.filter(function (r) { return r.month === month })
  const paid = cur.filter(function (r) { return r.status === 'paid' })
  const unpaid = cur.filter(function (r) { return r.status === 'posted' })          // posted to the books, not yet paid
  const notPosted = Math.max(0, data.active - cur.filter(function (r) { return r.status !== 'draft' }).length)   // not saved, or saved but not posted
  const notPrepared = notPosted
  const prevUnpaid = data.runs.filter(function (r) { return r.month === prev && r.status !== 'paid' })
  if (cur.length === 0 && prevUnpaid.length === 0 && notPrepared === 0) return null

  const sum = function (list, f) { return list.reduce(function (t, r) { return t + f(r) }, 0) }

  return (
    <div className="card-new" style={{ marginTop: 14 }}>
      <div className="card-h">
        <div>
          <div className="card-t">CI payroll — {monthLabel(month)}</div>
          <div className="card-ts">Monthly payments to class instructors</div>
        </div>
        <div className="card-link" onClick={function () { onNavigate && onNavigate('accounting') }}>CI payroll →</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, padding: '4px 4px 8px' }}>
        <div><div style={{ font: '700 18px var(--font)', color: 'var(--green)' }}>{rupees(sum(paid, function (r) { return r.paid_amount }))}</div><div className="kc-lbl">Paid · {paid.length} CI{paid.length !== 1 ? 's' : ''}</div></div>
        <div><div style={{ font: '700 18px var(--font)', color: '#92400E' }}>{rupees(sum(unpaid, function (r) { return r.total }))}</div><div className="kc-lbl">Owed, unpaid · {unpaid.length}</div></div>
        <div><div style={{ font: '700 18px var(--font)', color: 'var(--text3)' }}>{notPrepared}</div><div className="kc-lbl">Not posted yet</div></div>
      </div>
      {prevUnpaid.length > 0 && (
        <div style={{ margin: '0 4px 4px', padding: '8px 12px', borderRadius: 8, background: '#FEF3C7', color: '#92400E', font: '600 12px var(--font)' }}>
          {monthLabel(prev)} still unpaid or not posted: {prevUnpaid.map(function (r) { return ((r.instructors && r.instructors.full_name) || 'CI') + ' ' + rupees(r.total) }).join(' · ')}
        </div>
      )}
    </div>
  )
}
