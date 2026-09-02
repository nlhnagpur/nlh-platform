import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast } from '../utils'
import { isAdminRole } from '../constants/roles'
import { getDescendantIds, getTreeIds } from '../utils/hierarchy'
import { invoiceFit, invoiceFull } from '../utils/invoiceFit'
import { sendInvoiceEmail, sendPaymentReminder, sendPaymentVerified } from '../services/email'
import { sendWAOrderDispatched, sendWAPaymentReceived } from '../services/whatsapp'
import { printOrderReceipt } from '../components/studentDocs'
import { captureDocPng } from '../utils/captureReceipt'
import InvoiceView from '../components/InvoiceView'
import CouponField from '../components/CouponField'
import ModalHeader from '../components/ModalHeader'

// JSX badge components
function StatusBadge({ status }) {
  const map = {
    pending:           { cls: 'bdg-pend', txt: 'pending' },
    proforma:          { cls: 'bdg-pend', txt: 'proforma' },
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
  all: 'All', pending: 'Pending', proforma: 'Proforma', invoiced: 'Invoiced',
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
// viewOnly: opened from the Receipts button to read the ledger and print
// receipts, with no entry form — the only way into the history for an order
// that is already closed.
function RecordPaymentModal({ order, onClose, onSaved, viewOnly }) {
  // bill_to_fr (a school, or any other bill_to_franchisee_id override) is who
  // actually owes and pays this money — every notification/receipt below
  // must address them, not whichever CF/UF placed the order on their behalf.
  const billFr = order.bill_to_fr || order.placer || {}
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
  const [waPhone, setWaPhone]       = useState(billFr.phone || '')
  const [history, setHistory]       = useState([])
  const [waSendingId, setWaSendingId] = useState(null)

  async function loadHistory() {
    const { data } = await sb.from('order_payments')
      .select('id, amount, paid_on, mode, reference, note, receipt_no')
      .eq('order_id', order.id)
      .order('paid_on', { ascending: false })
    setHistory(data || [])
  }
  useEffect(function () { loadHistory() }, [order.id])

  // "Paid to date" is the running total as at THAT payment, not today's — a
  // receipt must reflect the moment it was issued, or reprinting an old one
  // would show a figure that never existed.
  function paidAsAt(p) {
    return history
      .filter(function (x) { return x.paid_on < p.paid_on || (x.paid_on === p.paid_on && x.id === p.id) })
      .reduce(function (s, x) { return s + (x.amount || 0) }, 0)
  }

  function printReceipt(p) {
    printOrderReceipt(order, p, { paidToDate: paidAsAt(p) })
  }

  // Send (or re-send) one receipt on WhatsApp, with a PNG of the document.
  async function sendReceiptWA(p) {
    const phone = waPhone || billFr.phone
    if (!phone) { showToast('No phone number on file for this franchisee', 'warn'); return }
    setWaSendingId(p.id)
    try {
      const asAt = paidAsAt(p)
      let imageUrl = null
      try {
        const html = printOrderReceipt(order, p, { paidToDate: asAt, asHtml: true })
        imageUrl = await captureDocPng(html, p.receipt_no || 'receipt')
      } catch (capErr) { /* falls back to the text receipt */ }

      const r = await sendWAPaymentReceived(phone, {
        name:      billFr.business_name || 'Partner',
        amount:    fmtAmt(p.amount),
        balance:   fmtAmt(Math.max(0, total - asAt)),
        receiptNo: p.receipt_no || order.invoice_no || '—',
        date:      fmtDate(p.paid_on),
        imageUrl:  imageUrl,
      })
      if (r && r.success) showToast('💬 Receipt ' + (p.receipt_no || '') + ' sent on WhatsApp.')
      else showToast('WhatsApp failed: ' + ((r && r.error) || 'unknown error'), 'warn')
    } catch (e) {
      showToast('WhatsApp failed: ' + e.message, 'warn')
    }
    setWaSendingId(null)
  }

  // Remove a wrongly-keyed instalment. The trigger recomputes the order total,
  // so deleting here is the supported way to undo a mistake.
  async function handleDeletePayment(p) {
    if (!window.confirm(`Remove the ₹${fmtAmt(p.amount)} payment dated ${fmtDate(p.paid_on)}?\n\nThe order total will be recalculated.`)) return
    const { error } = await sb.from('order_payments').delete().eq('id', p.id)
    if (error) { showToast('Could not remove it: ' + error.message, 'err'); return }
    showToast('Payment removed — order total recalculated.')
    await loadHistory()
    onSaved()
  }

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
    // One row per instalment. A DB trigger rolls the ledger up into
    // orders.amount_paid / paid_at / status, so the total can never drift.
    const { data: inserted, error } = await sb.from('order_payments').insert({
      order_id:  order.id,
      amount:    amt,
      // Date the money was actually received (back-datable), not when it was keyed in
      paid_on:   paidOn || new Date().toISOString().slice(0, 10),
      mode:      mode,
      reference: ref.trim() || null,
    }).select('receipt_no').single()
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
        // A PNG of the receipt, so the franchisee gets the document itself and
        // not just the figures. Best-effort: a capture failure still sends text.
        let imageUrl = null
        try {
          const html = printOrderReceipt(
            order,
            { receipt_no: inserted && inserted.receipt_no, amount: amt, paid_on: paidOn, mode: mode, reference: ref.trim() || null },
            { paidToDate: (order.amount_paid || 0) + amt, asHtml: true }
          )
          imageUrl = await captureDocPng(html, (inserted && inserted.receipt_no) || 'receipt')
        } catch (capErr) { /* non-fatal */ }

        const r = await sendWAPaymentReceived(waPhone, {
          imageUrl:  imageUrl,
          name:      billFr.business_name || 'Partner',
          amount:    fmtAmt(amt),
          balance:   fmtAmt(balanceAfter),
          // The receipt number, so it matches the printed receipt the
          // franchisee is handed — not the invoice it was paid against.
          receiptNo: (inserted && inserted.receipt_no) || order.invoice_no || '—',
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
        <ModalHeader flush
          title={viewOnly ? 'Payments & Receipts' : 'Record Payment'}
          subtitle={'New Learning Horizons · ' + (order.invoice_no || order.order_ref || 'Payment')}
          onClose={onClose} />
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
          {!viewOnly && total > 0 && remaining === 0 && (
            <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8,
              padding:'10px 14px', marginBottom:12, fontSize:12, color:'#166534' }}>
              ✓ <b>Already fully paid.</b> ₹{fmtAmt(order.amount_paid)} of ₹{fmtAmt(total)} is recorded —
              don't re-enter a payment that's already here, it would be counted twice.
            </div>
          )}

          {viewOnly ? null : total === 0 ? (
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

          {/* ── Payment history — every instalment, individually removable ── */}
          {history.length > 0 && (
            <div style={{ marginTop:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:.4, marginBottom:6 }}>
                Payment History
              </div>
              <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                {history.map(function (p, i) {
                  return (
                    <div key={p.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border)', fontSize:12 }}>
                      <span style={{ fontFamily:'var(--mono)', fontWeight:700, minWidth:76 }}>₹{fmtAmt(p.amount)}</span>
                      <span style={{ color:'var(--text2)' }}>{fmtDate(p.paid_on)}</span>
                      <span style={{ color:'var(--text3)', textTransform:'uppercase', fontSize:10 }}>{p.mode}</span>
                      {p.receipt_no && (
                        <span style={{ color:'var(--purple)', fontFamily:'var(--mono)', fontSize:10, fontWeight:600 }}>
                          {p.receipt_no}
                        </span>
                      )}
                      {p.reference && <span style={{ color:'var(--text3)', fontFamily:'var(--mono)', fontSize:10 }}>{p.reference}</span>}
                      <button type="button" className="btn-s" title="Print this receipt"
                        style={{ marginLeft:'auto', fontSize:11, padding:'2px 8px' }}
                        onClick={function () { printReceipt(p) }}>
                        Receipt
                      </button>
                      <button type="button" className="btn-s" title="Send this receipt on WhatsApp"
                        disabled={waSendingId === p.id}
                        style={{ fontSize:11, padding:'2px 8px', color:'var(--green,#1D7A4F)' }}
                        onClick={function () { sendReceiptWA(p) }}>
                        {waSendingId === p.id ? 'Sending…' : '💬 WhatsApp'}
                      </button>
                      <button type="button" className="btn-s" title="Remove this payment"
                        style={{ fontSize:11, padding:'2px 8px', color:'var(--red,#b91c1c)' }}
                        onClick={function () { handleDeletePayment(p) }}>
                        Remove
                      </button>
                    </div>
                  )
                })}
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
          <button className="btn-s" onClick={onClose}>{viewOnly ? 'Close' : 'Cancel'}</button>
          {!viewOnly && (total === 0
            ? <button className="btn-p" onClick={handleCloseZero} disabled={saving}>{saving ? 'Closing…' : 'Close Order (₹0)'}</button>
            : <button className="btn-p" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : isFull ? 'Record Full Payment' : isPart ? 'Record Part Payment' : 'Save'}</button>
          )}
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
  // bill_to_fr (a school, or any other bill_to_franchisee_id override) is who
  // actually owes/receives this order — notify them, not just whoever placed it.
  const billFr = order.bill_to_fr || order.placer || {}
  const today = new Date().toISOString().slice(0, 10)
  const [courier,  setCourier]  = useState(order.courier_partner  || '')
  const [awb,      setAwb]      = useState(order.awb_number       || '')
  const [date,     setDate]     = useState(order.dispatch_date    || today)
  const [weight,   setWeight]   = useState(order.dispatch_weight  != null ? String(order.dispatch_weight) : '')
  const [freight,  setFreight]  = useState(order.dispatch_freight != null ? String(order.dispatch_freight) : '')
  const [saved,    setSaved]    = useState(getSavedCouriers)
  const [saving,   setSaving]   = useState(false)
  const [sendWA,   setSendWA]   = useState(true)
  const [waPhone,  setWaPhone]  = useState(billFr.phone || '')

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
            name:      billFr.business_name || 'Partner',
            invoiceNo: order.invoice_no || order.id,
            awb:       awb.trim(),
            courier:   courier.trim() || 'courier',
            // Blank here is meaningful: the courier often bills us after
            // dispatch, and the template then reads "As per actuals".
            freight:   freight !== '' ? parseInt(freight, 10) || 0 : 0,
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
function InvoiceConfirmModal({ order, mode, onClose, onConfirm }) {
  const isProforma = mode === 'proforma'
  const isConvert  = mode === 'convert'
  const [sendWA, setSendWA] = useState(true)
  const [waPhone, setWaPhone] = useState(order.bill_to_fr?.phone || order.placer?.phone || '')
  const billee = order.bill_to_fr?.business_name || order.placer?.business_name || 'the franchisee'
  const title = isProforma ? 'Generate Proforma' : isConvert ? 'Convert to Invoice' : 'Generate Invoice'
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function (e) { e.stopPropagation() }} style={{ maxWidth: 460 }}>
        <ModalHeader flush title={title} subtitle={'Order ' + (order.order_ref || '')} onClose={onClose} />
        <div style={{ padding: '4px 20px 8px' }}>
          {isProforma ? (
            <p style={{ font: '500 13px var(--font)', color: 'var(--text2)', margin: '4px 0 12px' }}>
              This creates a <strong>proforma</strong> document (not a tax invoice, no invoice number consumed) for <strong>{billee}</strong>.
              The real invoice is only generated once payment is verified, and the order can't be dispatched before then.
            </p>
          ) : isConvert ? (
            <p style={{ font: '500 13px var(--font)', color: 'var(--text2)', margin: '4px 0 12px' }}>
              This assigns a real invoice number for <strong>{billee}</strong> right now, <strong>without waiting for a payment</strong> —
              use this once the order is confirmed even if money hasn't landed yet. Proforma {order.proforma_no || ''} is superseded; dispatch unlocks immediately after.
            </p>
          ) : (
            <p style={{ font: '500 13px var(--font)', color: 'var(--text2)', margin: '4px 0 12px' }}>
              This will assign an invoice number and mark the order as <strong>invoiced</strong>
              {' '}for <strong>{billee}</strong>.
            </p>
          )}
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--green-bg, #f0fdf4)', border: '1px solid var(--green, #1D7A4F)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '600 12px var(--font)', color: 'var(--green, #1D7A4F)', cursor: 'pointer' }}>
              <input type="checkbox" checked={sendWA} onChange={function (e) { setSendWA(e.target.checked) }} />
              💬 Send WhatsApp {isProforma ? 'proforma' : 'invoice'} notice to franchisee
            </label>
            {sendWA && (
              <input value={waPhone} onChange={function (e) { setWaPhone(e.target.value) }}
                placeholder="Franchisee WhatsApp number" style={{ marginTop: 8, fontSize: 13, width: '100%' }} />
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-s" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={function () { onConfirm({ sendWA: sendWA, waPhone: waPhone.trim() }) }}>
            {title}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── RaiseCreditNoteModal — admin-only, pays out a CF's commission on a
// closed school order by crediting it into their ledger. Pre-fills the
// system-computed suggestion (Σ sent_qty × cf_commission_rate) but the
// amount is editable before raising, per how this was specified.
function RaiseCreditNoteModal({ order, currentUser, onClose, onSaved }) {
  const [suggested, setSuggested] = useState(0)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(function () {
    async function load() {
      const { data } = await sb.from('order_items')
        .select('sent_qty, ordered_qty, cf_commission_rate, skus(level_name, courses(group_name))')
        .eq('order_id', order.id)
      const total = (data || []).reduce(function (sum, it) {
        const qty = (it.sent_qty && it.sent_qty > 0) ? it.sent_qty : (it.ordered_qty || 0)
        return sum + qty * (it.cf_commission_rate || 0)
      }, 0)
      setSuggested(total)
      setAmount(String(total))
      const lines = (data || []).filter(function (it) { return (it.cf_commission_rate || 0) > 0 })
        .map(function (it) { return (it.skus?.courses?.group_name || 'Kit') + ' — ' + (it.skus?.level_name || '') })
      setReason('School kit commission · ' + (order.order_ref || '') + (lines.length ? ' · ' + lines.join(', ') : ''))
      setLoading(false)
    }
    load()
  }, [order.id])

  async function save() {
    const amt = parseInt(amount, 10) || 0
    if (amt <= 0) { showToast('Enter an amount greater than zero', 'warn'); return }
    setSaving(true)
    const { error } = await sb.from('franchisee_credit_notes').insert({
      franchisee_id: order.placer_id,
      order_id: order.id,
      suggested_amount: suggested,
      amount: amt,
      reason: reason.trim() || null,
      requested_by: currentUser?.email || null,
    })
    setSaving(false)
    if (error) { showToast('Failed to raise credit note: ' + error.message, 'err'); return }
    showToast('Credit note raised — awaiting approval ✓')
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <ModalHeader flush title="Raise Credit Note" subtitle={'Order ' + (order.order_ref || '') + ' · ' + (order.bill_to_fr?.business_name || '')} onClose={onClose} />
        <div style={{ padding: '4px 20px 16px' }}>
          {loading ? <div className="muted">Calculating commission…</div> : (
            <>
              <p className="hint" style={{ marginBottom: 10 }}>
                System-suggested commission: <strong>₹{fmtAmt(suggested)}</strong> (based on sent quantities × the agreed per-kit cut).
                Adjust below if needed before raising.
              </p>
              <label style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>
                Amount
                <input type="number" min={0} value={amount} onChange={function (e) { setAmount(e.target.value) }}
                  style={{ marginTop: 6, fontSize: 14, width: '100%', fontWeight: 700 }} />
              </label>
              <label style={{ font: '600 12px var(--font)', color: 'var(--text2)', display: 'block', marginTop: 12 }}>
                Reason / note
                <textarea rows={2} value={reason} onChange={function (e) { setReason(e.target.value) }}
                  style={{ marginTop: 6, fontSize: 12, width: '100%', resize: 'vertical' }} />
              </label>
              <p className="hint" style={{ marginTop: 10 }}>
                This still needs a separate approval before it shows up in {order.placer?.business_name || 'the CF'}'s ledger.
              </p>
            </>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving || loading}>{saving ? 'Raising…' : 'Raise Credit Note'}</button>
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

// UF can only order SKUs for admin-enabled levels. Mirrors the filter used on
// CoursesPage and the student enrollment form: registered_skus (specific
// levels) takes priority; registered_courses is only a fallback when no
// levels have been individually enabled. SMF/CF/NLH are unrestricted.
function filterSkusForFranchisee(pool, fr) {
  const tier = fr?.tier || 'UF'
  if (tier !== 'UF') return pool
  const regSkus = fr?.registered_skus || []
  if (regSkus.length > 0) return pool.filter(function (s) { return regSkus.includes(s.id) })
  const regCourses = fr?.registered_courses || []
  if (regCourses.length > 0) return pool.filter(function (s) { return regCourses.includes(s.course_id) })
  return pool
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
  // This order bills a school (a real franchisee, tier SCHOOL) — new/edited
  // lines must price from the negotiated school_sku_rates, not the flat
  // uf_rate/cf_rate/smf_rate columns, same as NewOrderModal already does.
  const isSchoolOrder = order.bill_to_fr?.tier === 'SCHOOL'
  const [schoolRates, setSchoolRates] = useState({})   // { [sku_id]: { rate, cf_cut } }

  useEffect(function () {
    if (!isSchoolOrder) return
    sb.from('school_sku_rates').select('sku_id, rate, cf_cut').eq('franchisee_id', order.bill_to_franchisee_id)
      .then(function (res) {
        const m = {}
        ;(res.data || []).forEach(function (r) { m[r.sku_id] = { rate: r.rate, cf_cut: r.cf_cut } })
        setSchoolRates(m)
      })
  }, [isSchoolOrder, order.bill_to_franchisee_id])

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
        const schoolRate = isSchoolOrder ? schoolRates[id] : null
        return {
          ...it, sku_id: id, item_id: null, skus: sku || null, inventory_items: null,
          rate: schoolRate ? schoolRate.rate : (sku ? rateForSku(sku, tier) : 0),
          cf_commission_rate: schoolRate ? schoolRate.cf_cut : null,
          ordered_qty: it.ordered_qty || 1, excluded_kit_items: [],
        }
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
          cf_commission_rate: item.cf_commission_rate != null ? item.cf_commission_rate : null,
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

    showToast(order.invoice_no ? 'Invoice updated.' : order.proforma_no ? 'Proforma updated.' : 'Order updated.')
    onSaved()
    setSaving(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-lg" onClick={function (e) { e.stopPropagation() }}
        style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '92vh' }}>
        <ModalHeader
          title={(order.invoice_no ? 'Edit Invoice — ' : order.proforma_no ? 'Edit Proforma — ' : 'Edit Order — ') + order.order_ref}
          subtitle={'New Learning Horizons · ' + (order.invoice_no ? 'Invoice editor' : order.proforma_no ? 'Proforma editor' : 'Order editor')}
          onClose={onClose} />
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
                    const schoolRate = isSchoolOrder && item.sku_id ? schoolRates[item.sku_id] : null
                    const defaultRate = schoolRate ? schoolRate.rate : (item.skus ? rateForSku(item.skus, order.placer_tier) : 0)
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
                                // A school order can only order kits with an
                                // agreed rate for that school — same restriction
                                // as NewOrderModal's initial placement.
                                (isSchoolOrder ? allSkus.filter(function (s) { return schoolRates[s.id] }) : allSkus)
                                  .reduce(function (acc, s) {
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
                              {/* Raw inventory items aren't covered by school_sku_rates — a school
                                  order can only carry priced kits, not individually-billed items. */}
                              {!isSchoolOrder && allItems.length > 0 && (
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
  // Each line: { sku_id, qty, rate, excluded, cf_commission_rate }  — excluded = kit item_ids not being sent
  const [lines, setLines] = useState([{ sku_id: '', qty: 1, rate: 0, excluded: [], cf_commission_rate: null }])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [coupon, setCoupon] = useState(null)   // { coupon_id, code, discount, _base }

  // A CF can place an order billed to one of their schools instead of their
  // own centre. A school is a real franchisee row (tier SCHOOL, parented
  // under the CF) — HO bills it directly, the CF earns a per-kit commission
  // (school_sku_rates), and the order lines re-price accordingly.
  const [cfSchools, setCfSchools] = useState([])
  const [schoolId, setSchoolId] = useState('')
  const [schoolRates, setSchoolRates] = useState({})   // { [sku_id]: { rate, cf_cut } }

  useEffect(function () {
    if (placerTier !== 'CF' || !placerId) { setCfSchools([]); setSchoolId(''); return }
    let cancelled = false
    sb.from('franchisees').select('id, business_name').eq('parent_id', placerId).eq('tier', 'SCHOOL').eq('status', 'active').order('business_name')
      .then(function (res) { if (!cancelled) setCfSchools(res.data || []) })
    return function () { cancelled = true }
  }, [placerId, placerTier])

  useEffect(function () {
    if (!schoolId) { setSchoolRates({}); return }
    let cancelled = false
    sb.from('school_sku_rates').select('sku_id, rate, cf_cut').eq('franchisee_id', schoolId)
      .then(function (res) {
        if (cancelled) return
        const m = {}
        ;(res.data || []).forEach(function (r) { m[r.sku_id] = { rate: r.rate, cf_cut: r.cf_cut } })
        setSchoolRates(m)
      })
    return function () { cancelled = true }
  }, [schoolId])

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
        // Admin: see all franchisees. NLH Head Office itself is excluded —
        // orders always bill a franchisee (SMF/CF/UF); HO taking stock for
        // samples/internal use is tracked as a stock issue, not an order.
        // SCHOOL-tier rows are excluded too — a school is never a normal
        // order placer/payer, it's only ever reached via a CF's "Bill to
        // school" sub-selector below, which correctly prices from the
        // negotiated school_sku_rates instead of the flat tier rate.
        const fRes = await sb.from('franchisees')
          .select('id, business_name, tier, registered_courses, registered_skus, address, city, state')
          .not('tier', 'in', '(NLH,SCHOOL)')
          .order('business_name')
        setFranchisees(fRes.data || [])
        setVisibleSkus(allS)
      } else if (isMasterFr) {
        // SMF / CF: see self + all descendants, default selection = self
        const [selfRes, descendantIds] = await Promise.all([
          sb.from('franchisees')
            .select('id, business_name, tier, registered_courses, registered_skus, address, city, state')
            .eq('id', currentFranchiseeId)
            .single(),
          getDescendantIds(currentFranchiseeId),
        ])
        let allFrs = selfRes.data ? [selfRes.data] : []
        if (descendantIds.length > 0) {
          // Same SCHOOL exclusion as the admin branch above.
          const descRes = await sb.from('franchisees')
            .select('id, business_name, tier, registered_courses, registered_skus, address, city, state')
            .in('id', descendantIds)
            .neq('tier', 'SCHOOL')
            .order('tier').order('business_name')
          allFrs = [...allFrs, ...(descRes.data || [])]
        }
        setFranchisees(allFrs)
        // Default = self
        if (selfRes.data) {
          const fr = selfRes.data
          setPlacerTier(fr.tier || 'UF')
          setDeliverTo(buildAddress(fr))
          setVisibleSkus(filterSkusForFranchisee(ordPool, fr))
        }
      } else {
        // UF: own data only, SKUs filtered to registered levels/courses
        const frRes = await sb.from('franchisees')
          .select('id, tier, registered_courses, registered_skus, address, city, state')
          .eq('id', currentFranchiseeId)
          .single()
        if (frRes.data) {
          const fr = frRes.data
          setPlacerTier(fr.tier || 'UF')
          setDeliverTo(buildAddress(fr))
          setVisibleSkus(filterSkusForFranchisee(ordPool, fr))
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
            if (schoolId && schoolRates[id]) {
              updated.rate = schoolRates[id].rate
              updated.cf_commission_rate = schoolRates[id].cf_cut
            } else {
              updated.rate = rateForSku(sku, placerTier)
              updated.cf_commission_rate = null
            }
          }
        }
        return updated
      })
    })
  }

  // When franchisee selection changes: auto-fill address + tier + refresh line rates + filter SKUs
  function handleFranchiseeChange(fid) {
    setPlacerId(fid)
    setSchoolId('')   // switching franchisee resets any school selection — schools belong to one CF
    const fr = franchisees.find(function (f) { return f.id === fid })
    if (!fr) return
    const tier = fr.tier || 'UF'
    setPlacerTier(tier)
    setDeliverTo(buildAddress(fr))
    // Filter SKUs by registered levels/courses for UF; supply SKUs stay HO-only.
    // HO admin is unrestricted — they can order anything for any franchisee.
    const pool = isAdmin ? allSkus : allSkus.filter(function (s) { return (s.sku_type || 'course_kit') !== 'supply' })
    setVisibleSkus(isAdmin ? pool : filterSkusForFranchisee(pool, fr))
    // Refresh rates on existing lines for the new tier
    setLines(function (prev) {
      return prev.map(function (line) {
        if (!line.sku_id) return line
        const sku = allSkus.find(function (s) { return s.id === line.sku_id })
        return { ...line, rate: rateForSku(sku, tier) }
      })
    })
  }

  // Switching the school (or clearing it, back to "own centre") re-prices
  // every already-picked line — same rationale as handleFranchiseeChange.
  function handleSchoolChange(sid) {
    setSchoolId(sid)
    setLines(function (prev) {
      return prev.map(function (line) {
        if (!line.sku_id) return line
        if (sid) {
          const r = schoolRates[line.sku_id]
          // Rate map for the newly-picked school isn't loaded yet on this same
          // tick (it's fetched by the schoolId effect) — the effect's rerender
          // will settle it; here just clear commission if this SKU has no
          // agreed school rate at all.
          return r ? { ...line, rate: r.rate, cf_commission_rate: r.cf_cut } : line
        }
        const sku = allSkus.find(function (s) { return s.id === line.sku_id })
        return { ...line, rate: rateForSku(sku, placerTier), cf_commission_rate: null }
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
    const total = calcTotal()
    const discount = coupon ? Math.min(coupon.discount, total) : 0

    // Derive tier from loaded franchisees if not already set (e.g. admin didn't change selection)
    const resolvedTier = placerTier || (franchisees.find(function (f) { return f.id === fid })?.tier) || 'UF'

    // order_ref is intentionally left unset here — trg_order_ref generates it
    // atomically from order_seq on insert. This used to precompute it via the
    // next_order_ref() RPC (a plain MAX(existing)+1 scan, not sequence-backed)
    // and send it explicitly, which raced under concurrent submits: two
    // inserts landing close together could both compute the same "next"
    // number and the second would fail with a duplicate key error on
    // orders_order_ref_key — reported live for Nexa Minds.
    const { data: orderData, error: orderErr } = await sb
      .from('orders')
      .insert({
        placer_id: fid,
        placer_tier: resolvedTier,
        deliver_to: deliverTo.trim(),
        subtotal: total,
        grand_total: Math.max(0, total - discount),
        discount_amount: discount,
        coupon_id: coupon?.coupon_id || null,
        coupon_code: coupon?.code || null,
        status: 'pending',
        bill_to_franchisee_id: schoolId || null,
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
        cf_commission_rate: line.cf_commission_rate != null ? parseInt(line.cf_commission_rate, 10) : null,
      }
    })

    const { error: itemsErr } = await sb.from('order_items').insert(itemRows)
    if (itemsErr) {
      showToast('Order created but items failed: ' + itemsErr.message)
    } else {
      showToast('Order placed: ' + orderData.order_ref)
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

              {/* This order can bill a school this CF services instead of the CF's
                  own centre — HO bills the school directly, the CF earns the
                  per-kit commission negotiated for that school (school_sku_rates). */}
              {placerTier === 'CF' && cfSchools.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={lblCap}>Bill to{schoolId && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--text3)' }}> · HO invoices the school; you earn a per-kit commission</span>}</div>
                  <select value={schoolId} onChange={function (e) { handleSchoolChange(e.target.value) }} style={fld}>
                    <option value="">Own centre (regular CF order)</option>
                    {cfSchools.map(function (s) {
                      return <option key={s.id} value={s.id}>🏫 {s.business_name}</option>
                    })}
                  </select>
                </div>
              )}

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
                  const defaultRate = schoolId ? (schoolRates[line.sku_id]?.rate || 0) : rateForSku(sku, placerTier)
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
                          // A school order can only order kits that have an agreed
                          // rate for that school — ordering something with no
                          // negotiated price makes no sense here.
                          (schoolId ? visibleSkus.filter(function (s) { return schoolRates[s.id] }) : visibleSkus)
                            .reduce(function (acc, s) { const c = s.courses?.group_name || 'Other'; if (!acc[c]) acc[c] = []; acc[c].push(s); return acc }, {})
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
// OrdersPage — main component
// ---------------------------------------------------------------------------
const ORDER_FILTERS = ['all', 'pending', 'proforma', 'invoiced', 'payment_submitted', 'closed']

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
  const [viewPayOrder,   setViewPayOrder]   = useState(null)
  const [dispatchOrder, setDispatchOrder] = useState(null)
  const [editInvoiceOrder, setEditInvoiceOrder] = useState(null)
  const [showNewOrder, setShowNewOrder] = useState(false)
  const [invoiceViewOrder, setInvoiceViewOrder] = useState(null)
  const [invoiceConfirm, setInvoiceConfirm] = useState(null)
  const [proformaConfirm, setProformaConfirm] = useState(null)
  const [convertConfirm, setConvertConfirm] = useState(null)   // proforma order being converted straight to invoice, no payment required
  const [raiseCnOrder, setRaiseCnOrder] = useState(null)
  const [pendingCns, setPendingCns] = useState([])
  const [cancelOrder, setCancelOrder] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [deleteProformaOrder, setDeleteProformaOrder] = useState(null)
  const [deletingProforma, setDeletingProforma] = useState(false)

  const canCancel = ['owner', 'super_admin', 'admin'].includes(currentRole)

  useEffect(function () {
    if (currentRole === null) return   // wait for auth to resolve
    loadOrders()
    if (isAdminRole(currentRole)) loadPendingCns()
  }, [currentRole, currentFranchiseeId])

  async function loadPendingCns() {
    const { data } = await sb.from('franchisee_credit_notes')
      .select('*, franchisees(business_name, tier), orders(order_ref, invoice_no)')
      .eq('status', 'pending')
      .order('requested_at', { ascending: false })
    setPendingCns(data || [])
  }

  async function approveCreditNote(cn) {
    setActionLoading('cn_' + cn.id)
    const { error } = await sb.from('franchisee_credit_notes')
      .update({ status: 'approved', approved_by: currentUser?.email || null })
      .eq('id', cn.id)
    if (error) { showToast('Failed to approve: ' + error.message, 'err') }
    else { showToast('Credit note approved ✓'); await loadPendingCns() }
    setActionLoading(null)
  }

  async function rejectCreditNote(cn) {
    setActionLoading('cn_' + cn.id)
    const { error } = await sb.from('franchisee_credit_notes')
      .update({ status: 'rejected', approved_by: currentUser?.email || null, approved_at: new Date().toISOString() })
      .eq('id', cn.id)
    if (error) { showToast('Failed to reject: ' + error.message, 'err') }
    else { showToast('Credit note rejected'); await loadPendingCns() }
    setActionLoading(null)
  }

  async function loadOrders() {
    setLoading(true)
    let data, error

    const PLACER_FIELDS = 'business_name, tier, email, city, state, phone, address'
    const SELECT = '*, placer:franchisees!orders_placer_id_fkey(' + PLACER_FIELDS + '), bill_to_fr:franchisees!orders_bill_to_franchisee_id_fkey(' + PLACER_FIELDS + ', gstin)'
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
      const billFrPhone = order.bill_to_fr?.phone || order.placer?.phone
      const wantWA = waOpts ? waOpts.sendWA : !!billFrPhone
      const waPhone = waOpts ? waOpts.waPhone : (billFrPhone || '')
      await loadOrders()
      if (wantWA && waPhone) {
        setInvoiceViewOrder({ ...order, invoice_no: invoiceNo, grand_total: grandTotal, status: 'invoiced' })
        showToast('Invoiced ' + invoiceNo + ' · tap 💬 WhatsApp to send it to the franchisee')
      }
    }
    setActionLoading(null)
  }

  // Proforma is a preliminary, non-tax document — no invoice number consumed,
  // no dispatch allowed yet. It reuses the same total/kit-capacity checks as
  // a direct invoice, just targets 'proforma' instead of 'invoiced' so
  // trg_proforma_no (not trg_invoice_no) fires.
  async function handleMarkProforma(order, waOpts) {
    setActionLoading(order.id + '_proforma')

    const { data: itemRows } = await sb
      .from('order_items').select('sku_id, ordered_qty, rate').eq('order_id', order.id)

    const kmap = await loadKitMap((itemRows || []).map(function (r) { return r.sku_id }))
    const fit = invoiceFit((itemRows || []).map(function (r) {
      return { kitCount: (kmap[r.sku_id] || []).length }
    }))
    if (fit.overflow > 0) {
      showToast('Document is full — please create another order for the remaining items.', 'warn')
      setActionLoading(null)
      return
    }

    const itemsTotal = (itemRows || []).reduce(function (sum, it) {
      return sum + (it.ordered_qty || 0) * (it.rate || 0)
    }, 0)
    const discount = Math.min(order.discount_amount || 0, itemsTotal)
    const grandTotal = Math.max(0, itemsTotal + (order.courier_charges || 0) - discount)

    const { error } = await sb
      .from('orders')
      .update({ status: 'proforma', grand_total: grandTotal, subtotal: itemsTotal })
      .eq('id', order.id)
      .eq('status', 'pending')

    if (error) {
      showToast('Failed to generate proforma: ' + error.message)
    } else {
      const { data: refreshed } = await sb
        .from('orders').select('proforma_no').eq('id', order.id).single()
      showToast('Proforma generated: ' + (refreshed?.proforma_no || ''))
      await loadOrders()
      // Deliberately no auto-email/WA-send of the proforma itself yet (unlike
      // the real invoice) — admin shares it manually via the PDF/print view
      // for now; wanted the payment-status branch settled before wiring that up.
    }
    setActionLoading(null)
  }

  async function handleVerifyPayment(order) {
    setActionLoading(order.id + '_verify')
    // A proforma order has no invoice_no yet — verifying its payment is what
    // converts it to a real tax invoice (fires trg_invoice_no on the
    // proforma -> invoiced transition) before closing it. A direct-invoiced
    // order already has its invoice_no, so it just closes as before.
    if (order.proforma_no && !order.invoice_no) {
      const { error: invErr } = await sb.from('orders').update({ status: 'invoiced' }).eq('id', order.id)
      if (invErr) {
        showToast('Failed to convert proforma to invoice: ' + invErr.message)
        setActionLoading(null)
        return
      }
    }
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

  // Admin decides to issue the real invoice on their own say-so, without
  // waiting for a payment to land — reuses the same proforma -> invoiced
  // transition trg_invoice_no fires on, just triggered directly instead of
  // via the payment-sync path. Mirrors handleMarkInvoiced's capacity check
  // and WhatsApp-notice flow.
  async function handleConvertProforma(order, waOpts) {
    setActionLoading(order.id + '_convert')

    const { data: itemRows } = await sb
      .from('order_items').select('sku_id, ordered_qty, rate').eq('order_id', order.id)

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
    const discount = Math.min(order.discount_amount || 0, itemsTotal)
    const grandTotal = Math.max(0, itemsTotal + (order.courier_charges || 0) - discount)

    const { error } = await sb
      .from('orders')
      .update({ status: 'invoiced', grand_total: grandTotal, subtotal: itemsTotal })
      .eq('id', order.id)
      .eq('status', 'proforma')

    if (error) {
      showToast('Failed to convert to invoice: ' + error.message)
    } else {
      const { data: refreshed } = await sb.from('orders').select('invoice_no').eq('id', order.id).single()
      const invoiceNo = refreshed?.invoice_no || ''
      showToast('Converted to Invoice ' + invoiceNo)
      try {
        await sendInvoiceEmail({ ...order, invoice_no: invoiceNo })
      } catch (emailErr) {
        console.warn('Invoice email failed:', emailErr.message)
      }
      const billFrPhone = order.bill_to_fr?.phone || order.placer?.phone
      const wantWA = waOpts ? waOpts.sendWA : !!billFrPhone
      const waPhone = waOpts ? waOpts.waPhone : (billFrPhone || '')
      await loadOrders()
      if (wantWA && waPhone) {
        setInvoiceViewOrder({ ...order, invoice_no: invoiceNo, grand_total: grandTotal, status: 'invoiced' })
        showToast('Invoiced ' + invoiceNo + ' · tap 💬 WhatsApp to send it')
      }
    }
    setActionLoading(null)
  }

  // Deleting a proforma (not a real invoice — no invoice_no was ever
  // consumed, no numbering/audit-trail obligation) is preferable to
  // "cancelling" it: Cancel Invoice only clears invoice_no, and running it
  // on a proforma would leave a stale proforma_no behind that'd silently
  // block ever generating a fresh proforma for this order again (see
  // generate_proforma_no — it only fires when proforma_no is null).
  // Blocked if a payment has already been recorded, as a safety check.
  async function handleDeleteProforma() {
    if (!deleteProformaOrder) return
    if ((deleteProformaOrder.amount_paid || 0) > 0) {
      showToast('This order has a payment recorded — cannot delete it.', 'err')
      return
    }
    setDeletingProforma(true)
    const { error: itemsErr } = await sb.from('order_items').delete().eq('order_id', deleteProformaOrder.id)
    if (itemsErr) {
      showToast('Failed to delete order items: ' + itemsErr.message, 'err')
      setDeletingProforma(false)
      return
    }
    const { error } = await sb.from('orders').delete().eq('id', deleteProformaOrder.id)
    setDeletingProforma(false)
    if (error) { showToast('Failed to delete proforma: ' + error.message, 'err'); return }
    showToast('Proforma ' + (deleteProformaOrder.proforma_no || deleteProformaOrder.order_ref) + ' deleted')
    setDeleteProformaOrder(null)
    await loadOrders()
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
          name:  order.bill_to_fr?.business_name || order.placer?.business_name || '',
          email: order.bill_to_fr?.email || order.placer?.email || '',
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
            <>
              <button className="row-action primary" disabled={busy} onClick={function () { setInvoiceConfirm(order) }}>
                {isActing(order.id, 'invoice') ? '…' : 'Invoice'}
              </button>
              <button className="row-action" disabled={busy} onClick={function () { setProformaConfirm(order) }}
                title="Preliminary, non-tax document — no dispatch until payment is verified">
                {isActing(order.id, 'proforma') ? '…' : 'Proforma'}
              </button>
            </>
          )}
          {['invoiced', 'part_paid', 'proforma'].includes(order.status) && !isAdmin && (
            <button className="row-action green" onClick={function () { setPaySubmitOrder(order) }}>Submit Pmt</button>
          )}
          {/* part_paid and proforma get the same actions as invoiced — Edit
              included: InvoiceEditModal only touches order_items/subtotal/
              grand_total/courier/coupon, never invoice_no or proforma_no, so
              re-pricing a proforma before it's converted is exactly as safe
              as editing a pending order. */}
          {['invoiced', 'part_paid', 'proforma'].includes(order.status) && isAdmin && (
            <>
              <button className="row-action green" onClick={function () { setRecordPayOrder(order) }}>Record Pmt</button>
              <button className="row-action" disabled={busy} onClick={function () { handleSendReminder(order) }}>
                {isActing(order.id, 'reminder') ? '…' : 'Remind'}
              </button>
              <button className="row-action" onClick={function () { setEditInvoiceOrder(order) }}>Edit</button>
            </>
          )}
          {/* Proforma-only: issue the real invoice on admin's own say-so
              without waiting for a payment, or delete it outright if the
              deal isn't going ahead (no invoice_no was ever consumed, so
              there's nothing to preserve — unlike Cancel, which is for a
              real invoice's audit trail). */}
          {order.status === 'proforma' && isAdmin && (
            <>
              <button className="row-action primary" disabled={busy} onClick={function () { setConvertConfirm(order) }}
                title="Issue the real invoice now, without waiting for payment">
                {isActing(order.id, 'convert') ? '…' : 'Convert to Invoice'}
              </button>
              <button className="row-action danger" onClick={function () { setDeleteProformaOrder(order) }}>Delete</button>
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
          {/* Receipts live in the payment history, which used to be reachable
              only through Record Pmt — so a closed order had no way in. */}
          {order.amount_paid > 0 && (
            <button className="row-action" title="View payments and print receipts"
              onClick={function () { setViewPayOrder(order) }}>Receipts</button>
          )}
          {['invoiced', 'part_paid', 'payment_submitted', 'closed', 'proforma'].includes(order.status) && (
            <button className="row-action" onClick={function () { setInvoiceViewOrder(order) }}>PDF</button>
          )}
          {/* A proforma order with no real invoice yet can't dispatch — payment
              has to be verified first (which converts it to a real invoice). */}
          {order.proforma_no && !order.invoice_no ? (
            <button className="row-action" disabled title="Verify payment first — this order is still on a proforma, not a real invoice">
              🔒 Dispatch
            </button>
          ) : (
            <button className="row-action" onClick={function () { setDispatchOrder(order) }}>
              {order.dispatched_at ? 'Dispatch ✎' : 'Dispatch'}
            </button>
          )}
          {canCancel && ['invoiced', 'payment_submitted'].includes(order.status) && (
            <button className="row-action danger" onClick={function () { setCancelOrder(order) }}>Cancel</button>
          )}
          {/* CF commission payout — admin-only, never available to the CF
              themselves. Only makes sense once the school order is actually
              settled (closed) so the commission is on real, paid business. */}
          {isAdmin && order.bill_to_fr?.tier === 'SCHOOL' && order.status === 'closed' && (
            <button className="row-action" style={{ color: 'var(--purple)', borderColor: 'var(--purple)' }}
              onClick={function () { setRaiseCnOrder(order) }}>
              🧾 Raise Credit Note
            </button>
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
    { id: 'proforma',          l: 'Proforma',       cls: 'pending' },
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

        {/* CF commission credit notes awaiting approval — admin-only, raised
            only by admin, so this is purely a review/approve queue. Approving
            is what makes it show up in the CF's ledger (loadFranchiseeLedger). */}
        {isAdmin && pendingCns.length > 0 && (
          <div style={{ background: '#FFF7DA', border: '1px solid #D97706', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
            <div style={{ font: '700 11px var(--mono)', color: '#92400E', textTransform: 'uppercase', marginBottom: 8 }}>
              🧾 {pendingCns.length} credit note{pendingCns.length !== 1 ? 's' : ''} awaiting approval
            </div>
            {pendingCns.map(function (cn) {
              const busy = actionLoading === 'cn_' + cn.id
              return (
                <div key={cn.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid #F3E4B8', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, flex: 1, minWidth: 200 }}>
                    <b>{cn.franchisees?.business_name || '—'}</b> ({cn.franchisees?.tier}) · ₹{fmtAmt(cn.amount)}
                    {cn.orders?.order_ref ? ' · order ' + cn.orders.order_ref : ''}
                    {cn.reason ? <span style={{ color: 'var(--text3)' }}> — {cn.reason}</span> : ''}
                  </span>
                  <button className="row-action green" disabled={busy} onClick={function () { approveCreditNote(cn) }}>
                    {busy ? '…' : 'Approve'}
                  </button>
                  <button className="row-action danger" disabled={busy} onClick={function () { rejectCreditNote(cn) }}>Reject</button>
                </div>
              )
            })}
          </div>
        )}

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
                  <th className="hide-mobile">Invoice / Proforma No</th>
                  {(isAdmin || currentRole === 'smf' || currentRole === 'cf') && <th>Franchisee</th>}
                  <th className="hide-mobile">Date</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Balance</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(function (order) {
                  return (
                    <tr key={order.id}>
                      <td className="mono" style={{ color: 'var(--purple)', fontWeight: 600 }}>{order.order_ref}</td>
                      <td className="mono hide-mobile">
                        {order.invoice_no || (order.proforma_no
                          ? <span style={{ color: 'var(--amber, #B45309)' }}>{order.proforma_no}</span>
                          : '—')}
                      </td>
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
                      {/* What's still owed — the figure that actually needs chasing.
                          The amount received shows on the 💰 line under the actions. */}
                      <td className="hide-mobile" style={{ textAlign: 'right' }}>
                        {(function () {
                          const bal = Math.max(0, (order.grand_total || 0) - (order.amount_paid || 0))
                          return (
                            <div className="amt" style={{
                              color: bal > 0 ? '#92400e' : 'var(--green)',
                              fontWeight: bal > 0 ? 700 : 500,
                            }}>
                              {bal > 0 ? '₹' + fmtAmt(bal) : '₹0'}
                            </div>
                          )
                        })()}
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

      {viewPayOrder && (
        <RecordPaymentModal
          viewOnly
          order={viewPayOrder}
          onClose={function () { setViewPayOrder(null) }}
          onSaved={async function () { await loadOrders() }}
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
          mode="invoice"
          onClose={function () { setInvoiceConfirm(null) }}
          onConfirm={function (waOpts) {
            const ord = invoiceConfirm
            setInvoiceConfirm(null)
            handleMarkInvoiced(ord, waOpts)
          }}
        />
      )}

      {proformaConfirm && (
        <InvoiceConfirmModal
          order={proformaConfirm}
          mode="proforma"
          onClose={function () { setProformaConfirm(null) }}
          onConfirm={function (waOpts) {
            const ord = proformaConfirm
            setProformaConfirm(null)
            handleMarkProforma(ord, waOpts)
          }}
        />
      )}

      {convertConfirm && (
        <InvoiceConfirmModal
          order={convertConfirm}
          mode="convert"
          onClose={function () { setConvertConfirm(null) }}
          onConfirm={function (waOpts) {
            const ord = convertConfirm
            setConvertConfirm(null)
            handleConvertProforma(ord, waOpts)
          }}
        />
      )}

      {deleteProformaOrder && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={function () { if (!deletingProforma) setDeleteProformaOrder(null) }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, maxWidth: 440, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}
            onClick={function (e) { e.stopPropagation() }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>🗑</span>
              <div style={{ font: '700 16px "DM Sans",sans-serif', color: '#A32D2D' }}>Delete Proforma {deleteProformaOrder.proforma_no}?</div>
            </div>
            <p style={{ font: '400 13px "DM Sans",sans-serif', color: '#5C5A54', lineHeight: 1.6, marginBottom: 16 }}>
              This <strong>permanently deletes</strong> order {deleteProformaOrder.order_ref} and its line items — no real invoice
              number was ever consumed, so unlike Cancel there's nothing to preserve. This can't be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={function () { setDeleteProformaOrder(null) }} disabled={deletingProforma}
                style={{ padding: '9px 20px', border: '1px solid #D0CEC6', borderRadius: 8, background: '#fff', font: '600 13px "DM Sans",sans-serif', cursor: 'pointer', color: '#5C5A54' }}>Keep It</button>
              <button onClick={handleDeleteProforma} disabled={deletingProforma}
                style={{ padding: '9px 20px', border: 'none', borderRadius: 8, background: '#DC2626', color: '#fff', font: '600 13px "DM Sans",sans-serif', cursor: 'pointer', opacity: deletingProforma ? .7 : 1 }}>
                {deletingProforma ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {raiseCnOrder && (
        <RaiseCreditNoteModal
          order={raiseCnOrder}
          currentUser={currentUser}
          onClose={function () { setRaiseCnOrder(null) }}
          onSaved={async function () { setRaiseCnOrder(null); await loadPendingCns() }}
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

