import React, { useState, useEffect } from 'react'
import { jsPDF } from 'jspdf'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast } from '../utils'
import { isAdminRole } from '../constants/roles'
import { getDescendantIds, getTreeIds } from '../utils/hierarchy'
import { invoiceFit, invoiceFull } from '../utils/invoiceFit'
import { sendInvoiceEmail, sendPaymentReminder, sendPaymentVerified } from '../services/email'
import { sendWAOrderDispatched, sendWAPaymentReceived } from '../services/whatsapp'
import InvoiceView from '../components/InvoiceView'
import CouponField from '../components/CouponField'
import ModalHeader from '../components/ModalHeader'

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
        <ModalHeader flush title="Submit Payment Proof" subtitle="New Learning Horizons · Payment" onClose={onClose} />
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
  const [paidOn, setPaidOn]         = useState(
    order.paid_at ? String(order.paid_at).slice(0, 10) : new Date().toISOString().slice(0, 10)
  )
  const [saving, setSaving]         = useState(false)
  const [sendWA,  setSendWA]        = useState(true)
  const [waPhone, setWaPhone]       = useState(order.placer?.phone || '')

  const amt    = parseInt(amountPaid, 10) || 0
  const isFull = (order.amount_paid || 0) + amt >= total && total > 0
  const isPart = amt > 0 && !isFull
  // Balance AFTER this payment — must account for what was already recorded
  const balanceAfter = Math.max(0, total - (order.amount_paid || 0) - amt)

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
    // Each entry ADDS to what's already recorded, so re-keying a payment that
    // was entered earlier silently doubles it. An order can never be paid more
    // than its total — block it rather than store an impossible figure.
    if (total > 0 && (order.amount_paid || 0) + amt > total) {
      showToast(
        remaining === 0
          ? `This order is already fully paid (₹${fmtAmt(total)}). Nothing more to record.`
          : `That's more than the balance. Only ₹${fmtAmt(remaining)} is outstanding on this order.`,
        'warn'
      )
      return
    }
    setSaving(true)
    const newStatus = isFull ? 'closed' : 'part_paid'
    const { error } = await sb.from('orders').update({
      amount_paid:         (order.amount_paid || 0) + amt,
      payment_mode:        mode,
      payment_ref:         ref.trim() || null,
      // Date the money was actually received (back-datable), not when it was keyed in
      paid_at:             (paidOn || new Date().toISOString().slice(0, 10)) + 'T00:00:00+00:00',
      payment_verified_at: isFull ? new Date().toISOString() : null,
      status:              newStatus,
    }).eq('id', order.id)
    if (error) {
      showToast('Failed to record payment: ' + error.message, 'err')
      setSaving(false)
      return
    }

    showToast(isFull ? '✓ Full payment recorded — order closed.' : `Part payment of ₹${fmtAmt(amt)} recorded.`)

    // Acknowledge the payment on WhatsApp. Non-fatal: the payment is already
    // saved, so a messaging failure must never look like a failed payment.
    if (sendWA && waPhone) {
      try {
        const r = await sendWAPaymentReceived(waPhone, {
          name:      order.placer?.business_name || 'Partner',
          amount:    fmtAmt(amt),
          balance:   fmtAmt(balanceAfter),
          receiptNo: order.invoice_no || order.order_ref || '—',
          date:      fmtDate(paidOn),
        })
        if (r && r.success) showToast('💬 Payment acknowledgement sent on WhatsApp.')
        else showToast('Payment saved, but WhatsApp failed: ' + ((r && r.error) || 'unknown error'), 'warn')
      } catch (e) {
        showToast('Payment saved, but WhatsApp failed: ' + e.message, 'warn')
      }
    }

    onSaved()
    setSaving(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }}>
        <ModalHeader flush title="Record Payment" subtitle="New Learning Horizons · Payment" onClose={onClose} />
        <div>
          {/* Order total summary */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
            background:'var(--bg2)', borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
            <div>
              <div style={{ fontSize:11, color:'var(--text3)' }}>Order Total</div>
              <div style={{ fontSize:18, fontWeight:700, fontFamily:'var(--mono)' }}>₹{fmtAmt(total)}</div>
            </div>
            {order.amount_paid > 0 && (
              <>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>Already recorded</div>
                  <div style={{ fontSize:14, fontWeight:600, color:'var(--text2)', fontFamily:'var(--mono)' }}>
                    ₹{fmtAmt(order.amount_paid)}
                  </div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>Balance</div>
                  <div style={{ fontSize:14, fontWeight:700, fontFamily:'var(--mono)',
                    color: remaining > 0 ? '#92400e' : 'var(--green)' }}>
                    ₹{fmtAmt(remaining)}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Nothing left to collect — the amount field only ever ADDS, so warn loudly */}
          {total > 0 && remaining === 0 && (
            <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8,
              padding:'10px 14px', marginBottom:12, fontSize:12, color:'#166534' }}>
              ✓ <b>Already fully paid.</b> ₹{fmtAmt(order.amount_paid)} of ₹{fmtAmt(total)} is recorded —
              don't re-enter a payment that's already here, it would be counted twice.
            </div>
          )}

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
                  <option value="other">Other</option>
                </select>
              </label>
              <label>Amount Received Now (₹)
                <input
                  type="number" placeholder={`Up to ₹${fmtAmt(remaining)}`}
                  max={remaining}
                  value={amountPaid}
                  onChange={function (e) { setAmountPaid(e.target.value) }}
                  style={{ fontWeight:700, fontSize:16 }}
                />
              </label>
              <label>Payment Date
                <input
                  type="date"
                  value={paidOn}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={function (e) { setPaidOn(e.target.value) }}
                  title="Date the payment was actually received — back-date it if you're entering it later"
                />
              </label>
              <label>UTR / Reference Number
                <input
                  type="text" placeholder="Transaction ID / cheque no. / cash ref"
                  value={ref}
                  onChange={function (e) { setRef(e.target.value) }}
                />
              </label>

              {/* One-tap amounts — full settlement or a common part payment */}
              <div className="col-span-2" style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:-4 }}>
                <span style={{ fontSize:11, color:'var(--text3)', alignSelf:'center', marginRight:2 }}>Quick fill:</span>
                <button type="button" className="btn-s" style={{ fontSize:11, padding:'3px 10px' }}
                  onClick={function () { setAmountPaid(String(remaining)) }}>
                  Full ₹{fmtAmt(remaining)}
                </button>
                <button type="button" className="btn-s" style={{ fontSize:11, padding:'3px 10px' }}
                  onClick={function () { setAmountPaid(String(Math.round(remaining / 2))) }}>
                  Half ₹{fmtAmt(Math.round(remaining / 2))}
                </button>
                <button type="button" className="btn-s" style={{ fontSize:11, padding:'3px 10px' }}
                  onClick={function () { setAmountPaid('') }}>
                  Clear
                </button>
              </div>

              {/* WhatsApp acknowledgement */}
              <div className="col-span-2" style={{ padding:'10px 12px', borderRadius:10, background:'var(--green-bg, #f0fdf4)', border:'1px solid var(--green, #1D7A4F)' }}>
                <label style={{ display:'flex', alignItems:'center', gap:8, font:'600 12px var(--font)', color:'var(--green, #1D7A4F)', cursor:'pointer' }}>
                  <input type="checkbox" checked={sendWA} onChange={function (e) { setSendWA(e.target.checked) }} />
                  💬 Send WhatsApp payment acknowledgement to franchisee
                </label>
                {sendWA && (
                  <>
                    <input value={waPhone} onChange={function (e) { setWaPhone(e.target.value) }}
                      placeholder="Franchisee WhatsApp number" style={{ marginTop:8, fontSize:13, width:'100%' }} />
                    {amt > 0 && (
                      <div style={{ marginTop:6, fontSize:11, color:'var(--green, #1D7A4F)' }}>
                        Will confirm ₹{fmtAmt(amt)} received
                        {balanceAfter > 0 ? ` · ₹${fmtAmt(balanceAfter)} still due` : ' · fully paid'}
                      </div>
                    )}
                  </>
                )}
              </div>
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
                : <span style={{ color:'#92400e', fontWeight:600, fontSize:13 }}>Part payment — balance: <b>₹{fmtAmt(balanceAfter)}</b> — order marked <b>Part Paid</b></span>
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
  const [sendWA,   setSendWA]   = useState(true)
  const [waPhone,  setWaPhone]  = useState(order.placer?.phone || '')

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
      if (sendWA && waPhone && awb.trim()) {
        try {
          const r = await sendWAOrderDispatched(waPhone, {
            name:      order.placer?.business_name || 'Partner',
            invoiceNo: order.invoice_no || order.id,
            awb:       awb.trim(),
            courier:   courier.trim() || 'courier',
          })
          if (r && r.success) showToast('Dispatch update sent on WhatsApp ✓')
          else showToast('Dispatched · WhatsApp update failed' + (r && r.error ? ': ' + r.error : ''), 'warn')
        } catch (waErr) {
          showToast('Dispatched · WhatsApp update failed: ' + waErr.message, 'warn')
        }
      }
      // ── Auto-deduct HO stock for this dispatch (once per order, via each kit's BOM) ──
      try {
        const { data: already } = await sb.from('stock_ledger').select('id').eq('ref_type', 'order').eq('ref_id', order.id).limit(1)
        if (!already || already.length === 0) {
          const { data: oitems } = await sb.from('order_items').select('sku_id, item_id, ordered_qty, sent_qty, excluded_kit_items').eq('order_id', order.id)
          const skuIds = (oitems || []).map(function (o) { return o.sku_id }).filter(Boolean)
          {
            const kitsRes = skuIds.length ? await sb.from('kit_items').select('sku_id, item_id, quantity').in('sku_id', skuIds) : { data: [] }
            const kits = kitsRes.data || []
            const rows = []
            ;(oitems || []).forEach(function (o) {
              const units = (o.sent_qty && o.sent_qty > 0) ? o.sent_qty : (o.ordered_qty || 0)
              const note = 'Dispatch ' + (order.invoice_no || order.order_ref || '')
              if (o.item_id) {
                // raw inventory-item line — deduct the item directly
                if (units > 0) rows.push({ item_id: o.item_id, location_type: 'ho', movement_type: 'issue_to_franchisee', qty: -units, ref_type: 'order', ref_id: order.id, franchisee_id: order.placer_id, note: note })
              } else {
                // kit/supply SKU line — expand its bill of materials, skipping components the biller marked not-sent
                const excluded = o.excluded_kit_items || []
                kits.filter(function (k) { return k.sku_id === o.sku_id && !excluded.includes(k.item_id) }).forEach(function (k) {
                  const qn = units * Number(k.quantity || 1)
                  if (qn > 0) rows.push({ item_id: k.item_id, location_type: 'ho', movement_type: 'issue_to_franchisee', qty: -qn, ref_type: 'order', ref_id: order.id, franchisee_id: order.placer_id, note: note })
                })
              }
            })
            if (rows.length) {
              await sb.from('stock_ledger').insert(rows)
              showToast('HO stock deducted for ' + rows.length + ' item line' + (rows.length !== 1 ? 's' : ''))
            }
          }
        }
      } catch (stkErr) { console.warn('Stock deduction skipped:', stkErr.message) }

      // ── Lock (redeem) the coupon now that the order is dispatched ──
      if (order.coupon_code) {
        try {
          const r = await sb.rpc('redeem_coupon', {
            p_code: order.coupon_code, p_context: 'order',
            p_amount: order.subtotal || 0, p_franchisee: order.placer_id, p_ref: order.id,
          })
          if (r && r.data && r.data.valid === false) {
            showToast('Dispatched · coupon could not be locked: ' + (r.data.message || 'limit reached'), 'warn')
          }
        } catch (cErr) { console.warn('Coupon lock skipped:', cErr.message) }
      }
      onSaved()
    }
    setSaving(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }}>
        <ModalHeader flush title="Mark Dispatched" subtitle="New Learning Horizons · Dispatch" onClose={onClose} />
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

          {/* WhatsApp dispatch update to franchisee */}
          <div className="col-span-2" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--green-bg, #f0fdf4)', border: '1px solid var(--green, #1D7A4F)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '600 12px var(--font)', color: 'var(--green, #1D7A4F)', cursor: 'pointer' }}>
              <input type="checkbox" checked={sendWA} onChange={function (e) { setSendWA(e.target.checked) }} />
              💬 Send WhatsApp dispatch update to franchisee
            </label>
            {sendWA && (
              <input value={waPhone} onChange={function (e) { setWaPhone(e.target.value) }}
                placeholder="Franchisee WhatsApp number" style={{ marginTop: 8, fontSize: 13, width: '100%' }} />
            )}
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

// Confirms invoicing and lets the admin control the WhatsApp invoice notice.
function InvoiceConfirmModal({ order, onClose, onConfirm }) {
  const [sendWA, setSendWA] = useState(true)
  const [waPhone, setWaPhone] = useState(order.placer?.phone || '')
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }} style={{ maxWidth: 460 }}>
        <ModalHeader flush title="Generate Invoice" subtitle={'Order ' + (order.order_ref || '')} onClose={onClose} />
        <div style={{ padding: '4px 20px 8px' }}>
          <p style={{ font: '500 13px var(--font)', color: 'var(--text2)', margin: '4px 0 12px' }}>
            This will assign an invoice number and mark the order as <strong>invoiced</strong>
            {' '}for <strong>{order.placer?.business_name || 'the franchisee'}</strong>.
          </p>
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--green-bg, #f0fdf4)', border: '1px solid var(--green, #1D7A4F)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '600 12px var(--font)', color: 'var(--green, #1D7A4F)', cursor: 'pointer' }}>
              <input type="checkbox" checked={sendWA} onChange={function (e) { setSendWA(e.target.checked) }} />
              💬 Send WhatsApp invoice notice to franchisee
            </label>
            {sendWA && (
              <input value={waPhone} onChange={function (e) { setWaPhone(e.target.value) }}
                placeholder="Franchisee WhatsApp number" style={{ marginTop: 8, fontSize: 13, width: '100%' }} />
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-s" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={function () { onConfirm({ sendWA: sendWA, waPhone: waPhone.trim() }) }}>Generate Invoice</button>
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

// Load kit bill-of-materials for a set of SKU ids → { sku_id: [{ item_id, name, quantity }] }
async function loadKitMap(skuIds) {
  const ids = (skuIds || []).filter(Boolean)
  if (ids.length === 0) return {}
  const { data } = await sb.from('kit_items').select('sku_id, item_id, quantity, inventory_items(name)').in('sku_id', ids)
  const map = {}
  ;(data || []).forEach(function (k) {
    if (!map[k.sku_id]) map[k.sku_id] = []
    map[k.sku_id].push({ item_id: k.item_id, name: k.inventory_items?.name || '—', quantity: k.quantity })
  })
  return map
}

// Small reusable kit checklist — pre-checked components; unchecking marks an item not-sent
function KitChecklist({ components, excluded, onToggle }) {
  if (!components || components.length === 0) return null
  const ex = excluded || []
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', padding: '6px 10px', background: 'var(--purple-bg, #F1EEFB)', borderRadius: 8, marginTop: 6 }}>
      <span style={{ font: '700 9px var(--mono)', color: 'var(--purple)', textTransform: 'uppercase', letterSpacing: '.05em', alignSelf: 'center', marginRight: 2 }}>Kit contents</span>
      {components.map(function (c) {
        const checked = !ex.includes(c.item_id)
        return (
          <label key={c.item_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', font: '500 11px var(--font)', color: checked ? 'var(--text)' : 'var(--text3)', textDecoration: checked ? 'none' : 'line-through' }}>
            <input type="checkbox" checked={checked} onChange={function () { onToggle(c.item_id) }} style={{ cursor: 'pointer', accentColor: 'var(--purple)' }} />
            {c.name}{c.quantity > 1 ? ' ×' + c.quantity : ''}
          </label>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// InvoiceEditModal — admin edits items (add/delete/change), sent_qty, rate, courier
// ---------------------------------------------------------------------------
function InvoiceEditModal({ order, isAdmin, onClose, onSaved }) {
  const [items, setItems] = useState([])
  const [allSkus, setAllSkus] = useState([])
  const [allItems, setAllItems] = useState([])
  const [kitMap, setKitMap] = useState({})   // sku_id -> [{ item_id, name, quantity }]
  const [deletedIds, setDeletedIds] = useState([])
  const [courierCharges, setCourierCharges] = useState(order.courier_charges || 0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [coupon, setCoupon] = useState(
    order.coupon_id ? { coupon_id: order.coupon_id, code: order.coupon_code, discount: order.discount_amount || 0 } : null
  )

  useEffect(function () { loadData() }, [])

  async function loadData() {
    const [itemsRes, skusRes, invRes] = await Promise.all([
      sb.from('order_items').select('*, skus(level_name, uf_rate, cf_rate, smf_rate, courses(group_name)), inventory_items(name, unit)').eq('order_id', order.id),
      isAdmin ? sb.from('skus').select('id, level_name, uf_rate, cf_rate, smf_rate, courses(group_name)').order('sort_order') : { data: [] },
      isAdmin ? sb.from('inventory_items').select('id, name, unit, sell_price').eq('is_active', true).order('name') : { data: [] },
    ])
    if (itemsRes.error) showToast('Failed to load items: ' + itemsRes.error.message)
    else setItems(itemsRes.data || [])
    setAllSkus(skusRes.data || [])
    setAllItems(invRes.data || [])
    // Kit compositions for both existing lines and the full SKU catalog (for newly-added lines)
    const skuIds = [].concat(
      (itemsRes.data || []).map(function (it) { return it.sku_id }),
      (skusRes.data || []).map(function (s) { return s.id })
    )
    setKitMap(await loadKitMap(skuIds))
    // Make sure we have the current coupon on the order
    const { data: ord } = await sb.from('orders').select('coupon_id, coupon_code, discount_amount').eq('id', order.id).single()
    if (ord && ord.coupon_id) setCoupon({ coupon_id: ord.coupon_id, code: ord.coupon_code, discount: ord.discount_amount || 0 })
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

  function toggleKitItem(idx, itemId) {
    setItems(function (prev) {
      return prev.map(function (it, i) {
        if (i !== idx) return it
        const ex = it.excluded_kit_items || []
        const next = ex.includes(itemId) ? ex.filter(function (x) { return x !== itemId }) : [...ex, itemId]
        return { ...it, excluded_kit_items: next }
      })
    })
  }

  // value is "sku:<id>" (kit/supply) or "item:<id>" (raw inventory item)
  function updateNewItemSku(idx, value) {
    const tier = order.placer_tier || 'UF'
    setItems(function (prev) {
      return prev.map(function (it, i) {
        if (i !== idx) return it
        if (value && value.indexOf('item:') === 0) {
          const id = value.slice(5)
          const inv = allItems.find(function (x) { return x.id === id })
          return { ...it, item_id: id, sku_id: null, skus: null, inventory_items: inv ? { name: inv.name, unit: inv.unit } : null, rate: inv ? (inv.sell_price || 0) : 0, ordered_qty: it.ordered_qty || 1, excluded_kit_items: [] }
        }
        const id = value && value.indexOf('sku:') === 0 ? value.slice(4) : value
        const sku = allSkus.find(function (s) { return s.id === id })
        return { ...it, sku_id: id, item_id: null, skus: sku || null, inventory_items: null, rate: sku ? rateForSku(sku, tier) : 0, ordered_qty: it.ordered_qty || 1, excluded_kit_items: [] }
      })
    })
  }

  function addItem() {
    setItems(function (prev) {
      return [...prev, { id: null, sku_id: '', item_id: null, ordered_qty: 1, sent_qty: 0, rate: 0, skus: null, inventory_items: null }]
    })
  }

  function removeItem(idx) {
    const item = items[idx]
    if (item.id) setDeletedIds(function (prev) { return [...prev, item.id] })
    setItems(function (prev) { return prev.filter(function (_, i) { return i !== idx }) })
  }

  function lineTotal(item) { return (item.ordered_qty || 0) * (item.rate || 0) }

  function itemsSubtotal() {
    return items.reduce(function (s, it) { return s + lineTotal(it) }, 0)
  }
  const liveSubtotal = items.reduce(function (s, it) { return s + (it.ordered_qty || 0) * (it.rate || 0) }, 0)

  // Re-validate the applied coupon whenever the order total changes, so the
  // discount tracks the new amount (e.g. 15% recomputed) instead of staying
  // frozen at the value from when it was first applied. Drops it if the new
  // total no longer qualifies (e.g. below the minimum).
  useEffect(function () {
    if (loading || items.length === 0) return   // wait until the order's items have loaded
    if (!coupon || !coupon.code) return
    let cancelled = false
    async function reval() {
      const { data } = await sb.rpc('validate_coupon', {
        p_code: coupon.code, p_context: 'order',
        p_amount: Math.max(0, Math.round(liveSubtotal)),
        p_franchisee: order.placer_id || null,
        p_exclude_ref: order.id,
      })
      if (cancelled) return
      if (!data || !data.valid || !data.discount) {
        setCoupon(null)
        showToast(data && data.message ? 'Coupon removed — ' + data.message : 'Coupon removed (no longer applies to this total)', 'warn')
      } else if (data.discount !== coupon.discount) {
        setCoupon(function (prev) { return prev ? { ...prev, discount: data.discount } : prev })
      }
    }
    reval()
    return function () { cancelled = true }
  }, [liveSubtotal])  // eslint-disable-line react-hooks/exhaustive-deps

  function couponDisc() {
    return coupon ? Math.min(coupon.discount || 0, itemsSubtotal()) : 0
  }
  function grandTotal() {
    return Math.max(0, itemsSubtotal() + (parseInt(courierCharges, 10) || 0) - couponDisc())
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
          .update({ sent_qty: item.sent_qty, rate: item.rate, ordered_qty: item.ordered_qty, excluded_kit_items: item.sku_id ? (item.excluded_kit_items || []) : [] })
          .eq('id', item.id)
        if (error) { showToast('Error saving item: ' + error.message); setSaving(false); return }
      } else {
        if (!item.sku_id && !item.item_id) continue
        const { error } = await sb.from('order_items').insert({
          order_id: order.id,
          sku_id: item.sku_id || null,
          item_id: item.item_id || null,
          ordered_qty: item.ordered_qty || 1,
          sent_qty: item.sent_qty || 0,
          rate: item.rate || 0,
          excluded_kit_items: item.sku_id ? (item.excluded_kit_items || []) : [],
        })
        if (error) { showToast('Error adding item: ' + error.message); setSaving(false); return }
      }
    }
    const cc = parseInt(courierCharges, 10) || 0
    const subTotal = items.reduce(function (s, it) { return s + (it.ordered_qty || 0) * (it.rate || 0) }, 0)
    const discount = coupon ? Math.min(coupon.discount || 0, subTotal) : 0
    await sb.from('orders').update({
      courier_charges: cc,
      subtotal:        subTotal,
      grand_total:     Math.max(0, subTotal + cc - discount),
      discount_amount: discount,
      coupon_id:       coupon?.coupon_id || null,
      coupon_code:     coupon?.code || null,
    }).eq('id', order.id)

    // The coupon only locks (redeems) once the order is dispatched. Clear any
    // stale redemption for this order, and only re-record it if the order has
    // already been dispatched (so editing a dispatched order keeps the lock in
    // sync); otherwise leave it unlocked until dispatch.
    await sb.rpc('clear_coupon_redemption', { p_context: 'order', p_ref: order.id })
    if (order.dispatched_at && coupon && discount > 0) {
      await sb.rpc('redeem_coupon', {
        p_code: coupon.code, p_context: 'order', p_amount: subTotal,
        p_franchisee: order.placer_id, p_ref: order.id,
      })
    }

    showToast(order.invoice_no ? 'Invoice updated.' : 'Order updated.')
    onSaved()
    setSaving(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-lg" onClick={function (e) { e.stopPropagation() }}
        style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '92vh' }}>
        <ModalHeader title={(order.invoice_no ? 'Edit Invoice — ' : 'Edit Order — ') + order.order_ref} subtitle={'New Learning Horizons · ' + (order.invoice_no ? 'Invoice editor' : 'Order editor')} onClose={onClose} />
        <div style={{ padding: '18px 22px', overflowY: 'auto', background: 'var(--bg2, #FAFAF8)', flex: 1 }}>
          {loading ? (
            <div className="muted">Loading items…</div>
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
                    const rowKey = item.id || ('new-' + idx)
                    const kitComps = item.sku_id ? kitMap[item.sku_id] : null
                    return [
                      <tr key={rowKey} style={isNew ? { background: 'var(--bg3)' } : {}}>
                        <td>
                          {isNew ? (
                            <select
                              value={item.item_id ? 'item:' + item.item_id : (item.sku_id ? 'sku:' + item.sku_id : '')}
                              onChange={function (e) { updateNewItemSku(idx, e.target.value) }}
                              style={{ width: '100%', fontSize: 13 }}
                            >
                              <option value="">— Select SKU or item —</option>
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
                                      return <option key={s.id} value={'sku:' + s.id}>{s.level_name}</option>
                                    })}
                                  </optgroup>
                                )
                              })}
                              {allItems.length > 0 && (
                                <optgroup label="📦 Inventory items (individual)">
                                  {allItems.map(function (iv) {
                                    return <option key={iv.id} value={'item:' + iv.id}>{iv.name}{iv.sell_price ? ' — ₹' + fmtAmt(iv.sell_price) : ''}</option>
                                  })}
                                </optgroup>
                              )}
                            </select>
                          ) : (
                            <>
                              {item.skus?.courses?.group_name && (
                                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 1 }}>{item.skus.courses.group_name}</div>
                              )}
                              {item.item_id && !item.skus && (
                                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 1 }}>📦 Inventory item</div>
                              )}
                              <div style={{ fontWeight: 500 }}>{item.inventory_items?.name || item.skus?.level_name || item.sku_id || '—'}</div>
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
                            value={item.sent_qty} min={0} disabled={!isAdmin}
                            onChange={function (e) { updateField(idx, 'sent_qty', e.target.value) }}
                          />
                        </td>
                        <td>
                          <input
                            type="number" className="price-inp"
                            value={item.rate} min={0} disabled={!isAdmin}
                            onChange={function (e) { updateField(idx, 'rate', e.target.value) }}
                            style={{ fontWeight: 600 }}
                            title={!isAdmin ? 'Pricing is set by Head Office' : undefined}
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
                      </tr>,
                      kitComps && kitComps.length > 0 ? (
                        <tr key={rowKey + '-kit'}>
                          <td colSpan={isAdmin ? 6 : 5} style={{ paddingTop: 0, borderTop: 'none' }}>
                            <KitChecklist components={kitComps} excluded={item.excluded_kit_items} onToggle={function (id) { toggleKitItem(idx, id) }} />
                          </td>
                        </tr>
                      ) : null,
                    ]
                  })}
                </tbody>
              </table>

              {isAdmin && (function () {
                // One invoice = one A4 page. Once it's full, stop accepting items —
                // the remaining ones belong on the next invoice.
                const full = invoiceFull(items.map(function (it) {
                  return { kitCount: (kitMap[it.sku_id] || []).length }
                }))
                return (
                  <>
                    <button
                      className="btn-s btn-sm"
                      onClick={addItem}
                      disabled={full}
                      title={full ? 'Invoice is full — create another invoice for more items' : 'Add another product'}
                      style={{ marginTop: 10, border: '1.5px dashed var(--purple)', color: full ? 'var(--text3)' : 'var(--purple)', background: 'none', opacity: full ? 0.5 : 1, cursor: full ? 'not-allowed' : 'pointer' }}
                    >
                      + Add Product
                    </button>
                    {full && (
                      <div style={{ marginTop: 8, padding: '9px 12px', borderRadius: 8, background: '#FEF3C7', border: '1px solid #FCD34D', font: '600 12px var(--font)', color: '#8A5200' }}>
                        Invoice is full — please create another invoice for the remaining items.
                      </div>
                    )}
                  </>
                )
              })()}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 16, gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="fr" style={{ margin: 0 }}>
                    <label>Courier Charges (Rs)</label>
                    <input
                      type="number" value={courierCharges}
                      onChange={function (e) { setCourierCharges(e.target.value) }}
                      style={{ width: 140 }}
                    />
                  </div>
                  {isAdmin && (
                    <div className="fr" style={{ margin: 0 }}>
                      <label>🎟️ Discount coupon</label>
                      <CouponField context="order" amount={itemsSubtotal()} franchiseeId={order.placer_id}
                        applied={coupon} excludeRef={order.id}
                        onApply={function (c) { setCoupon(c) }}
                        onClear={function () { setCoupon(null) }}
                        disabled={itemsSubtotal() <= 0} compact />
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', padding: '10px 16px', background: 'var(--bg3)', borderRadius: 10, minWidth: 180 }}>
                  {couponDisc() > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>
                      Subtotal Rs {fmtAmt(itemsSubtotal())}
                      <span style={{ color: 'var(--green, #1D7A4F)', display: 'block' }}>Coupon − Rs {fmtAmt(couponDisc())}</span>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Grand Total</div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--purple)' }}>
                    Rs {fmtAmt(grandTotal())}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 22px', borderTop: '1px solid var(--border)', background: '#fff', flexShrink: 0 }}>
          <button className="btn-s" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save Changes'}
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
  const [allItems, setAllItems] = useState([])   // HO inventory items (admin only)
  const [kitMap, setKitMap] = useState({})       // sku_id -> [{ item_id, name, quantity }]
  const [visibleSkus, setVisibleSkus] = useState([])
  const [placerId, setPlacerId] = useState(showFrDropdown ? (isAdmin ? '' : currentFranchiseeId) : currentFranchiseeId)
  const [placerTier, setPlacerTier] = useState('')
  const [deliverTo, setDeliverTo] = useState('')
  // Each line: { sku_id, qty, rate, excluded }  — excluded = kit item_ids not being sent
  const [lines, setLines] = useState([{ sku_id: '', qty: 1, rate: 0, excluded: [] }])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [coupon, setCoupon] = useState(null)   // { coupon_id, code, discount, _base }

  // Build a delivery address string from franchisee fields
  function buildAddress(fr) {
    return [fr.address, fr.city, fr.state].filter(Boolean).join(', ')
  }

  useEffect(function () {
    async function loadData() {
      // SKUs always loaded for everyone
      const sRes = await sb.from('skus')
        .select('id, level_name, uf_rate, cf_rate, smf_rate, course_id, sku_type, courses(group_name)')
        .order('sort_order')
      const allS = sRes.data || []
      setAllSkus(allS)
      setKitMap(await loadKitMap(allS.map(function (s) { return s.id })))
      // HO can also bill raw inventory items individually
      if (isAdmin) {
        const ivRes = await sb.from('inventory_items').select('id, name, unit, sell_price').eq('is_active', true).order('name')
        setAllItems(ivRes.data || [])
      }
      // Standalone supply / individual-sale SKUs are HO-only; franchisees never see them.
      const ordPool = isAdmin ? allS : allS.filter(function (s) { return (s.sku_type || 'course_kit') !== 'supply' })

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
          setVisibleSkus(ordPool)   // SMF/CF: course kits only (no HO supply SKUs)
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
            setVisibleSkus(ordPool.filter(function (s) { return regCourses.includes(s.course_id) }))
          } else {
            setVisibleSkus(ordPool)
          }
        }
      }
      setLoading(false)
    }
    loadData()
  }, [])

  function addLine() {
    setLines(function (prev) { return [...prev, { sku_id: '', qty: 1, rate: 0, excluded: [] }] })
  }

  function toggleKitItem(idx, itemId) {
    setLines(function (prev) {
      return prev.map(function (line, i) {
        if (i !== idx) return line
        const ex = line.excluded || []
        const next = ex.includes(itemId) ? ex.filter(function (x) { return x !== itemId }) : [...ex, itemId]
        return { ...line, excluded: next }
      })
    })
  }

  function removeLine(idx) {
    setLines(function (prev) { return prev.filter(function (_, i) { return i !== idx }) })
  }

  function updateLine(idx, field, val) {
    setLines(function (prev) {
      return prev.map(function (line, i) {
        if (i !== idx) return line
        const updated = { ...line, [field]: val }
        // The line picker passes "sku:<id>" or "item:<id>"; set rate accordingly
        if (field === 'sku_id') {
          updated.excluded = []   // new selection → all kit components checked
          if (val && val.indexOf('item:') === 0) {
            const id = val.slice(5)
            const inv = allItems.find(function (x) { return x.id === id })
            updated.sku_id = ''; updated.item_id = id; updated.rate = inv ? (inv.sell_price || 0) : 0
          } else {
            const id = val && val.indexOf('sku:') === 0 ? val.slice(4) : val
            updated.sku_id = id; updated.item_id = null
            const sku = allSkus.find(function (s) { return s.id === id })
            updated.rate = rateForSku(sku, placerTier)
          }
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
    // Filter SKUs by registered courses for UF; supply SKUs stay HO-only.
    const pool = isAdmin ? allSkus : allSkus.filter(function (s) { return (s.sku_type || 'course_kit') !== 'supply' })
    const regCourses = fr.registered_courses || []
    if (tier === 'UF' && regCourses.length > 0) {
      setVisibleSkus(pool.filter(function (s) { return regCourses.includes(s.course_id) }))
    } else {
      setVisibleSkus(pool)
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

  const subTotal = calcTotal()
  const couponDiscount = coupon ? Math.min(coupon.discount, subTotal) : 0
  const netTotal = Math.max(0, subTotal - couponDiscount)

  // If the order amount changes after a coupon was applied, drop it so the
  // discount can't go stale (re-apply against the new total).
  useEffect(function () {
    if (coupon && coupon._base != null && coupon._base !== subTotal) setCoupon(null)
  }, [subTotal])  // eslint-disable-line

  async function handleSubmit() {
    const fid = placerId || currentFranchiseeId
    if (!fid) { showToast('Select a franchisee.'); return }
    const validLines = lines.filter(function (l) { return (l.sku_id || l.item_id) && parseInt(l.qty, 10) > 0 })
    if (validLines.length === 0) { showToast('Add at least one SKU.'); return }

    setSaving(true)
    const { data: refData } = await sb.rpc('next_order_ref')
    const orderRef = refData || ('ORD-' + Date.now())
    const total = calcTotal()
    const discount = coupon ? Math.min(coupon.discount, total) : 0

    // Derive tier from loaded franchisees if not already set (e.g. admin didn't change selection)
    const resolvedTier = placerTier || (franchisees.find(function (f) { return f.id === fid })?.tier) || 'UF'

    const { data: orderData, error: orderErr } = await sb
      .from('orders')
      .insert({
        order_ref: orderRef,
        placer_id: fid,
        placer_tier: resolvedTier,
        deliver_to: deliverTo.trim(),
        subtotal: total,
        grand_total: Math.max(0, total - discount),
        discount_amount: discount,
        coupon_id: coupon?.coupon_id || null,
        coupon_code: coupon?.code || null,
        status: 'pending',
      })
      .select().single()

    if (orderErr) {
      showToast('Failed to create order: ' + orderErr.message)
      setSaving(false)
      return
    }

    // NOTE: the coupon is only *applied* here (stored on the order). It is not
    // redeemed/locked until the order is marked dispatched — see DispatchModal.

    const itemRows = validLines.map(function (line) {
      return {
        order_id: orderData.id,
        sku_id: line.sku_id || null,
        item_id: line.item_id || null,
        ordered_qty: parseInt(line.qty, 10),
        sent_qty: 0,
        rate: parseInt(line.rate, 10) || 0,
        excluded_kit_items: line.sku_id ? (line.excluded || []) : [],
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

  const selectedFr = franchisees.find(function (f) { return f.id === placerId })

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-lg ord-modal" onClick={function (e) { e.stopPropagation() }}
        style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '92vh' }}>

        <ModalHeader title="New Order" subtitle="New Learning Horizons · Order form" onClose={onClose} />

        {/* ── Body ── */}
        <div style={{ padding: '18px 22px', overflowY: 'auto', background: 'var(--bg2, #FAFAF8)', flex: 1 }}>
          {loading ? (
            <div className="muted">Loading…</div>
          ) : (
            <>
              {/* Bill-to / Deliver-to header strip */}
              <div style={{ display: 'grid', gridTemplateColumns: showFrDropdown ? '1fr 1fr' : '1fr', gap: 14, marginBottom: 16 }}>
                {showFrDropdown && (
                  <div>
                    <div style={lblCap}>{isAdmin ? 'Bill to franchisee' : 'Place order for'}{isMasterFr && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--text3)' }}> · you or a sub-franchisee</span>}</div>
                    <select value={placerId} onChange={function (e) { handleFranchiseeChange(e.target.value) }} style={fld}>
                      {isAdmin && <option value="">— Select franchisee —</option>}
                      {franchisees.map(function (f) {
                        const isSelf = f.id === currentFranchiseeId
                        return <option key={f.id} value={f.id}>[{f.tier}] {f.business_name}{isSelf && isMasterFr ? ' (you)' : ''}</option>
                      })}
                    </select>
                    {selectedFr && (
                      <div style={{ marginTop: 6, font: '500 11px var(--font)', color: 'var(--text3)' }}>
                        {[selectedFr.city, selectedFr.state].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <div style={lblCap}>Deliver to{deliverTo && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--text3)' }}> · auto-filled, editable</span>}</div>
                  <textarea rows={showFrDropdown ? 2 : 2} value={deliverTo}
                    onChange={function (e) { setDeliverTo(e.target.value) }} placeholder="Delivery address…"
                    style={Object.assign({}, fld, { resize: 'vertical', minHeight: 44 })} />
                </div>
              </div>

              {/* ── Invoice-style line items card ── */}
              <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,.03)' }}>
                {/* header row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 96px 92px 30px', gap: 8, padding: '9px 12px', background: 'var(--purple-bg, #F1EEFB)', borderBottom: '1px solid var(--border)' }}>
                  {['Item / SKU', 'Qty', 'Rate', 'Amount', ''].map(function (h, i) {
                    return <span key={i} style={{ font: '700 9.5px var(--mono)', color: 'var(--purple)', textTransform: 'uppercase', letterSpacing: '.06em', textAlign: i === 3 ? 'right' : i === 1 || i === 2 ? 'left' : 'left' }}>{h}</span>
                  })}
                </div>

                {lines.map(function (line, idx) {
                  const sku = allSkus.find(function (s) { return s.id === line.sku_id })
                  const defaultRate = rateForSku(sku, placerTier)
                  const lineRate = parseInt(line.rate, 10) || 0
                  const lineAmt = lineRate * (parseInt(line.qty, 10) || 0)
                  const isOverridden = sku && lineRate !== defaultRate
                  const kitComps = line.sku_id ? kitMap[line.sku_id] : null
                  return (
                    <div key={idx} style={{ background: idx % 2 ? 'var(--bg2, #FAFAF8)' : '#fff', borderBottom: '1px solid var(--bg4, #F1F0EC)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 96px 92px 30px', gap: 8, padding: '8px 12px', alignItems: 'center' }}>
                      <select value={line.item_id ? 'item:' + line.item_id : (line.sku_id ? 'sku:' + line.sku_id : '')} onChange={function (e) { updateLine(idx, 'sku_id', e.target.value) }} style={fldSm}>
                        <option value="">{isAdmin ? '— Select SKU or item —' : '— Select SKU —'}</option>
                        {Object.entries(
                          visibleSkus.reduce(function (acc, s) { const c = s.courses?.group_name || 'Other'; if (!acc[c]) acc[c] = []; acc[c].push(s); return acc }, {})
                        ).map(function ([course, skus]) {
                          return <optgroup key={course} label={course}>{skus.map(function (s) { return <option key={s.id} value={'sku:' + s.id}>{s.level_name}</option> })}</optgroup>
                        })}
                        {isAdmin && allItems.length > 0 && (
                          <optgroup label="📦 Inventory items (individual)">
                            {allItems.map(function (iv) { return <option key={iv.id} value={'item:' + iv.id}>{iv.name}{iv.sell_price ? ' — ₹' + fmtAmt(iv.sell_price) : ''}</option> })}
                          </optgroup>
                        )}
                      </select>
                      <input type="number" min={1} value={line.qty} onChange={function (e) { updateLine(idx, 'qty', e.target.value) }} style={fldSm} />
                      <div style={{ position: 'relative' }}>
                        <input type="number" min={0} value={line.rate} onChange={function (e) { updateLine(idx, 'rate', e.target.value) }}
                          style={Object.assign({}, fldSm, { fontWeight: 600, borderColor: isOverridden ? 'var(--amber, #F59E0B)' : undefined })}
                          title={isOverridden ? 'Overriding default rate of Rs ' + defaultRate : 'Default rate for tier'} />
                        {isOverridden && (
                          <span style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 8.5, color: '#B45309', cursor: 'pointer' }}
                            title={'Reset to Rs ' + defaultRate} onClick={function () { updateLine(idx, 'rate', defaultRate) }}>reset</span>
                        )}
                      </div>
                      <span style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: lineAmt > 0 ? 'var(--text)' : 'var(--text3)' }}>{fmtAmt(lineAmt)}</span>
                      <button onClick={function () { removeLine(idx) }} disabled={lines.length === 1}
                        style={{ background: 'none', border: 'none', cursor: lines.length === 1 ? 'default' : 'pointer', color: 'var(--text3)', fontSize: 16, padding: 0, opacity: lines.length === 1 ? .3 : 1 }} title="Remove">✕</button>
                    </div>
                    {kitComps && kitComps.length > 0 && (
                      <div style={{ padding: '0 12px 8px' }}>
                        <KitChecklist components={kitComps} excluded={line.excluded} onToggle={function (itemId) { toggleKitItem(idx, itemId) }} />
                      </div>
                    )}
                    </div>
                  )
                })}

                <div style={{ padding: '10px 12px' }}>
                  <button className="btn-s btn-sm" onClick={addLine} style={{ border: '1.5px dashed var(--purple)', color: 'var(--purple)', background: 'none' }}>+ Add item</button>
                </div>
              </div>

              {/* ── Coupon + branded totals panel ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
                <div>
                  <div style={lblCap}>🎟️ Discount coupon</div>
                  <CouponField context="order" amount={subTotal} franchiseeId={placerId || currentFranchiseeId || null}
                    applied={coupon}
                    onApply={function (c) { setCoupon(Object.assign({}, c, { _base: subTotal })) }}
                    onClear={function () { setCoupon(null) }}
                    disabled={subTotal <= 0} compact />
                </div>
                <div style={{ minWidth: 210, background: 'var(--purple-bg, #F1EEFB)', border: '1px solid #DDD6F3', borderLeft: '3px solid var(--purple)', borderRadius: 12, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', font: '500 12px var(--font)', color: 'var(--text2)', marginBottom: 4 }}>
                    <span>Subtotal</span><span style={{ fontFamily: 'var(--mono)' }}>Rs {fmtAmt(subTotal)}</span>
                  </div>
                  {couponDiscount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', font: '600 12px var(--font)', color: 'var(--green, #1D7A4F)', marginBottom: 4 }}>
                      <span>Discount{coupon?.code ? ' (' + coupon.code + ')' : ''}</span><span style={{ fontFamily: 'var(--mono)' }}>− Rs {fmtAmt(couponDiscount)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid #DDD6F3', marginTop: 6, paddingTop: 8 }}>
                    <span style={{ font: '700 12px var(--font)', color: 'var(--text)' }}>Order Total</span>
                    <span style={{ font: '800 20px var(--mono)', color: 'var(--purple)' }}>Rs {fmtAmt(netTotal)}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 22px', borderTop: '1px solid var(--border)', background: '#fff', flexShrink: 0 }}>
          <button className="btn-s" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={handleSubmit} disabled={saving || loading}>{saving ? 'Placing Order…' : 'Place Order'}</button>
        </div>
      </div>
    </div>
  )
}

// Shared field styles for the branded order form
const lblCap = { font: '700 10px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5, display: 'block' }
const fld    = { width: '100%', font: '500 13px var(--font)', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--border2, #d8d5cc)', background: '#fff', boxSizing: 'border-box', color: 'var(--text)' }
const fldSm  = { width: '100%', font: '500 12.5px var(--font)', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border2, #d8d5cc)', background: '#fff', boxSizing: 'border-box', color: 'var(--text)' }

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
      : (item.inventory_items?.name || item.sku_id || '')
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
  const courier  = order.courier_charges || 0
  const discount = order.discount_amount || 0
  const total    = order.grand_total || (subtotal + courier - discount)
  const botH     = discount > 0 ? 75 : 66
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
  if (discount > 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); tc(...TMD)
    doc.text('Discount' + (order.coupon_code ? ' (' + order.coupon_code + ')' : ''), tL, ty)
    doc.setFont('helvetica', 'bold'); tc(...GREEN)
    doc.text('- Rs ' + fmtAmt(discount), tR, ty, { align: 'right' })
    ty += 8.5
  }
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
  const [invoiceConfirm, setInvoiceConfirm] = useState(null)
  const [cancelOrder, setCancelOrder] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const canCancel = ['owner', 'super_admin', 'admin'].includes(currentRole)

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

  async function handleMarkInvoiced(order, waOpts) {
    setActionLoading(order.id + '_invoice')

    // Compute grand_total from items before invoicing
    const { data: itemRows } = await sb
      .from('order_items').select('sku_id, ordered_qty, rate').eq('order_id', order.id)

    // An invoice must fit a single A4 page (it is also sent as one WhatsApp
    // image). Capacity is computed from the real page geometry — rows carrying
    // kit chips are taller, so the limit depends on what's actually ordered.
    const kmap = await loadKitMap((itemRows || []).map(function (r) { return r.sku_id }))
    const fit = invoiceFit((itemRows || []).map(function (r) {
      return { kitCount: (kmap[r.sku_id] || []).length }
    }))
    if (fit.overflow > 0) {
      showToast('Invoice is full — please create another invoice for the remaining items.', 'warn')
      setActionLoading(null)
      return
    }

    const itemsTotal = (itemRows || []).reduce(function (sum, it) {
      return sum + (it.ordered_qty || 0) * (it.rate || 0)
    }, 0)
    // Preserve any coupon discount already applied at checkout
    const discount = Math.min(order.discount_amount || 0, itemsTotal)
    const grandTotal = Math.max(0, itemsTotal + (order.courier_charges || 0) - discount)

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
        await sendInvoiceEmail(invoicedOrder)
      } catch (emailErr) {
        console.warn('Invoice email failed:', emailErr.message)
      }
      // The invoice template carries an image header (a PNG of the invoice), so
      // the invoice has to be on screen to be captured. Open the invoice view —
      // its 💬 WhatsApp button does the capture, upload and send.
      const wantWA = waOpts ? waOpts.sendWA : !!order.placer?.phone
      const waPhone = waOpts ? waOpts.waPhone : (order.placer?.phone || '')
      await loadOrders()
      if (wantWA && waPhone) {
        setInvoiceViewOrder({ ...order, invoice_no: invoiceNo, grand_total: grandTotal, status: 'invoiced' })
        showToast('Invoiced ' + invoiceNo + ' · tap 💬 WhatsApp to send it to the franchisee')
      }
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
        await sendPaymentVerified(order)
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

  async function handlePayOnline(order) {
    const balance = Math.max(0, (order.grand_total || 0) - (order.amount_paid || 0))
    if (!balance) { showToast('No balance due', 'warn'); return }
    setActionLoading(order.id + '_pay')
    try {
      // 1. Create Razorpay order on server
      const res  = await fetch('/api/create-razorpay-order', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, amount: balance }),
      })
      const data = await res.json()
      if (!data.success) { showToast('Payment init failed: ' + data.error, 'err'); setActionLoading(null); return }

      // 2. Open Razorpay checkout
      var options = {
        key:         data.keyId,
        amount:      balance * 100,
        currency:    'INR',
        name:        'New Learning Horizons',
        description: 'Invoice ' + (order.invoice_no || order.order_ref),
        order_id:    data.rzpOrderId,
        prefill: {
          name:  order.placer?.business_name || '',
          email: order.placer?.email || '',
        },
        theme: { color: '#534AB7' },
        handler: async function (response) {
          // Payment successful — mark as payment_submitted (webhook will close it)
          var now = new Date().toISOString()
          await sb.from('orders').update({
            status:               'payment_submitted',
            payment_mode:         'razorpay',
            payment_ref:          response.razorpay_payment_id,
            amount_paid:          balance,
            paid_at:              now,
            payment_submitted_at: now,
          }).eq('id', order.id)
          setOrders(function (prev) {
            return prev.map(function (o) {
              return o.id === order.id
                ? { ...o, status: 'payment_submitted', payment_mode: 'razorpay', payment_ref: response.razorpay_payment_id, amount_paid: balance, payment_submitted_at: now }
                : o
            })
          })
          showToast('Payment successful! ₹' + balance + ' paid via Razorpay ✓')
        },
      }
      var rzp = new window.Razorpay(options)
      rzp.on('payment.failed', function (response) {
        showToast('Payment failed: ' + (response.error?.description || 'Unknown error'), 'err')
      })
      rzp.open()
    } catch (e) {
      showToast('Payment error: ' + e.message, 'err')
    }
    setActionLoading(null)
  }

  async function handleSendReminder(order) {
    setActionLoading(order.id + '_reminder')
    try {
      const result = await sendPaymentReminder(order)
      if (!result.success) {
        showToast('Reminder failed: ' + (result.error || 'No franchisee email on file'), 'warn')
        setActionLoading(null)
        return
      }
      // Stamp the order only after a confirmed send
      var now = new Date().toISOString()
      var newCount = (order.reminder_count || 0) + 1
      await sb.from('orders').update({
        last_reminded_at: now,
        reminder_count: newCount,
      }).eq('id', order.id)
      // Update local state so the UI reflects immediately
      setOrders(function (prev) {
        return prev.map(function (o) {
          return o.id === order.id ? { ...o, last_reminded_at: now, reminder_count: newCount } : o
        })
      })
      showToast('Payment reminder sent ✓')
    } catch (e) {
      showToast('Failed to send reminder: ' + e.message)
    }
    setActionLoading(null)
  }

  async function handleDownloadInvoice(order) {
    const { data: items, error } = await sb
      .from('order_items')
      .select('*, skus(level_name, courses(group_name)), inventory_items(name)')
      .eq('order_id', order.id)
    if (error) {
      showToast('Failed to load items: ' + error.message)
      return
    }
    await generateInvoicePDF(order, items || [])
  }

  async function handleCancelInvoice() {
    if (!cancelOrder) return
    setCancelling(true)
    const { error } = await sb.from('orders').update({
      status: 'pending',
      invoice_no: null,
      invoice_cancelled_at: new Date().toISOString(),
      invoice_cancelled_by: currentUser?.email || currentRole || 'admin',
    }).eq('id', cancelOrder.id)
    setCancelling(false)
    if (error) { showToast('Failed to cancel: ' + error.message, 'err'); return }
    showToast('Invoice ' + (cancelOrder.invoice_no || '') + ' cancelled · order returned to Pending')
    setCancelOrder(null)
    setCancelReason('')
    await loadOrders()
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
    const dispInfo = order.dispatched_at ? [
      order.awb_number ? 'AWB ' + order.awb_number : null,
      order.courier_partner,
      order.dispatch_date,
      order.dispatch_weight != null ? order.dispatch_weight + ' kg' : null,
      order.dispatch_freight > 0 ? '₹' + fmtAmt(order.dispatch_freight) : null,
    ].filter(Boolean).join(' · ') : ''
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, minWidth: 0 }}>
        {/* ── action buttons: one clean aligned row ── */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
          {order.status === 'pending' && (
            <button className="row-action" onClick={function () { setEditInvoiceOrder(order) }}>Edit</button>
          )}
          {order.status === 'pending' && isAdmin && (
            <button className="row-action primary" disabled={busy} onClick={function () { setInvoiceConfirm(order) }}>
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
          <button className="row-action" onClick={function () { setDispatchOrder(order) }}>
            {order.dispatched_at ? 'Dispatch ✎' : 'Dispatch'}
          </button>
          {canCancel && ['invoiced', 'payment_submitted'].includes(order.status) && (
            <button className="row-action danger" onClick={function () { setCancelOrder(order) }}>Cancel</button>
          )}
        </div>

        {/* ── metadata, muted, on their own lines below ── */}
        {order.paid_at && order.amount_paid > 0 && (
          <span style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
            💰 ₹{fmtAmt(order.amount_paid)} on {fmtDate(String(order.paid_at).slice(0, 10))}
            {order.payment_mode ? ' · ' + order.payment_mode : ''}
          </span>
        )}
        {order.last_reminded_at && (
          <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
            Reminded {fmtDate(order.last_reminded_at.slice(0, 10))}
            {order.reminder_count > 1 ? ' ×' + order.reminder_count : ''}
          </span>
        )}
        {order.dispatched_at && dispInfo && (
          <span style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'right', maxWidth: 260 }}>
            📦 {dispInfo}
          </span>
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

      {invoiceConfirm && (
        <InvoiceConfirmModal
          order={invoiceConfirm}
          onClose={function () { setInvoiceConfirm(null) }}
          onConfirm={function (waOpts) {
            const ord = invoiceConfirm
            setInvoiceConfirm(null)
            handleMarkInvoiced(ord, waOpts)
          }}
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

      {cancelOrder && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={function () { if (!cancelling) { setCancelOrder(null); setCancelReason('') } }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, maxWidth: 440, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}
            onClick={function (e) { e.stopPropagation() }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>⚠️</span>
              <div style={{ font: '700 16px "DM Sans",sans-serif', color: '#A32D2D' }}>Cancel Invoice {cancelOrder.invoice_no}?</div>
            </div>
            <p style={{ font: '400 13px "DM Sans",sans-serif', color: '#5C5A54', lineHeight: 1.6, marginBottom: 16 }}>
              This will <strong>void the invoice number</strong> and return the order to <em>Pending</em>. The number will not be reused.
            </p>
            <textarea value={cancelReason} onChange={function (e) { setCancelReason(e.target.value) }} placeholder="Reason (optional)" rows={2}
              style={{ width: '100%', padding: '8px 11px', border: '1.5px solid #E2E0D8', borderRadius: 8, font: '13px "DM Sans",sans-serif', marginBottom: 16, resize: 'none', outline: 'none', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={function () { setCancelOrder(null); setCancelReason('') }} disabled={cancelling}
                style={{ padding: '9px 20px', border: '1px solid #D0CEC6', borderRadius: 8, background: '#fff', font: '600 13px "DM Sans",sans-serif', cursor: 'pointer', color: '#5C5A54' }}>Keep Invoice</button>
              <button onClick={handleCancelInvoice} disabled={cancelling}
                style={{ padding: '9px 20px', border: 'none', borderRadius: 8, background: '#DC2626', color: '#fff', font: '600 13px "DM Sans",sans-serif', cursor: 'pointer', opacity: cancelling ? .7 : 1 }}>
                {cancelling ? 'Cancelling…' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

