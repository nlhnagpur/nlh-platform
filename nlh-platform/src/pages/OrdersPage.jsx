import React, { useState, useEffect } from 'react'
import { jsPDF } from 'jspdf'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast, orderStatusLabel, orderPaymentBadge } from '../utils'
import { isAdminRole } from '../constants/roles'
import { sendInvoiceEmail, sendPaymentReminder, sendPaymentVerified } from '../services/email'

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
          <p className="text-muted">Order total: {fmtAmt(order.total_amount || 0)}</p>
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
  const [courier, setCourier] = useState(order.courier_name || '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const { error } = await sb
      .from('orders')
      .update({
        awb_number: awb.trim(),
        courier_name: courier.trim(),
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

  useEffect(function () {
    loadItems()
  }, [])

  async function loadItems() {
    const { data, error } = await sb
      .from('order_items')
      .select('*, skus(name)')
      .eq('order_id', order.id)
    if (error) {
      showToast('Failed to load items: ' + error.message)
    } else {
      setItems(data || [])
    }
    setLoading(false)
  }

  function updateSentQty(itemId, val) {
    setItems(function (prev) {
      return prev.map(function (it) {
        if (it.id === itemId) return { ...it, sent_qty: parseInt(val, 10) || 0 }
        return it
      })
    })
  }

  async function handleSave() {
    setSaving(true)
    for (const item of items) {
      await sb
        .from('order_items')
        .update({ sent_qty: item.sent_qty })
        .eq('id', item.id)
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
          <button style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}} onClick={onClose}>×</button>
        </div>
        <div >
          {loading ? (
            <div className="text-muted">Loading items…</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Ordered Qty</th>
                  <th>Sent Qty</th>
                  <th>Rate</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map(function (item) {
                  return (
                    <tr key={item.id}>
                      <td>{item.skus?.name || item.sku_id}</td>
                      <td>{item.ordered_qty}</td>
                      <td>
                        <input
                          type="number"
                          className="price-inp"
                          value={item.sent_qty}
                          min={0}
                          max={item.ordered_qty}
                          onChange={function (e) { updateSentQty(item.id, e.target.value) }}
                        />
                      </td>
                      <td>{fmtAmt(item.rate)}</td>
                      <td>{fmtAmt(item.sent_qty * item.rate)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div className="fr" style={{ marginTop: 16 }}>
            <label>Courier Charges (₹)</label>
            <input
              type="number"
              value={courierCharges}
              onChange={function (e) { setCourierCharges(e.target.value) }}
              style={{ width: 140 }}
            />
          </div>
        </div>
        <div className="modal-actions">
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
function NewOrderModal({ currentFranchiseeId, isAdmin, onClose, onSaved }) {
  const [franchisees, setFranchisees] = useState([])
  const [skus, setSkus] = useState([])
  const [placerId, setPlacerId] = useState(isAdmin ? '' : currentFranchiseeId)
  const [deliverTo, setDeliverTo] = useState('')
  const [lines, setLines] = useState([{ sku_id: '', qty: 1 }])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(function () {
    async function loadData() {
      const [fRes, sRes] = await Promise.all([
        sb.from('franchisees').select('id, name, tier').order('name'),
        sb.from('skus').select('id, name, uf_rate').order('name'),
      ])
      setFranchisees(fRes.data || [])
      setSkus(sRes.data || [])
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

  function calcTotal() {
    return lines.reduce(function (sum, line) {
      const sku = skus.find(function (s) { return s.id === line.sku_id })
      if (!sku) return sum
      return sum + (sku.uf_rate * (parseInt(line.qty, 10) || 0))
    }, 0)
  }

  async function handleSubmit() {
    const fid = placerId || currentFranchiseeId
    if (!fid) { showToast('Select a franchisee.'); return }
    const validLines = lines.filter(function (l) { return l.sku_id && parseInt(l.qty, 10) > 0 })
    if (validLines.length === 0) { showToast('Add at least one SKU.'); return }

    setSaving(true)
    const orderRef = 'ORD-' + Date.now()
    const total = calcTotal()

    const { data: orderData, error: orderErr } = await sb
      .from('orders')
      .insert({
        order_ref: orderRef,
        placer_id: fid,
        deliver_to: deliverTo.trim(),
        total_amount: total,
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
      const sku = skus.find(function (s) { return s.id === line.sku_id })
      return {
        order_id: orderData.id,
        sku_id: line.sku_id,
        ordered_qty: parseInt(line.qty, 10),
        sent_qty: 0,
        rate: sku ? sku.uf_rate : 0,
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
                  <select value={placerId} onChange={function (e) { setPlacerId(e.target.value) }}>
                    <option value="">— Select franchisee —</option>
                    {franchisees.map(function (f) {
                      return (
                        <option key={f.id} value={f.id}>
                          [{f.tier}] {f.name}
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
                  const sku = skus.find(function (s) { return s.id === line.sku_id })
                  const lineAmt = sku ? sku.uf_rate * (parseInt(line.qty, 10) || 0) : 0
                  return (
                    <div key={idx} className="order-line">
                      <select
                        value={line.sku_id}
                        onChange={function (e) { updateLine(idx, 'sku_id', e.target.value) }}
                      >
                        <option value="">— Select SKU —</option>
                        {skus.map(function (s) {
                          return (
                            <option key={s.id} value={s.id}>
                              {s.name}
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
                      <span>{sku ? fmtAmt(sku.uf_rate) : '—'}</span>
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
// PDF invoice generation
// ---------------------------------------------------------------------------
function generateInvoicePDF(order, items) {
  const doc = new jsPDF()
  const pageW = doc.internal.pageSize.getWidth()

  // Header
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('NEW LEARNING HORIZONS', pageW / 2, 20, { align: 'center' })
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('admin@nlhnagpur.info | nlhnagpur.info', pageW / 2, 27, { align: 'center' })

  doc.setLineWidth(0.5)
  doc.line(14, 32, pageW - 14, 32)

  // Invoice details
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('INVOICE', 14, 42)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Invoice No: ' + (order.invoice_no || 'N/A'), 14, 50)
  doc.text('Order Ref: ' + (order.order_ref || ''), 14, 57)
  doc.text('Date: ' + fmtDate(order.created_at), 14, 64)
  doc.text('Franchisee: ' + (order.placer?.name || order.placer_id || ''), 14, 71)
  if (order.deliver_to) {
    doc.text('Deliver To: ' + order.deliver_to, 14, 78)
  }

  // Items table header
  let y = 90
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('SKU', 14, y)
  doc.text('Ordered', 90, y)
  doc.text('Sent', 120, y)
  doc.text('Rate', 145, y)
  doc.text('Amount', 170, y)
  doc.line(14, y + 2, pageW - 14, y + 2)

  doc.setFont('helvetica', 'normal')
  y += 8
  let subtotal = 0
  for (const item of items) {
    const amt = (item.sent_qty || 0) * (item.rate || 0)
    subtotal += amt
    doc.text(String(item.skus?.name || item.sku_id || ''), 14, y)
    doc.text(String(item.ordered_qty || 0), 90, y)
    doc.text(String(item.sent_qty || 0), 120, y)
    doc.text('₹' + fmtAmt(item.rate || 0), 145, y)
    doc.text('₹' + fmtAmt(amt), 170, y)
    y += 7
    if (y > 270) {
      doc.addPage()
      y = 20
    }
  }

  doc.line(14, y, pageW - 14, y)
  y += 7

  const courier = order.courier_charges || 0
  const total = subtotal + courier

  doc.text('Subtotal:', 145, y)
  doc.text('₹' + fmtAmt(subtotal), 170, y)
  y += 7
  if (courier > 0) {
    doc.text('Courier Charges:', 145, y)
    doc.text('₹' + fmtAmt(courier), 170, y)
    y += 7
  }
  doc.setFont('helvetica', 'bold')
  doc.text('TOTAL:', 145, y)
  doc.text('₹' + fmtAmt(total), 170, y)

  if (order.payment_mode) {
    y += 12
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text('Payment: ' + order.payment_mode + (order.payment_ref ? ' / ' + order.payment_ref : ''), 14, y)
  }

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
    loadOrders()
  }, [currentRole, currentFranchiseeId])

  async function loadOrders() {
    setLoading(true)
    let query
    if (isAdmin) {
      query = sb
        .from('orders')
        .select('*, placer:franchisees!orders_placer_id_fkey(name, tier, email)')
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
      .select('*, skus(name)')
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
      <div className="btn-group">
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
          <span className="text-muted" style={{ fontSize: 12 }}>
            Dispatched {fmtDate(order.dispatched_at)}
            {order.awb_number ? ' · ' + order.awb_number : ''}
          </span>
        )}
      </div>
    )
  }

  if (loading) return <div className="page-loading">Loading orders…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h2>Orders</h2>
        <button className="btn-p" onClick={function () { setShowNewOrder(true) }}>
          + New Order
        </button>
      </div>

      <div className="page-toolbar">
        <div className="filter-tabs">
          {ORDER_FILTERS.map(function (f) {
            const label = f === 'all' ? 'All' : orderStatusLabel(f)
            return (
              <button
                key={f}
                className={'filter-tab' + (orderFilter === f ? ' active' : '')}
                onClick={function () { setOrderFilter(f) }}
              >
                {label}
                {filterCounts[f] > 0 && (
                  <span className="tab-count">{filterCounts[f]}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">No orders found.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table orders-table">
            <thead>
              <tr>
                <th>Order Ref</th>
                <th>Invoice No</th>
                {isAdmin && <th>Franchisee</th>}
                <th>Amount</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Actions</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function (order) {
                return (
                  <tr key={order.id}>
                    <td className="mono">{order.order_ref}</td>
                    <td className="mono">{order.invoice_no || <span className="text-muted">—</span>}</td>
                    {isAdmin && (
                      <td>
                        {order.placer ? (
                          <span>
                            <span className="badge badge-sm">{order.placer.tier}</span>{' '}
                            {order.placer.name}
                          </span>
                        ) : (
                          <span className="text-muted">{order.placer_id}</span>
                        )}
                      </td>
                    )}
                    <td>{fmtAmt(order.total_amount || 0)}</td>
                    <td>
                      <span className={'badge status-' + order.status}>
                        {orderStatusLabel(order.status)}
                      </span>
                    </td>
                    <td>{orderPaymentBadge(order)}</td>
                    <td>{renderActions(order)}</td>
                    <td className="text-muted">{fmtDate(order.created_at)}</td>
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
          isAdmin={isAdmin}
          onClose={function () { setShowNewOrder(false) }}
          onSaved={async function () { setShowNewOrder(false); await loadOrders() }}
        />
      )}
    </div>
  )
}
