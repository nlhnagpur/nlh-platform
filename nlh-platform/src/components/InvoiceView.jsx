import React, { useState, useEffect, useRef } from 'react'
import { sb } from '../supabase'
import { fmtAmt } from '../utils'
import { sendInvoiceEmail } from '../services/email'

const CANCEL_ROLES = ['owner', 'super_admin', 'admin']

function fmtDateLong(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

function dueDateStr(createdAt) {
  if (!createdAt) return '—'
  const d = new Date(createdAt)
  d.setDate(d.getDate() + 14)
  return fmtDateLong(d.toISOString())
}

function numToWords(num) {
  if (!num || num === 0) return 'Zero Rupees Only'
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  function convert(n) {
    if (n < 20) return ones[n]
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '')
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '')
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '')
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '')
  }
  return convert(Math.round(num)) + ' Rupees Only'
}

export default function InvoiceView({ order, onClose, onCancelled, currentRole, currentUser }) {
  const [items,   setItems]   = useState([])
  const [placer,  setPlacer]  = useState(order.placer || order.franchisees || null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  // Editable fields
  const [billToName,     setBillToName]     = useState(order.bill_to_name || '')
  const [shipTo,         setShipTo]         = useState(order.ship_to || '')
  const [editingBillTo,  setEditingBillTo]  = useState(false)
  const [editingShipTo,  setEditingShipTo]  = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [cancelling,     setCancelling]     = useState(false)
  const [showCancelDlg,  setShowCancelDlg]  = useState(false)
  const [cancelReason,   setCancelReason]   = useState('')

  const canCancel = CANCEL_ROLES.includes(currentRole) &&
    ['invoiced', 'payment_submitted'].includes(order.status)

  const printRef = useRef(null)

  useEffect(function() {
    async function loadData() {
      const { data: itemData } = await sb.from('order_items')
        .select('*, skus(level_name, uf_rate, cf_rate, smf_rate, courses(group_name))')
        .eq('order_id', order.id)
      setItems(itemData || [])

      if (order.placer_id) {
        const { data: frData } = await sb.from('franchisees')
          .select('business_name, tier, email, city, state, area, country, phone, address')
          .eq('id', order.placer_id)
          .single()
        if (frData) {
          setPlacer(frData)
          // Default bill_to_name to franchisee name if not overridden
          if (!order.bill_to_name) setBillToName(frData.business_name || '')
        }
      }
      setLoading(false)
    }
    loadData()
  }, [order.id, order.placer_id, order.bill_to_name])

  async function saveBillTo() {
    setSaving(true)
    await sb.from('orders').update({ bill_to_name: billToName }).eq('id', order.id)
    setSaving(false)
    setEditingBillTo(false)
  }

  async function saveShipTo() {
    setSaving(true)
    await sb.from('orders').update({ ship_to: shipTo }).eq('id', order.id)
    setSaving(false)
    setEditingShipTo(false)
  }

  async function handleCancelInvoice() {
    setCancelling(true)
    const { error } = await sb.from('orders').update({
      status:                 'pending',
      invoice_no:             null,
      invoiced_at:            null,
      invoice_cancelled_at:   new Date().toISOString(),
      invoice_cancelled_by:   currentUser?.email || currentRole || 'admin',
    }).eq('id', order.id)
    setCancelling(false)
    setShowCancelDlg(false)
    if (error) {
      alert('Failed to cancel invoice: ' + error.message)
    } else {
      if (onCancelled) onCancelled()
      onClose()
    }
  }

  function handlePrint() {
    const el = printRef.current
    if (!el) return
    const win = window.open('', '_blank', 'width=900,height=700')
    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <title>Invoice ${order.invoice_no || order.id}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'DM Sans',system-ui,sans-serif;background:#fff;color:#1A1916;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .sheet{width:100%;min-height:297mm;display:flex;flex-direction:column;background:#fff}
        @media print{@page{size:A4;margin:0}body{background:#fff}.no-print{display:none}}
      </style>
      </head><body>
      <div class="no-print" style="text-align:right;padding:12px 24px;background:#f0f0f0">
        <button onclick="window.print()" style="background:#534AB7;color:#fff;border:none;padding:10px 20px;border-radius:8px;font:600 13px sans-serif;cursor:pointer">Print / Save PDF</button>
      </div>
      ${el.innerHTML}
      </body></html>`)
    win.document.close()
  }

  const fr = placer || {}
  const subtotal   = items.reduce(function(sum, item) { return sum + (item.rate || 0) * (item.ordered_qty || 0) }, 0)
  const courier    = order.courier_charges || 0
  const grandTotal = order.grand_total || (subtotal + courier)
  const amtPaid    = order.amount_paid || 0
  const balance    = grandTotal - amtPaid
  const payStatus  = order.status === 'closed' ? 'paid' : (amtPaid > 0 ? 'part' : 'unpaid')

  const displayBillTo = billToName || fr.business_name || '—'
  const hasShipTo     = !!shipTo

  async function handleSendEmail() {
    const email = fr.email
    if (!email) { alert('No email address found for this franchisee.'); return }
    setSending(true)
    try {
      await sendInvoiceEmail(order, email, fr.business_name || email, grandTotal)
      alert('Invoice emailed to ' + email)
    } catch (err) {
      alert('Failed to send email: ' + err.message)
    } finally {
      setSending(false)
    }
  }

  // ── Inline edit popover ──────────────────────────────────────────────────
  function EditPopover({ label, value, onChange, onSave, onCancel, placeholder }) {
    return (
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(255,255,255,.96)', borderRadius: 12, zIndex: 10,
        display: 'flex', flexDirection: 'column', padding: '12px 14px', gap: 8,
        boxShadow: '0 0 0 2px #534AB7'
      }}>
        <div style={{ font: '700 9px "DM Mono",monospace', color: '#534AB7', textTransform: 'uppercase', letterSpacing: '.1em' }}>
          Edit {label}
        </div>
        <input
          autoFocus
          value={value}
          onChange={function(e) { onChange(e.target.value) }}
          placeholder={placeholder}
          onKeyDown={function(e) { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel(); }}
          style={{
            border: '1.5px solid #534AB7', borderRadius: 7, padding: '7px 10px',
            font: '600 13px "DM Sans",sans-serif', color: '#1A1916', outline: 'none', width: '100%'
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onSave} disabled={saving} style={{ flex: 1, padding: '7px', background: '#534AB7', color: '#fff', border: 'none', borderRadius: 7, font: '600 11px "DM Sans",sans-serif', cursor: 'pointer' }}>
            {saving ? 'Saving…' : '✓ Save'}
          </button>
          <button onClick={onCancel} style={{ padding: '7px 12px', background: '#F0EEE9', color: '#5C5A54', border: 'none', borderRadius: 7, font: '600 11px "DM Sans",sans-serif', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', overflowY: 'auto',
      padding: '24px 16px 60px'
    }}>
      {/* ── toolbar ── */}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20,
        background: '#fff', borderRadius: 30, padding: '6px 6px 6px 18px',
        boxShadow: '0 4px 14px rgba(0,0,0,.12)',
        font: '500 12px "DM Mono",monospace', color: '#5C5A54',
        textTransform: 'uppercase', letterSpacing: '.05em',
        flexShrink: 0, flexWrap: 'wrap', justifyContent: 'center'
      }}>
        <span>
          <span style={{ display:'inline-block', width:6, height:6, borderRadius:'50%', background:'#16A34A', marginRight:6, verticalAlign:'middle' }}></span>
          {order.invoice_no || 'Draft'} · Preview
        </span>
        <button onClick={onClose} style={{ background:'#fff', color:'#5C5A54', border:'1px solid #D0CEC6', padding:'8px 16px', borderRadius:24, cursor:'pointer', font:'600 11px "DM Mono",monospace', letterSpacing:'.05em', textTransform:'uppercase' }}>
          ← Back
        </button>
        <button
          onClick={function() { setEditingBillTo(true); setEditingShipTo(false) }}
          style={{ background:'#FFF7DA', color:'#D97706', border:'1px solid #F59E0B', padding:'8px 16px', borderRadius:24, cursor:'pointer', font:'600 11px "DM Mono",monospace', letterSpacing:'.05em', textTransform:'uppercase' }}
        >
          ✏ Bill To
        </button>
        <button
          onClick={function() { setEditingShipTo(true); setEditingBillTo(false) }}
          style={{ background: hasShipTo ? '#E6F5ED' : '#F7F6F3', color: hasShipTo ? '#1D7A4F' : '#5C5A54', border: '1px solid ' + (hasShipTo ? '#16A34A' : '#D0CEC6'), padding:'8px 16px', borderRadius:24, cursor:'pointer', font:'600 11px "DM Mono",monospace', letterSpacing:'.05em', textTransform:'uppercase' }}
        >
          {hasShipTo ? '✓ Ship To' : '＋ Ship To'}
        </button>
        <button onClick={handleSendEmail} disabled={sending || !fr.email} style={{ background: fr.email ? '#16A34A' : '#9C9A92', color:'#fff', border:'none', padding:'8px 16px', borderRadius:24, cursor: fr.email ? 'pointer' : 'not-allowed', font:'600 11px "DM Mono",monospace', letterSpacing:'.05em', textTransform:'uppercase', opacity: sending ? .7 : 1 }}>
          {sending ? 'Sending…' : '📧 Send Email'}
        </button>
        <button onClick={handlePrint} style={{ background:'#534AB7', color:'#fff', border:'none', padding:'8px 16px', borderRadius:24, cursor:'pointer', font:'600 11px "DM Mono",monospace', letterSpacing:'.05em', textTransform:'uppercase' }}>
          Print / Save PDF
        </button>
        {canCancel && (
          <button
            onClick={function() { setShowCancelDlg(true) }}
            style={{ background:'rgba(220,38,38,.1)', color:'#A32D2D', border:'1.5px solid rgba(220,38,38,.35)', padding:'8px 16px', borderRadius:24, cursor:'pointer', font:'600 11px "DM Mono",monospace', letterSpacing:'.05em', textTransform:'uppercase' }}
          >
            ✕ Cancel Invoice
          </button>
        )}
      </div>

      {/* ── Cancel confirmation dialog ── */}
      {showCancelDlg && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 400,
          background: 'rgba(0,0,0,.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24
        }}>
          <div style={{
            background: '#fff', borderRadius: 14, padding: 28, maxWidth: 440, width: '100%',
            boxShadow: '0 20px 60px rgba(0,0,0,.25)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>⚠️</span>
              <div style={{ font: '700 16px "DM Sans",sans-serif', color: '#A32D2D' }}>Cancel Invoice {order.invoice_no}?</div>
            </div>
            <p style={{ font: '400 13px "DM Sans",sans-serif', color: '#5C5A54', lineHeight: 1.6, marginBottom: 16 }}>
              This will <strong>void the invoice number</strong> and return the order to <em>Pending</em> status.
              The invoice number will not be reused. This action is logged and cannot be undone.
            </p>
            <div style={{ marginBottom: 18 }}>
              <label style={{ font: '600 10px "DM Mono",monospace', color: '#9C9A92', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 5 }}>
                Reason for cancellation (optional)
              </label>
              <input
                autoFocus
                value={cancelReason}
                onChange={function(e) { setCancelReason(e.target.value) }}
                placeholder="e.g. Wrong franchisee, duplicate order…"
                style={{ width: '100%', padding: '8px 11px', border: '1.5px solid #E2E0D8', borderRadius: 8, font: '13px "DM Sans",sans-serif', color: '#1A1916', outline: 'none' }}
                onKeyDown={function(e) { if (e.key === 'Escape') setShowCancelDlg(false) }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={function() { setShowCancelDlg(false); setCancelReason('') }}
                style={{ padding: '9px 20px', border: '1px solid #D0CEC6', borderRadius: 8, background: '#fff', font: '600 13px "DM Sans",sans-serif', cursor: 'pointer', color: '#5C5A54' }}
              >
                Keep Invoice
              </button>
              <button
                onClick={handleCancelInvoice}
                disabled={cancelling}
                style={{ padding: '9px 20px', border: 'none', borderRadius: 8, background: '#DC2626', color: '#fff', font: '600 13px "DM Sans",sans-serif', cursor: 'pointer', opacity: cancelling ? .7 : 1 }}
              >
                {cancelling ? 'Cancelling…' : 'Yes, Cancel Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── A4 sheet ── */}
      {loading ? (
        <div style={{ background:'#fff', borderRadius:12, padding:40, color:'#9C9A92', fontFamily:'DM Mono,monospace', fontSize:13 }}>Loading invoice…</div>
      ) : (
        <div ref={printRef} style={{
          width: '210mm', minHeight: '297mm', background: '#fff',
          boxShadow: '0 8px 28px rgba(0,0,0,.10), 0 2px 6px rgba(0,0,0,.06)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: '"DM Sans", system-ui, sans-serif',
          WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact'
        }}>
          {/* ── HEADER ── */}
          <div style={{
            position: 'relative', padding: '18px 22mm 0', height: 200,
            background: 'linear-gradient(115deg, #FFF6D9 0%, #FFE89B 40%, #FFD234 75%, #FFB347 100%)',
            flexShrink: 0, overflow: 'hidden'
          }}>
            <svg style={{ position:'absolute', left:0, right:0, bottom:-1, width:'100%', height:30, pointerEvents:'none' }} viewBox="0 0 800 30" preserveAspectRatio="none">
              <path d="M0 30 L0 18 Q 100 4, 200 16 T 400 16 T 600 16 T 800 18 L 800 30 Z" fill="#fff" />
            </svg>
            <div style={{ display:'grid', gridTemplateColumns:'130px 1fr 200px', alignItems:'start', gap:16, position:'relative', zIndex:2 }}>
              <div style={{ width:130, height:130, flexShrink:0, background:'#fff', borderRadius:14, padding:6, boxShadow:'0 4px 14px rgba(217,119,6,.22)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <img src="/NLH%20Logo.png" alt="NLH" style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }} />
              </div>
              <div style={{ textAlign:'center', paddingTop:22 }}>
                <div style={{ font:'800 56px "DM Sans",sans-serif', color:'#1E40AF', letterSpacing:'-.02em', lineHeight:1, marginBottom:6 }}>INVOICE</div>
                <div style={{ font:'700 10px "DM Mono",monospace', color:'#D97706', textTransform:'uppercase', letterSpacing:'.25em' }}>Tax invoice · Original copy</div>
              </div>
              <div style={{ textAlign:'right', paddingTop:2, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
                <span style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#1E40AF', color:'#fff', padding:'4px 12px 4px 8px', borderRadius:24, font:'800 8.5px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.12em', whiteSpace:'nowrap' }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:'#FBBF24', display:'inline-block' }}></span>
                  Head Office
                </span>
                <div style={{ font:'800 17px "DM Sans",sans-serif', color:'#1A1916', lineHeight:1.15, letterSpacing:'-.01em', marginTop:2 }}>New Learning Horizons</div>
                <div style={{ font:'700 9.5px "DM Sans",sans-serif', color:'#1A1916', lineHeight:1.6, marginTop:4, textAlign:'right' }}>
                  <div>📍 9, Anjuman Shopping Complex,</div>
                  <div>&nbsp;&nbsp;&nbsp; Residency Rd, Sadar, Nagpur 440 001</div>
                  <div>☎️ +91 9373 111 311</div>
                  <div>✉️ dhiral@nlhnagpur.info</div>
                </div>
              </div>
            </div>
            <div style={{ position:'absolute', bottom:-8, left:'50%', transform:'translateX(-50%)', width:80, height:80, zIndex:1, filter:'drop-shadow(0 4px 10px rgba(217,119,6,.35))' }}>
              <img src="/NLH%20Mascot.png" alt="" style={{ width:'100%', height:'100%', objectFit:'contain' }} />
            </div>
          </div>

          {/* ── TAGLINE ── */}
          <div style={{ background:'linear-gradient(90deg, #534AB7 0%, #6F66CC 100%)', color:'#fff', textAlign:'center', padding:'7px 22mm', font:'600 9px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.14em', position:'relative', zIndex:3 }}>
            New Learning Horizons <span style={{ margin:'0 8px', opacity:.6 }}>·</span> ISO 9001:2015 Certified <span style={{ margin:'0 8px', opacity:.6 }}>·</span> Enriching Children's Future
          </div>

          {/* ── META ── */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', background:'#F7F6F3', borderBottom:'1px solid #E2E0D8', padding:'12px 22mm', gap:16 }}>
            {[
              { lbl: 'Invoice no.', val: order.invoice_no || 'DRAFT', mono: true },
              { lbl: 'Order ref.',  val: order.order_ref || ('ORD-' + String(order.id).slice(0, 8).toUpperCase()), mono: true },
              { lbl: 'Issue date',  val: fmtDateLong(order.invoiced_at || order.created_at) },
              { lbl: 'Due date',    val: dueDateStr(order.invoiced_at || order.created_at), status: payStatus },
            ].map(function(c, i) {
              return (
                <div key={i} style={{ display:'flex', flexDirection:'column', gap:3 }}>
                  <span style={{ font:'600 8.5px "DM Mono",monospace', color:'#9C9A92', textTransform:'uppercase', letterSpacing:'.08em' }}>{c.lbl}</span>
                  <span style={{ font: c.mono ? '700 12px "DM Mono",monospace' : '700 13px "DM Sans",sans-serif', color:'#1A1916' }}>{c.val}</span>
                  {c.status && (
                    <span style={{
                      display:'inline-flex', alignItems:'center', gap:5, padding:'4px 12px', borderRadius:24, font:'700 10px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.08em', alignSelf:'flex-start', marginTop:2,
                      background: c.status === 'paid' ? '#E6F5ED' : c.status === 'part' ? '#FEF3E0' : 'rgba(220,38,38,.12)',
                      color: c.status === 'paid' ? '#1D7A4F' : c.status === 'part' ? '#8A5200' : '#A32D2D'
                    }}>
                      <span style={{ width:6, height:6, borderRadius:'50%', background:'currentColor', display:'inline-block' }}></span>
                      {c.status === 'paid' ? 'Paid' : c.status === 'part' ? 'Part Paid' : 'Unpaid'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── BODY ── */}
          <div style={{ padding:'18px 22mm 0', flex:1, display:'flex', flexDirection:'column', gap:14 }}>

            {/* ── parties row: From | Bill To | Ship To ── */}
            <div style={{ display:'grid', gridTemplateColumns: hasShipTo ? '1fr 1fr 1fr' : '1fr 1fr', gap:12 }}>

              {/* From */}
              <div style={{ borderRadius:12, padding:'14px 16px', background:'#EEEDFE', position:'relative', overflow:'hidden' }}>
                <div style={{ position:'absolute', top:0, bottom:0, left:0, width:3, background:'#534AB7' }}></div>
                <div style={{ font:'700 8.5px "DM Mono",monospace', color:'#534AB7', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:7 }}>From</div>
                <div style={{ font:'700 14px "DM Sans",sans-serif', color:'#1A1916', lineHeight:1.2, marginBottom:5 }}>New Learning Horizons</div>
                <div style={{ font:'500 10px "DM Mono",monospace', color:'#5C5A54', lineHeight:1.55 }}>
                  9, Anjuman Shopping Complex, Residency Road<br/>Sadar, Nagpur · Maharashtra · 440 001
                </div>
                <div style={{ marginTop:8, paddingTop:7, borderTop:'1px dashed rgba(0,0,0,.12)', display:'flex', gap:10, flexWrap:'wrap', font:'600 9px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.06em' }}>
                  <span style={{ color:'#9C9A92' }}>Ph · <b style={{ color:'#1A1916' }}>9373 111 311</b></span>
                </div>
              </div>

              {/* Bill To */}
              <div style={{ borderRadius:12, padding:'14px 16px', background:'linear-gradient(135deg, #FFF7DA 0%, #FFEAA0 100%)', position:'relative', overflow:'hidden' }}>
                <div style={{ position:'absolute', top:0, bottom:0, left:0, width:3, background:'#F59E0B' }}></div>

                {/* edit popover */}
                {editingBillTo && (
                  <EditPopover
                    label="Bill To name"
                    value={billToName}
                    onChange={setBillToName}
                    onSave={saveBillTo}
                    onCancel={function() { setEditingBillTo(false) }}
                    placeholder={fr.business_name || 'Franchisee name'}
                  />
                )}

                <div style={{ font:'700 8.5px "DM Mono",monospace', color:'#D97706', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:7 }}>Bill to</div>
                <div style={{ font:'700 14px "DM Sans",sans-serif', color:'#1A1916', lineHeight:1.2, marginBottom:5 }}>{displayBillTo}</div>
                <div style={{ font:'500 10px "DM Mono",monospace', color:'#5C5A54', lineHeight:1.7 }}>
                  {fr.address && <div>📍 {fr.address}</div>}
                  {fr.area && <div>&nbsp;&nbsp;&nbsp; {fr.area}</div>}
                  {(fr.city || fr.state) && <div>{[fr.city, fr.state].filter(Boolean).join(', ')}</div>}
                  {fr.country && fr.country !== 'India' && <div>{fr.country}</div>}
                  {fr.phone && <div>☎️ {fr.phone}</div>}
                  {fr.email && <div>✉️ {fr.email}</div>}
                </div>
                <div style={{ marginTop:8, paddingTop:7, borderTop:'1px dashed rgba(0,0,0,.12)', display:'flex', gap:10, flexWrap:'wrap', font:'600 9px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.06em' }}>
                  <span style={{ background:'rgba(217,119,6,.18)', color:'#D97706', padding:'2px 8px', borderRadius:20, fontWeight:700 }}>{fr.tier || order.placer_tier || 'UF'}</span>
                  {order.order_ref && <span style={{ color:'#9C9A92' }}>Ref · <b style={{ color:'#1A1916' }}>{order.order_ref}</b></span>}
                </div>
              </div>

              {/* Ship To — only shown when set */}
              {hasShipTo && (
                <div style={{ borderRadius:12, padding:'14px 16px', background:'linear-gradient(135deg, #E6F5ED 0%, #C6EDD8 100%)', position:'relative', overflow:'hidden' }}>
                  <div style={{ position:'absolute', top:0, bottom:0, left:0, width:3, background:'#16A34A' }}></div>

                  {editingShipTo && (
                    <EditPopover
                      label="Ship To"
                      value={shipTo}
                      onChange={setShipTo}
                      onSave={saveShipTo}
                      onCancel={function() { setEditingShipTo(false) }}
                      placeholder="e.g. NLH Dharampeth, CF Nagpur"
                    />
                  )}

                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:7 }}>
                    <div style={{ font:'700 8.5px "DM Mono",monospace', color:'#1D7A4F', textTransform:'uppercase', letterSpacing:'.1em' }}>Ship / Deliver to</div>
                  </div>
                  <div style={{ font:'700 13px "DM Sans",sans-serif', color:'#1A1916', lineHeight:1.35, whiteSpace:'pre-wrap' }}>{shipTo}</div>
                  <div style={{ marginTop:8, paddingTop:7, borderTop:'1px dashed rgba(0,0,0,.12)', font:'600 9px "DM Mono",monospace', color:'#1D7A4F', textTransform:'uppercase', letterSpacing:'.06em' }}>
                    Goods dispatched to this address
                  </div>
                </div>
              )}
            </div>

            {/* items table */}
            <div style={{ border:'1px solid #E2E0D8', borderRadius:12, overflow:'hidden' }}>
              <div style={{ background:'linear-gradient(90deg, #534AB7 0%, #6F66CC 100%)', color:'#fff', padding:'10px 16px', display:'grid', gridTemplateColumns:'32px 1fr 50px 50px 80px 100px', gap:10, font:'700 9px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.08em' }}>
                <div>#</div><div>SKU / Item</div>
                <div style={{ textAlign:'right' }}>Ord</div>
                <div style={{ textAlign:'right' }}>Sent</div>
                <div style={{ textAlign:'right' }}>Rate</div>
                <div style={{ textAlign:'right' }}>Amount</div>
              </div>
              {items.map(function(item, i) {
                const course  = item.skus?.courses?.group_name || ''
                const level   = item.skus?.level_name || item.sku_id || '—'
                const name    = course ? course + ' — ' + level : level
                const lineAmt = (item.rate || 0) * (item.ordered_qty || 0)
                const sent    = item.sent_qty || 0
                return (
                  <div key={item.id} style={{ display:'grid', gridTemplateColumns:'32px 1fr 50px 50px 80px 100px', gap:10, padding:'10px 16px', borderBottom: i < items.length - 1 ? '1px solid #E2E0D8' : 'none', background: i % 2 === 1 ? '#FAFAFE' : '#fff', alignItems:'center' }}>
                    <div style={{ font:'600 9px "DM Mono",monospace', color:'#9C9A92' }}>{String(i + 1).padStart(2, '0')}</div>
                    <div style={{ display:'flex', flexDirection:'column' }}>
                      <span style={{ font:'600 11.5px "DM Sans",sans-serif', color:'#1A1916', lineHeight:1.2 }}>{name}</span>
                      {item.sku_id && <span style={{ font:'500 9px "DM Mono",monospace', color:'#9C9A92', marginTop:2, textTransform:'uppercase', letterSpacing:'.04em' }}>{item.sku_id.slice(0, 8).toUpperCase()}</span>}
                    </div>
                    <div style={{ textAlign:'right', font:'500 11px "DM Mono",monospace', color:'#5C5A54' }}>{item.ordered_qty || 0}</div>
                    <div style={{ textAlign:'right', font:'500 11px "DM Mono",monospace', color: sent === item.ordered_qty ? '#16A34A' : '#5C5A54', fontWeight: sent === item.ordered_qty ? 700 : 500 }}>{sent}</div>
                    <div style={{ textAlign:'right', font:'500 11px "DM Mono",monospace', color:'#5C5A54' }}>₹{fmtAmt(item.rate || 0)}</div>
                    <div style={{ textAlign:'right', font:'700 12px "DM Mono",monospace', color:'#1A1916' }}>₹{fmtAmt(lineAmt)}</div>
                  </div>
                )
              })}
            </div>

            {/* bottom: payment + totals */}
            <div style={{ display:'grid', gridTemplateColumns:'1.05fr 1fr', gap:12 }}>
              {/* payment box */}
              <div style={{ background:'linear-gradient(135deg, #FFF7DA 0%, #FFE89B 100%)', borderRadius:12, padding:16, position:'relative', overflow:'hidden' }}>
                <div style={{ position:'absolute', top:0, bottom:0, left:0, width:3, background:'#F59E0B' }}></div>
                <div style={{ font:'700 9px "DM Mono",monospace', color:'#D97706', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:4 }}>Payment details</div>
                <div style={{ font:'500 10px "DM Mono",monospace', color:'#5C5A54', marginBottom:12, letterSpacing:'.02em' }}>Pay via NEFT / IMPS / UPI</div>
                <div style={{ background:'#fff', borderRadius:10, padding:12, display:'grid', gridTemplateColumns:'minmax(0,1fr) 120px', gap:12, boxShadow:'0 1px 3px rgba(0,0,0,.06)', alignItems:'start' }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    <div>
                      <div style={{ font:'700 12px "DM Sans",sans-serif', color:'#1E40AF', display:'flex', alignItems:'center', gap:6 }}>🏦 IDFC First Bank</div>
                      <div style={{ font:'500 9px "DM Mono",monospace', color:'#9C9A92', textTransform:'uppercase', letterSpacing:'.04em', marginTop:-2 }}>Dharampeth, Nagpur</div>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'50px 1fr', gap:'4px 8px', font:'500 10.5px "DM Mono",monospace', alignItems:'center' }}>
                      <span style={{ color:'#9C9A92', fontSize:9, textTransform:'uppercase', letterSpacing:'.05em', fontWeight:600 }}>A/C</span>
                      <span style={{ color:'#1A1916', fontWeight:600 }}>10049219082</span>
                      <span style={{ color:'#9C9A92', fontSize:9, textTransform:'uppercase', letterSpacing:'.05em', fontWeight:600 }}>IFSC</span>
                      <span style={{ color:'#1A1916', fontWeight:600 }}>IDFB0022022</span>
                    </div>
                    <div style={{ background:'#EEEDFE', borderRadius:7, padding:'6px 10px', font:'700 9.5px "DM Mono",monospace', color:'#534AB7', letterSpacing:'.04em', display:'flex', alignItems:'center', gap:6 }}>
                      📱 UPI: newlearninghorizons@idfcbank
                    </div>
                    <div style={{ marginTop:4, background:'#1E40AF', color:'#fff', borderRadius:8, padding:'8px 12px', font:'600 9px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.1em', textAlign:'center' }}>
                      ⚡ Instant · NEFT · IMPS accepted
                    </div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
                    <div style={{ font:'700 8.5px "DM Mono",monospace', color:'#1E40AF', textTransform:'uppercase', letterSpacing:'.1em', textAlign:'center', lineHeight:1.3 }}>Scan to pay</div>
                    <img src="/nlh-upi-qr.png" alt="Pay QR" style={{ width:110, height:110, display:'block', background:'#fff', borderRadius:6, padding:4, border:'2px solid #1E40AF', objectFit:'contain' }} />
                    <div style={{ font:'700 7.5px "DM Mono",monospace', color:'#5C5A54', textAlign:'center', lineHeight:1.35, letterSpacing:'.03em', textTransform:'uppercase' }}>
                      <b style={{ color:'#534AB7' }}>newlearninghorizons@idfcbank</b>
                    </div>
                  </div>
                </div>
              </div>

              {/* totals */}
              <div style={{ background:'#EEEDFE', borderRadius:12, padding:'14px 16px', position:'relative', overflow:'hidden', display:'flex', flexDirection:'column', gap:0 }}>
                <div style={{ position:'absolute', top:0, bottom:0, left:0, width:3, background:'#534AB7' }}></div>
                <div style={{ font:'700 9px "DM Mono",monospace', color:'#534AB7', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:6 }}>Invoice summary</div>
                {[
                  { l: 'Kit subtotal',    v: '₹' + fmtAmt(subtotal) },
                  { l: 'Courier charges', v: courier > 0 ? '₹' + fmtAmt(courier) : '—' },
                  { l: 'Amount paid',     v: amtPaid > 0 ? '₹' + fmtAmt(amtPaid) : '—', muted: amtPaid === 0 },
                ].map(function(row, i) {
                  return (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px dashed rgba(83,74,183,.25)' }}>
                      <span style={{ font:'500 11px "DM Sans",sans-serif', color:'#5C5A54' }}>{row.l}</span>
                      <span style={{ font:'600 12px "DM Mono",monospace', color: row.muted ? '#9C9A92' : '#1A1916', fontWeight: row.muted ? 400 : 600 }}>{row.v}</span>
                    </div>
                  )
                })}
                {balance < grandTotal && (
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px dashed rgba(83,74,183,.25)' }}>
                    <span style={{ font:'500 11px "DM Sans",sans-serif', color:'#5C5A54' }}>Balance due</span>
                    <span style={{ font:'600 12px "DM Mono",monospace', color: balance > 0 ? '#A32D2D' : '#1D7A4F' }}>₹{fmtAmt(balance)}</span>
                  </div>
                )}
                <div style={{ marginTop:10, background:'linear-gradient(135deg, #534AB7 0%, #6F66CC 100%)', borderRadius:10, padding:'14px 16px', display:'flex', justifyContent:'space-between', alignItems:'baseline', color:'#fff', boxShadow:'0 4px 14px rgba(83,74,183,.25)' }}>
                  <div style={{ font:'700 9.5px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.12em' }}>Grand total</div>
                  <div style={{ font:'800 22px "DM Sans",sans-serif', letterSpacing:'-.01em', lineHeight:1 }}>
                    <span style={{ font:'700 11px "DM Sans",sans-serif', marginRight:4, opacity:.85 }}>₹</span>
                    {fmtAmt(grandTotal)}
                  </div>
                </div>
                <div style={{ marginTop:8, font:'500 9px "DM Mono",monospace', color:'#9C9A92', lineHeight:1.45, textTransform:'uppercase', letterSpacing:'.04em' }}>
                  Amount in words: <b style={{ color:'#534AB7' }}>{numToWords(grandTotal)}</b>
                </div>
              </div>
            </div>

            {/* thank you */}
            <div style={{ marginTop:14, background:'linear-gradient(115deg, #FFE89B 0%, #FFD234 100%)', borderRadius:12, padding:'14px 16px 14px 90px', position:'relative', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'space-between', gap:14 }}>
              <div style={{ position:'absolute', left:4, bottom:-6, width:76, height:76, zIndex:1, filter:'drop-shadow(0 3px 8px rgba(217,119,6,.3))' }}>
                <img src="/NLH%20Mascot.png" alt="" style={{ width:'100%', height:'100%', objectFit:'contain' }} />
              </div>
              <div style={{ zIndex:2, flex:1 }}>
                <div style={{ font:'800 17px "DM Sans",sans-serif', color:'#1E40AF', letterSpacing:'-.01em' }}>Thank you for your order!</div>
                <div style={{ font:'500 10px "DM Mono",monospace', color:'#5B3A00', textTransform:'uppercase', letterSpacing:'.06em', marginTop:3 }}>
                  Enriching children's future · New Learning Horizons
                </div>
              </div>
              <div style={{ zIndex:2, textAlign:'right', background:'rgba(255,255,255,.6)', padding:'8px 14px', borderRadius:24, backdropFilter:'blur(4px)' }}>
                <div style={{ font:'700 8.5px "DM Mono",monospace', color:'#D97706', textTransform:'uppercase', letterSpacing:'.08em' }}>Support</div>
                <div style={{ font:'800 14px "DM Sans",sans-serif', color:'#1E40AF', marginTop:1 }}>9373 111 311</div>
              </div>
            </div>

          </div>

          {/* ── FOOTER ── */}
          <div style={{ background:'#1F2937', color:'#fff', padding:'14px 22mm', marginTop:'auto', position:'relative' }}>
            <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'linear-gradient(90deg, #F59E0B 0%, #EA580C 50%, #F59E0B 100%)' }}></div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:14 }}>
              <div style={{ font:'600 9px "DM Mono",monospace', color:'#fff', textTransform:'uppercase', letterSpacing:'.1em' }}>
                <span style={{ color:'#FCD34D' }}>New Learning Horizons</span> · Est. 2008 · ISO 9001:2015
              </div>
              <div style={{ font:'500 8.5px "DM Mono",monospace', color:'rgba(255,255,255,.5)', textTransform:'uppercase', letterSpacing:'.08em' }}>
                This is a computer generated invoice
              </div>
              <div style={{ font:'600 9px "DM Mono",monospace', color:'#fff', letterSpacing:'.04em' }}>
                nlhnagpur.info · <span style={{ color:'#FCD34D' }}>dhiral@nlhnagpur.info</span>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
