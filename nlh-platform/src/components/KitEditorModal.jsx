import { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { showToast } from '../utils'
import ModalHeader from './ModalHeader'

// Edit the bill-of-materials (kit_items) for one SKU.
// props: sku { id, label }, items (all active inventory_items), onClose, onSaved
export default function KitEditorModal({ sku, items, onClose, onSaved }) {
  const [rows, setRows]     = useState([])   // [{ item_id, quantity }]
  const [loading, setLoad]  = useState(true)
  const [saving, setSaving] = useState(false)
  const [pick, setPick]     = useState('')

  useEffect(function () {
    sb.from('kit_items').select('item_id, quantity').eq('sku_id', sku.id)
      .then(function (res) { setRows((res.data || []).map(function (r) { return { item_id: r.item_id, quantity: Number(r.quantity) || 1 } })); setLoad(false) })
  }, [sku.id])

  const usedIds = rows.map(function (r) { return r.item_id })
  const available = (items || []).filter(function (i) { return i.is_active !== false && !usedIds.includes(i.id) })
  function itemName(id) { const i = (items || []).find(function (x) { return x.id === id }); return i ? i.name : '—' }
  function itemUnit(id) { const i = (items || []).find(function (x) { return x.id === id }); return i ? i.unit : '' }

  function addItem() {
    if (!pick) return
    setRows(function (r) { return r.concat({ item_id: pick, quantity: 1 }) })
    setPick('')
  }
  function setQty(id, q) { setRows(function (r) { return r.map(function (x) { return x.item_id === id ? { ...x, quantity: q } : x }) }) }
  function remove(id) { setRows(function (r) { return r.filter(function (x) { return x.item_id !== id }) }) }

  async function save() {
    setSaving(true)
    // Full replace — small lists, keeps it simple and consistent
    const { error: delErr } = await sb.from('kit_items').delete().eq('sku_id', sku.id)
    if (delErr) { setSaving(false); showToast('Save failed: ' + delErr.message, 'err'); return }
    const insert = rows
      .filter(function (r) { return r.item_id && Number(r.quantity) > 0 })
      .map(function (r) { return { sku_id: sku.id, item_id: r.item_id, quantity: Number(r.quantity) } })
    if (insert.length) {
      const { error } = await sb.from('kit_items').insert(insert)
      if (error) { setSaving(false); showToast('Save failed: ' + error.message, 'err'); return }
    }
    setSaving(false)
    showToast('Kit contents saved ✓')
    if (onSaved) onSaved(sku.id, insert.length)
    onClose()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }} style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '92vh', width: 520, maxWidth: '96vw' }}>
        <ModalHeader title="Kit Contents" subtitle={sku.label} onClose={onClose} />
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, background: 'var(--bg2, #FAFAF8)' }}>
          {loading ? (
            <div className="hint">Loading…</div>
          ) : (
            <>
              {rows.length === 0 ? (
                <p className="hint" style={{ marginTop: 0 }}>No items yet. Add the items that make up this kit.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                  {rows.map(function (r) {
                    return (
                      <div key={r.item_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: '#fff', border: '1px solid var(--border)' }}>
                        <span style={{ flex: 1, font: '600 13px var(--font)', color: 'var(--text)' }}>{itemName(r.item_id)}</span>
                        <input type="number" min="1" value={r.quantity}
                          onChange={function (e) { setQty(r.item_id, e.target.value) }}
                          style={{ width: 70, fontSize: 13 }} />
                        <span style={{ font: '500 11px var(--mono)', color: 'var(--text3)', width: 34 }}>{itemUnit(r.item_id)}</span>
                        <button className="btn-s" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--red,#dc2626)' }} onClick={function () { remove(r.item_id) }}>✕</button>
                      </div>
                    )
                  })}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6 }}>
                <select value={pick} onChange={function (e) { setPick(e.target.value) }} style={{ flex: 1, fontSize: 13 }}>
                  <option value="">— add an item —</option>
                  {available.map(function (i) { return <option key={i.id} value={i.id}>{i.name}{i.item_code ? ' (' + i.item_code + ')' : ''}</option> })}
                </select>
                <button className="btn-s" onClick={addItem} disabled={!pick}>+ Add</button>
              </div>
              {available.length === 0 && (items || []).length === 0 && (
                <p className="hint" style={{ marginTop: 10 }}>No inventory items exist yet — add some in the Items tab first.</p>
              )}
            </>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--border)', background: '#fff' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving || loading}>{saving ? 'Saving…' : 'Save kit'}</button>
        </div>
      </div>
    </div>
  )
}
