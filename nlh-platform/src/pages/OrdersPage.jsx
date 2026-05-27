import React, { useState, useEffect } from 'react'
import { jsPDF } from 'jspdf'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast } from '../utils'
import { isAdminRole } from '../constants/roles'
import { getDescendantIds, getTreeIds } from '../utils/hierarchy'
import { sendInvoiceEmail, sendPaymentReminder, sendPaymentVerified } from '../services/email'
import { sendWAOrderInvoiced, sendWAOrderDispatched } from '../services/whatsapp'
import InvoiceView from '../components/InvoiceView'

// JSX badge components
function StatusBadge({ status }) {
  const map = {
    pending:           { cls: 'bdg-pend', txt: 'pending' },
    invoiced:          { cls: 'bdg-inv',  txt: 'invoiced' },
    payment_submitted: { cls: 'bdg-pmt',  txt: 'pmt submitted' },
    verified:          { cls: 'bdg-paid', txt: 'verified' },
    closed:            { cls: 'bdg-paid', txt: 'closed' },
    part_paid:         { cls: 'bdg-pmt',  txt: 'part paid' },
  }
  const s = map[status] || { cls: '', txt: status || '—' }
  return <span className={'bdg ' + s.cls}><span className="d"></span>{s.txt}</span>
}

function PaymentBadge({ order }) {
  if (!order.amount_paid) return null
  if (order.payment_verified_at)  return <span className="badge ba">Paid ✓</span>
  if (order.payment_submitted_at) return <span className="badge bpu">Pmt Submitted</span>
  return <span className="badge bp">Part Paid</span>
}

function TierBadge({ tier }) {
  if (!tier) return null
  const cls = { NLH: 't-nlh', SMF: 't-smf', CF: 't-cf', UF: 't-uf' }[tier] || ''
  return <span className={'tier ' + cls}>{tier}</span>
}

const FILTER_LABELS = {
  all: 'All', pending: 'Pending', invoiced: 'Invoiced',
  payment_submitted: 'Pmt Submitted', closed: 'Closed',
}

// ---------------------------------------------------------------------------
// PaySubmitModal — franchisee submits payment proof
// ---------------------------------------------------------------------------
function PaySubmitModal({ order, onClose, onSaved }) {
  const [mode, setMode] = useState('upi')
  const [utr, setUtr] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    if (!utr.trim()) { showToast('Please enter UTR / reference number.'); return }
    setSaving(true)
    const { error } = await sb
      .from('orders')
      .update({
        payment_mode: mode,
        payment_ref: utr.trim(),
        payment_submitted_at: new Date().toISOString(),
        status: 'payment_submitted',
      })
      .eq('id', order.id)
    if (error) {
      showToast('Failed to submit payment: ' + error.message)
    } else {
      showToast('Payment details submitted.')
      onSaved()
    }
    setSaving(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>Submit Payment Proof</h3>
          <button style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}} onClick={onClose}>×</button>
        </div>
        <div >
          <div className="fr">
            <label>Payment Mode</label>
            <select value={mode} onChange={function (e) { setMode(e.target.value) }}>
              <option value="upi">UPI</option>
              <option value="neft">NEFT / RTGS</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
          <div className="fr">
            <label>UTR / Reference Number</label>
            <input
              type="text"
              placeholder="Enter transaction reference"
              value={utr}
              onChange={function (e) { setUtr(e.target.value) }}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-s" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Submitting…' : 'Submit Payment'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// RecordPaymentModal — admin records payment with mode, UTR, part/full logic
// ---------------------------------------------------------------------------
function RecordPaymentModal({ order, onClose, onSaved }) {
  const total = order.grand_total || 0
  const remaining = Math.max(0, total - (order.amount_paid || 0))
  const [amountPaid, setAmountPaid] = useState(remaining > 0 ? String(remaining) : '')
  const [mode, setMode]             = useState(order.payment_mode || 'upi')
  const [ref,  setRef]              = useState(order.payment_ref  || '')
  const [saving, setSaving]         = useState(false)

  const amt    = parseInt(amountPaid, 10) || 0
  const isFull = (order.amount_paid || 0) + amt >= total && total > 0
  const isPart = amt > 0 && !isFull

  // Close a zero-value order directly (free / gifted / already noted)
  async function handleCloseZero() {
    setSaving(true)
    const { error } = await sb.from('orders').update({ status: 'closed', payment_verified_at: new Date().toISOString() }).eq('id', order.id)
    setSaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err') }
    else { showToast('Order closed.'); onSaved() }
  }

  async function handleSave() {
    if (isNaN(amt) || amt <= 0) { showToast('Enter a valid amount greater than zero.', 'warn'); return }
    setSaving(true)
    const newStatus = isFull ? 'closed' : 'part_paid'
    const { error } = await sb.from('orders').update({
      amount_paid:         (order.amount_paid || 0) + amt,
      payment_mode:        mode,
      payment_ref:         ref.trim() || null,
      payment_verified_at: isFull ? new Date().toISOString() : null,
      status:              newStatus,
    }).eq('id', order.id)
    if (error) {
      showToast('Failed to record payment: ' + error.message, 'err')
    } else {
      showToast(isFull ? '✓ Full payment recorded — order closed.' : `Part payment of ₹${fmtAmt(amt)} recorded.`)
      onSaved()
    }
    setSaving(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>Record Payment</h3>
          <button style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--text3)'}} onClick={onClose}>×</button>
        </div>
        <div>
          {/* Order total summary */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
            background:'var(--bg2)', borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
            <div>
              <div style={{ fontSize:11, color:'var(--text3)' }}>Order Total</div>
              <div style={{ fontSize:18, fontWeight:700, fontFamily:'var(--mono)' }}>₹{fmtAmt(total)}</div>
            </div>
            {order.amount_paid > 0 && (
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:11, color:'var(--text3)' }}>Previously recorded</div>
                <div style={{ fontSize:14, fontWeight:600, color:'var(--text2)', fontFamily:'var(--mono)' }}>
                  ₹{fmtAmt(order.amount_paid)}
                </div>
              </div>
            )}
          </div>

          {total === 0 ? (
            /* ── Zero-value order — no payment needed ── */
            <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'14px 16px', marginTop:4, textAlign:'center' }}>
              <div style={{ fontSize:22, marginBottom:6 }}>🎁</div>
              <div style={{ fontWeight:700, fontSize:14, color:'#15803d', marginBottom:4 }}>No payment required</div>
              <div style={{ fontSize:12, color:'#166534', lineHeight:1.5 }}>
                This order has a total of ₹0. It may be a free kit, a gifted order, or the invoice hasn't been updated with rates yet.<br/>
                You can close it directly, or go to the invoice Edit tab to set the correct amounts first.
              </div>
            </div>
          ) : (
            /* ── Normal payment form ── */
            <div className="form-grid">
              <label>Payment Mode
                <select value={mode} onChange={function (e) { setMode(e.target.value) }}>
                  <option value="upi">UPI</option>
                  <option value="neft">NEFT / RTGS</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="Other">Other</option>
                </select>
              </label>
              <label>Amount Paid (₹)
                <input
                  type="number" placeholder={`Up to ₹${fmtAmt(total)}`}
                  value={amountPaid}
                  onChange={function (e) { setAmountPaid(e.target.value) }}
                  style={{ fontWeight:700, fontSize:16 }}
                />
              </label>
              <label className="col-span-2">UTR / Reference Number
                <input
                  type="text" placeholder="Transaction ID / cheque no. / cash ref"
                  value={ref}
                  onChange={function (e) { setRef(e.target.value) }}
                />
              </label>
            </div>
          )}

          {/* Live balance indicator */}
          {total > 0 && amt > 0 && (
            <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:12,
              padding:'8px 14px', borderRadius:8,
              background: isFull ? 'var(--green-bg,#f0fdf4)' : '#fffbeb',
              border: '1px solid ' + (isFull ? 'var(--green)' : '#fbbf24') }}>
              {isFull
                ? <span style={{ color:'var(--green)', fontWeight:700, fontSize:13 }}>✓ Full payment — order will be marked <b>Closed</b></span>
                : <span style={{ color:'#92400e', fontWeight:600, fontSize:13 }}>Part payment — balance: <b>₹{fmtAmt(total - amt)}</b> — order marked <b>Part Paid</b></span>
              }
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-s" onClick={onClose}>Cancel</button>
          {total === 0
            ? <button className="btn-p" onClick={handleCloseZero} disabled={saving}>{saving ? 'Closing…' : 'Close Order (₹0)'}</button>
            : <button className="btn-p" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : isFull ? 'Record Full Payment' : isPart ? 'Record Part Payment' : 'Save'}</button>
          }
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DispatchModal — mark dispatched with AWB
// ---------------------------------------------------------------------------
// ── saved courier vendors (localStorage) ──────────────────────────────────────
const COURIER_STORAGE_KEY = 'nlh_courier_vendors'
function getSavedCouriers() {
  try { return JSON.parse(localStorage.getItem(COURIER_STORAGE_KEY) || '[]') } catch { return [] }
}
function saveCourier(name) {
  if (!name) return
  const list = getSavedCouriers()
  const updated = [name, ...list.filter(function (c) { return c.toLowerCase() !== name.toLowerCase() })].slice(0, 10)
  try { localStorage.setItem(COURIER_STORAGE_KEY, JSON.stringify(updated)) } catch {}
}

function DispatchModal({ order, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10)
  const [courier,  setCourier]  = useState(order.courier_partner  || '')
  const [awb,      setAwb]      = useState(order.awb_number       || '')
  const [date,     setDate]     = useState(order.dispatch_date    || today)
  const [weight,   setWeight]   = useState(order.dispatch_weight  != null ? String(order.dispatch_weight) : '')
  const [freight,  setFreight]  = useState(order.dispatch_freight != null ? String(order.dispatch_freight) : '')
  const [saved,    setSaved]    = useState(getSavedCouriers)
  const [saving,   setSaving]   = useState(false)

  async function handleSave() {
    if (!awb.trim()) { showToast('Enter AWB / tracking number.', 'warn'); return }
    setSaving(true)
    const { error } = await sb
      .from('orders')
      .update({
        courier_partner:  courier.trim(),
        awb_number:       awb.trim(),
        dispatch_date:    date || today,
        dispatch_weight:  weight !== '' ? parseFloat(weight) || null : null,
        dispatch_freight: freight !== '' ? parseInt(freight, 10) || 0 : 0,
        dispatched_at:    new Date().toISOString(),
      })
      .eq('id', order.id)
    if (error) {
      showToast('Failed to update dispatch: ' + error.message)
    } else {
      if (courier.trim()) { saveCourier(courier.trim()); setSaved(getSavedCouriers()) }
      showToast('Dispatched!')
      try {
        const phone = order.placer?.phone || ''
        if (phone && awb.trim()) {
          await sendWAOrderDispatched(phone, {
            name:      order.placer?.business_name || 'Partner',
            invoiceNo: order.invoice_no || order.id,
            awb:       awb.trim(),
            courier:   courier.trim() || 'courier',
          })
        }
      } catch (waErr) {
        console.warn('WhatsApp dispatch notification failed:', waErr.message)
      }
      onSaved()
    }
    setSaving(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>Mark Dispatched</h3>
          <button style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--text3)'}} onClick={onClose}>×</button>
        </div>
        <div className="form-grid">
          {/* Courier — with saved-vendor datalist */}
          <label className="col-span-2">Courier / Vendor
            <input
              list="courier-list"
              placeholder="e.g. DTDC, BlueDart, Delhivery"
              value={courier}
              onChange={function (e) { setCourier(e.target.value) }}
              autoFocus
            />
            <datalist id="courier-list">
              {['DTDC', 'BlueDart', 'Delhivery', 'Ekart', 'Xpressbees', 'Shree Maruti Courier', 'Professional Courier', 'India Post',
                ...saved.filter(function (c) { return !['DTDC','BlueDart','Delhivery','Ekart','Xpressbees','Shree Maruti Courier','Professional Courier','India Post'].includes(c) })
              ].map(function (c) { return <option key={c} value={c} /> })}
            </datalist>
            {saved.length > 0 && (
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:5 }}>
                {saved.map(function (c) {
                  return (
                    <button key={c} type="button"
                      onClick={function () { setCourier(c) }}
                      style={{ fontSize:10, padding:'2px 8px', borderRadius:20, border:'1px solid var(--border)',
                        background: courier === c ? 'var(--purple)' : 'var(--bg2)',
                        color: courier === c ? '#fff' : 'var(--text2)', cursor:'pointer' }}
                    >{c}</button>
                  )
                })}
              </div>
            )}
          </label>

          <label>AWB / Tracking Number
            <input
              type="text"
              placeholder="Enter AWB or tracking no."
              value={awb}
              onChange={function (e) { setAwb(e.target.value) }}
            />
          </label>

          <label>Dispatch Date
            <input
              type="date"
              value={date}
              onChange={function (e) { setDate(e.target.value) }}
            />
          </label>

          <label>Weight (kg)
            <input
              type="number"
              min="0"
              step="0.001"
              placeholder="e.g. 2.5"
              value={weight}
              onChange={function (e) { setWeight(e.target.value) }}
            />
          </label>

          <label>Freight Charges (₹)
            <input
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 150"
              value={freight}
              onChange={function (e) { setFreight(e.target.value) }}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn-s" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Mark Dispatched'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Module-level helper — used by both InvoiceEditModal and NewOrderModal
function rateForSku(sku, tier) {
  if (!sku) return 0
  if (tier === 'CF')                return sku.cf_rate  || 0
  if (tier === 'SMF' || tier === 'NLH') return sku.smf_rate || 0
  return sku.uf_rate || 0
}

// ---------------------------------------------------------------------------
// InvoiceEditModal — admin edits items (add/delete/change), sent_qty, rate, courier
// ---------------------------------------------------------------------------
function InvoiceEditModal({ order, isAdmin, onClose, onSaved }) {
  const [items, setItems] = useState([])
  const [allSkus, setAllSkus] = useState([])
  const [deletedIds, setDeletedIds] = useState([])
  const [courierCharges, setCourierCharges] = useState(order.courier_charges || 0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(function () { loadData() }, [])

  async function loadData() {
    const [itemsRes, skusRes] = await Promise.all([
      sb.from('order_items').select('*, skus(level_name, uf_rate, cf_rate, smf_rate, courses(group_name))').eq('order_id', order.id),
      isAdmin ? sb.from('skus').select('id, level_name, uf_rate, cf_rate, smf_rate, courses(group_name)').order('sort_order') : { data: [] },
    ])
    if (itemsRes.error) showToast('Failed to load items: ' + itemsRes.error.message)
    else setItems(itemsRes.data || [])
    setAllSkus(skusRes.data || [])
    setLoading(false)
  }

  function updateField(idx, field, val) {
    setItems(function (prev) {
      return prev.map(function (it, i) {
        if (i !== idx) return it
        return { ...it, [field]: parseInt(val, 10) || 0 }
      })
    })
  }

  function updateNewItemSku(idx, skuId) {
    const sku = allSkus.find(function (s) { return s.id === skuId })
    const tier = order.placer_tier || 'UF'
    const rate = sku ? (rateForSku(sku, tier)) : 0
    setItems(function (prev) {
      return prev.map(function (it, i) {
        if (i !== idx) return it
        return { ...it, sku_id: skuId, skus: sku || null, rate, ordered_qty: it.ordered_qty || 1 }
      })
    })
  }

  function addItem() {
    setItems(function (prev) {
      return [...prev, { id: null, sku_id: '', ordered_qty: 1, sent_qty: 0, rate: 0, skus: null }]
    })
  }

  function removeItem(idx) {
    const item = items[idx]
    if (item.id) setDeletedIds(function (prev) { return [...prev, item.id] })
    setItems(function (prev) { return prev.filter(function (_, i) { return i !== idx }) })
  }

  function lineTotal(item) { return (item.ordered_qty || 0) * (item.rate || 0) }

  function grandTotal() {
    return items.reduce(function (s, it) { return s + lineTotal(it) }, 0) + (parseInt(courierCharges, 10) || 0)
  }

  async function handleSave() {
    setSaving(true)
    // Delete removed items
    for (const id of deletedIds) {
      const { error } = await sb.from('order_items').delete().eq('id', id)
      if (error) { showToast('Error removing item: ' + error.message); setSaving(false); return }
    }
    // Update or insert items
    for (const item of items) {
      if (item.id) {
        const { error } = await sb
          .from('order_items')
          .update({ sent_qty: item.sent_qty, rate: item.rate, ordered_qty: item.ordered_qty })
          .eq('id', item.id)
        if (error) { showToast('Error saving item: ' + error.message); setSaving(false); return }
      } else {
        if (!item.sku_id) continue
        const { error } = await sb.from('order_items').insert({
          order_id: order.id,
          sku_id: item.sku_id,
          ordered_qty: item.ordered_qty || 1,
          sent_qty: item.sent_qty || 0,
          rate: item.rate || 0,
        })
        if (error) { showToast('Error adding item: ' + error.message); setSaving(false); return }
      }
    }
    const cc = parseInt(courierCharges, 10) || 0
    const subTotal = items.reduce(function (s, it) { return s + (it.ordered_qty || 0) * (it.rate || 0) }, 0)
    await sb.from('orders').update({
      courier_charges: cc,
      subtotal:        subTotal,
      grand_total:     subTotal + cc,
    }).eq('id', order.id)
    showToast('Invoice updated.')
    onSaved()
    setSaving(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-lg" onClick={function (e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>Edit Invoice — {order.order_ref}</h3>
          <button style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--text3)'}} onClick={onClose}>x</button>
        </div>
        <div>
          {loading ? (
            <div className="muted">Loading items...</div>
          ) : (
            <>
              <table className="tbl" style={{ marginBottom: 0 }}>
                <thead>
                  <tr>
                    <th>SKU / Item</th>
                    <th style={{ width: 70 }}>Ord Qty</th>
                    <th style={{ width: 80 }}>Sent Qty</th>
                    <th style={{ width: 100 }}>Rate (Rs)</th>
                    <th style={{ width: 100, textAlign: 'right' }}>Amount (Rs)</th>
                    {isAdmin && <th style={{ width: 40 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map(function (item, idx) {
                    const defaultRate = item.skus ? rateForSku(item.skus, order.placer_tier) : 0
                    const isNew = !item.id
                    return (
                      <tr key={item.id || ('new-' + idx)} style={isNew ? { background: 'var(--bg3)' } : {}}>
                        <td>
                          {isNew ? (
                            <select
                              value={item.sku_id}
                              onChange={function (e) { updateNewItemSku(idx, e.target.value) }}
                              style={{ width: '100%', fontSize: 13 }}
                            >
                              <option value="">— Select SKU —</option>
                              {Object.entries(
                                allSkus.reduce(function (acc, s) {
                                  const c = s.courses?.group_name || 'Other'
                                  if (!acc[c]) acc[c] = []
                                  acc[c].push(s)
                                  return acc
                                }, {})
                              ).map(function ([course, skus]) {
                                return (
                                  <optgroup key={course} label={course}>
                                    {skus.map(function (s) {
                                      return <option key={s.id} value={s.id}>{s.level_name}</option>
                                    })}
                                  </optgroup>
                                )
                              })}
                            </select>
                          ) : (
                            <>
                              {item.skus?.courses?.group_name && (
                                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 1 }}>{item.skus.courses.group_name}</div>
                              )}
                              <div style={{ fontWeight: 500 }}>{item.skus?.level_name || item.sku_id}</div>
                              {item.rate !== defaultRate && defaultRate > 0 && (
                                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Default: Rs {fmtAmt(defaultRate)}</div>
                              )}
                            </>
                          )}
                        </td>
                        <td>
                          <input
                            type="number" className="price-inp"
                            value={item.ordered_qty} min={1}
                            onChange={function (e) { updateField(idx, 'ordered_qty', e.target.value) }}
                          />
                        </td>
                        <td>
                          <input
                            type="number" className="price-inp"
                            value={item.sent_qty} min={0}
                            onChange={function (e) { updateField(idx, 'sent_qty', e.target.value) }}
                          />
                        </td>
                        <td>
                          <input
                            type="number" className="price-inp"
                            value={item.rate} min={0}
                            onChange={function (e) { updateField(idx, 'rate', e.target.value) }}
                            style={{ fontWeight: 600 }}
                          />
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--mono)' }}>
                          Rs {fmtAmt(lineTotal(item))}
                        </td>
                        {isAdmin && (
                          <td style={{ textAlign: 'center' }}>
                            <button
                              onClick={function () { removeItem(idx) }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 16, lineHeight: 1 }}
                              title="Remove item"
                            >
                              x
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {isAdmin && (
                <button
                  className="btn-s btn-sm"
                  onClick={addItem}
                  style={{ marginTop: 10, border: '1.5px dashed var(--purple)', color: 'var(--purple)', background: 'none' }}
                >
                  + Add Product
                </button>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 16, gap: 16 }}>
                <div className="fr" style={{ margin: 0, flex: 1 }}>
                  <label>Courier Charges (Rs)</label>
                  <input
                    type="number" value={courierCharges}
                    onChange={function (e) { setCourierCharges(e.target.value) }}
                    style={{ width: 140 }}
                  />
                </div>
                <div style={{ textAlign: 'right', padding: '10px 16px', background: 'var(--bg3)', borderRadius: 10, minWidth: 180 }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Grand Total</div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--purple)' }}>
                    Rs {fmtAmt(grandTotal())}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-s" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// NewOrderModal — create an order
// ---------------------------------------------------------------------------
function NewOrderModal({ currentFranchiseeId, currentRole, isAdmin, onClose, onSaved }) {
  // SMF and CF can place orders for themselves OR sub-franchisees
  const isMasterFr = currentRole === 'smf' || currentRole === 'cf'
  const showFrDropdown = isAdmin || isMasterFr

  const [franchisees, setFranchisees] = useState([])
  const [allSkus, setAllSkus] = useState([])
  const [visibleSkus, setVisibleSkus] = useState([])
  const [placerId, setPlacerId] = useState(showFrDropdown ? (isAdmin ? '' : currentFranchiseeId) : currentFranchiseeId)
  const [placerTier, setPlacerTier] = useState('')
  const [deliverTo, setDeliverTo] = useState('')
  // Each line: { sku_id, qty, rate }  — rate is editable per line
  const [lines, setLines] = useState([{ sku_id: '', qty: 1, rate: 0 }])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Build a delivery address string from franchisee fields
  function buildAddress(fr) {
    return [fr.address, fr.city, fr.state].filter(Boolean).join(', ')
  }

  useEffect(function () {
    async function loadData() {
      // SKUs always loaded for everyone
      const sRes = await sb.from('skus')
        .select('id, level_name, uf_rate, cf_rate, smf_rate, course_id, courses(group_name)')
        .order('sort_order')
      const allS = sRes.data || []
      setAllSkus(allS)

      if (isAdmin) {
        // Admin: see all franchisees
        const fRes = await sb.from('franchisees')
          .select('id, business_name, tier, registered_courses, address, city, state')
          .order('business_name')
        setFranchisees(fRes.data || [])
        setVisibleSkus(allS)
      } else if (isMasterFr) {
        // SMF / CF: see self + all descendants, default selection = self
        const [selfRes, descendantIds] = await Promise.all([
          sb.from('franchisees')
            .select('id, business_name, tier, registered_courses, address, city, state')
            .eq('id', currentFranchiseeId)
            .single(),
          getDescendantIds(currentFranchiseeId),
        ])
        let allFrs = selfRes.data ? [selfRes.data] : []
        if (descendantIds.length > 0) {
          const descRes = await sb.from('franchisees')
            .select('id, business_name, tier, registered_courses, address, city, state')
            .in('id', descendantIds)
            .order('tier').order('business_name')
          allFrs = [...allFrs, ...(descRes.data || [])]
        }
        setFranchisees(allFrs)
        // Default = self
        if (selfRes.data) {
          const fr = selfRes.data
          setPlacerTier(fr.tier || 'UF')
          setDeliverTo(buildAddress(fr))
          setVisibleSkus(allS)   // SMF/CF see all SKUs
        }
      } else {
        // UF: own data only, SKUs filtered to registered courses
        const frRes = await sb.from('franchisees')
          .select('id, tier, registered_courses, address, city, state')
          .eq('id', currentFranchiseeId)
          .single()
        if (frRes.data) {
          const fr = frRes.data
          setPlacerTier(fr.tier || 'UF')
          setDeliverTo(buildAddress(fr))
          const regCourses = fr.registered_courses || []
          if (fr.tier === 'UF' && regCourses.length > 0) {
            setVisibleSkus(allS.filter(function (s) { return regCourses.includes(s.course_id) }))
          } else {
            setVisibleSkus(allS)
          }
        }
      }
      setLoading(false)
    }
    loadData()
  }, [])

  function addLine() {
    setLines(function (prev) { return [...prev, { sku_id: '', qty: 1, rate: 0 }] })
  }

  function removeLine(idx) {
    setLines(function (prev) { return prev.filter(function (_, i) { return i !== idx }) })
  }

  function updateLine(idx, field, val) {
    setLines(function (prev) {
      return prev.map(function (line, i) {
        if (i !== idx) return line
        const updated = { ...line, [field]: val }
        // When SKU changes, auto-populate rate from tier default
        if (field === 'sku_id') {
          const sku = allSkus.find(function (s) { return s.id === val })
          updated.rate = rateForSku(sku, placerTier)
        }
        return updated
      })
    })
  }

  // When franchisee selection changes: auto-fill address + tier + refresh line rates + filter SKUs
  function handleFranchiseeChange(fid) {
    setPlacerId(fid)
    const fr = franchisees.find(function (f) { return f.id === fid })
    if (!fr) return
    const tier = fr.tier || 'UF'
    setPlacerTier(tier)
    setDeliverTo(buildAddress(fr))
    // Filter SKUs by registered courses for UF; show all for SMF/CF
    const regCourses = fr.registered_courses || []
    if (tier === 'UF' && regCourses.length > 0) {
      setVisibleSkus(allSkus.filter(function (s) { return regCourses.includes(s.course_id) }))
    } else {
      setVisibleSkus(allSkus)
    }
    // Refresh rates on existing lines for the new tier
    setLines(function (prev) {
      return prev.map(function (line) {
        if (!line.sku_id) return line
        const sku = allSkus.find(function (s) { return s.id === line.sku_id })
        return { ...line, rate: rateForSku(sku, tier) }
      })
    })
  }

  function calcTotal() {
    return lines.reduce(function (sum, line) {
      if (!line.sku_id) return sum
      return sum + ((parseInt(line.rate, 10) || 0) * (parseInt(line.qty, 10) || 0))
    }, 0)
  }

  async function handleSubmit() {
    const fid = placerId || currentFranchiseeId
    if (!fid) { showToast('Select a franchisee.'); return }
    const validLines = lines.filter(function (l) { return l.sku_id && parseInt(l.qty, 10) > 0 })
    if (validLines.length === 0) { showToast('Add at least one SKU.'); return }

    setSaving(true)
    const { data: refData } = await sb.rpc('next_order_ref')
    const orderRef = refData || ('ORD-' + Date.now())
    const total = calcTotal()

    // Derive tier from loaded franchisees if not already set (e.g. admin didn't change selection)
    const resolvedTier = placerTier || (franchisees.find(function (f) { return f.id === fid })?.tier) || 'UF'

    const { data: orderData, error: orderErr } = await sb
      .from('orders')
      .insert({
        order_ref: orderRef,
        placer_id: fid,
        placer_tier: resolvedTier,
        deliver_to: deliverTo.trim(),
        grand_total: total,
        status: 'pending',
      })
      .select().single()

    if (orderErr) {
      showToast('Failed to create order: ' + orderErr.message)
      setSaving(false)
      return
    }

    const itemRows = validLines.map(function (line) {
      return {
        order_id: orderData.id,
        sku_id: line.sku_id,
        ordered_qty: parseInt(line.qty, 10),
        sent_qty: 0,
        rate: parseInt(line.rate, 10) || 0,
      }
    })

    const { error: itemsErr } = await sb.from('order_items').insert(itemRows)
    if (itemsErr) {
      showToast('Order created but items failed: ' + itemsErr.message)
    } else {
      showToast('Order placed: ' + orderRef)
      onSaved()
    }
    setSaving(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-lg" onClick={function (e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>New Order</h3>
          <button style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--text3)'}} onClick={onClose}>x</button>
        </div>
        <div>
          {loading ? (
            <div className="muted">Loading...</div>
          ) : (
            <>
              {showFrDropdown && (
                <div className="fr">
                  <label>
                    {isAdmin ? 'Franchisee' : 'Place order for'}
                    {isMasterFr && <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: 11, marginLeft: 6 }}>(yourself or a sub-franchisee)</span>}
                  </label>
                  <select value={placerId} onChange={function (e) { handleFranchiseeChange(e.target.value) }}>
                    {isAdmin && <option value="">-- Select franchisee --</option>}
                    {franchisees.map(function (f) {
                      const isSelf = f.id === currentFranchiseeId
                      return (
                        <option key={f.id} value={f.id}>
                          [{f.tier}] {f.business_name}{isSelf && isMasterFr ? ' (you)' : ''}
                        </option>
                      )
                    })}
                  </select>
                </div>
              )}

              <div className="fr">
                <label>
                  Deliver To
                  {deliverTo && <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: 11, marginLeft: 6 }}>(auto-filled from franchisee record — edit if needed)</span>}
                </label>
                <textarea
                  rows={2}
                  value={deliverTo}
                  onChange={function (e) { setDeliverTo(e.target.value) }}
                  placeholder="Delivery address..."
                />
              </div>

              {/* SKU lines */}
              <div style={{ marginTop: 12 }}>
                {/* Column headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 100px 90px 32px', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>SKU</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Qty</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Rate (Rs)</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right' }}>Amount</span>
                  <span />
                </div>

                {lines.map(function (line, idx) {
                  const sku = allSkus.find(function (s) { return s.id === line.sku_id })
                  const defaultRate = rateForSku(sku, placerTier)
                  const lineRate = parseInt(line.rate, 10) || 0
                  const lineAmt = lineRate * (parseInt(line.qty, 10) || 0)
                  const isOverridden = sku && lineRate !== defaultRate

                  return (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 72px 100px 90px 32px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <select
                        value={line.sku_id}
                        onChange={function (e) { updateLine(idx, 'sku_id', e.target.value) }}
                      >
                        <option value="">-- Select SKU --</option>
                        {Object.entries(
                          visibleSkus.reduce(function (acc, s) {
                            const c = s.courses?.group_name || 'Other'
                            if (!acc[c]) acc[c] = []
                            acc[c].push(s)
                            return acc
                          }, {})
                        ).map(function ([course, skus]) {
                          return (
                            <optgroup key={course} label={course}>
                              {skus.map(function (s) {
                                return <option key={s.id} value={s.id}>{s.level_name}</option>
                              })}
                            </optgroup>
                          )
                        })}
                      </select>

                      <input
                        type="number" min={1} value={line.qty}
                        onChange={function (e) { updateLine(idx, 'qty', e.target.value) }}
                      />

                      <div style={{ position: 'relative' }}>
                        <input
                          type="number" min={0} value={line.rate}
                          onChange={function (e) { updateLine(idx, 'rate', e.target.value) }}
                          style={{ width: '100%', fontWeight: 600, borderColor: isOverridden ? 'var(--amber, #F59E0B)' : undefined }}
                          title={isOverridden ? 'Overriding default rate of Rs ' + defaultRate : 'Default rate for tier'}
                        />
                        {isOverridden && (
                          <span
                            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 9, color: '#B45309', cursor: 'pointer' }}
                            title={'Reset to Rs ' + defaultRate}
                            onClick={function () { updateLine(idx, 'rate', defaultRate) }}
                          >
                            reset
                          </span>
                        )}
                      </div>

                      <span style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600 }}>
                        {fmtAmt(lineAmt)}
                      </span>

                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, padding: 0 }}
                        onClick={function () { removeLine(idx) }}
                        disabled={lines.length === 1}
                      >
                        x
                      </button>
                    </div>
                  )
                })}

                <button className="btn-s btn-sm" onClick={addLine} style={{ marginTop: 6 }}>
                  + Add SKU
                </button>
              </div>

              {/* Total */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>Order Total</div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--purple)' }}>
                    Rs {fmtAmt(calcTotal())}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-s" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={handleSubmit} disabled={saving || loading}>
            {saving ? 'Placing Order...' : 'Place Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PDF invoice generation — NLH branded pastel design
// ---------------------------------------------------------------------------
async function generateInvoicePDF(order, items) {
  // ── Load images from /public ──────────────────────────────
  async function loadImg(path) {
    try {
      const res = await fetch(path)
      if (!res.ok) return null
      const blob = await res.blob()
      return new Promise(function (resolve) {
        const reader = new FileReader()
        reader.onloadend = function () { resolve(reader.result) }
        reader.readAsDataURL(blob)
      })
    } catch (e) { return null }
  }
  const [logoB64, mascotB64, qrB64] = await Promise.all([
    loadImg('/NLH Logo.png'),
    loadImg('/NLH Mascot.png'),
    loadImg('/My QR.jpg'),
  ])

  const doc  = new jsPDF({ unit: 'mm', format: 'a4' })
  const W    = 210
  const L    = 12
  const R    = 198
  const CW   = R - L

  function fc(r, g, b) { doc.setFillColor(r, g, b) }
  function dc(r, g, b) { doc.setDrawColor(r, g, b) }
  function tc(r, g, b) { doc.setTextColor(r, g, b) }

  const YELLOW   = [255, 210,  52]
  const YLLT     = [255, 253, 224]
  const PURPLE   = [ 83,  74, 183]
  const NAVY     = [ 26,  35, 126]
  const LAVENDER = [237, 233, 254]
  const WHITE    = [255, 255, 255]
  const FOOTERBG = [ 28,  20,  68]
  const TDK      = [ 24,  20,  60]
  const TMD      = [100,  95, 150]
  const TLT      = [165, 160, 200]
  const GREEN    = [ 22, 163,  74]
  const RED      = [220,  38,  38]
  const AMBER    = [217, 119,   6]

  // ═══════════════════════════════════════════════════════════
  // 1.  HEADER — yellow band with actual NLH logo
  // ═══════════════════════════════════════════════════════════
  fc(...YELLOW); doc.rect(0, 0, W, 54, 'F')

  // White logo card (left)
  fc(...WHITE); doc.roundedRect(L, 6, 72, 42, 3, 3, 'F')
  if (logoB64) {
    doc.addImage(logoB64, 'PNG', L + 1, 7, 70, 40)
  }

  // INVOICE title — right
  doc.setFont('helvetica', 'bold'); doc.setFontSize(30); tc(...NAVY)
  doc.text('INVOICE', R, 22, { align: 'right' })

  // Company contact — right
  doc.setFont('helvetica', 'bold');   doc.setFontSize(9);   tc(...TDK)
  doc.text('New Learning Horizons', R, 30, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); tc(...TMD)
  doc.text('9, Anjuman Shopping Complex, Residency Road, Sadar, Nagpur - 440 001', R, 36, { align: 'right' })
  doc.text('Ph: +91-9373111311   |   dhiral@nlhnagpur.info', R, 41.5, { align: 'right' })
  doc.text('www.nlhnagpur.info', R, 47, { align: 'right' })

  // Purple tagline bar
  fc(...PURPLE); doc.rect(0, 54, W, 7.5, 'F')
  tc(...WHITE); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
  doc.text(
    "New Learning Horizons | ISO 9001:2015 Certified | Enriching Children's Future",
    W / 2, 58.8, { align: 'center' }
  )

  // ═══════════════════════════════════════════════════════════
  // 2.  BILL TO  /  INVOICE DETAILS
  // ═══════════════════════════════════════════════════════════
  const cardY = 65, cardH = 34

  // Left card — Bill To (lavender)
  fc(...LAVENDER); doc.roundedRect(L,  cardY, 105, cardH, 3, 3, 'F')
  fc(...PURPLE);   doc.roundedRect(L,  cardY, 2.5, cardH, 1, 1, 'F')

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); tc(...PURPLE)
  doc.text('BILL TO', L + 6, cardY + 7)
  const frName = order.placer?.business_name || order.placer_id || 'Franchisee'
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); tc(...TDK)
  doc.text(doc.splitTextToSize(frName, 97)[0], L + 6, cardY + 14.5)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); tc(...TMD)
  if (order.deliver_to) {
    const al = doc.splitTextToSize(order.deliver_to, 97)
    doc.text(al[0], L + 6, cardY + 21)
    if (al[1]) doc.text(al[1], L + 6, cardY + 26)
  }
  doc.setFontSize(7.5); tc(...TLT)
  doc.text(
    'Tier: ' + (order.placer?.tier || order.placer_tier || '-') +
    '   |   Order ref: ' + (order.order_ref || '-'),
    L + 6, cardY + 31.5
  )

  // Right card — Invoice Details (pastel yellow)
  fc(...YLLT);   doc.roundedRect(121, cardY, 77, cardH, 3, 3, 'F')
  fc(...YELLOW); doc.roundedRect(121, cardY, 2.5, cardH, 1, 1, 'F')

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); tc(...NAVY)
  doc.text('INVOICE DETAILS', 126, cardY + 7)

  const iVX = R - 2
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); tc(...TMD)
  doc.text('Invoice No.', 126, cardY + 15)
  doc.setFont('helvetica', 'bold');   tc(...TDK)
  doc.text(order.invoice_no || 'DRAFT', iVX, cardY + 15, { align: 'right' })

  doc.setFont('helvetica', 'normal'); tc(...TMD)
  doc.text('Date', 126, cardY + 23)
  doc.setFont('helvetica', 'bold');   tc(...TDK)
  doc.text(fmtDate(order.created_at), iVX, cardY + 23, { align: 'right' })

  const isPaid      = order.status === 'closed'
  const isSubmitted = order.status === 'payment_submitted'
  if (isPaid)           fc(...GREEN)
  else if (isSubmitted) fc(...AMBER)
  else                  fc(...RED)
  doc.roundedRect(iVX - 30, cardY + 25.5, 32, 7, 2, 2, 'F')
  tc(...WHITE); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
  const statusTxt = isPaid ? 'PAID' : (isSubmitted ? 'PMT SUBMITTED' : 'UNPAID')
  doc.text(statusTxt, iVX - 14, cardY + 30.5, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); tc(...TMD)
  doc.text('Status', 126, cardY + 30.5)

  // ═══════════════════════════════════════════════════════════
  // 3.  ITEMS TABLE
  // ═══════════════════════════════════════════════════════════
  let y = cardY + cardH + 8

  const cSku  = L + 3
  const cOrd  = 128
  const cSent = 146
  const cRate = 167
  const cAmt  = R - 1

  fc(...PURPLE); doc.rect(L, y, CW, 8.5, 'F')
  tc(...WHITE); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.2)
  const hY = y + 5.8
  doc.text('SKU / Item',    cSku,        hY)
  doc.text('Ord',           cOrd,        hY, { align: 'right' })
  doc.text('Sent',          cSent,       hY, { align: 'right' })
  doc.text('Rate (Rs)',     cRate,       hY, { align: 'right' })
  doc.text('Amount (Rs)',   cAmt,        hY, { align: 'right' })
  y += 8.5

  let subtotal = 0
  items.forEach(function (item, idx) {
    const rowH = 8
    const amt  = (item.ordered_qty || 0) * (item.rate || 0)
    subtotal  += amt

    if (idx % 2 === 0) { fc(250, 248, 255); doc.rect(L, y, CW, rowH, 'F') }

    dc(215, 210, 240); doc.setLineWidth(0.15)
    doc.line(L, y + rowH, R, y + rowH)

    const rY = y + 5.5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); tc(...TDK)
    const skuLabel = item.skus
      ? (item.skus.courses?.group_name ? item.skus.courses.group_name + ' — ' + item.skus.level_name : item.skus.level_name)
      : (item.sku_id || '')
    doc.text(doc.splitTextToSize(skuLabel, 70)[0], cSku, rY)

    doc.setFontSize(9); tc(...TDK)
    doc.text(String(item.ordered_qty || 0), cOrd, rY, { align: 'right' })

    if ((item.sent_qty || 0) > 0) { tc(...GREEN) } else { tc(...TLT) }
    doc.text(String(item.sent_qty || 0), cSent, rY, { align: 'right' })

    tc(...TMD); doc.setFontSize(8.5)
    doc.text(fmtAmt(item.rate || 0), cRate, rY, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    if (amt > 0) { tc(...TDK) } else { tc(...TLT) }
    doc.text(fmtAmt(amt), cAmt, rY, { align: 'right' })

    y += rowH
    if (y > 248) { doc.addPage(); y = 20 }
  })

  y += 6

  // ═══════════════════════════════════════════════════════════
  // 4.  PAYMENT  +  TOTALS
  // ═══════════════════════════════════════════════════════════
  const courier = order.courier_charges || 0
  const total   = order.grand_total || (subtotal + courier)
  const botH    = 66
  const payW    = 106
  const totX    = L + payW + 4
  const totW    = CW - payW - 4

  // Payment box — pastel yellow
  fc(...YLLT);   doc.roundedRect(L, y, payW, botH, 3, 3, 'F')
  fc(...YELLOW); doc.roundedRect(L, y, 2.5,  botH, 1, 1, 'F')

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); tc(...NAVY)
  doc.text('PAY VIA', L + 6, y + 7.5)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); tc(...TMD)
  doc.text('Transfer and share UTR / transaction ref with NLH.', L + 6, y + 13.5)

  // Inner white card — bank details left + QR right
  const cardInX = L + 3, cardInW = payW - 6, cardInY = y + 18, cardInH = 44
  fc(...WHITE); doc.roundedRect(cardInX, cardInY, cardInW, cardInH, 2, 2, 'F')

  // QR code — right side of inner card (28x28)
  const qrSize = 28, qrX = cardInX + cardInW - qrSize - 2, qrY = cardInY + 2
  if (qrB64) {
    doc.addImage(qrB64, 'JPEG', qrX, qrY, qrSize, qrSize)
  } else {
    // Fallback: draw placeholder box
    dc(200, 200, 200); fc(240, 240, 240)
    doc.roundedRect(qrX, qrY, qrSize, qrSize, 1, 1, 'FD')
    tc(160, 160, 160); doc.setFontSize(6)
    doc.text('QR', qrX + qrSize / 2, qrY + qrSize / 2 + 2, { align: 'center' })
  }
  // "Scan" label below QR
  tc(...PURPLE); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5)
  doc.text('Scan to Pay', qrX + qrSize / 2, qrY + qrSize + 4, { align: 'center' })

  // Bank details — left of inner card (text limited width to avoid QR overlap)
  const bankTextW = cardInW - qrSize - 8
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); tc(...TDK)
  doc.text('IDFC FIRST Bank', cardInX + 4, cardInY + 8)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); tc(...TMD)
  doc.text('Byramji Town Branch, Nagpur', cardInX + 4, cardInY + 14)
  doc.text('A/c: 10278096847', cardInX + 4, cardInY + 20)
  doc.text('IFSC: IDFB0042504', cardInX + 4, cardInY + 26)
  doc.setFont('helvetica', 'bold'); tc(...PURPLE); doc.setFontSize(6.5)
  const upiLines = doc.splitTextToSize('UPI: newlearninghorizons@idfcbank', bankTextW)
  doc.text(upiLines, cardInX + 4, cardInY + 33)

  // Yellow scan strip at bottom of payment box
  fc(...YELLOW); doc.roundedRect(cardInX, y + botH - 9, cardInW, 7, 1, 1, 'F')
  tc(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2)
  doc.text('Scan QR with any UPI app to pay instantly', cardInX + cardInW / 2, y + botH - 4.5, { align: 'center' })

  // Totals box — lavender
  fc(...LAVENDER); doc.roundedRect(totX, y, totW, botH, 3, 3, 'F')
  fc(...PURPLE);   doc.roundedRect(totX, y, 2.5,  botH, 1, 1, 'F')

  let ty  = y + 12
  const tL = totX + 7
  const tR = R - 3

  function totRow(label, val) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); tc(...TMD)
    doc.text(label, tL, ty)
    doc.setFont('helvetica', 'bold'); tc(...TDK)
    doc.text(val, tR, ty, { align: 'right' })
    ty += 8.5
  }
  totRow('Subtotal', 'Rs ' + fmtAmt(subtotal))
  totRow('Courier charges', courier > 0 ? 'Rs ' + fmtAmt(courier) : 'As per actuals')
  totRow('GST', 'Not applicable')

  dc(180, 170, 220); doc.setLineWidth(0.35)
  doc.line(tL, ty - 3, tR, ty - 3)

  // Total pill
  fc(...PURPLE); doc.roundedRect(totX + 2, ty - 1, totW - 4, 13, 2, 2, 'F')
  tc(...WHITE); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('Total', tL, ty + 7.5)
  doc.text('Rs ' + fmtAmt(total), tR, ty + 7.5, { align: 'right' })

  y += botH + 4

  // Payment & dispatch notes
  if (order.payment_mode || order.payment_ref) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); tc(...TLT)
    doc.text(
      'Payment: ' + (order.payment_mode || '') +
      (order.payment_ref ? '  |  Ref: ' + order.payment_ref : ''),
      L, y
    )
    y += 5
  }
  if (order.awb_number || order.dispatched_at) {
    const dispParts = []
    if (order.courier_partner) dispParts.push(order.courier_partner)
    if (order.awb_number)      dispParts.push('AWB: ' + order.awb_number)
    if (order.dispatch_date)   dispParts.push(order.dispatch_date)
    if (order.dispatch_weight != null) dispParts.push(order.dispatch_weight + ' kg')
    if (order.dispatch_freight > 0)    dispParts.push('Freight: Rs ' + fmtAmt(order.dispatch_freight))
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); tc(...TLT)
    doc.text('Dispatch: ' + dispParts.join('  |  '), L, y)
    y += 5
  }

  // ═══════════════════════════════════════════════════════════
  // 5.  MASCOT + THANK YOU banner
  // ═══════════════════════════════════════════════════════════
  const bannerY = Math.max(y + 2, 240)
  const bannerH = 22
  const mascotSz = 24

  // Pastel yellow banner
  fc(...YLLT); doc.roundedRect(L, bannerY, CW, bannerH, 3, 3, 'F')
  fc(...YELLOW); doc.roundedRect(L, bannerY, 2.5, bannerH, 1, 1, 'F')

  // Mascot image — left side of banner
  if (mascotB64) {
    doc.addImage(mascotB64, 'PNG', L + 3, bannerY - 2, mascotSz, mascotSz + 2)
  }

  // Thank you text
  const txX = L + mascotSz + 8
  tc(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('Thank you for your order!', txX, bannerY + 9)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); tc(...TMD)
  doc.text('Grand Total Payable:', txX, bannerY + 16)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); tc(...PURPLE)
  doc.text('Rs ' + fmtAmt(total), R - 3, bannerY + 16, { align: 'right' })

  // ═══════════════════════════════════════════════════════════
  // 6.  FOOTER
  // ═══════════════════════════════════════════════════════════
  fc(...YELLOW);   doc.rect(0, 281, W, 1.5, 'F')
  fc(...FOOTERBG); doc.rect(0, 282.5, W, 14.5, 'F')
  tc(...WHITE); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text(
    "New Learning Horizons | ISO 9001:2015 Certified | Enriching Children's Future | www.nlhnagpur.info",
    W / 2, 289.5, { align: 'center' }
  )
  tc(...TLT); doc.setFontSize(7)
  doc.text('This is a computer-generated document.', W / 2, 294.5, { align: 'center' })

  doc.save('Invoice-' + (order.invoice_no || order.order_ref) + '.pdf')
}

// ---------------------------------------------------------------------------
// OrdersPage — main component
// ---------------------------------------------------------------------------
const ORDER_FILTERS = ['all', 'pending', 'invoiced', 'payment_submitted', 'closed']

export default function OrdersPage() {
  const { currentRole, currentFranchiseeId, currentUser } = useAuth()
  const isAdmin = isAdminRole(currentRole)

  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [orderFilter, setOrderFilter] = useState('all')
  const [actionLoading, setActionLoading] = useState(null)

  // Modal state
  const [paySubmitOrder, setPaySubmitOrder] = useState(null)
  const [recordPayOrder, setRecordPayOrder] = useState(null)
  const [dispatchOrder, setDispatchOrder] = useState(null)
  const [editInvoiceOrder, setEditInvoiceOrder] = useState(null)
  const [showNewOrder, setShowNewOrder] = useState(false)
  const [invoiceViewOrder, setInvoiceViewOrder] = useState(null)

  useEffect(function () {
    if (currentRole === null) return   // wait for auth to resolve
    loadOrders()
  }, [currentRole, currentFranchiseeId])

  async function loadOrders() {
    setLoading(true)
    let data, error

    const PLACER_FIELDS = 'business_name, tier, email, city, state, phone, address'
    const SELECT = '*, placer:franchisees!orders_placer_id_fkey(' + PLACER_FIELDS + '), bill_to_fr:franchisees!orders_bill_to_franchisee_id_fkey(business_name, tier)'
    if (isAdmin) {
      ;({ data, error } = await sb
        .from('orders')
        .select(SELECT)
        .order('created_at', { ascending: false }))
    } else if (currentRole === 'smf' || currentRole === 'cf') {
      const treeIds = await getTreeIds(currentFranchiseeId)
      ;({ data, error } = await sb
        .from('orders')
        .select(SELECT)
        .in('placer_id', treeIds.length > 0 ? treeIds : [currentFranchiseeId])
        .order('created_at', { ascending: false }))
    } else {
      ;({ data, error } = await sb
        .from('orders')
        .select(SELECT)
        .eq('placer_id', currentFranchiseeId)
        .order('created_at', { ascending: false }))
    }

    if (error) {
      showToast('Failed to load orders: ' + error.message)
    } else {
      setOrders(data || [])
    }
    setLoading(false)
  }

  async function handleMarkInvoiced(order) {
    setActionLoading(order.id + '_invoice')

    // Compute grand_total from items before invoicing
    const { data: itemRows } = await sb
      .from('order_items').select('ordered_qty, rate').eq('order_id', order.id)
    const itemsTotal = (itemRows || []).reduce(function (sum, it) {
      return sum + (it.ordered_qty || 0) * (it.rate || 0)
    }, 0)
    const grandTotal = itemsTotal + (order.courier_charges || 0)

    // Let the DB trigger (trg_invoice_no) assign invoice_no atomically from invoice_seq.
    const { error } = await sb
      .from('orders')
      .update({ status: 'invoiced', grand_total: grandTotal, subtotal: itemsTotal })
      .eq('id', order.id)
      .eq('status', 'pending')

    if (error) {
      showToast('Failed to invoice order: ' + error.message)
    } else {
      const { data: refreshed } = await sb
        .from('orders').select('invoice_no').eq('id', order.id).single()
      const invoiceNo = refreshed?.invoice_no || ''
      showToast('Invoiced as ' + invoiceNo)
      try {
        const invoicedOrder = { ...order, invoice_no: invoiceNo }
        const placerEmail = order.placer?.email || ''
        const placerName  = order.placer?.business_name || order.placer?.email || ''
        if (placerEmail) {
          await sendInvoiceEmail(invoicedOrder, placerEmail, placerName, grandTotal)
        }
      } catch (emailErr) {
        console.warn('Invoice email failed:', emailErr.message)
      }
      try {
        const phone = order.placer?.phone || ''
        if (phone) {
          await sendWAOrderInvoiced(phone, {
            name:      order.placer?.business_name || 'Partner',
            invoiceNo: invoiceNo,
            amount:    fmtAmt(grandTotal),
          })
        }
      } catch (waErr) {
        console.warn('WhatsApp invoice notification failed:', waErr.message)
      }
      await loadOrders()
    }
    setActionLoading(null)
  }

  async function handleVerifyPayment(order) {
    setActionLoading(order.id + '_verify')
    const { error } = await sb
      .from('orders')
      .update({ status: 'closed', payment_verified_at: new Date().toISOString() })
      .eq('id', order.id)
    if (error) {
      showToast('Failed to verify payment: ' + error.message)
    } else {
      showToast('Payment verified. Order closed.')
      try {
        await sendPaymentVerified({ order })
      } catch (_) { /* non-fatal */ }
      await loadOrders()
    }
    setActionLoading(null)
  }

  async function handleReopen(order) {
    setActionLoading(order.id + '_reopen')
    const { error } = await sb
      .from('orders')
      .update({ status: 'invoiced' })
      .eq('id', order.id)
    if (error) {
      showToast('Failed to reopen order: ' + error.message)
    } else {
      showToast('Order reopened to invoiced.')
      await loadOrders()
    }
    setActionLoading(null)
  }

  async function handleSendReminder(order) {
    setActionLoading(order.id + '_reminder')
    try {
      await sendPaymentReminder({ order })
      showToast('Payment reminder sent.')
    } catch (e) {
      showToast('Failed to send reminder: ' + e.message)
    }
    setActionLoading(null)
  }

  async function handleDownloadInvoice(order) {
    const { data: items, error } = await sb
      .from('order_items')
      .select('*, skus(level_name, courses(group_name))')
      .eq('order_id', order.id)
    if (error) {
      showToast('Failed to load items: ' + error.message)
      return
    }
    await generateInvoicePDF(order, items || [])
  }

  function isActing(orderId, action) {
    return actionLoading === orderId + '_' + action
  }

  const filtered = orders.filter(function (o) {
    if (orderFilter === 'all') return true
    return o.status === orderFilter
  })

  const filterCounts = ORDER_FILTERS.reduce(function (acc, f) {
    acc[f] = f === 'all' ? orders.length : orders.filter(function (o) { return o.status === f }).length
    return acc
  }, {})

  function renderActions(order) {
    const busy = actionLoading && actionLoading.startsWith(order.id)
    return (
      <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {order.status === 'pending' && isAdmin && (
          <button className="row-action primary" disabled={busy} onClick={function () { handleMarkInvoiced(order) }}>
            {isActing(order.id, 'invoice') ? '…' : 'Invoice'}
          </button>
        )}
        {order.status === 'invoiced' && !isAdmin && (
          <button className="row-action green" onClick={function () { setPaySubmitOrder(order) }}>Submit Pmt</button>
        )}
        {order.status === 'invoiced' && isAdmin && (
          <>
            <button className="row-action green" onClick={function () { setRecordPayOrder(order) }}>Record Pmt</button>
            <button className="row-action" disabled={busy} onClick={function () { handleSendReminder(order) }}>
              {isActing(order.id, 'reminder') ? '…' : 'Remind'}
            </button>
            <button className="row-action" onClick={function () { setEditInvoiceOrder(order) }}>Edit</button>
          </>
        )}
        {order.status === 'payment_submitted' && isAdmin && (
          <button className="row-action primary" disabled={busy} onClick={function () { handleVerifyPayment(order) }}>
            {isActing(order.id, 'verify') ? '…' : 'Verify'}
          </button>
        )}
        {order.status === 'closed' && isAdmin && (
          <button className="row-action" disabled={busy} onClick={function () { handleReopen(order) }}>
            {isActing(order.id, 'reopen') ? '…' : 'Reopen'}
          </button>
        )}
        {['invoiced', 'payment_submitted', 'closed'].includes(order.status) && (
          <button className="row-action" onClick={function () { setInvoiceViewOrder(order) }}>PDF</button>
        )}
        {!order.dispatched_at && (
          <button className="row-action" onClick={function () { setDispatchOrder(order) }}>Dispatch</button>
        )}
        {order.dispatched_at && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:1 }}>
            <span style={{ color:'var(--text3)', fontSize:11, fontFamily:'var(--mono)' }}>
              {order.awb_number || 'Dispatched'}
            </span>
            <span style={{ fontSize:10, color:'var(--text3)' }}>
              {[
                order.courier_partner,
                order.dispatch_date,
                order.dispatch_weight != null ? order.dispatch_weight + ' kg' : null,
                order.dispatch_freight > 0 ? '₹' + fmtAmt(order.dispatch_freight) : null,
              ].filter(Boolean).join(' · ')}
            </span>
            <button className="row-action" style={{ fontSize:10, padding:'2px 8px' }}
              onClick={function () { setDispatchOrder(order) }}>Edit</button>
          </div>
        )}
      </div>
    )
  }

  if (loading) return <div className="loading"><span className="spinner" />Loading orders…</div>

  const statusPillMap = [
    { id: 'all',               l: 'All',           cls: 'all' },
    { id: 'pending',           l: 'Pending',        cls: 'pending' },
    { id: 'invoiced',          l: 'Invoiced',       cls: 'inv' },
    { id: 'payment_submitted', l: 'Pmt Submitted',  cls: 'pmt' },
    { id: 'closed',            l: 'Closed',         cls: 'closed' },
  ]

  return (
    <div className="pg">
      {/* Topbar */}
      <header className="tb">
        <div className="crumb">Operations <span className="sep">›</span> <b>Orders</b></div>
        <div className="tb-r">
          <input className="search tb-search" placeholder="Search by order ref or franchisee…" readOnly />
          <button className="btn btn-s">Export CSV</button>
          <button className="btn btn-p" onClick={function () { setShowNewOrder(true) }}>+ New Order</button>
        </div>
      </header>

      <div className="content">
        {/* Page header */}
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>Operations</div>
            <h1 className="ph-title">Orders</h1>
            <div className="ph-sub">
              Tracking <b>{orders.length} orders</b>.{' '}
              <b>{filterCounts['pending']} pending invoice</b> · total active orders across all centres.
            </div>
          </div>
        </div>

        {/* Status pills filter */}
        <div className="status-pills">
          {statusPillMap.map(function (s) {
            return (
              <button
                key={s.id}
                className={'sp ' + (orderFilter === s.id ? ('on ' + s.cls) : '')}
                onClick={function () { setOrderFilter(s.id) }}
              >
                {s.l} <span className="ct">{filterCounts[s.id]}</span>
              </button>
            )
          })}
        </div>

        {/* Orders table */}
        {filtered.length === 0 ? (
          <div className="empty">No orders found.</div>
        ) : (
          <div className="card tbl-scroll" style={{ marginBottom: 0 }}>
            <table className="big-tbl">
              <thead>
                <tr>
                  <th>Order Ref</th>
                  <th className="hide-mobile">Invoice No</th>
                  {(isAdmin || currentRole === 'smf' || currentRole === 'cf') && <th>Franchisee</th>}
                  <th className="hide-mobile">Date</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Paid</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(function (order) {
                  return (
                    <tr key={order.id}>
                      <td className="mono" style={{ color: 'var(--purple)', fontWeight: 600 }}>{order.order_ref}</td>
                      <td className="mono hide-mobile">{order.invoice_no || '—'}</td>
                      {(isAdmin || currentRole === 'smf' || currentRole === 'cf') && (
                        <td>
                          {(() => {
                            const displayFr = order.bill_to_fr || order.placer
                            const isBillDiff = order.bill_to_fr && order.bill_to_fr.business_name !== order.placer?.business_name
                            if (!displayFr) return <span className="tier t-uf">{order.placer_tier}</span>
                            return (
                              <div className="placer-cell">
                                <div className="placer-av" style={{ background: isBillDiff ? '#D97706' : 'var(--purple)' }}>
                                  {(displayFr.business_name || '').split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <div className="placer-name">{displayFr.business_name}</div>
                                  <div className="placer-loc">
                                    <TierBadge tier={displayFr.tier} />
                                    {isBillDiff && <span style={{ fontSize: 9, color: '#D97706', marginLeft: 4 }}>billed to</span>}
                                  </div>
                                </div>
                              </div>
                            )
                          })()}
                        </td>
                      )}
                      <td className="mono hide-mobile">{fmtDate(order.created_at)}</td>
                      <td><StatusBadge status={order.status} /></td>
                      <td style={{ textAlign: 'right' }}><div className="amt">₹{fmtAmt(order.grand_total || 0)}</div></td>
                      <td className="hide-mobile" style={{ textAlign: 'right' }}>
                        <div className="amt" style={{ color: order.amount_paid > 0 ? 'var(--green)' : 'var(--text3)' }}>
                          ₹{fmtAmt(order.amount_paid || 0)}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{renderActions(order)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {paySubmitOrder && (
        <PaySubmitModal
          order={paySubmitOrder}
          onClose={function () { setPaySubmitOrder(null) }}
          onSaved={async function () { setPaySubmitOrder(null); await loadOrders() }}
        />
      )}

      {recordPayOrder && (
        <RecordPaymentModal
          order={recordPayOrder}
          onClose={function () { setRecordPayOrder(null) }}
          onSaved={async function () { setRecordPayOrder(null); await loadOrders() }}
        />
      )}

      {dispatchOrder && (
        <DispatchModal
          order={dispatchOrder}
          onClose={function () { setDispatchOrder(null) }}
          onSaved={async function () { setDispatchOrder(null); await loadOrders() }}
        />
      )}

      {editInvoiceOrder && (
        <InvoiceEditModal
          order={editInvoiceOrder}
          isAdmin={isAdmin}
          onClose={function () { setEditInvoiceOrder(null) }}
          onSaved={async function () { setEditInvoiceOrder(null); await loadOrders() }}
        />
      )}

      {showNewOrder && (
        <NewOrderModal
          currentFranchiseeId={currentFranchiseeId}
          currentRole={currentRole}
          isAdmin={isAdmin}
          onClose={function () { setShowNewOrder(false) }}
          onSaved={async function () { setShowNewOrder(false); await loadOrders() }}
        />
      )}

      {invoiceViewOrder && (
        <InvoiceView
          order={invoiceViewOrder}
          onClose={function() { setInvoiceViewOrder(null) }}
          onCancelled={async function() { setInvoiceViewOrder(null); await loadOrders() }}
          currentRole={currentRole}
          currentUser={currentUser}
        />
      )}
    </div>
  )
}

