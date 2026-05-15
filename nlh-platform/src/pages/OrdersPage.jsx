import React, { useState, useEffect } from 'react'
import { jsPDF } from 'jspdf'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast } from '../utils'
import { isAdminRole } from '../constants/roles'
import { sendInvoiceEmail, sendPaymentReminder, sendPaymentVerified } from '../services/email'

// JSX badge components (replaces HTML-string utils)
function StatusBadge({ status }) {
  const map = {
    pending:           { cls: 'bp',  txt: 'Pending' },
    invoiced:          { cls: 'br',  txt: 'Invoiced' },
    payment_submitted: { cls: 'bpu', txt: 'Pmt Submitted' },
    verified:          { cls: 'ba',  txt: 'Verified' },
    closed:            { cls: 'ba',  txt: 'Closed' },
    part_paid:         { cls: 'bp',  txt: 'Part Paid' },
  }
  const s = map[status] || { cls: 'bd', txt: status || '—' }
  return <span className={'badge ' + s.cls}>{s.txt}</span>
}

function PaymentBadge({ order }) {
  if (!order.amount_paid) return null
  if (order.payment_verified_at)  return <span className="badge ba">Paid ✓</span>
  if (order.payment_submitted_at) return <span className="badge bpu">Pmt Submitted</span>
  return <span className="badge bp">Part Paid</span>
}

function TierBadge({ tier }) {
  if (!tier) return null
  const cls = { SMF: 't-smf', CF: 't-cf', UF: 't-uf' }[tier] || ''
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
  const [mode, setMode] = useState('UPI')
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
              <option value="UPI">UPI</option>
              <option value="NEFT">NEFT / RTGS</option>
              <option value="Cash">Cash</option>
              <option value="Cheque">Cheque</option>
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
// RecordPaymentModal — admin records amount paid
// ---------------------------------------------------------------------------
function RecordPaymentModal({ order, onClose, onSaved }) {
  const [amountPaid, setAmountPaid] = useState(order.amount_paid || '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const amt = parseInt(amountPaid, 10)
    if (isNaN(amt) || amt < 0) { showToast('Enter a valid amount.'); return }
    setSaving(true)
    const { error } = await sb
      .from('orders')
      .update({ amount_paid: amt })
      .eq('id', order.id)
    if (error) {
      showToast('Failed to record payment: ' + error.message)
    } else {
      showToast('Payment recorded.')
      onSaved()
    }
    setSaving(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>Record Payment</h3>
          <button style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}} onClick={onClose}>×</button>
        </div>
        <div >
          <div className="fr">
            <label>Amount Paid (₹)</label>
            <input
              type="number"
              placeholder="Enter amount paid"
              value={amountPaid}
              onChange={function (e) { setAmountPaid(e.target.value) }}
            />
          </div>
          <p className="muted">Order total: ₹{fmtAmt(order.grand_total || 0)}</p>
        </div>
        <div className="modal-actions">
          <button className="btn-s" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DispatchModal — mark dispatched with AWB
// ---------------------------------------------------------------------------
function DispatchModal({ order, onClose, onSaved }) {
  const [awb, setAwb] = useState(order.awb_number || '')
  const [courier, setCourier] = useState(order.courier_partner || '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const { error } = await sb
      .from('orders')
      .update({
        awb_number: awb.trim(),
        courier_partner: courier.trim(),
        dispatched_at: new Date().toISOString(),
      })
      .eq('id', order.id)
    if (error) {
      showToast('Failed to update dispatch: ' + error.message)
    } else {
      showToast('Dispatched!')
      onSaved()
    }
    setSaving(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>Mark Dispatched</h3>
          <button style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}} onClick={onClose}>×</button>
        </div>
        <div >
          <div className="fr">
            <label>Courier Name</label>
            <input
              type="text"
              placeholder="e.g. DTDC, BlueDart"
              value={courier}
              onChange={function (e) { setCourier(e.target.value) }}
            />
          </div>
          <div className="fr">
            <label>AWB / Tracking Number</label>
            <input
              type="text"
              placeholder="Enter AWB number"
              value={awb}
              onChange={function (e) { setAwb(e.target.value) }}
            />
          </div>
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

// ---------------------------------------------------------------------------
// InvoiceEditModal — admin edits sent_qty, courier_charges
// ---------------------------------------------------------------------------
function InvoiceEditModal({ order, onClose, onSaved }) {
  const [items, setItems] = useState([])
  const [courierCharges, setCourierCharges] = useState(order.courier_charges || 0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(function () { loadItems() }, [])

  async function loadItems() {
    const { data, error } = await sb
      .from('order_items')
      .select('*, skus(level_name, uf_rate, cf_rate, smf_rate)')
      .eq('order_id', order.id)
    if (error) { showToast('Failed to load items: ' + error.message) }
    else { setItems(data || []) }
    setLoading(false)
  }

  function updateField(itemId, field, val) {
    setItems(function (prev) {
      return prev.map(function (it) {
        if (it.id !== itemId) return it
        return { ...it, [field]: parseInt(val, 10) || 0 }
      })
    })
  }

  function lineTotal(item) {
    return (item.ordered_qty || 0) * (item.rate || 0)
  }

  function grandTotal() {
    const itemsTotal = items.reduce(function (s, it) { return s + lineTotal(it) }, 0)
    return itemsTotal + (parseInt(courierCharges, 10) || 0)
  }

  async function handleSave() {
    setSaving(true)
    for (const item of items) {
      const { error } = await sb
        .from('order_items')
        .update({ sent_qty: item.sent_qty, rate: item.rate })
        .eq('id', item.id)
      if (error) { showToast('Error saving item: ' + error.message); setSaving(false); return }
    }
    await sb
      .from('orders')
      .update({ courier_charges: parseInt(courierCharges, 10) || 0 })
      .eq('id', order.id)
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
                    <th style={{ width: 80 }}>Ord Qty</th>
                    <th style={{ width: 90 }}>Sent Qty</th>
                    <th style={{ width: 110 }}>Rate (Rs)</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Amount (Rs)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(function (item) {
                    const defaultRate = item.skus
                      ? ({ UF: item.skus.uf_rate, CF: item.skus.cf_rate, SMF: item.skus.smf_rate }[order.placer_tier] || item.skus.uf_rate || 0)
                      : 0
                    return (
                      <tr key={item.id}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{item.skus?.level_name || item.sku_id}</div>
                          {item.rate !== defaultRate && defaultRate > 0 && (
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                              Default: Rs {fmtAmt(defaultRate)}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>{item.ordered_qty}</td>
                        <td>
                          <input
                            type="number" className="price-inp"
                            value={item.sent_qty} min={0} max={item.ordered_qty}
                            onChange={function (e) { updateField(item.id, 'sent_qty', e.target.value) }}
                          />
                        </td>
                        <td>
                          <input
                            type="number" className="price-inp"
                            value={item.rate} min={0}
                            onChange={function (e) { updateField(item.id, 'rate', e.target.value) }}
                            style={{ fontWeight: 600 }}
                          />
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--mono)' }}>
                          Rs {fmtAmt(lineTotal(item))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

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
function NewOrderModal({ currentFranchiseeId, isAdmin, onClose, onSaved }) {
  const [franchisees, setFranchisees] = useState([])
  const [allSkus, setAllSkus] = useState([])       // full list (admin)
  const [visibleSkus, setVisibleSkus] = useState([]) // filtered by registration
  const [placerId, setPlacerId] = useState(isAdmin ? '' : currentFranchiseeId)
  const [placerTier, setPlacerTier] = useState('')  // UF / CF / SMF
  const [deliverTo, setDeliverTo] = useState('')
  const [lines, setLines] = useState([{ sku_id: '', qty: 1 }])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(function () {
    async function loadData() {
      if (isAdmin) {
        const [fRes, sRes] = await Promise.all([
          sb.from('franchisees').select('id, business_name, tier, registered_courses').order('business_name'),
          sb.from('skus').select('id, level_name, uf_rate, cf_rate, smf_rate, course_id').order('sort_order'),
        ])
        setFranchisees(fRes.data || [])
        setAllSkus(sRes.data || [])
        setVisibleSkus(sRes.data || []) // admin sees all
      } else {
        // Non-admin: fetch own franchisee record + filtered SKUs
        const [frRes, sRes] = await Promise.all([
          sb.from('franchisees').select('id, tier, registered_courses').eq('id', currentFranchiseeId).single(),
          sb.from('skus').select('id, level_name, uf_rate, cf_rate, smf_rate, course_id').order('sort_order'),
        ])
        const allS = sRes.data || []
        setAllSkus(allS)
        if (frRes.data) {
          setPlacerTier(frRes.data.tier || 'UF')
          const regCourses = frRes.data.registered_courses || []
          // UF can only order for their registered courses; SMF/CF see all
          if (frRes.data.tier === 'UF' && regCourses.length > 0) {
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
    setLines(function (prev) { return [...prev, { sku_id: '', qty: 1 }] })
  }

  function removeLine(idx) {
    setLines(function (prev) { return prev.filter(function (_, i) { return i !== idx }) })
  }

  function updateLine(idx, field, val) {
    setLines(function (prev) {
      return prev.map(function (line, i) {
        if (i !== idx) return line
        return { ...line, [field]: val }
      })
    })
  }

  // Get tier-appropriate rate for a SKU
  function rateForSku(sku, tier) {
    if (!sku) return 0
    if (tier === 'CF')  return sku.cf_rate  || 0
    if (tier === 'SMF') return sku.smf_rate || 0
    return sku.uf_rate || 0
  }

  // When admin selects a franchisee, update tier (admin sees all SKUs regardless)
  function handleFranchiseeChange(fid) {
    setPlacerId(fid)
    const fr = franchisees.find(function (f) { return f.id === fid })
    if (fr) setPlacerTier(fr.tier || 'UF')
  }

  function calcTotal() {
    return lines.reduce(function (sum, line) {
      const sku = allSkus.find(function (s) { return s.id === line.sku_id })
      if (!sku) return sum
      return sum + (rateForSku(sku, placerTier) * (parseInt(line.qty, 10) || 0))
    }, 0)
  }

  async function handleSubmit() {
    const fid = placerId || currentFranchiseeId
    if (!fid) { showToast('Select a franchisee.'); return }
    const validLines = lines.filter(function (l) { return l.sku_id && parseInt(l.qty, 10) > 0 })
    if (validLines.length === 0) { showToast('Add at least one SKU.'); return }

    setSaving(true)

    // Generate sequential order ref from DB
    const { data: refData } = await sb.rpc('next_order_ref')
    const orderRef = refData || ('ORD-' + Date.now())

    const total = calcTotal()

    const { data: orderData, error: orderErr } = await sb
      .from('orders')
      .insert({
        order_ref: orderRef,
        placer_id: fid,
        placer_tier: placerTier || 'UF',
        deliver_to: deliverTo.trim(),
        grand_total: total,
        status: 'pending',
      })
      .select()
      .single()

    if (orderErr) {
      showToast('Failed to create order: ' + orderErr.message)
      setSaving(false)
      return
    }

    const itemRows = validLines.map(function (line) {
      const sku = allSkus.find(function (s) { return s.id === line.sku_id })
      return {
        order_id: orderData.id,
        sku_id: line.sku_id,
        ordered_qty: parseInt(line.qty, 10),
        sent_qty: 0,
        rate: rateForSku(sku, placerTier),
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
          <button style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}} onClick={onClose}>×</button>
        </div>
        <div >
          {loading ? (
            <div className="text-muted">Loading…</div>
          ) : (
            <>
              {isAdmin && (
                <div className="fr">
                  <label>Franchisee</label>
                  <select value={placerId} onChange={function (e) { handleFranchiseeChange(e.target.value) }}>
                    <option value="">— Select franchisee —</option>
                    {franchisees.map(function (f) {
                      return (
                        <option key={f.id} value={f.id}>
                          [{f.tier}] {f.business_name}
                        </option>
                      )
                    })}
                  </select>
                </div>
              )}
              <div className="fr">
                <label>Deliver To (address)</label>
                <textarea
                  rows={2}
                  value={deliverTo}
                  onChange={function (e) { setDeliverTo(e.target.value) }}
                  placeholder="Delivery address…"
                />
              </div>
              <div className="order-lines">
                <div className="order-lines-header">
                  <span>SKU</span>
                  <span>Qty</span>
                  <span>Rate</span>
                  <span>Amount</span>
                  <span></span>
                </div>
                {lines.map(function (line, idx) {
                  const sku = allSkus.find(function (s) { return s.id === line.sku_id })
                  const skuRate = rateForSku(sku, placerTier)
                  const lineAmt = sku ? skuRate * (parseInt(line.qty, 10) || 0) : 0
                  return (
                    <div key={idx} className="order-line">
                      <select
                        value={line.sku_id}
                        onChange={function (e) { updateLine(idx, 'sku_id', e.target.value) }}
                      >
                        <option value="">— Select SKU —</option>
                        {visibleSkus.map(function (s) {
                          const rate = rateForSku(s, placerTier)
                          return (
                            <option key={s.id} value={s.id}>
                              {s.level_name}{rate ? ' — ₹' + rate : ''}
                            </option>
                          )
                        })}
                      </select>
                      <input
                        type="number"
                        min={1}
                        value={line.qty}
                        onChange={function (e) { updateLine(idx, 'qty', e.target.value) }}
                        style={{ width: 70 }}
                      />
                      <span>{sku ? fmtAmt(skuRate) : '—'}</span>
                      <span>{fmtAmt(lineAmt)}</span>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={function () { removeLine(idx) }}
                        disabled={lines.length === 1}
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
                <button className="btn-s btn-sm" onClick={addLine} style={{ marginTop: 8 }}>
                  + Add SKU
                </button>
              </div>
              <div className="order-total">
                Total: <strong>{fmtAmt(calcTotal())}</strong>
              </div>
            </>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-s" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={handleSubmit} disabled={saving || loading}>
            {saving ? 'Placing Order…' : 'Place Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PDF invoice generation — NLH branded pastel design
// ---------------------------------------------------------------------------
function generateInvoicePDF(order, items) {
  const doc  = new jsPDF({ unit: 'mm', format: 'a4' })
  const W    = 210          // page width
  const L    = 12           // left margin
  const R    = 198          // right margin
  const CW   = R - L        // content width

  // ── colour helpers ─────────────────────────────────────────
  function fc(r, g, b) { doc.setFillColor(r, g, b) }
  function dc(r, g, b) { doc.setDrawColor(r, g, b) }
  function tc(r, g, b) { doc.setTextColor(r, g, b) }

  const YELLOW   = [255, 210,  52]   // #FFD234  NLH yellow
  const YLLT     = [255, 253, 224]   // pastel yellow
  const PURPLE   = [ 83,  74, 183]   // #534AB7  NLH purple
  const NAVY     = [ 26,  35, 126]   // #1A237E  dark navy
  const LAVENDER = [237, 233, 254]   // pastel lavender
  const WHITE    = [255, 255, 255]
  const FOOTERBG = [ 28,  20,  68]   // near-black footer
  const TDK      = [ 24,  20,  60]   // text dark
  const TMD      = [100,  95, 150]   // text medium
  const TLT      = [165, 160, 200]   // text light
  const GREEN    = [ 22, 163,  74]
  const RED      = [220,  38,  38]
  const AMBER    = [217, 119,   6]

  // ═══════════════════════════════════════════════════════════
  // 1.  HEADER — NLH yellow background
  // ═══════════════════════════════════════════════════════════
  fc(...YELLOW); doc.rect(0, 0, W, 54, 'F')

  // White logo card
  fc(...WHITE); doc.roundedRect(L, 6, 70, 42, 3, 3, 'F')

  // ── Draw sun mascot ────────────────────────────────────────
  const sx = 22, sy = 25, sr = 6.5

  // Rays (12 at 30° intervals)
  dc(255, 145, 0); doc.setLineWidth(1.7)
  for (let i = 0; i < 12; i++) {
    const a = (i * 30) * Math.PI / 180
    doc.line(
      sx + Math.cos(a) * (sr + 1.3), sy + Math.sin(a) * (sr + 1.3),
      sx + Math.cos(a) * (sr + 4.8), sy + Math.sin(a) * (sr + 4.8)
    )
  }
  // Sun body
  fc(255, 195, 0); dc(255, 145, 0); doc.setLineWidth(0.6)
  doc.circle(sx, sy, sr, 'FD')
  // Eyes
  fc(60, 30, 0)
  doc.circle(sx - 2.3, sy - 1.6, 0.95, 'F')
  doc.circle(sx + 2.3, sy - 1.6, 0.95, 'F')
  // Eye shine
  fc(255, 255, 255)
  doc.circle(sx - 2, sy - 2, 0.38, 'F')
  doc.circle(sx + 2.6, sy - 2, 0.38, 'F')
  // Smile (5 line segments forming arc)
  dc(60, 30, 0); doc.setLineWidth(0.75)
  for (let i = 0; i < 5; i++) {
    const a1 = (147 + i * 18) * Math.PI / 180
    const a2 = (147 + (i + 1) * 18) * Math.PI / 180
    doc.line(
      sx + Math.cos(a1) * 3.4, sy + Math.sin(a1) * 3.4,
      sx + Math.cos(a2) * 3.4, sy + Math.sin(a2) * 3.4
    )
  }
  // Cheeks (two small orange circles)
  fc(255, 140, 80); doc.setLineWidth(0)
  doc.circle(sx - 4.3, sy + 1.8, 1.8, 'F')
  doc.circle(sx + 4.3, sy + 1.8, 1.8, 'F')

  // Logo text
  tc(...NAVY)
  doc.setFont('helvetica', 'italic');     doc.setFontSize(7)
  doc.text('Estd. 2008', L + 2, 11.5)
  doc.setFont('helvetica', 'italic');     doc.setFontSize(8.5)
  doc.text('new', 33.5, 19)
  doc.setFont('helvetica', 'bold');       doc.setFontSize(14.5)
  doc.text('Learning', 33.5, 26.5)
  doc.setFontSize(11.5)
  doc.text('HORIZONS®', 33.5, 33.5)
  doc.setFont('helvetica', 'normal');     doc.setFontSize(6.5); tc(...PURPLE)
  doc.text('ISO 9001 : 2015 Certified', L + 2, 39.5)
  doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(6.5); tc(21, 101, 192)
  doc.text("Enriching Children's Future", L + 2, 45)

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
    "New Learning Horizons  ·  ISO 9001:2015 Certified  ·  Enriching Children's Future",
    W / 2, 58.8, { align: ‘center’ }
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
    'Tier: ' + (order.placer?.tier || order.placer_tier || '—') +
    '   ·   Order ref: ' + (order.order_ref || '—'),
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

  // Status pill
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
  let y = cardY + cardH + 8   // ≈ 107

  // Column right-edge x-positions
  const cSku  = L + 3
  const cOrd  = 128
  const cSent = 146
  const cRate = 167
  const cAmt  = R - 1

  // Header bar
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
    // Amount based on ordered_qty so it matches grand_total
    const amt  = (item.ordered_qty || 0) * (item.rate || 0)
    subtotal  += amt

    // Alternating row background
    if (idx % 2 === 0) { fc(250, 248, 255); doc.rect(L, y, CW, rowH, 'F') }

    // Row separator
    dc(215, 210, 240); doc.setLineWidth(0.15)
    doc.line(L, y + rowH, R, y + rowH)

    const rY = y + 5.5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); tc(...TDK)
    doc.text(doc.splitTextToSize(item.skus?.level_name || item.sku_id || '', 70)[0], cSku, rY)

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
  const botH    = 62
  const payW    = 106
  const totX    = L + payW + 4
  const totW    = CW - payW - 4

  // Payment box — pastel yellow with yellow left accent
  fc(...YLLT);   doc.roundedRect(L,  y, payW, botH, 3, 3, 'F')
  fc(...YELLOW); doc.roundedRect(L,  y, 2.5,  botH, 1, 1, 'F')

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); tc(...NAVY)
  doc.text('PAY VIA', L + 6, y + 7.5)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); tc(...TMD)
  doc.text('Payment pending. Please transfer and share UTR', L + 6, y + 13.5)
  doc.text('/ transaction reference with NLH.', L + 6, y + 18.5)

  // Inner white bank-details card
  fc(...WHITE); doc.roundedRect(L + 3, y + 22, payW - 6, 36, 2, 2, 'F')
  doc.setFont('helvetica', 'bold');   doc.setFontSize(7.5); tc(...TDK)
  doc.text('IDFC FIRST Bank, Nagpur - Byramji Town Branch', L + 7, y + 29)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); tc(...TMD)
  doc.text('A/c No: 10278096847', L + 7, y + 35)
  doc.text('IFSC Code: IDFB0042504', L + 7, y + 41)
  doc.setFont('helvetica', 'bold'); tc(...PURPLE)
  doc.text('UPI: newlearninghorizons@idfcbank', L + 7, y + 47.5)
  // Yellow "scan & pay" strip
  fc(...YELLOW); doc.roundedRect(L + 3, y + 51.5, payW - 6, 6.5, 1, 1, 'F')
  tc(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8)
  doc.text('- Scan QR in any UPI app  -  newlearninghorizons@idfcbank', L + 7, y + 56)

  // Totals box — lavender with purple left accent
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

  // Divider
  dc(180, 170, 220); doc.setLineWidth(0.35)
  doc.line(tL, ty - 3, tR, ty - 3)

  // Total pill
  fc(...PURPLE); doc.roundedRect(totX + 2, ty - 1, totW - 4, 13, 2, 2, 'F')
  tc(...WHITE); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('Total', tL, ty + 7.5)
  doc.text('Rs ' + fmtAmt(total), tR, ty + 7.5, { align: 'right' })

  y += botH + 6

  // Payment & dispatch notes
  if (order.payment_mode || order.payment_ref) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); tc(...TLT)
    doc.text(
      'Payment: ' + (order.payment_mode || '') +
      (order.payment_ref ? '  ·  Ref: ' + order.payment_ref : ''),
      L, y
    )
    y += 5
  }
  if (order.awb_number) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); tc(...TLT)
    doc.text(
      'Dispatched via: ' + (order.courier_partner || '') + '  ·  AWB: ' + order.awb_number,
      L, y
    )
  }

  // ═══════════════════════════════════════════════════════════
  // 5.  FOOTER
  // ═══════════════════════════════════════════════════════════
  fc(...YELLOW);   doc.rect(0, 281, W, 1.5, 'F')
  fc(...FOOTERBG); doc.rect(0, 282.5, W, 14.5, 'F')
  tc(...WHITE); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text(
    "New Learning Horizons  ·  ISO 9001:2015 Certified  ·  Enriching Children's Future  ·  www.nlhnagpur.info",
    W / 2, 289.5, { align: ‘center’ }
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
  const { currentRole, currentFranchiseeId } = useAuth()
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

  useEffect(function () {
    if (currentRole === null) return   // wait for auth to resolve
    loadOrders()
  }, [currentRole, currentFranchiseeId])

  async function loadOrders() {
    setLoading(true)
    let query
    if (isAdmin) {
      query = sb
        .from('orders')
        .select('*, placer:franchisees!orders_placer_id_fkey(business_name, tier, email)')
        .order('created_at', { ascending: false })
    } else {
      query = sb
        .from('orders')
        .select('*')
        .eq('placer_id', currentFranchiseeId)
        .order('created_at', { ascending: false })
    }
    const { data, error } = await query
    if (error) {
      showToast('Failed to load orders: ' + error.message)
    } else {
      setOrders(data || [])
    }
    setLoading(false)
  }

  async function handleMarkInvoiced(order) {
    setActionLoading(order.id + '_invoice')
    // Atomic invoice number generation
    const { data: inv, error: invErr } = await sb
      .from('orders')
      .select('id')
      .not('invoice_no', 'is', null)
      .order('invoice_no', { ascending: false })
      .limit(1)
      .maybeSingle()

    let nextNum = 1
    if (!invErr && inv) {
      const parts = (inv.invoice_no || '').split('-')
      nextNum = (parseInt(parts[parts.length - 1], 10) || 0) + 1
    }
    const year = new Date().getFullYear()
    const invoiceNo = 'INV-' + year + '-' + String(nextNum).padStart(4, '0')

    const { error } = await sb
      .from('orders')
      .update({ status: 'invoiced', invoice_no: invoiceNo })
      .eq('id', order.id)
      .is('invoice_no', null)

    if (error) {
      showToast('Failed to invoice order: ' + error.message)
    } else {
      showToast('Invoiced as ' + invoiceNo)
      try {
        await sendInvoiceEmail({ order: { ...order, invoice_no: invoiceNo } })
      } catch (_) { /* non-fatal */ }
      await loadOrders()
    }
    setActionLoading(null)
  }

  async function handleVerifyPayment(order) {
    setActionLoading(order.id + '_verify')
    const { error } = await sb
      .from('orders')
      .update({ status: 'closed' })
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
      .select('*, skus(level_name)')
      .eq('order_id', order.id)
    if (error) {
      showToast('Failed to load items: ' + error.message)
      return
    }
    generateInvoicePDF(order, items || [])
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
      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
        {/* pending → Mark Invoiced (admin only) */}
        {order.status === 'pending' && isAdmin && (
          <button
            className="btn-p btn-sm"
            disabled={busy}
            onClick={function () { handleMarkInvoiced(order) }}
          >
            {isActing(order.id, 'invoice') ? '…' : 'Mark Invoiced'}
          </button>
        )}

        {/* invoiced → franchisee can submit payment */}
        {order.status === 'invoiced' && !isAdmin && (
          <button
            className="btn-p btn-sm"
            onClick={function () { setPaySubmitOrder(order) }}
          >
            Submit Payment
          </button>
        )}

        {/* invoiced → admin: record payment, reminder, edit invoice */}
        {order.status === 'invoiced' && isAdmin && (
          <>
            <button className="btn-s btn-sm" onClick={function () { setRecordPayOrder(order) }}>
              Record Payment
            </button>
            <button
              className="btn-s btn-sm"
              disabled={busy}
              onClick={function () { handleSendReminder(order) }}
            >
              {isActing(order.id, 'reminder') ? '…' : 'Send Reminder'}
            </button>
            <button className="btn-s btn-sm" onClick={function () { setEditInvoiceOrder(order) }}>
              Edit Invoice
            </button>
          </>
        )}

        {/* payment_submitted → admin: verify */}
        {order.status === 'payment_submitted' && isAdmin && (
          <button
            className="btn-p btn-sm"
            disabled={busy}
            onClick={function () { handleVerifyPayment(order) }}
          >
            {isActing(order.id, 'verify') ? '…' : 'Verify Payment'}
          </button>
        )}

        {/* closed → admin: reopen */}
        {order.status === 'closed' && isAdmin && (
          <button
            className="btn-s btn-sm"
            disabled={busy}
            onClick={function () { handleReopen(order) }}
          >
            {isActing(order.id, 'reopen') ? '…' : 'Reopen'}
          </button>
        )}

        {/* closed or invoiced → download invoice */}
        {['invoiced', 'payment_submitted', 'closed'].includes(order.status) && (
          <button
            className="btn-s btn-sm"
            onClick={function () { handleDownloadInvoice(order) }}
          >
            Download Invoice
          </button>
        )}

        {/* any → mark dispatched if not yet dispatched */}
        {!order.dispatched_at && (
          <button
            className="btn-s btn-sm"
            onClick={function () { setDispatchOrder(order) }}
          >
            Mark Dispatched
          </button>
        )}
        {order.dispatched_at && (
          <span style={{ color:'var(--text3)', fontSize: 12 }}>
            Dispatched {fmtDate(order.dispatched_at)}
            {order.awb_number ? ' · ' + order.awb_number : ''}
          </span>
        )}
      </div>
    )
  }

  if (loading) return <div className="loading"><span className="spinner" />Loading orders…</div>

  return (
    <div className="pg">
      <div className="topbar">
        <div>
          <div className="pt">Orders</div>
          <div className="ps">Manage and track all kit orders</div>
        </div>
        <button className="btn-p" onClick={function () { setShowNewOrder(true) }}>+ New Order</button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {ORDER_FILTERS.map(function (f) {
          const active = orderFilter === f
          return (
            <button
              key={f}
              className={active ? 'btn-p btn-sm' : 'btn-s btn-sm'}
              onClick={function () { setOrderFilter(f) }}
            >
              {FILTER_LABELS[f]}{filterCounts[f] > 0 ? ' (' + filterCounts[f] + ')' : ''}
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No orders found.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Order Ref</th>
                <th>Invoice No</th>
                {isAdmin && <th>Franchisee</th>}
                <th>Total</th>
                <th>Paid</th>
                <th>Status</th>
                <th>Actions</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function (order) {
                return (
                  <tr key={order.id}>
                    <td className="mono">{order.order_ref}</td>
                    <td className="mono">{order.invoice_no || '—'}</td>
                    {isAdmin && (
                      <td>
                        {order.placer
                          ? <span><TierBadge tier={order.placer.tier} /> {order.placer.business_name}</span>
                          : <span className="muted">{order.placer_tier}</span>}
                      </td>
                    )}
                    <td className="mono">₹{fmtAmt(order.grand_total || 0)}</td>
                    <td className="mono" style={{ color: order.amount_paid > 0 ? 'var(--green)' : 'var(--text3)' }}>
                      ₹{fmtAmt(order.amount_paid || 0)}
                    </td>
                    <td><StatusBadge status={order.status} /></td>
                    <td>{renderActions(order)}</td>
                    <td className="muted">{fmtDate(order.created_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

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
    </div>
  )
}
