import React, { useState, useEffect, useCallback } from 'react'
import { sb } from '../supabase'
import { showToast, fmtAmt } from '../utils'
import { generateServiceInvoices, groupServiceLines, monthFirst, monthLabel } from '../utils/serviceBilling'

// Admin-only "CIs & Billing" tab on a school's page: the CIs NLH appoints to a
// Full-Service school and what the school is charged for each, plus the
// shortcut to generate this month's service invoice (the invoice itself lives
// in the Orders tab like any other). The CF commission is deliberately NOT here.

const inp = { padding: '6px 8px', fontSize: 12 }

export default function SchoolCiBilling({ school, currentUser, canEdit }) {
  const [rows, setRows] = useState([])
  const [model, setModel] = useState(null)         // latest school agreement's service_model
  const [invoices, setInvoices] = useState([])
  const [hoCis, setHoCis] = useState([])
  const [programs, setPrograms] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [month, setMonth] = useState(monthFirst(new Date()))
  const [form, setForm] = useState({ instructor_id: '', program: '', level_label: '', monthly_charge: '', starts_on: new Date().toISOString().slice(0, 10) })
  const [revise, setRevise] = useState(null)       // { row, charge, from }

  const load = useCallback(async function () {
    setLoading(true)
    const courseIds = school.registered_courses || []
    const [ciRes, agRes, invRes, hoRes, crsRes] = await Promise.all([
      sb.from('school_ci_assignments').select('*').eq('school_id', school.id).order('starts_on', { ascending: false }),
      sb.from('franchisee_agreements').select('service_model').eq('franchisee_id', school.id).eq('kind', 'school').order('generated_at', { ascending: false }).limit(1),
      sb.from('orders').select('id, order_ref, invoice_no, status, grand_total, amount_paid, service_month').eq('kind', 'service').eq('bill_to_franchisee_id', school.id).order('service_month', { ascending: false }).limit(12),
      sb.from('franchisees').select('id').eq('tier', 'NLH').limit(1),
      courseIds.length ? sb.from('courses').select('group_name, name').in('id', courseIds) : Promise.resolve({ data: [] }),
    ])
    setRows(ciRes.data || [])
    setModel((agRes.data && agRes.data[0] && agRes.data[0].service_model) || null)
    setInvoices(invRes.data || [])
    setPrograms(Array.from(new Set((crsRes.data || []).map(function (c) { return c.group_name || c.name }).filter(Boolean))).sort())
    const hoId = hoRes.data && hoRes.data[0] && hoRes.data[0].id
    if (hoId) {
      const { data: ins } = await sb.from('instructors').select('id, full_name, status').eq('franchisee_id', hoId).order('full_name')
      setHoCis((ins || []).filter(function (i) { return i.status !== 'inactive' && i.status !== 'left' }))
    }
    setLoading(false)
  }, [school.id, school.registered_courses])

  useEffect(function () { load() }, [load])

  async function addCi() {
    const ci = hoCis.find(function (i) { return i.id === form.instructor_id })
    const charge = parseInt(form.monthly_charge, 10)
    if (!ci) { showToast('Pick the CI', 'warn'); return }
    if (!form.program) { showToast('Pick the program', 'warn'); return }
    if (!(charge >= 0)) { showToast('Enter the monthly charge to the school', 'warn'); return }
    setBusy(true)
    const { error } = await sb.from('school_ci_assignments').insert({
      school_id: school.id, instructor_id: ci.id, ci_name: ci.full_name, program: form.program,
      level_label: form.level_label.trim() || null, monthly_charge: charge, frequency: 'Monthly',
      starts_on: form.starts_on, created_by: currentUser && currentUser.email,
    })
    setBusy(false)
    if (error) { showToast('Could not add CI: ' + error.message, 'err'); return }
    setForm(function (f) { return { ...f, instructor_id: '', monthly_charge: '', level_label: '' } })
    showToast('CI appointed ✓')
    load()
  }

  async function endCi(r) {
    const { error } = await sb.from('school_ci_assignments').update({ ends_on: new Date().toISOString().slice(0, 10) }).eq('id', r.id)
    if (error) { showToast('Could not end appointment: ' + error.message, 'err'); return }
    load()
  }

  // A charge revision never edits history: the old row ends the day before, a new row starts.
  async function saveRevision() {
    const r = revise.row
    const charge = parseInt(revise.charge, 10)
    if (!(charge >= 0)) { showToast('Enter the new monthly charge', 'warn'); return }
    if (revise.from <= r.starts_on) { showToast('The new charge must start after the current row started', 'warn'); return }
    setBusy(true)
    const prev = new Date(revise.from + 'T00:00:00'); prev.setDate(prev.getDate() - 1)
    const prevIso = prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0') + '-' + String(prev.getDate()).padStart(2, '0')
    const { error: e1 } = await sb.from('school_ci_assignments').update({ ends_on: prevIso }).eq('id', r.id)
    if (e1) { setBusy(false); showToast('Could not revise: ' + e1.message, 'err'); return }
    const { data: created, error: e2 } = await sb.from('school_ci_assignments').insert({
      school_id: r.school_id, instructor_id: r.instructor_id, ci_name: r.ci_name, program: r.program,
      level_label: r.level_label, monthly_charge: charge, frequency: r.frequency, starts_on: revise.from,
      created_by: currentUser && currentUser.email,
    }).select().single()
    if (e2) { setBusy(false); showToast('Could not revise: ' + e2.message, 'err'); return }
    // carry the CF share over to the new row (admin-only table)
    const { data: term } = await sb.from('cf_commission_terms').select('share_amount').eq('ci_assignment_id', r.id).maybeSingle()
    if (term && term.share_amount > 0) {
      await sb.from('cf_commission_terms').insert({ school_id: r.school_id, kind: 'ci', ci_assignment_id: created.id, share_amount: term.share_amount, updated_by: currentUser && currentUser.email })
    }
    setBusy(false)
    setRevise(null)
    showToast('Charge revised from ' + revise.from + ' ✓')
    load()
  }

  async function generate() {
    setBusy(true)
    try {
      const res = await generateServiceInvoices(month, { schoolId: school.id })
      if (res.created.length) showToast('Invoice draft ' + res.created[0].order_ref + ' created in Orders ✓')
      else showToast(res.skipped[0] ? res.skipped[0].reason : 'Nothing to invoice', 'warn')
      load()
    } catch (e) { showToast('Could not generate: ' + e.message, 'err') }
    setBusy(false)
  }

  const today = new Date().toISOString().slice(0, 10)
  const active = rows.filter(function (r) { return !r.ends_on || r.ends_on >= today })
  const lines = groupServiceLines(rows, month)
  const monthTotal = lines.reduce(function (s, l) { return s + l.qty * l.rate }, 0)

  if (loading) return <div className="loading"><span className="spinner" />Loading…</div>

  return (
    <div style={{ padding: 20 }}>
      {model !== 'full_service' && (
        <p className="hint" style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          {model === 'inhouse'
            ? 'This school\'s agreement is the In-house model, so no monthly CI invoices are raised for it.'
            : 'No School agreement generated yet. Monthly CI invoices are raised only for schools on a Full-Service agreement.'}
        </p>
      )}

      <div style={{ font: '700 12px var(--font)', marginBottom: 8 }}>CIs appointed by NLH</div>
      {rows.length === 0 ? <p className="hint">No CIs appointed yet.</p> : (
        <div className="tbl-scroll" style={{ marginBottom: 12 }}>
          <table className="data-table">
            <thead><tr><th>CI</th><th>Program</th><th>Level</th><th style={{ textAlign: 'right' }}>Monthly charge</th><th>From</th><th>To</th><th></th></tr></thead>
            <tbody>
              {rows.map(function (r) {
                const isActive = !r.ends_on || r.ends_on >= today
                return (
                  <tr key={r.id} style={{ opacity: isActive ? 1 : 0.55 }}>
                    <td>{r.ci_name}</td>
                    <td>{r.program}</td>
                    <td>{r.level_label || 'All levels'}</td>
                    <td style={{ textAlign: 'right' }}>₹{fmtAmt(r.monthly_charge)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{r.starts_on}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{r.ends_on || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {canEdit && isActive && (<>
                        <button className="btn-s" style={{ fontSize: 11 }} onClick={function () { setRevise({ row: r, charge: String(r.monthly_charge), from: monthFirst(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)) }) }}>Revise charge</button>{' '}
                        <button className="btn-s" style={{ fontSize: 11 }} onClick={function () { endCi(r) }}>End</button>
                      </>)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {revise && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ font: '600 12px var(--font)', marginBottom: 8 }}>Revise charge — {revise.row.ci_name} · {revise.row.program}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="number" min={0} value={revise.charge} onChange={function (e) { setRevise({ ...revise, charge: e.target.value }) }} style={{ ...inp, width: 120 }} />
            <span style={{ fontSize: 12 }}>from</span>
            <input type="date" value={revise.from} onChange={function (e) { setRevise({ ...revise, from: e.target.value }) }} style={inp} />
            <button className="btn-p" disabled={busy} onClick={saveRevision}>Save revision</button>
            <button className="btn-s" onClick={function () { setRevise(null) }}>Cancel</button>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>Earlier months and issued invoices stay as they were; the new charge applies to invoices from that date.</p>
        </div>
      )}

      {canEdit && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ font: '600 12px var(--font)', marginBottom: 8 }}>Appoint a CI</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={form.instructor_id} onChange={function (e) { setForm({ ...form, instructor_id: e.target.value }) }} style={{ ...inp, minWidth: 160 }}>
              <option value="">CI…</option>
              {hoCis.map(function (i) { return <option key={i.id} value={i.id}>{i.full_name}</option> })}
            </select>
            <select value={form.program} onChange={function (e) { setForm({ ...form, program: e.target.value }) }} style={{ ...inp, minWidth: 150 }}>
              <option value="">Program…</option>
              {programs.map(function (p) { return <option key={p} value={p}>{p}</option> })}
            </select>
            <input placeholder="Level (blank = all)" value={form.level_label} onChange={function (e) { setForm({ ...form, level_label: e.target.value }) }} style={{ ...inp, width: 140 }} />
            <input type="number" min={0} placeholder="₹ / month" value={form.monthly_charge} onChange={function (e) { setForm({ ...form, monthly_charge: e.target.value }) }} style={{ ...inp, width: 110 }} />
            <input type="date" value={form.starts_on} onChange={function (e) { setForm({ ...form, starts_on: e.target.value }) }} style={inp} />
            <button className="btn-p" disabled={busy} onClick={addCi}>+ Appoint</button>
          </div>
          {hoCis.length === 0 && <p className="hint" style={{ marginTop: 6 }}>No NLH instructors found — add the CI under Instructors first.</p>}
        </div>
      )}

      <div style={{ font: '700 12px var(--font)', marginBottom: 8 }}>Monthly invoice</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <input type="month" value={month.slice(0, 7)} onChange={function (e) { if (e.target.value) setMonth(e.target.value + '-01') }} style={inp} />
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>
          {lines.length === 0 ? 'No active CIs this month' : lines.map(function (l) { return l.qty + ' × ' + l.program + (l.level ? ' ' + l.level : '') + ' @ ₹' + fmtAmt(l.rate) }).join(' · ') + ' = '}
          {lines.length > 0 && <strong>₹{fmtAmt(monthTotal)}</strong>}
        </span>
        {canEdit && <button className="btn-p" disabled={busy || lines.length === 0 || model !== 'full_service'} onClick={generate}>Generate {monthLabel(month)} invoice</button>}
      </div>
      <p className="hint">Invoices are created as drafts in the Orders tab, where you can edit the amounts and then issue them.</p>

      {invoices.length > 0 && (
        <div className="tbl-scroll" style={{ marginTop: 10 }}>
          <table className="data-table">
            <thead><tr><th>Month</th><th>Ref</th><th>Invoice</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {invoices.map(function (o) {
                return (
                  <tr key={o.id}>
                    <td>{o.service_month ? monthLabel(o.service_month) : '—'}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{o.order_ref}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{o.invoice_no || '—'}</td>
                    <td>{o.status}</td>
                    <td style={{ textAlign: 'right' }}>₹{fmtAmt(o.grand_total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {active.length === 0 && rows.length > 0 && <p className="hint" style={{ marginTop: 8 }}>All appointments have ended.</p>}
    </div>
  )
}
