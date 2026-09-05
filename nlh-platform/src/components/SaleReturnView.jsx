import React, { useState } from 'react'
import { sb } from '../supabase'
import { fmtAmt, showToast } from '../utils'

// Printable Sale Return voucher — a franchisee (CF/SMF) supplied part of
// another party's order from their own previously-purchased stock, and this
// document is the credit record for it (see franchisee_stock_returns and
// createPendingStockReturns in OrdersPage.jsx). Always a single line — one
// SKU, one qty — so unlike InvoiceView this never needs page-pack logic.
// Auto-generated and auto-approved, but the rate (or qty) can be corrected
// here by hand — e.g. if the franchisee's original purchase rate needs
// adjusting — same "automated, manually correctable" model the user asked
// for the whole sale-return process to follow.

function fmtDateLong(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

function tbBtn(active, color) {
  return {
    background: active ? (color || '#534AB7') : '#fff', color: active ? '#fff' : '#5C5A54',
    border: '1px solid ' + (active ? (color || '#534AB7') : '#D0CEC6'), padding: '8px 14px', borderRadius: 24,
    cursor: 'pointer', font: '600 11px "DM Mono",monospace', letterSpacing: '.05em', textTransform: 'uppercase',
  }
}

export default function SaleReturnView({ saleReturn: r, onClose, onSaved }) {
  const fr = r.franchisees || {}
  const skuName = (r.skus?.courses?.group_name ? r.skus.courses.group_name + ' — ' : '') + (r.skus?.level_name || '')
  const forOrder = r.orders?.invoice_no || r.orders?.order_ref || '—'
  // Who actually received the goods — a school billed through its CF shows
  // as the school, same bill_to_fr-else-placer resolution used everywhere
  // else (OrderReceiverInfo, InvoiceView, stock ledger notes).
  const receiver = r.orders?.bill_to_fr?.business_name || r.orders?.placer?.business_name || '—'
  const orderDate = fmtDateLong(r.orders?.invoiced_at || r.orders?.created_at)

  const [editing, setEditing] = useState(false)
  const [qty, setQty] = useState(r.qty)
  const [unitValue, setUnitValue] = useState(r.unit_value)
  const [saving, setSaving] = useState(false)
  const liveCredit = (parseInt(qty, 10) || 0) * (parseInt(unitValue, 10) || 0)

  function startEdit() { setQty(r.qty); setUnitValue(r.unit_value); setEditing(true) }
  function cancelEdit() { setQty(r.qty); setUnitValue(r.unit_value); setEditing(false) }

  async function saveEdit() {
    const q = parseInt(qty, 10) || 0
    const uv = parseInt(unitValue, 10) || 0
    setSaving(true)
    const { error } = await sb.from('franchisee_stock_returns')
      .update({ qty: q, unit_value: uv, total_credit: q * uv })
      .eq('id', r.id)
    setSaving(false)
    if (error) { showToast('Failed to save: ' + error.message, 'err'); return }
    showToast('Sale return voucher updated ✓')
    setEditing(false)
    if (onSaved) onSaved()
  }

  function handlePrint() {
    const node = document.getElementById('sr-sheet')
    if (!node) return
    const win = window.open('', '_blank', 'width=900,height=800')
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sale Return ${r.return_no || ''}</title>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'DM Sans',system-ui,sans-serif;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;position:relative}
      @media print{@page{size:A4;margin:0}.np{display:none}}
      </style></head><body>
      <div class="np" style="text-align:right;padding:10px 20px;background:#f0f0f0"><button onclick="window.print()" style="background:#534AB7;color:#fff;border:none;padding:8px 18px;border-radius:7px;font:600 13px sans-serif;cursor:pointer">Print / Save PDF</button></div>
      <div class="page">${node.outerHTML}</div>
      </body></html>`)
    win.document.close()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', padding: '20px 16px 60px' }}>

      {/* toolbar */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 16, background: '#fff', borderRadius: 30, padding: '5px 5px 5px 16px', boxShadow: '0 4px 14px rgba(0,0,0,.12)', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'center' }}>
        <span style={{ font: '600 11px "DM Mono",monospace', color: '#5C5A54', marginRight: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#2563EB', marginRight: 5, verticalAlign: 'middle' }} />{r.return_no || 'Sale Return'}
        </span>
        {editing ? (
          <>
            <button onClick={saveEdit} disabled={saving} style={{ ...tbBtn(false), background: '#16A34A', color: '#fff', border: 'none', opacity: saving ? .7 : 1 }}>{saving ? 'Saving…' : '✓ Save'}</button>
            <button onClick={cancelEdit} disabled={saving} style={tbBtn(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button onClick={startEdit} style={{ ...tbBtn(false), background: '#D97706', color: '#fff', border: 'none' }}>✏ Edit</button>
            <button onClick={handlePrint} style={{ ...tbBtn(false), background: '#534AB7', color: '#fff', border: 'none' }}>🖨 PDF</button>
            <button onClick={onClose} style={tbBtn(false)}>← Back</button>
          </>
        )}
      </div>

      {/* ══════════ VOUCHER ══════════ */}
      <div id="sr-sheet" style={{ width: '210mm', minHeight: '297mm', background: '#fff', boxShadow: '0 8px 28px rgba(0,0,0,.10)', display: 'flex', flexDirection: 'column', fontFamily: '"DM Sans",system-ui,sans-serif', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>

        {/* header band */}
        <div style={{ background: 'linear-gradient(115deg,#EFF6FF 0%,#DBEAFE 45%,#93C5FD 80%,#60A5FA 100%)', padding: '10px 20px 0', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
          <svg style={{ position: 'absolute', left: 0, right: 0, bottom: -1, width: '100%', height: 20, pointerEvents: 'none' }} viewBox="0 0 800 20" preserveAspectRatio="none">
            <path d="M0 20 L0 12 Q100 2,200 11 T400 11 T600 11 T800 12 L800 20 Z" fill="#fff" />
          </svg>
          <div style={{ display: 'grid', gridTemplateColumns: '68px 1fr auto', alignItems: 'center', gap: 12, position: 'relative', zIndex: 2 }}>
            <div style={{ width: 68, height: 68, background: '#fff', borderRadius: 10, padding: 4, boxShadow: '0 3px 10px rgba(37,99,235,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <img src="/NLH%20Logo.png" alt="NLH" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ font: '800 40px "DM Sans",sans-serif', color: '#1E40AF', letterSpacing: '-.02em', lineHeight: 1, marginBottom: 2 }}>SALE RETURN</div>
              <div style={{ font: '700 8px "DM Mono",monospace', color: '#2563EB', textTransform: 'uppercase', letterSpacing: '.2em' }}>Stock &amp; Credit Voucher · Auto-Approved</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#1E40AF', color: '#fff', padding: '3px 10px 3px 7px', borderRadius: 20, font: '700 7.5px "DM Mono",monospace', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 4, whiteSpace: 'nowrap' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#FBBF24', display: 'inline-block' }} />Head Office
              </span>
              <div style={{ font: '700 12px "DM Sans",sans-serif', color: '#1A1916', lineHeight: 1.2 }}>New Learning Horizons</div>
              <div style={{ font: '500 8px "DM Sans",sans-serif', color: '#1A1916', lineHeight: 1.6, marginTop: 3 }}>
                <div>9, Anjuman Shopping Complex, Residency Rd, Sadar, Nagpur 440 001</div>
                <div>☎ +91 9373 111 311 · ✉ dhiral@nlhnagpur.info</div>
              </div>
            </div>
          </div>
        </div>

        {/* tagline */}
        <div style={{ background: 'linear-gradient(90deg,#1E40AF,#2563EB)', color: '#fff', textAlign: 'center', padding: '5px 20px', font: '600 8px "DM Mono",monospace', textTransform: 'uppercase', letterSpacing: '.14em', flexShrink: 0 }}>
          New Learning Horizons · ISO 9001:2015 Certified · Enriching Children's Future
        </div>

        {/* meta */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', background: '#F7F6F3', borderBottom: '1px solid #E2E0D8', padding: '8px 20px', gap: 10, flexShrink: 0 }}>
          {[
            { lbl: 'Voucher no.', val: r.return_no || 'Pending', mono: true },
            { lbl: 'For order / invoice', val: forOrder, mono: true },
            { lbl: 'Return date', val: fmtDateLong(r.approved_at || r.created_at) },
            { lbl: 'Status', val: (r.status || 'approved').replace(/^\w/, function (c) { return c.toUpperCase() }) },
          ].map(function (c, i) {
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ font: '600 7.5px "DM Mono",monospace', color: '#9C9A92', textTransform: 'uppercase', letterSpacing: '.07em' }}>{c.lbl}</span>
                <span style={{ font: c.mono ? '700 11px "DM Mono",monospace' : '700 11px "DM Sans",sans-serif', color: '#1A1916' }}>{c.val}</span>
              </div>
            )
          })}
        </div>

        {/* body */}
        <div style={{ padding: '10px 20px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* parties */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ borderRadius: 10, padding: '9px 12px 24px', background: '#EFF6FF', position: 'relative', overflow: 'hidden', minHeight: 104 }}>
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 3, background: '#2563EB' }} />
              <div style={{ font: '700 7.5px "DM Mono",monospace', color: '#2563EB', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 5 }}>Returned goods issued by</div>
              <div style={{ font: '700 12px "DM Sans",sans-serif', color: '#1A1916', lineHeight: 1.2, marginBottom: 3 }}>New Learning Horizons</div>
              <div style={{ font: '500 9px "DM Mono",monospace', color: '#5C5A54', lineHeight: 1.55 }}>9, Anjuman Shopping Complex, Residency Rd, Sadar, Nagpur 440 001</div>
            </div>
            <div style={{ borderRadius: 10, padding: '9px 12px 24px', background: 'linear-gradient(135deg,#FFF7DA,#FFEAA0)', position: 'relative', overflow: 'hidden', minHeight: 104 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ font: '700 7.5px "DM Mono",monospace', color: '#D97706', textTransform: 'uppercase', letterSpacing: '.1em' }}>Credited to</span>
                {fr.phone && <span style={{ font: '700 11px "DM Sans",sans-serif', color: '#1A1916', whiteSpace: 'nowrap' }}>☎ {fr.phone}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                <span style={{ background: 'rgba(0,0,0,.08)', color: '#D97706', padding: '2px 8px', borderRadius: 20, font: '700 8px "DM Mono",monospace', textTransform: 'uppercase', letterSpacing: '.04em', flexShrink: 0 }}>{fr.tier || '—'}</span>
                <span style={{ font: '700 12px "DM Sans",sans-serif', color: '#1A1916', lineHeight: 1.2 }}>{fr.business_name || '—'}</span>
              </div>
              <div style={{ font: '500 9px "DM Mono",monospace', color: '#5C5A54', lineHeight: 1.55 }}>
                {[fr.address, fr.area, [fr.city, fr.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
              </div>
              {fr.email && <div style={{ position: 'absolute', left: 12, bottom: 7, font: '500 9px "DM Mono",monospace', color: '#5C5A54' }}>✉ {fr.email}</div>}
            </div>
          </div>

          {/* item table — one line, editable qty/rate */}
          <div style={{ border: '1px solid #E2E0D8', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(90deg,#1E40AF,#2563EB)', color: '#fff', padding: '9px 14px', display: 'grid', gridTemplateColumns: '1fr 70px 90px 110px', gap: 10, font: '700 10px "DM Mono",monospace', textTransform: 'uppercase', letterSpacing: '.07em' }}>
              <div>SKU / Item</div>
              <div style={{ textAlign: 'right' }}>Qty</div>
              <div style={{ textAlign: 'right' }}>Rate</div>
              <div style={{ textAlign: 'right' }}>Credit</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 90px 110px', gap: 10, padding: '11px 14px', alignItems: 'center' }}>
              <div style={{ font: '600 13px "DM Sans",sans-serif', color: '#1A1916' }}>{skuName || '—'}</div>
              {editing ? (
                <input type="number" min="1" value={qty} onChange={function (e) { setQty(e.target.value) }}
                  style={{ textAlign: 'right', font: '600 12.5px "DM Mono",monospace', border: '1px solid #D0CEC6', borderRadius: 6, padding: '4px 6px', width: '100%' }} />
              ) : (
                <div style={{ textAlign: 'right', font: '500 12.5px "DM Mono",monospace', color: '#5C5A54' }}>{qty}</div>
              )}
              {editing ? (
                <input type="number" min="0" value={unitValue} onChange={function (e) { setUnitValue(e.target.value) }}
                  style={{ textAlign: 'right', font: '600 12.5px "DM Mono",monospace', border: '1px solid #D0CEC6', borderRadius: 6, padding: '4px 6px', width: '100%' }} />
              ) : (
                <div style={{ textAlign: 'right', font: '500 12.5px "DM Mono",monospace', color: '#5C5A54' }}>₹{fmtAmt(unitValue)}</div>
              )}
              <div style={{ textAlign: 'right', font: '700 13.5px "DM Mono",monospace', color: '#1A1916' }}>₹{fmtAmt(liveCredit)}</div>
            </div>
          </div>

          {/* who it was supplied to — short, one line */}
          <div style={{ font: '500 10px "DM Mono",monospace', color: '#5C5A54' }}>
            Supplied to <b style={{ color: '#1A1916' }}>{receiver}</b> · {forOrder} · {orderDate}
          </div>

          {/* credit total */}
          <div style={{ background: '#EFF6FF', borderRadius: 10, padding: '12px 14px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 3, background: '#2563EB' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ font: '700 10px "DM Mono",monospace', color: '#1E40AF', textTransform: 'uppercase', letterSpacing: '.12em' }}>Total Credit Due to {fr.business_name || 'Franchisee'}</div>
              <div style={{ font: '800 23px "DM Sans",sans-serif', color: '#1A1916', letterSpacing: '-.01em', lineHeight: 1 }}>
                <span style={{ font: '700 12px "DM Sans",sans-serif', marginRight: 3, opacity: .7 }}>₹</span>{fmtAmt(liveCredit)}
              </div>
            </div>
          </div>

        </div>

        {/* footer */}
        <div style={{ background: 'linear-gradient(115deg,#DBEAFE,#93C5FD)', padding: '10px 20px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
          <div style={{ font: '800 15px "DM Sans",sans-serif', color: '#1E40AF', letterSpacing: '-.01em' }}>Sale Return — Auto-Approved</div>
          <div style={{ font: '600 7.5px "DM Mono",monospace', color: '#1E3A8A', textTransform: 'uppercase', letterSpacing: '.06em', textAlign: 'right' }}>Computer generated voucher · No signature required</div>
        </div>

      </div>
    </div>
  )
}
