import { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, showToast } from '../utils'

// Tone map for program emoji colors
const TONE_MAP = {
  1: { bg: '#DBEAFE', color: '#2563EB' },
  2: { bg: '#DCFCE7', color: '#16A34A' },
  3: { bg: '#FEF3C7', color: '#D97706' },
  4: { bg: '#FCE7F3', color: '#DB2777' },
  5: { bg: '#E9D5FF', color: '#7C3AED' },
  6: { bg: '#BAE6FD', color: '#0284C7' },
  7: { bg: '#FED7AA', color: '#EA580C' },
  8: { bg: '#FECDD3', color: '#E11D48' },
}

export default function PricesPage() {
  const { currentUser } = useAuth()
  const [skus, setSkus] = useState([])
  // programs = unique group_names, each is { groupName, tone, skuCount }
  const [programs, setPrograms] = useState([])
  const [activeGroup, setActiveGroup] = useState(null)
  const [priceChanges, setPriceChanges] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(function () {
    loadSkus()
  }, [])

  async function loadSkus() {
    setLoading(true)
    const { data, error } = await sb
      .from('skus')
      .select('*, courses(id, name, group_name)')
      .order('sort_order')
    if (error) {
      showToast('Failed to load SKUs: ' + error.message)
    } else {
      const s = data || []
      setSkus(s)

      // Build unique programs by group_name — each group_name = one program in the rail
      const seen = {}
      const programList = []
      s.forEach(function (sku) {
        const gn = sku.courses?.group_name || sku.courses?.name || '—'
        if (!seen[gn]) {
          seen[gn] = true
          programList.push({ groupName: gn, tone: (programList.length % 8) + 1 })
        }
      })
      setPrograms(programList)
      if (programList.length > 0 && !activeGroup) {
        setActiveGroup(programList[0].groupName)
      }
    }
    setLoading(false)
  }

  function handlePriceInput(skuId, field, newVal, originalSku) {
    setPriceChanges(function (prev) {
      const existing = prev[skuId] || {
        uf_rate: originalSku.uf_rate,
        cf_rate: originalSku.cf_rate,
        smf_rate: originalSku.smf_rate,
        old_uf_rate: originalSku.uf_rate,
        old_cf_rate: originalSku.cf_rate,
        old_smf_rate: originalSku.smf_rate,
      }
      return {
        ...prev,
        [skuId]: { ...existing, [field]: parseInt(newVal, 10) || 0 },
      }
    })
  }

  function isChanged(skuId, field, originalVal) {
    if (!priceChanges[skuId]) return false
    return priceChanges[skuId][field] !== originalVal
  }

  async function handleSave() {
    const changedIds = Object.keys(priceChanges)
    if (changedIds.length === 0) {
      showToast('No changes to save.')
      return
    }
    setSaving(true)
    let errorOccurred = false
    for (const skuId of changedIds) {
      const ch = priceChanges[skuId]
      const { error: updateErr } = await sb
        .from('skus')
        .update({ uf_rate: ch.uf_rate, cf_rate: ch.cf_rate, smf_rate: ch.smf_rate })
        .eq('id', skuId)
      if (updateErr) {
        showToast('Error updating SKU: ' + updateErr.message)
        errorOccurred = true
        continue
      }
      await sb.from('kit_price_history').insert({
        sku_id: skuId,
        old_uf_rate: ch.old_uf_rate,
        new_uf_rate: ch.uf_rate,
        old_cf_rate: ch.old_cf_rate,
        new_cf_rate: ch.cf_rate,
        old_smf_rate: ch.old_smf_rate,
        new_smf_rate: ch.smf_rate,
        changed_by: currentUser.email,
        changed_at: new Date().toISOString(),
      })
    }
    if (!errorOccurred) {
      showToast('Prices saved successfully.')
      setPriceChanges({})
      await loadSkus()
    }
    setSaving(false)
  }

  function getCurrentVal(sku, field) {
    if (priceChanges[sku.id] && priceChanges[sku.id][field] !== undefined) {
      return priceChanges[sku.id][field]
    }
    return sku[field]
  }

  const changedCount = Object.keys(priceChanges).length
  // All SKUs whose course's group_name matches the selected program
  const activeSkus = skus.filter(function (s) {
    const gn = s.courses?.group_name || s.courses?.name || '—'
    return gn === activeGroup
  })

  if (loading) return <div className="loading"><span className="spinner" />Loading prices…</div>

  return (
    <div className="pg">
      {/* Topbar */}
      <header className="tb">
        <div className="crumb">Catalog <span className="sep">›</span> <b>Kit Prices</b></div>
        <div className="tb-r">
          <input className="search tb-search" placeholder="Search by SKU…" readOnly />
          {changedCount > 0 && (
            <button className="btn btn-p" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save ' + changedCount + ' Change' + (changedCount > 1 ? 's' : '')}
            </button>
          )}
        </div>
      </header>

      <div className="content">
        {/* Page header */}
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>Catalog</div>
            <h1 className="ph-title">Kit Prices</h1>
            <div className="ph-sub">
              <b>{skus.length} SKUs</b> across {programs.length} programs · tier-specific rates for UF, CF, and SMF.
              Zero renders as <b>Price TBD</b> in the order form.
            </div>
          </div>
        </div>

        {/* Prices layout: sidebar rail + main table */}
        <div className="prices-layout">
          {/* Left rail: program list — one entry per unique group_name */}
          <div className="prices-rail">
            <div className="prices-rail-h">Programs</div>
            {programs.map(function (p) {
              const tone = TONE_MAP[p.tone] || TONE_MAP[1]
              const skuCount = skus.filter(function (s) {
                const gn = s.courses?.group_name || s.courses?.name || '—'
                return gn === p.groupName
              }).length
              // Initials from the first two words of the program name
              const initials = p.groupName.split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()
              return (
                <div
                  key={p.groupName}
                  className={'prices-rail-i ' + (activeGroup === p.groupName ? 'on' : '')}
                  onClick={function () { setActiveGroup(p.groupName) }}
                >
                  <div className="prices-rail-em" style={{ background: tone.bg, color: tone.color }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="prices-rail-name">{p.groupName}</div>
                    <div className="prices-rail-sub">{skuCount} SKU{skuCount !== 1 ? 's' : ''}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Right: price matrix */}
          <div className="prices-main">
            <div className="card-h" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <div className="card-t">{activeGroup || '—'} · Price matrix</div>
                <div className="card-ts">All edits auto-logged · {changedCount > 0 && <span style={{ color: 'var(--amber)' }}>{changedCount} unsaved change{changedCount > 1 ? 's' : ''}</span>}</div>
              </div>
              {changedCount > 0 && (
                <button className="btn btn-p" onClick={handleSave} disabled={saving} style={{ fontSize: 11 }}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              )}
            </div>
            <div className="prices-notice">
              <span>💡</span>
              <span><b>Heads up.</b> Prices are live — changes immediately affect what franchisees see when ordering. A zero rate renders as <b>Price TBD</b>.</span>
            </div>
            <table className="prices-tbl">
              <thead>
                <tr>
                  <th>SKU / Kit</th>
                  <th className="r">UF Rate (₹)</th>
                  <th className="r">CF Rate (₹)</th>
                  <th className="r">SMF Rate (₹)</th>
                  <th className="r">Student Fee</th>
                </tr>
              </thead>
              <tbody>
                {activeSkus.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 24, color: 'var(--text3)', textAlign: 'center' }}>Select a program to view SKUs</td></tr>
                )}
                {activeSkus.map(function (sku) {
                  const ufChanged = isChanged(sku.id, 'uf_rate', sku.uf_rate)
                  const cfChanged = isChanged(sku.id, 'cf_rate', sku.cf_rate)
                  const smfChanged = isChanged(sku.id, 'smf_rate', sku.smf_rate)
                  return (
                    <tr key={sku.id}>
                      <td>
                        <div className="prices-sku-cell">
                          <div className="prices-sku-name">{sku.level_name}</div>
                          <div className="prices-sku-code">{sku.id.slice(0, 8).toUpperCase()}</div>
                        </div>
                      </td>
                      <td>
                        <div className="pinp-wrap">
                          <span className="pinp-cur">₹</span>
                          <input
                            type="number"
                            className={'pinp' + (ufChanged ? ' ch' : '') + (getCurrentVal(sku, 'uf_rate') === 0 ? ' zero' : '')}
                            value={getCurrentVal(sku, 'uf_rate')}
                            onChange={function (e) { handlePriceInput(sku.id, 'uf_rate', e.target.value, sku) }}
                          />
                        </div>
                      </td>
                      <td>
                        <div className="pinp-wrap">
                          <span className="pinp-cur">₹</span>
                          <input
                            type="number"
                            className={'pinp' + (cfChanged ? ' ch' : '') + (getCurrentVal(sku, 'cf_rate') === 0 ? ' zero' : '')}
                            value={getCurrentVal(sku, 'cf_rate')}
                            onChange={function (e) { handlePriceInput(sku.id, 'cf_rate', e.target.value, sku) }}
                          />
                        </div>
                      </td>
                      <td>
                        <div className="pinp-wrap">
                          <span className="pinp-cur">₹</span>
                          <input
                            type="number"
                            className={'pinp' + (smfChanged ? ' ch' : '') + (getCurrentVal(sku, 'smf_rate') === 0 ? ' zero' : '')}
                            value={getCurrentVal(sku, 'smf_rate')}
                            onChange={function (e) { handlePriceInput(sku.id, 'smf_rate', e.target.value, sku) }}
                          />
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', font: '500 12px var(--mono)', color: 'var(--text2)' }}>
                        {sku.student_fee ? '₹' + fmtAmt(sku.student_fee) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
