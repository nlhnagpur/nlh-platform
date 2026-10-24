import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { loadBatchHealthIssues } from '../utils/batchHealthLoad'
import { closeItems, monthIsPast } from '../utils/monthClose'
import { monthLabel } from '../utils/ciPayrollRun'
import { staffGuideHtml } from '../utils/staffGuide'
import { printHtmlDoc } from '../components/studentDocs'

const SEV = {
  error: { label: 'Fix', color: '#991B1B', bg: '#FEE2E2' },
  warn:  { label: 'Check', color: '#92400E', bg: '#FEF3C7' },
  info:  { label: 'Note', color: '#475569', bg: '#E2E8F0' },
}
const PAGE_LABEL = { batches: 'Batches', students: 'Students', instructors: 'Instructors', orders: 'Orders' }
const GROUPS = ['Batches & students', 'CI payroll', 'Orders', 'Certificates']

function thisMonth() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') }
function shiftMonth(m, n) { const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') }
function todayIso() { const d = new Date(); return thisMonth() + '-' + String(d.getDate()).padStart(2, '0') }

// Today / Month close (HO): every check in one list, each with where to go to fix it. Nothing here is typed in.
export default function TodayPage({ onNavigate }) {
  const [month, setMonth] = useState(thisMonth())
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(function () {
    let cancelled = false
    setItems(null)
    ;(async function () {
      const health = await loadBatchHealthIssues()
      const aRes = await sb.from('instructor_courses').select('instructor_id, instructors(id, full_name, status, left_at)')
      if (aRes.error) throw aRes.error
      const seen = {}, cis = []
      ;(aRes.data || []).forEach(function (a) {
        const i = a.instructors
        if (!i || seen[i.id]) return
        seen[i.id] = true
        if (i.status === 'active' || month <= thisMonth()) cis.push(i)
      })
      const rRes = await sb.from('ci_payroll_runs').select('instructor_id, month, status, total').eq('month', month)
      if (rRes.error) throw rRes.error
      const [o1, o2, c1] = await Promise.all([
        sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        sb.from('orders').select('id', { count: 'exact', head: true }).not('payment_submitted_at', 'is', null).is('payment_verified_at', null).neq('status', 'closed').neq('status', 'cancelled'),
        sb.from('enrollments').select('id', { count: 'exact', head: true }).not('completed_at', 'is', null).gt('fee_amount', 0).is('cert_wa_sent_at', null).is('cert_emailed_at', null).is('cert_issued_at', null),
      ])
      if (cancelled) return
      setItems(closeItems({ month: month, today: todayIso(), health: health, cis: cis, runs: rRes.data || [], ordersToInvoice: o1.count || 0, ordersToVerify: o2.count || 0, certs: c1.count || 0 }))
    })().catch(function (e) { if (!cancelled) { setError(e.message || 'Could not load the list'); setItems([]) } })
    return function () { cancelled = true }
  }, [month, reload])

  const past = monthIsPast(month, todayIso())
  const all = items || []
  const todo = all.filter(function (i) { return i.severity !== 'info' }).length

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ font: '700 22px var(--font)', margin: 0 }}>Today &amp; Month close</h1>
          <div style={{ font: '500 12px var(--font)', color: 'var(--text3)', marginTop: 2 }}>
            {items === null ? 'Checking…' : todo === 0 ? '✓ Nothing needs doing' : todo + ' thing' + (todo !== 1 ? 's' : '') + ' to do'}{all.length > todo ? ' · ' + (all.length - todo) + ' note' + (all.length - todo !== 1 ? 's' : '') : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn" onClick={function () { setMonth(shiftMonth(month, -1)) }}>‹</button>
          <b style={{ font: '700 13px var(--font)', minWidth: 120, textAlign: 'center' }}>{monthLabel(month)}{past ? '' : ' (running)'}</b>
          <button className="btn" disabled={month >= thisMonth()} onClick={function () { setMonth(shiftMonth(month, 1)) }}>›</button>
          <button className="btn" onClick={function () { setReload(function (n) { return n + 1 }) }}>↻ Re-check</button>
          <button className="btn" onClick={function () { printHtmlDoc(staffGuideHtml()) }}>🖨 Staff guide</button>
        </div>
      </div>
      {error && <div className="hint" style={{ color: 'var(--red)' }}>{error}</div>}
      {items === null && <div className="loading">Checking batches, payroll, orders…</div>}
      {GROUPS.map(function (g) {
        const rows = all.filter(function (i) { return i.group === g })
        if (items === null) return null
        return (
          <div key={g} style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 14, overflow: 'hidden', background: 'var(--card, #fff)' }}>
            <div style={{ display: 'flex', gap: 10, padding: '10px 14px', background: 'var(--bg2)' }}>
              <span style={{ font: '700 13px var(--font)' }}>{g}</span>
              <span style={{ font: '600 12px var(--font)', color: rows.length ? '#92400E' : 'var(--green)' }}>{rows.length ? rows.length + (rows.length !== 1 ? ' items' : ' item') : '✓ All clear'}</span>
            </div>
            {rows.map(function (i, n) {
              return (
                <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 14px', borderTop: '1px solid var(--border)' }}>
                  <span style={{ font: '700 10px var(--mono)', color: SEV[i.severity].color, background: SEV[i.severity].bg, borderRadius: 10, padding: '2px 8px', whiteSpace: 'nowrap', marginTop: 2 }}>{SEV[i.severity].label}</span>
                  <div style={{ flex: 1, font: '500 12px var(--font)', color: 'var(--text2)' }}>
                    <b style={{ color: 'var(--text)' }}>{i.title}</b> — {i.detail}
                    {i.action && <div style={{ marginTop: 2, color: 'var(--text3)' }}><b style={{ color: 'var(--text2)' }}>What to do:</b> {i.action}</div>}
                  </div>
                  <button className="btn" style={{ fontSize: 11, whiteSpace: 'nowrap' }} onClick={function () { onNavigate && onNavigate(i.page) }}>Open {PAGE_LABEL[i.page] || i.page} →</button>
                </div>
              )
            })}
          </div>
        )
      })}
      <div className="hint" style={{ marginTop: 8 }}>
        Month close: pick the month that just ended and clear the list — payroll saved, posted and paid, batches consistent, students placed.
      </div>
    </div>
  )
}
