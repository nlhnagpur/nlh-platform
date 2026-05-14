import { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, showToast } from '../utils'

export default function PricesPage() {
  const { currentUser } = useAuth()
  const [skus, setSkus] = useState([])
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
      .select('*, courses(name, group_name)')
      .order('course_id')
      .order('level')
    if (error) {
      showToast('Failed to load SKUs: ' + error.message)
    } else {
      setSkus(data || [])
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
        .update({
          uf_rate: ch.uf_rate,
          cf_rate: ch.cf_rate,
          smf_rate: ch.smf_rate,
        })
        .eq('id', skuId)
      if (updateErr) {
        showToast('Error updating SKU ' + skuId + ': ' + updateErr.message)
        errorOccurred = true
        continue
      }
      const { error: histErr } = await sb.from('kit_price_history').insert({
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
      if (histErr) {
        showToast('Error logging history for SKU ' + skuId + ': ' + histErr.message)
        errorOccurred = true
      }
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

  if (loading) return <div className="page-loading">Loading prices…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h2>Kit Prices</h2>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || changedCount === 0}
        >
          {saving ? 'Saving…' : changedCount > 0 ? 'Save ' + changedCount + ' Change' + (changedCount > 1 ? 's' : '') : 'No Changes'}
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Course</th>
              <th>Group</th>
              <th>Level / SKU</th>
              <th>UF Rate (₹)</th>
              <th>CF Rate (₹)</th>
              <th>SMF Rate (₹)</th>
              <th>Student Fee (₹)</th>
            </tr>
          </thead>
          <tbody>
            {skus.map(function (sku) {
              return (
                <tr key={sku.id}>
                  <td>{sku.courses?.name || '—'}</td>
                  <td>{sku.courses?.group_name || '—'}</td>
                  <td className="mono">{sku.name || 'Level ' + sku.level}</td>
                  <td>
                    <input
                      type="number"
                      className={'price-inp' + (isChanged(sku.id, 'uf_rate', sku.uf_rate) ? ' changed' : '')}
                      value={getCurrentVal(sku, 'uf_rate')}
                      onChange={function (e) { handlePriceInput(sku.id, 'uf_rate', e.target.value, sku) }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className={'price-inp' + (isChanged(sku.id, 'cf_rate', sku.cf_rate) ? ' changed' : '')}
                      value={getCurrentVal(sku, 'cf_rate')}
                      onChange={function (e) { handlePriceInput(sku.id, 'cf_rate', e.target.value, sku) }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className={'price-inp' + (isChanged(sku.id, 'smf_rate', sku.smf_rate) ? ' changed' : '')}
                      value={getCurrentVal(sku, 'smf_rate')}
                      onChange={function (e) { handlePriceInput(sku.id, 'smf_rate', e.target.value, sku) }}
                    />
                  </td>
                  <td>{fmtAmt(sku.student_fee)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
