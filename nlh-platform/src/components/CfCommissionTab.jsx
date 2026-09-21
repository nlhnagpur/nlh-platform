import React, { useState, useEffect, useCallback } from 'react'
import { sb } from '../supabase'
import { showToast, fmtAmt } from '../utils'

// Admin-only "Commission" tab on a CF's page. Pick one of the CF's schools and
// set the fixed amount NLH pays the CF: per kit for each program level the
// school buys, and per month for each CI appointed to the school. Stored in
// cf_commission_terms (admin-only table) — never visible to the school or CF.

export default function CfCommissionTab({ cf, currentUser, canEdit }) {
  const [schools, setSchools] = useState([])
  const [schoolId, setSchoolId] = useState('')
  const [kitRows, setKitRows] = useState([])   // { sku_id, program, level, rate }
  const [ciRows, setCiRows] = useState([])     // { id, ci_name, program, level, charge }
  const [shares, setShares] = useState({})     // key -> string
  const [terms, setTerms] = useState({})       // key -> row id (existing)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(function () {
    sb.from('franchisees').select('id, business_name, owner_name, registered_courses').eq('parent_id', cf.id).eq('tier', 'SCHOOL').order('business_name')
      .then(function (r) { setSchools(r.data || []) })
  }, [cf.id])

  const loadSchool = useCallback(async function (id) {
    if (!id) { setKitRows([]); setCiRows([]); setShares({}); setTerms({}); return }
    setLoading(true)
    const school = schools.find(function (s) { return s.id === id })
    const [rateRes, ciRes, termRes] = await Promise.all([
      sb.from('school_sku_rates').select('sku_id, rate, skus(level_name, sort_order, courses(group_name))').eq('franchisee_id', id),
      sb.from('school_ci_assignments').select('*').eq('school_id', id).order('starts_on', { ascending: false }),
      sb.from('cf_commission_terms').select('*').eq('school_id', id),
    ])
    let kits = (rateRes.data || []).map(function (r) {
      return { sku_id: r.sku_id, program: (r.skus && r.skus.courses && r.skus.courses.group_name) || 'Kit', level: (r.skus && r.skus.level_name) || '', rate: r.rate, o: (r.skus && r.skus.sort_order) || 0 }
    })
    if (!kits.length && school && (school.registered_courses || []).length) {
      const { data: sk } = await sb.from('skus').select('id, level_name, uf_rate, sort_order, courses(group_name)').in('course_id', school.registered_courses)
      kits = (sk || []).map(function (s) { return { sku_id: s.id, program: (s.courses && s.courses.group_name) || 'Kit', level: s.level_name, rate: s.uf_rate, o: s.sort_order || 0 } })
    }
    kits.sort(function (a, b) { return a.program.localeCompare(b.program) || a.o - b.o })
    const today = new Date().toISOString().slice(0, 10)
    const cis = (ciRes.data || []).filter(function (c) { return !c.ends_on || c.ends_on >= today })
    const sh = {}, tm = {}
    ;(termRes.data || []).forEach(function (t) {
      const key = t.kind === 'kit' ? 'k:' + t.sku_id : 'c:' + t.ci_assignment_id
      sh[key] = String(t.share_amount)
      tm[key] = t.id
    })
    setKitRows(kits)
    setCiRows(cis.map(function (c) { return { id: c.id, ci_name: c.ci_name, program: c.program, level: c.level_label || '', charge: c.monthly_charge } }))
    setShares(sh)
    setTerms(tm)
    setLoading(false)
  }, [schools])

  useEffect(function () { loadSchool(schoolId) }, [schoolId, loadSchool])

  async function save() {
    setSaving(true)
    const by = currentUser && currentUser.email
    const all = kitRows.map(function (k) { return { key: 'k:' + k.sku_id, row: { school_id: schoolId, kind: 'kit', sku_id: k.sku_id } } })
      .concat(ciRows.map(function (c) { return { key: 'c:' + c.id, row: { school_id: schoolId, kind: 'ci', ci_assignment_id: c.id } } }))
    let failed = null
    for (const it of all) {
      const raw = shares[it.key]
      const amt = raw === '' || raw == null ? null : Math.max(0, parseInt(raw, 10) || 0)
      const existing = terms[it.key]
      if (amt == null) {
        if (existing) { const r = await sb.from('cf_commission_terms').delete().eq('id', existing); if (r.error) failed = r.error }
        continue
      }
      const payload = { ...it.row, share_amount: amt, updated_by: by, updated_at: new Date().toISOString() }
      const r = existing
        ? await sb.from('cf_commission_terms').update({ share_amount: amt, updated_by: by, updated_at: payload.updated_at }).eq('id', existing)
        : await sb.from('cf_commission_terms').insert(payload)
      if (r.error) failed = r.error
    }
    setSaving(false)
    if (failed) { showToast('Could not save: ' + failed.message, 'err'); return }
    showToast('CF commission saved ✓')
    loadSchool(schoolId)
  }

  function setShare(key, v) { setShares(function (s) { return { ...s, [key]: v } }) }

  const cell = { width: 90, textAlign: 'right', fontSize: 12 }

  return (
    <div style={{ padding: 20 }}>
      <p className="hint" style={{ marginBottom: 12 }}>
        Admin only — the fixed amount paid to this CF for each school. It is never shown to the school or to the CF.
      </p>
      <label style={{ display: 'block', marginBottom: 14, maxWidth: 360 }}>School
        <select value={schoolId} onChange={function (e) { setSchoolId(e.target.value) }}>
          <option value="">Select a school…</option>
          {schools.map(function (s) { return <option key={s.id} value={s.id}>{s.business_name || s.owner_name}</option> })}
        </select>
      </label>
      {schools.length === 0 && <p className="hint">This CF has no schools yet.</p>}

      {schoolId && (loading ? <div className="loading"><span className="spinner" />Loading…</div> : (
        <>
          <div style={{ font: '700 12px var(--font)', marginBottom: 6 }}>Kits — fixed ₹ per kit</div>
          {kitRows.length === 0 ? <p className="hint">No kit rates set for this school yet.</p> : (
            <div className="tbl-scroll" style={{ marginBottom: 16 }}>
              <table className="data-table">
                <thead><tr><th>Program</th><th>Level</th><th style={{ textAlign: 'right' }}>We charge the school</th><th style={{ textAlign: 'right' }}>CF share (₹ / kit)</th></tr></thead>
                <tbody>
                  {kitRows.map(function (k) {
                    const key = 'k:' + k.sku_id
                    return (
                      <tr key={key}>
                        <td>{k.program}</td><td>{k.level}</td>
                        <td style={{ textAlign: 'right' }}>₹{fmtAmt(k.rate)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input type="number" min={0} disabled={!canEdit} value={shares[key] == null ? '' : shares[key]} onChange={function (e) { setShare(key, e.target.value) }} style={cell} placeholder="0" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ font: '700 12px var(--font)', marginBottom: 6 }}>CIs — fixed ₹ per CI per month</div>
          {ciRows.length === 0 ? <p className="hint">No CIs currently appointed to this school.</p> : (
            <div className="tbl-scroll" style={{ marginBottom: 16 }}>
              <table className="data-table">
                <thead><tr><th>CI</th><th>Program</th><th>Level</th><th style={{ textAlign: 'right' }}>We charge the school</th><th style={{ textAlign: 'right' }}>CF share (₹ / month)</th></tr></thead>
                <tbody>
                  {ciRows.map(function (c) {
                    const key = 'c:' + c.id
                    return (
                      <tr key={key}>
                        <td>{c.ci_name}</td><td>{c.program}</td><td>{c.level || 'All levels'}</td>
                        <td style={{ textAlign: 'right' }}>₹{fmtAmt(c.charge)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input type="number" min={0} disabled={!canEdit} value={shares[key] == null ? '' : shares[key]} onChange={function (e) { setShare(key, e.target.value) }} style={cell} placeholder="0" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {canEdit && <button className="btn-p" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save commission'}</button>}
          <p className="hint" style={{ marginTop: 10 }}>
            The share is locked in when an invoice is issued, so changing it here affects only invoices issued afterwards. Once an invoice is paid, use “Raise Credit Note” on it in Orders to credit the CF.
          </p>
        </>
      ))}
    </div>
  )
}
