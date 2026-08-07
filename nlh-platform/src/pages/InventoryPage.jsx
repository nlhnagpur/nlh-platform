import { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { isManagerOrAbove } from '../constants/roles'
import { fmtAmt, fmtDate, showToast } from '../utils'
import ModalHeader from '../components/ModalHeader'
import KitEditorModal from '../components/KitEditorModal'

const CATEGORIES = ['book', 'component', 'material', 'marketing', 'uniform', 'consumable', 'other']
const lbl = { display: 'block', font: '600 11px var(--font)', color: 'var(--text2)', marginBottom: 4 }
const inp = { width: '100%', font: '500 13px var(--font)', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2, #d8d5cc)', boxSizing: 'border-box' }

// ── Add / edit an inventory item ───────────────────────────────────────────
function ItemModal({ item, currentUserId, currentQty, onClose, onSaved }) {
  const editing = !!item
  // Opening stock can be set when creating an item, or for an existing item that
  // still has zero stock. Once it has movements, use Stock → Record receipt.
  const showOpening = !editing || (currentQty || 0) === 0
  const [f, setF] = useState({
    name: item?.name || '', category: item?.category || 'component',
    unit: item?.unit || 'pcs', hsn_code: item?.hsn_code || '', default_cost: item?.default_cost ?? '',
    sell_price: item?.sell_price ?? '', reorder_level: item?.reorder_level ?? '', opening: '',
    is_active: item?.is_active ?? true, notes: item?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setF(function (p) { return { ...p, [k]: v } }) }
  async function save() {
    if (!f.name.trim()) { showToast('Item name is required', 'warn'); return }
    const row = {
      name: f.name.trim(), category: f.category, unit: f.unit.trim() || 'pcs',
      hsn_code: f.hsn_code.trim() || null, default_cost: f.default_cost === '' ? 0 : Math.round(Number(f.default_cost)),
      sell_price: f.sell_price === '' ? 0 : Math.round(Number(f.sell_price)),
      reorder_level: f.reorder_level === '' ? 0 : Math.round(Number(f.reorder_level)), is_active: !!f.is_active, notes: f.notes.trim() || null,
    }
    setSaving(true)
    const { data: saved, error } = editing
      ? await sb.from('inventory_items').update(row).eq('id', item.id).select('id').single()
      : await sb.from('inventory_items').insert(row).select('id').single()
    if (error) { setSaving(false); showToast(/duplicate|unique/i.test(error.message) ? 'That item code already exists' : 'Save failed: ' + error.message, 'err'); return }
    // Opening stock → first receipt in the ledger
    const openQ = f.opening === '' ? 0 : Math.round(Number(f.opening))
    if (showOpening && openQ > 0 && saved?.id) {
      await sb.from('stock_ledger').insert({
        item_id: saved.id, location_type: 'ho', movement_type: 'receipt', qty: openQ,
        unit_cost: row.default_cost || null, ref_type: 'manual', note: 'Opening stock', created_by: currentUserId || null,
      })
    }
    setSaving(false)
    showToast(editing ? 'Item updated' : 'Item added')
    onSaved()
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }} style={{ padding: 0, overflow: 'hidden', width: 520, maxWidth: '96vw' }}>
        <ModalHeader title={editing ? 'Edit Item' : 'New Item'} subtitle="New Learning Horizons · Inventory" onClose={onClose} />
        <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ gridColumn: 'span 2' }}><span style={lbl}>Item name</span>
            <input value={f.name} onChange={function (e) { set('name', e.target.value) }} placeholder="e.g. Jr Abacus L1 — Practice Book" autoFocus style={inp} /></label>
          <label><span style={lbl}>Item code</span>
            <input value={editing ? item.item_code : 'Auto-generated (ITM-…)'} disabled
              style={Object.assign({}, inp, { fontFamily: 'var(--mono)', color: 'var(--text3)', background: 'var(--bg2,#f5f4f0)' })} /></label>
          <label><span style={lbl}>Category</span>
            <select value={f.category} onChange={function (e) { set('category', e.target.value) }} style={inp}>
              {CATEGORIES.map(function (c) { return <option key={c} value={c}>{c}</option> })}</select></label>
          <label><span style={lbl}>Unit</span>
            <input value={f.unit} onChange={function (e) { set('unit', e.target.value) }} placeholder="pcs / set / box" style={inp} /></label>
          <label><span style={lbl}>HSN code (GST)</span>
            <input value={f.hsn_code} onChange={function (e) { set('hsn_code', e.target.value) }} placeholder="optional" style={inp} /></label>
          <label><span style={lbl}>Cost price (₹)</span>
            <input type="number" value={f.default_cost} onChange={function (e) { set('default_cost', e.target.value) }} placeholder="what we pay" style={inp} /></label>
          <label><span style={lbl}>Selling price (₹)
            <span style={{ fontWeight: 400, color: 'var(--text3)' }}> · if sold separately</span></span>
            <input type="number" value={f.sell_price} onChange={function (e) { set('sell_price', e.target.value) }} placeholder="replacement / standalone price" style={inp} /></label>
          <label><span style={lbl}>Reorder level</span>
            <input type="number" value={f.reorder_level} onChange={function (e) { set('reorder_level', e.target.value) }} placeholder="0" style={inp} /></label>
          {showOpening ? (
            <label style={{ gridColumn: 'span 2' }}><span style={lbl}>📦 Opening stock (HO)
              <span style={{ fontWeight: 400, color: 'var(--text3)' }}> · current count in hand</span></span>
              <input type="number" value={f.opening} onChange={function (e) { set('opening', e.target.value) }} placeholder="e.g. 50 — recorded as the first receipt" style={inp} /></label>
          ) : (
            <div style={{ gridColumn: 'span 2', font: '500 12px var(--font)', color: 'var(--text3)', alignSelf: 'center' }}>
              In stock: <b style={{ color: 'var(--text)' }}>{currentQty}</b> {f.unit}. To change, use <b>Stock ledger → 📥 Record receipt</b>.
            </div>
          )}
          <label style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={f.is_active} onChange={function (e) { set('is_active', e.target.checked) }} />
            <span style={{ font: '600 13px var(--font)' }}>Active</span></label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save' : 'Add item'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Add a standalone supply SKU (no course) ────────────────────────────────
function SupplyModal({ onClose, onSaved }) {
  const [f, setF] = useState({ level_name: '', supply_category: '', uf_rate: '', cf_rate: '', smf_rate: '' })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setF(function (p) { return { ...p, [k]: v } }) }
  async function save() {
    if (!f.level_name.trim()) { showToast('Name is required', 'warn'); return }
    setSaving(true)
    const { error } = await sb.from('skus').insert({
      level_name: f.level_name.trim(), sku_type: 'supply', course_id: null,
      supply_category: f.supply_category.trim() || 'General',
      uf_rate: f.uf_rate === '' ? 0 : Math.round(Number(f.uf_rate)),
      cf_rate: f.cf_rate === '' ? 0 : Math.round(Number(f.cf_rate)),
      smf_rate: f.smf_rate === '' ? 0 : Math.round(Number(f.smf_rate)),
      is_active: true,
    })
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    showToast('Supply SKU added')
    onSaved()
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }} style={{ padding: 0, overflow: 'hidden', width: 480, maxWidth: '96vw' }}>
        <ModalHeader title="New Supply SKU" subtitle="Non-course franchisee supply" onClose={onClose} />
        <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ gridColumn: 'span 2' }}><span style={lbl}>Name</span>
            <input value={f.level_name} onChange={function (e) { set('level_name', e.target.value) }} placeholder="e.g. NLH Branded Banner (6x3)" style={inp} /></label>
          <label style={{ gridColumn: 'span 2' }}><span style={lbl}>Category</span>
            <input value={f.supply_category} onChange={function (e) { set('supply_category', e.target.value) }} placeholder="Marketing / Signage / Stationery" style={inp} /></label>
          <label><span style={lbl}>UF rate (₹)</span><input type="number" value={f.uf_rate} onChange={function (e) { set('uf_rate', e.target.value) }} style={inp} /></label>
          <label><span style={lbl}>CF rate (₹)</span><input type="number" value={f.cf_rate} onChange={function (e) { set('cf_rate', e.target.value) }} style={inp} /></label>
          <label><span style={lbl}>SMF rate (₹)</span><input type="number" value={f.smf_rate} onChange={function (e) { set('smf_rate', e.target.value) }} style={inp} /></label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add supply'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Record a stock receipt (goods in) ──────────────────────────────────────
function ReceiptModal({ items, currentUserId, onClose, onSaved }) {
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    const q = Math.round(Number(qty))
    if (!itemId) { showToast('Pick an item', 'warn'); return }
    if (!q || q <= 0) { showToast('Enter a positive quantity', 'warn'); return }
    setSaving(true)
    const { error } = await sb.from('stock_ledger').insert({
      item_id: itemId, location_type: 'ho', movement_type: 'receipt', qty: q,
      unit_cost: cost === '' ? null : Math.round(Number(cost)), ref_type: 'purchase',
      note: note.trim() || null, created_by: currentUserId || null,
      created_at: (date || new Date().toISOString().slice(0, 10)) + 'T12:00:00+00:00',
    })
    setSaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    showToast('Stock received ✓')
    onSaved()
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }} style={{ padding: 0, overflow: 'hidden', width: 460, maxWidth: '96vw' }}>
        <ModalHeader title="Record Stock Receipt" subtitle="Goods received at HO" onClose={onClose} />
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label><span style={lbl}>Item</span>
            <select value={itemId} onChange={function (e) { setItemId(e.target.value) }} style={inp}>
              <option value="">— select item —</option>
              {(items || []).filter(function (i) { return i.is_active !== false }).map(function (i) { return <option key={i.id} value={i.id}>{i.name}</option> })}
            </select></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label><span style={lbl}>Quantity received</span><input type="number" value={qty} onChange={function (e) { setQty(e.target.value) }} autoFocus style={inp} /></label>
            <label><span style={lbl}>Receipt date</span><input type="date" value={date} onChange={function (e) { setDate(e.target.value) }} style={inp} /></label>
            <label><span style={lbl}>Unit cost (₹, optional)</span><input type="number" value={cost} onChange={function (e) { setCost(e.target.value) }} style={inp} /></label>
          </div>
          <label><span style={lbl}>Note / supplier (optional)</span><input value={note} onChange={function (e) { setNote(e.target.value) }} placeholder="e.g. GRN-1023, Vendor X" style={inp} /></label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>{saving ? 'Saving…' : '+ Add to stock'}</button>
        </div>
      </div>
    </div>
  )
}

const MOVE_LABEL = {
  receipt: '📥 Receipt', issue_to_franchisee: '📦 Dispatch', receive_from_ho: '↘ Received',
  issue_to_student: '🎓 Issued', adjustment: '⚙ Adjustment', return: '↩ Return',
}

export default function InventoryPage() {
  const { currentRole, currentUser } = useAuth()
  const canManage = isManagerOrAbove(currentRole)

  const [tab, setTab]       = useState('items')   // items | kits | stock
  const [items, setItems]   = useState([])
  const [skus, setSkus]     = useState([])
  const [ledger, setLedger] = useState([])
  const [kitCounts, setKitCounts] = useState({})  // sku_id -> item count
  const [loading, setLoad]  = useState(true)
  const [search, setSearch] = useState('')

  // Per-item stock card (Stock ledger tab) — pick an item to see its full
  // opening/inward/outward/closing statement, not just the last 500 rows.
  const [stockItemId, setStockItemId] = useState('')
  const [stockItemLedger, setStockItemLedger] = useState(null)
  const [stockItemLoading, setStockItemLoading] = useState(false)

  const [itemModal, setItemModal] = useState(null)   // 'new' | item
  const [supplyModal, setSupplyModal] = useState(false)
  const [receiptModal, setReceiptModal] = useState(false)
  const [kitSku, setKitSku] = useState(null)

  useEffect(function () { load() }, [])
  async function load() {
    setLoad(true)
    const [it, sk, lg, ki] = await Promise.all([
      sb.from('inventory_items').select('*').order('name'),
      sb.from('skus').select('id, level_name, sku_type, supply_category, course_id, courses(group_name)').order('sort_order', { nullsFirst: false }),
      sb.from('stock_ledger').select('*').order('created_at', { ascending: false }).limit(500),
      sb.from('kit_items').select('sku_id'),
    ])
    setItems(it.data || [])
    setSkus(sk.data || [])
    setLedger(lg.data || [])
    const counts = {}
    ;(ki.data || []).forEach(function (r) { counts[r.sku_id] = (counts[r.sku_id] || 0) + 1 })
    setKitCounts(counts)
    setLoad(false)
  }

  // HO balance per item
  const balance = {}
  ledger.forEach(function (l) { if (l.location_type === 'ho') balance[l.item_id] = (balance[l.item_id] || 0) + (l.qty || 0) })
  function itemById(id) { return items.find(function (i) { return i.id === id }) }

  // Full history for one item (the capped/newest-500 `ledger` above isn't
  // reliable for an all-time opening/inward/outward/closing statement).
  async function loadItemLedger(id) {
    setStockItemLoading(true)
    const res = await sb.from('stock_ledger').select('*').eq('item_id', id).order('created_at', { ascending: true })
    setStockItemLedger(res.data || [])
    setStockItemLoading(false)
  }
  useEffect(function () {
    if (!stockItemId) { setStockItemLedger(null); return }
    loadItemLedger(stockItemId)
  }, [stockItemId])

  async function deleteLedger(l) {
    const it = items.find(function (i) { return i.id === l.item_id })
    if (!window.confirm('Remove this stock entry (' + (l.qty > 0 ? '+' : '') + l.qty + ' ' + (it ? it.name : '') + ')? The balance will be recalculated.')) return
    const { error } = await sb.from('stock_ledger').delete().eq('id', l.id)
    if (error) { showToast('Delete failed: ' + error.message, 'err'); return }
    showToast('Stock entry removed'); load()
  }

  async function deleteSupply(s) {
    if (!window.confirm('Delete supply “' + s.level_name + '”?')) return
    const { error } = await sb.from('skus').delete().eq('id', s.id)
    if (error) { showToast('Cannot delete — it is used on an order/invoice. Deactivate it instead.', 'warn'); return }
    showToast('Supply removed'); load()
  }

  async function removeItem(it) {
    if (!window.confirm('Delete item "' + it.name + '"? (Blocked if it is used in any kit or has stock movements.)')) return
    const { error } = await sb.from('inventory_items').delete().eq('id', it.id)
    if (error) { showToast('Cannot delete — it is referenced by a kit or the ledger. Mark it inactive instead.', 'warn'); return }
    showToast('Item deleted'); load()
  }

  const q = search.trim().toLowerCase()
  const filteredItems = items.filter(function (i) {
    return !q || (i.name || '').toLowerCase().includes(q) || (i.item_code || '').toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q)
  })
  const courseKits = skus.filter(function (s) { return (s.sku_type || 'course_kit') === 'course_kit' })
  const supplies   = skus.filter(function (s) { return s.sku_type === 'supply' })
  const lowStock = items.filter(function (i) { return (i.reorder_level || 0) > 0 && (balance[i.id] || 0) <= (i.reorder_level || 0) }).length

  return (
    <div className="pg">
      <header className="tb">
        <div className="crumb">Settings <span className="sep">›</span> <b>Inventory & Kits</b></div>
        <div className="tb-r">
          <input className="search tb-search" placeholder="Search items…" value={search} onChange={function (e) { setSearch(e.target.value) }} />
          {canManage && tab === 'items' && <button className="btn-s" onClick={function () { setSupplyModal(true) }}>+ Supply</button>}
          {canManage && tab === 'items' && <button className="btn-p" onClick={function () { setItemModal('new') }}>+ New item</button>}
          {canManage && tab === 'stock' && <button className="btn-p" onClick={function () { setReceiptModal(true) }}>📥 Record receipt</button>}
        </div>
      </header>

      <div className="content">
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>Supply chain</div>
            <h1 className="ph-title">Inventory & Kits</h1>
            <div className="ph-sub">
              <b>{items.length} items</b> · {skus.filter(function (s) { return (s.sku_type || 'course_kit') === 'course_kit' }).length} course kits · {skus.filter(function (s) { return s.sku_type === 'supply' }).length} supplies
              {lowStock > 0 && <span style={{ color: 'var(--red,#dc2626)', fontWeight: 600 }}> · {lowStock} low on stock</span>}
            </div>
          </div>
        </div>

        <div className="status-pills" style={{ marginBottom: 14 }}>
          {[['items', '📦 Item stock & Supplies'], ['kits', '🧰 Course kits'], ['stock', '📜 Stock ledger']].map(function (t) {
            return <button key={t[0]} className={'sp' + (tab === t[0] ? ' on on-pend' : '')} onClick={function () { setTab(t[0]) }}>{t[1]}</button>
          })}
        </div>

        {loading ? (
          <div className="loading"><span className="spinner" />Loading inventory…</div>
        ) : tab === 'items' ? (
          <>
            {filteredItems.length === 0 ? <div className="empty">No items yet. Add your kit components (books, tools, bags…).</div> : (
            <div className="card tbl-scroll" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="big-tbl">
                <thead><tr><th>Item</th><th className="hide-mobile">Category</th><th className="hide-mobile" style={{ textAlign: 'right' }}>Sell ₹</th><th style={{ textAlign: 'right' }}>In stock (HO)</th><th className="hide-mobile" style={{ textAlign: 'right' }}>Reorder</th>{canManage && <th style={{ textAlign: 'right' }}>Actions</th>}</tr></thead>
                <tbody>
                  {filteredItems.map(function (i) {
                    const bal = balance[i.id] || 0
                    const low = (i.reorder_level || 0) > 0 && bal <= (i.reorder_level || 0)
                    return (
                      <tr key={i.id} style={{ opacity: i.is_active === false ? 0.5 : 1 }}>
                        <td><div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>{i.name}</div>
                          {i.item_code && <div style={{ font: '500 10px var(--mono)', color: 'var(--text3)' }}>{i.item_code}</div>}</td>
                        <td className="hide-mobile" style={{ fontSize: 12, color: 'var(--text2)' }}>{i.category}</td>
                        <td className="hide-mobile" style={{ textAlign: 'right', font: '600 12px var(--mono)', color: i.sell_price ? 'var(--text)' : 'var(--text3)' }}>{i.sell_price ? '₹' + fmtAmt(i.sell_price) : '—'}</td>
                        <td style={{ textAlign: 'right', font: '700 13px var(--mono)', color: low ? 'var(--red,#dc2626)' : 'var(--text)' }}>
                          {bal} {i.unit}{low && <span title="At or below reorder level"> 🔴</span>}</td>
                        <td className="hide-mobile" style={{ textAlign: 'right', fontSize: 12, color: 'var(--text3)' }}>{i.reorder_level || '—'}</td>
                        {canManage && (
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button className="btn-s" style={{ padding: '4px 9px', marginRight: 4 }} onClick={function () { setItemModal(i) }}>Edit</button>
                            <button className="btn-s" style={{ padding: '4px 9px', color: 'var(--red,#dc2626)' }} onClick={function () { removeItem(i) }}>Delete</button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            )}

            {/* ── Supplies: priced services & documents (no stock) ── */}
            <div style={{ marginTop: 22, marginBottom: 8, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ font: '700 14px var(--font)', color: 'var(--text)', margin: 0 }}>Supplies</h3>
              <span style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>priced services &amp; documents — banners, certificates, agreements</span>
            </div>
            {supplies.length === 0 ? (
              <div className="empty" style={{ padding: 18 }}>No supplies yet.{canManage ? ' Add one with “+ Supply”.' : ''}</div>
            ) : (
              <div className="card tbl-scroll" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="big-tbl">
                  <thead><tr><th>Supply</th><th className="hide-mobile">Category</th>{canManage && <th style={{ textAlign: 'right' }}>Actions</th>}</tr></thead>
                  <tbody>
                    {supplies.map(function (s) {
                      return (
                        <tr key={s.id}>
                          <td><div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>{s.level_name}</div></td>
                          <td className="hide-mobile" style={{ fontSize: 12, color: 'var(--text2)' }}>{s.supply_category || '—'}</td>
                          {canManage && <td style={{ textAlign: 'right' }}><button className="btn-s" style={{ padding: '4px 10px', color: 'var(--red,#dc2626)' }} onClick={function () { deleteSupply(s) }}>Delete</button></td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : tab === 'kits' ? (
          courseKits.length === 0 ? <div className="empty">No course kits.</div> : (
            <div className="card tbl-scroll" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="big-tbl">
                <thead><tr><th>SKU</th><th className="hide-mobile">Course</th><th style={{ textAlign: 'center' }}>Kit items</th>{canManage && <th style={{ textAlign: 'right' }}>Actions</th>}</tr></thead>
                <tbody>
                  {courseKits.map(function (s) {
                    const n = kitCounts[s.id] || 0
                    const label = (s.courses?.group_name ? s.courses.group_name + ' — ' : '') + s.level_name
                    return (
                      <tr key={s.id}>
                        <td><div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>{s.level_name}</div></td>
                        <td className="hide-mobile" style={{ fontSize: 12, color: 'var(--text2)' }}>{s.courses?.group_name || '—'}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ font: '700 12px var(--mono)', color: n > 0 ? 'var(--green,#1D7A4F)' : 'var(--text3)' }}>{n}</span>
                          <span style={{ color: 'var(--text3)', fontSize: 11 }}> item{n !== 1 ? 's' : ''}</span>
                        </td>
                        {canManage && (
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn-s" style={{ padding: '4px 10px' }} onClick={function () { setKitSku({ id: s.id, label: label }) }}>🧰 Edit kit</button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>View item:</span>
                <select value={stockItemId} onChange={function (e) { setStockItemId(e.target.value) }}
                  style={{ font: '500 13px var(--font)', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border2, #d8d5cc)', minWidth: 260 }}>
                  <option value="">— all items (recent activity) —</option>
                  {items.slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || '') }).map(function (i) {
                    return <option key={i.id} value={i.id}>{i.name}{i.item_code ? ' (' + i.item_code + ')' : ''}</option>
                  })}
                </select>
              </label>
              {stockItemId && <button className="btn-s" onClick={function () { setStockItemId('') }}>✕ Clear</button>}
            </div>

            {stockItemId ? (
              stockItemLoading ? (
                <div className="loading"><span className="spinner" />Loading item history…</div>
              ) : (function () {
                const rows = stockItemLedger || []
                const it = itemById(stockItemId)
                const opening = rows.filter(function (r) { return r.note === 'Opening stock' }).reduce(function (s, r) { return s + (r.qty || 0) }, 0)
                const movementRows = rows.filter(function (r) { return r.note !== 'Opening stock' })
                const inward  = movementRows.filter(function (r) { return (r.qty || 0) > 0 }).reduce(function (s, r) { return s + r.qty }, 0)
                const outward = movementRows.filter(function (r) { return (r.qty || 0) < 0 }).reduce(function (s, r) { return s + Math.abs(r.qty) }, 0)
                const closing = opening + inward - outward
                let running = 0
                const card = { padding: '14px 18px', borderRadius: 10, background: 'var(--bg2,#f5f4f0)', minWidth: 130 }
                const cardLbl = { font: '600 10px var(--font)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }
                return (
                  <>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
                      <div style={card}><div style={cardLbl}>Opening</div><div style={{ font: '700 20px var(--mono)', color: 'var(--text)' }}>{opening}</div></div>
                      <div style={card}><div style={cardLbl}>Inward</div><div style={{ font: '700 20px var(--mono)', color: 'var(--green,#1D7A4F)' }}>+{inward}</div></div>
                      <div style={card}><div style={cardLbl}>Outward</div><div style={{ font: '700 20px var(--mono)', color: 'var(--red,#dc2626)' }}>−{outward}</div></div>
                      <div style={Object.assign({}, card, { background: 'var(--purple-bg,#EDE9FF)' })}><div style={cardLbl}>Closing</div><div style={{ font: '700 20px var(--mono)', color: 'var(--purple)' }}>{closing} {it?.unit}</div></div>
                    </div>
                    {rows.length === 0 ? <div className="empty">No stock movements yet for this item.</div> : (
                      <div className="card tbl-scroll" style={{ padding: 0, overflow: 'hidden' }}>
                        <table className="big-tbl">
                          <thead><tr><th>When</th><th>Type</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Balance</th><th className="hide-mobile">Note</th>{canManage && <th style={{ textAlign: 'right' }}>Actions</th>}</tr></thead>
                          <tbody>
                            {rows.map(function (l) {
                              running += (l.qty || 0)
                              return (
                                <tr key={l.id}>
                                  <td className="mono" style={{ whiteSpace: 'nowrap', color: 'var(--text3)', fontSize: 11 }}>{fmtDate(l.created_at)}</td>
                                  <td style={{ fontSize: 12 }}>{l.note === 'Opening stock' ? '🏁 Opening' : (MOVE_LABEL[l.movement_type] || l.movement_type)}</td>
                                  <td style={{ textAlign: 'right', font: '700 13px var(--mono)', color: l.qty < 0 ? 'var(--red,#dc2626)' : 'var(--green,#1D7A4F)' }}>{l.qty > 0 ? '+' : ''}{l.qty}</td>
                                  <td style={{ textAlign: 'right', font: '600 12px var(--mono)', color: 'var(--text2)' }}>{running}</td>
                                  <td className="hide-mobile" style={{ fontSize: 12, color: 'var(--text3)' }}>{l.note && l.note !== 'Opening stock' ? l.note : (l.ref_type === 'order' ? 'Order dispatch' : '')}</td>
                                  {canManage && (
                                    <td style={{ textAlign: 'right' }}>
                                      <button className="btn-s" style={{ fontSize: 10, padding: '2px 7px', color: 'var(--red,#dc2626)', borderColor: 'var(--red,#dc2626)' }}
                                        title="Remove this stock entry" onClick={function () { deleteLedger(l).then(function () { loadItemLedger(stockItemId) }) }}>🗑</button>
                                    </td>
                                  )}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )
              })()
            ) : (
              ledger.length === 0 ? <div className="empty">No stock movements yet. Record a receipt to start.</div> : (
                <div className="card tbl-scroll" style={{ padding: 0, overflow: 'hidden' }}>
                  <table className="big-tbl">
                    <thead><tr><th>When</th><th>Item</th><th>Type</th><th style={{ textAlign: 'right' }}>Qty</th><th className="hide-mobile">Note</th>{canManage && <th style={{ textAlign: 'right' }}>Actions</th>}</tr></thead>
                    <tbody>
                      {(q ? ledger.filter(function (l) { const it = itemById(l.item_id); return it && (it.name || '').toLowerCase().includes(q) }) : ledger).map(function (l) {
                        const it = itemById(l.item_id)
                        return (
                          <tr key={l.id}>
                            <td className="mono" style={{ whiteSpace: 'nowrap', color: 'var(--text3)', fontSize: 11 }}>{fmtDate(l.created_at)}</td>
                            <td style={{ fontSize: 12 }}>{it ? it.name : '—'}</td>
                            <td style={{ fontSize: 12 }}>{MOVE_LABEL[l.movement_type] || l.movement_type}</td>
                            <td style={{ textAlign: 'right', font: '700 13px var(--mono)', color: l.qty < 0 ? 'var(--red,#dc2626)' : 'var(--green,#1D7A4F)' }}>{l.qty > 0 ? '+' : ''}{l.qty}</td>
                            <td className="hide-mobile" style={{ fontSize: 12, color: 'var(--text3)' }}>{l.note || (l.ref_type === 'order' ? 'Order dispatch' : '')}</td>
                            {canManage && (
                              <td style={{ textAlign: 'right' }}>
                                <button className="btn-s" style={{ fontSize: 10, padding: '2px 7px', color: 'var(--red,#dc2626)', borderColor: 'var(--red,#dc2626)' }}
                                  title="Remove this stock entry" onClick={function () { deleteLedger(l) }}>🗑</button>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </>
        )}
      </div>

      {itemModal && <ItemModal item={itemModal === 'new' ? null : itemModal} currentUserId={currentUser?.id} currentQty={itemModal === 'new' ? 0 : (balance[itemModal.id] || 0)} onClose={function () { setItemModal(null) }} onSaved={function () { setItemModal(null); load() }} />}
      {supplyModal && <SupplyModal onClose={function () { setSupplyModal(false) }} onSaved={function () { setSupplyModal(false); load() }} />}
      {receiptModal && <ReceiptModal items={items} currentUserId={currentUser?.id} onClose={function () { setReceiptModal(false) }} onSaved={function () { setReceiptModal(false); load() }} />}
      {kitSku && <KitEditorModal sku={kitSku} items={items} onClose={function () { setKitSku(null) }} onSaved={function () { setKitSku(null); load() }} />}
    </div>
  )
}
