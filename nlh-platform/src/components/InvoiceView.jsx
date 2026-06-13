import React, { useState, useEffect, useCallback } from 'react'
import { sb } from '../supabase'
import { fmtAmt } from '../utils'
import { sendInvoiceEmail } from '../services/email'

const CANCEL_ROLES = ['owner', 'super_admin', 'admin']
const FR_FIELDS = 'id,business_name,tier,email,city,state,area,country,phone,address,parent_id'

function fmtDateLong(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}
function dueDateStr(d) {
  if (!d) return '—'
  const dt = new Date(d); dt.setDate(dt.getDate() + 14)
  return fmtDateLong(dt.toISOString())
}
function numToWords(num) {
  if (!num || num === 0) return 'Zero Rupees Only'
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
  function cvt(n) {
    if (n < 20) return ones[n]
    if (n < 100) return tens[Math.floor(n/10)] + (n%10?' '+ones[n%10]:'')
    if (n < 1000) return ones[Math.floor(n/100)]+' Hundred'+(n%100?' '+cvt(n%100):'')
    if (n < 100000) return cvt(Math.floor(n/1000))+' Thousand'+(n%1000?' '+cvt(n%1000):'')
    if (n < 10000000) return cvt(Math.floor(n/100000))+' Lakh'+(n%100000?' '+cvt(n%100000):'')
    return cvt(Math.floor(n/10000000))+' Crore'+(n%10000000?' '+cvt(n%10000000):'')
  }
  return cvt(Math.round(num)) + ' Rupees Only'
}
function rateForTier(sku, tier) {
  if (!sku) return 0
  if (tier === 'CF') return sku.cf_rate || 0
  if (tier === 'SMF' || tier === 'NLH') return sku.smf_rate || 0
  return sku.uf_rate || 0
}

function FrCard({ fr, selected, onClick, radio }) {
  if (!fr) return null
  return (
    <div onClick={onClick} style={{
      display:'flex', alignItems:'center', gap:10, padding:'9px 12px',
      border:'1.5px solid '+(selected?'#534AB7':'#E2E0D8'), borderRadius:9,
      cursor:onClick?'pointer':'default', background:selected?'#EEEDFE':'#fff', transition:'all .15s'
    }}>
      {radio && <div style={{ width:15, height:15, borderRadius:'50%', flexShrink:0, border:'2px solid '+(selected?'#534AB7':'#C0BDB4'), background:selected?'#534AB7':'#fff', display:'flex', alignItems:'center', justifyContent:'center' }}>
        {selected && <div style={{ width:5, height:5, borderRadius:'50%', background:'#fff' }} />}
      </div>}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ font:'700 12px "DM Sans",sans-serif', color:'#1A1916', lineHeight:1.2 }}>{fr.business_name||'—'}</div>
        <div style={{ font:'500 9px "DM Mono",monospace', color:'#9C9A92', marginTop:2 }}>
          {[fr.city,fr.state].filter(Boolean).join(', ')}{fr.email?' · '+fr.email:''}
        </div>
      </div>
      <span style={{ padding:'2px 7px', borderRadius:20, font:'700 8px "DM Mono",monospace', textTransform:'uppercase', flexShrink:0,
        background:fr.tier==='SMF'?'#EDE9FE':fr.tier==='CF'?'#FFF7DA':'#E6F5ED',
        color:fr.tier==='SMF'?'#534AB7':fr.tier==='CF'?'#D97706':'#1D7A4F' }}>{fr.tier||'UF'}</span>
    </div>
  )
}

function SectionHead({ color, label }) {
  return (
    <div style={{ font:'700 9px "DM Mono",monospace', color, textTransform:'uppercase', letterSpacing:'.12em', marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ display:'inline-block', width:3, height:13, background:color, borderRadius:2 }} />{label}
    </div>
  )
}

export default function InvoiceView({ order, onClose, onCancelled, currentRole, currentUser }) {
  const isAdmin = CANCEL_ROLES.includes(currentRole) || currentRole === 'manager' || currentRole === 'staff'
  const [activeTab,    setActiveTab]    = useState('view')
  const [items,        setItems]        = useState([])
  const [placer,       setPlacer]       = useState(null)
  const [billToFr,     setBillToFr]     = useState(null)
  const [shipToFr,     setShipToFr]     = useState(null)
  const [hierarchy,    setHierarchy]    = useState([])
  const [loading,      setLoading]      = useState(true)
  const [sending,      setSending]      = useState(false)

  // Edit — parties
  const [editBillToId,  setEditBillToId]  = useState(order.bill_to_franchisee_id || null)
  const [editBillToFr,  setEditBillToFr]  = useState(null)
  const [editShipToId,  setEditShipToId]  = useState(order.ship_to_franchisee_id || null)
  const [editCourier,   setEditCourier]   = useState(order.courier_charges || 0)
  const [editNotes,     setEditNotes]     = useState(order.notes || '')
  const [billSearch,    setBillSearch]    = useState('')
  const [billResults,   setBillResults]   = useState([])
  const [searching,     setSearching]     = useState(false)
  const [saving,        setSaving]        = useState(false)

  // Edit — items
  const [editItems,    setEditItems]    = useState([])
  const [allSkus,      setAllSkus]      = useState([])
  const [deletedIds,   setDeletedIds]   = useState([])
  const [kitMap,       setKitMap]       = useState({})   // sku_id -> [{ name, quantity }] kit composition

  // Live display (updated after save)
  const [liveCourier, setLiveCourier] = useState(order.courier_charges || 0)
  const [liveNotes,   setLiveNotes]   = useState(order.notes || '')

  // Cancel
  const [cancelling,    setCancelling]   = useState(false)
  const [showCancelDlg, setShowCancelDlg]= useState(false)
  const [cancelReason,  setCancelReason] = useState('')

  const canCancel = CANCEL_ROLES.includes(currentRole) &&
    ['invoiced','payment_submitted'].includes(order.status)

  // ── load ──────────────────────────────────────────────────────────────────
  useEffect(function() {
    async function loadData() {
      const [itemsRes, skusRes] = await Promise.all([
        sb.from('order_items').select('*, skus(id,level_name,uf_rate,cf_rate,smf_rate,courses(group_name)), inventory_items(name)').eq('order_id', order.id),
        sb.from('skus').select('id,level_name,uf_rate,cf_rate,smf_rate,courses(group_name)').order('sort_order'),
      ])
      setItems(itemsRes.data || [])
      setEditItems((itemsRes.data || []).map(function(it) { return { ...it } }))
      setAllSkus(skusRes.data || [])

      // Kit composition — items that make up each course kit on this order
      const skuIds = (itemsRes.data || []).map(function(it) { return it.sku_id }).filter(Boolean)
      if (skuIds.length > 0) {
        const { data: kitRows } = await sb
          .from('kit_items')
          .select('sku_id, item_id, quantity, inventory_items(name)')
          .in('sku_id', skuIds)
        const map = {}
        ;(kitRows || []).forEach(function(k) {
          if (!map[k.sku_id]) map[k.sku_id] = []
          map[k.sku_id].push({ item_id: k.item_id, name: k.inventory_items?.name || '—', quantity: k.quantity })
        })
        setKitMap(map)
      } else {
        setKitMap({})
      }

      let placerFr = null
      if (order.placer_id) {
        const { data } = await sb.from('franchisees').select(FR_FIELDS).eq('id', order.placer_id).single()
        placerFr = data; setPlacer(data)
      }

      // Hierarchy for Ship To
      const chain = []
      if (placerFr) {
        chain.push(placerFr)
        if (placerFr.parent_id) {
          const { data: cfD } = await sb.from('franchisees').select(FR_FIELDS).eq('id', placerFr.parent_id).single()
          if (cfD) {
            chain.push(cfD)
            if (cfD.parent_id) {
              const { data: smfD } = await sb.from('franchisees').select(FR_FIELDS).eq('id', cfD.parent_id).single()
              if (smfD && smfD.tier === 'SMF') chain.push(smfD)
            }
          }
        }
      }
      setHierarchy(chain)

      const btId = order.bill_to_franchisee_id || (placerFr ? placerFr.id : null)
      setEditBillToId(btId)

      let resolvedBT = placerFr
      if (order.bill_to_franchisee_id && order.bill_to_franchisee_id !== order.placer_id) {
        const { data: btD } = await sb.from('franchisees').select(FR_FIELDS).eq('id', order.bill_to_franchisee_id).single()
        resolvedBT = btD || placerFr
      }
      setBillToFr(resolvedBT)
      setEditBillToFr(resolvedBT)

      if (order.ship_to_franchisee_id) {
        const found = chain.find(function(f) { return f.id === order.ship_to_franchisee_id })
        setShipToFr(found || null)
      }
      setLoading(false)
    }
    loadData()
  }, [order.id])

  // ── franchisee search ──────────────────────────────────────────────────────
  const searchFr = useCallback(async function(q) {
    if (!q || q.length < 2) { setBillResults([]); return }
    setSearching(true)
    const { data } = await sb.from('franchisees').select(FR_FIELDS).ilike('business_name','%'+q+'%').order('business_name').limit(20)
    setBillResults(data || []); setSearching(false)
  }, [])
  useEffect(function() {
    const t = setTimeout(function() { searchFr(billSearch) }, 300)
    return function() { clearTimeout(t) }
  }, [billSearch, searchFr])

  // ── item edit helpers ──────────────────────────────────────────────────────
  function updateItem(idx, field, val) {
    setEditItems(function(prev) {
      return prev.map(function(it, i) { return i === idx ? { ...it, [field]: field === 'sku_id' ? val : (parseFloat(val) || 0) } : it })
    })
  }
  function updateItemSku(idx, skuId) {
    const sku = allSkus.find(function(s) { return s.id === skuId })
    const tier = order.placer_tier || 'UF'
    setEditItems(function(prev) {
      return prev.map(function(it, i) {
        return i === idx ? { ...it, sku_id: skuId, skus: sku || null, rate: sku ? rateForTier(sku, tier) : 0, ordered_qty: it.ordered_qty || 1 } : it
      })
    })
  }
  function addItem() {
    setEditItems(function(prev) { return [...prev, { sku_id: '', ordered_qty: 1, sent_qty: 0, rate: 0, skus: null, _new: true }] })
  }
  function removeItem(idx) {
    const item = editItems[idx]
    if (item.id) setDeletedIds(function(prev) { return [...prev, item.id] })
    setEditItems(function(prev) { return prev.filter(function(_, i) { return i !== idx }) })
  }

  // ── save ───────────────────────────────────────────────────────────────────
  async function saveEdits() {
    setSaving(true)

    // Delete removed items
    for (const id of deletedIds) {
      await sb.from('order_items').delete().eq('id', id)
    }
    // Update / insert items
    for (const item of editItems) {
      if (!item.sku_id) continue
      if (item.id) {
        await sb.from('order_items').update({ ordered_qty: item.ordered_qty, sent_qty: item.sent_qty || 0, rate: item.rate }).eq('id', item.id)
      } else {
        await sb.from('order_items').insert({ order_id: order.id, sku_id: item.sku_id, ordered_qty: item.ordered_qty || 1, sent_qty: item.sent_qty || 0, rate: item.rate || 0 })
      }
    }

    const subTotal = editItems.reduce(function(s, it) { return s + (it.ordered_qty||0)*(it.rate||0) }, 0)
    // Preserve any coupon discount already applied at checkout (re-clamp to new subtotal)
    const discountAmt = Math.min(order.discount_amount || 0, subTotal)
    const grandTotal = Math.max(0, subTotal + (editCourier || 0) - discountAmt)

    const { error } = await sb.from('orders').update({
      bill_to_franchisee_id: editBillToId || null,
      ship_to_franchisee_id: editShipToId || null,
      courier_charges:       editCourier || 0,
      notes:                 editNotes.trim() || null,
      subtotal:              subTotal,
      grand_total:           grandTotal,
    }).eq('id', order.id)

    setSaving(false)
    if (error) { alert('Save failed: ' + error.message); return }

    // Refresh items display
    const { data: freshItems } = await sb.from('order_items').select('*, skus(id,level_name,uf_rate,cf_rate,smf_rate,courses(group_name)), inventory_items(name)').eq('order_id', order.id)
    setItems(freshItems || [])
    setEditItems((freshItems || []).map(function(it) { return { ...it } }))
    setDeletedIds([])

    if (editBillToFr) setBillToFr(editBillToFr)
    setShipToFr(editShipToId ? (hierarchy.find(function(f) { return f.id === editShipToId }) || null) : null)
    setLiveCourier(editCourier || 0)
    setLiveNotes(editNotes.trim())
    setActiveTab('view')
  }

  // ── cancel ─────────────────────────────────────────────────────────────────
  async function handleCancelInvoice() {
    setCancelling(true)
    const { error } = await sb.from('orders').update({
      status: 'pending', invoice_no: null,
      invoice_cancelled_at: new Date().toISOString(),
      invoice_cancelled_by: currentUser?.email || currentRole || 'admin',
    }).eq('id', order.id)
    setCancelling(false); setShowCancelDlg(false)
    if (error) { alert('Failed to cancel: ' + error.message) }
    else { if (onCancelled) onCancelled(); onClose() }
  }

  // ── print ──────────────────────────────────────────────────────────────────
  // Manual A4 pagination: every page is a fixed 210×297mm box with a FIXED
  // header (masthead + From/Bill-to) and FIXED footer (thank-you strip). The
  // middle is a fixed-height items area; rows are measured on screen and packed
  // so they never overflow. When the list spills over, a "Continued on page N…"
  // line is stamped at the bottom of the items area and the rest carry to the
  // next page. The payment + totals block prints after the last item.
  function handlePrint() {
    function html(id) { const n = document.getElementById(id); return n ? n.outerHTML : '' }
    function h(id) { const n = document.getElementById(id); return n ? n.offsetHeight : 0 }
    const bodyEl = document.getElementById('inv-body')
    const itemsEl = document.getElementById('inv-items')
    if (!bodyEl || !itemsEl) return

    const PXMM = 96 / 25.4
    const PAGE_H = Math.round(297 * PXMM)        // ~1123px

    // Repeating header = masthead band + tagline + meta + parties
    const partiesNode = document.getElementById('inv-parties')
    const partiesHTML = partiesNode ? '<div style="padding:8px 20px 4px">' + partiesNode.outerHTML + '</div>' : ''
    const headHTML = html('inv-hd-band') + html('inv-hd-tag') + html('inv-hd-meta') + partiesHTML
    const footHTML = html('inv-foot')
    const colHeadHTML = html('inv-itemshead')

    // "After items" = everything in the body except the parties and the items
    // table (i.e. payment + totals + dispatch + notes), in order.
    let afterHTML = ''
    let afterH = 0
    Array.prototype.forEach.call(bodyEl.children, function (c) {
      if (c.id === 'inv-parties' || c.id === 'inv-items') return
      afterHTML += c.outerHTML
      afterH += c.offsetHeight + 8
    })

    // Measured heights (on-screen == print, sheet is a fixed 210mm wide)
    const headH = h('inv-hd-band') + h('inv-hd-tag') + h('inv-hd-meta') + h('inv-parties') + 14
    const footH = h('inv-foot')
    const colH  = h('inv-itemshead')
    const PAD   = 20            // top+bottom padding of the items area
    const CONT  = 26           // space reserved for the "continued…" line
    const avail = PAGE_H - headH - footH - PAD   // usable items-area height per page

    // Pack rows into pages by their measured heights
    const rowEls = Array.prototype.slice.call(itemsEl.querySelectorAll('.inv-row'))
    const rowHTML = rowEls.map(function (r) { return r.outerHTML })
    const rowH = rowEls.map(function (r) { return r.offsetHeight })
    const pages = []
    let cur = [], used = colH
    for (let i = 0; i < rowEls.length; i++) {
      if (cur.length > 0 && used + rowH[i] > avail - CONT) { pages.push(cur); cur = []; used = colH }
      cur.push(i); used += rowH[i]
    }
    pages.push(cur)
    if (pages.length === 0) pages.push([])

    // Does the payment/totals block fit under the last items page?
    const summaryOnLast = (used + afterH) <= avail
    const totalPages = pages.length + (summaryOnLast ? 0 : 1)

    const wm = '<div class="wm"><img src="/NLH%20Mascot.png" alt=""></div>'
    function pageHTML(inner) {
      return '<div class="page"><div class="phdr">' + headHTML + '</div>'
        + '<div class="pbody">' + wm + inner + '</div>'
        + '<div class="pftr">' + footHTML + '</div></div>'
    }

    let pagesHTML = ''
    pages.forEach(function (idxs, p) {
      const isLastItemsPage = (p === pages.length - 1)
      const rows = idxs.map(function (i) { return rowHTML[i] }).join('')
      const box = '<div class="ibox">' + colHeadHTML + rows + '</div>'
      const summary = (isLastItemsPage && summaryOnLast) ? '<div class="after">' + afterHTML + '</div>' : ''
      const cont = !isLastItemsPage ? '<div class="cont">⟶ Continued on page ' + (p + 2) + ' of ' + totalPages + '…</div>' : ''
      pagesHTML += pageHTML(box + summary + cont)
    })
    if (!summaryOnLast) pagesHTML += pageHTML('<div class="after" style="margin-top:6px">' + afterHTML + '</div>')

    const win = window.open('','_blank','width=900,height=800')
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${order.invoice_no||order.id}</title>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'DM Sans',system-ui,sans-serif;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .page{width:210mm;height:297mm;margin:0 auto;background:#fff;display:flex;flex-direction:column;overflow:hidden;page-break-after:always;position:relative}
      .page:last-child{page-break-after:auto}
      .phdr,.pftr{flex-shrink:0}
      .pbody{flex:1;position:relative;display:flex;flex-direction:column;padding:10px 20px;overflow:hidden}
      .wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0}
      .wm img{width:46%;max-width:300px;opacity:.16;object-fit:contain}
      .ibox{position:relative;z-index:1;border:1px solid #E2E0D8;border-radius:10px;overflow:hidden}
      .after{position:relative;z-index:1;margin-top:8px}
      .cont{position:relative;z-index:1;margin-top:auto;padding-top:10px;text-align:center;font:700 11px 'DM Mono',monospace;color:#534AB7;letter-spacing:.05em;text-transform:uppercase}
      @media print{@page{size:A4;margin:0}.np{display:none}}
      </style></head><body>
      <div class="np" style="text-align:right;padding:10px 20px;background:#f0f0f0"><button onclick="window.print()" style="background:#534AB7;color:#fff;border:none;padding:8px 18px;border-radius:7px;font:600 13px sans-serif;cursor:pointer">Print / Save PDF</button></div>
      ${pagesHTML}</body></html>`)
    win.document.close()
  }

  async function handleSendEmail() {
    const fr = billToFr || placer || {}
    const email = fr.email
    if (!email) { alert('No email found.'); return }
    setSending(true)
    try {
      await sendInvoiceEmail(order)
      alert('Invoice emailed to ' + email)
    } catch (err) { alert('Failed: ' + err.message) }
    setSending(false)
  }

  // ── computed ───────────────────────────────────────────────────────────────
  const fr         = billToFr || placer || {}
  const shipFr     = shipToFr
  const subtotal   = items.reduce(function(s, i) { return s + (i.rate||0)*(i.ordered_qty||0) }, 0)
  const discount   = Math.min(order.discount_amount || 0, subtotal)
  const liveGrandTotal = Math.max(0, subtotal + liveCourier - discount)
  const amtPaid    = order.amount_paid || 0
  const balance    = liveGrandTotal - amtPaid
  const payStatus  = order.status === 'closed' ? 'paid' : (amtPaid > 0 ? 'part' : 'unpaid')

  function tbBtn(active, color) {
    return { background: active?(color||'#534AB7'):'#fff', color: active?'#fff':'#5C5A54',
      border:'1px solid '+(active?(color||'#534AB7'):'#D0CEC6'), padding:'8px 14px', borderRadius:24,
      cursor:'pointer', font:'600 11px "DM Mono",monospace', letterSpacing:'.05em', textTransform:'uppercase' }
  }

  // ── edit items computed ────────────────────────────────────────────────────
  const editSubtotal = editItems.reduce(function(s, it) { return s + (it.ordered_qty||0)*(it.rate||0) }, 0)
  const editGrandTotal = Math.max(0, editSubtotal + (editCourier || 0) - Math.min(order.discount_amount || 0, editSubtotal))

  return (
    <div style={{ position:'fixed', inset:0, zIndex:200, background:'rgba(0,0,0,0.6)', display:'flex', flexDirection:'column', alignItems:'center', overflowY:'auto', padding:'20px 16px 60px' }}>

      {/* toolbar */}
      <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:16, background:'#fff', borderRadius:30, padding:'5px 5px 5px 16px', boxShadow:'0 4px 14px rgba(0,0,0,.12)', flexShrink:0, flexWrap:'wrap', justifyContent:'center' }}>
        <span style={{ font:'600 11px "DM Mono",monospace', color:'#5C5A54', marginRight:4, textTransform:'uppercase', letterSpacing:'.05em' }}>
          <span style={{ display:'inline-block', width:6, height:6, borderRadius:'50%', background:'#16A34A', marginRight:5, verticalAlign:'middle' }} />{order.invoice_no||'Draft'}
        </span>
        <button onClick={function(){setActiveTab('view')}} style={tbBtn(activeTab==='view','#534AB7')}>📄 View</button>
        <button onClick={function(){setActiveTab('edit')}} style={tbBtn(activeTab==='edit','#D97706')}>✏ Edit</button>
        <button onClick={handleSendEmail} disabled={sending||!fr.email} style={{ ...tbBtn(false), background:fr.email?'#16A34A':'#9C9A92', color:'#fff', border:'none', opacity:sending?.7:1, cursor:fr.email?'pointer':'not-allowed' }}>
          {sending?'Sending…':'📧 Email'}
        </button>
        <button onClick={handlePrint} style={{ ...tbBtn(false), background:'#534AB7', color:'#fff', border:'none' }}>🖨 PDF</button>
        <button onClick={onClose} style={tbBtn(false)}>← Back</button>
      </div>

      {/* Cancel dialog */}
      {showCancelDlg && (
        <div style={{ position:'fixed', inset:0, zIndex:400, background:'rgba(0,0,0,.55)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div style={{ background:'#fff', borderRadius:14, padding:28, maxWidth:440, width:'100%', boxShadow:'0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
              <span style={{ fontSize:22 }}>⚠️</span>
              <div style={{ font:'700 16px "DM Sans",sans-serif', color:'#A32D2D' }}>Cancel Invoice {order.invoice_no}?</div>
            </div>
            <p style={{ font:'400 13px "DM Sans",sans-serif', color:'#5C5A54', lineHeight:1.6, marginBottom:16 }}>
              This will <strong>void the invoice number</strong> and return the order to <em>Pending</em>. The number will not be reused.
            </p>
            <textarea value={cancelReason} onChange={function(e){setCancelReason(e.target.value)}} placeholder="Reason (optional)" rows={2}
              style={{ width:'100%', padding:'8px 11px', border:'1.5px solid #E2E0D8', borderRadius:8, font:'13px "DM Sans",sans-serif', marginBottom:16, resize:'none', outline:'none', boxSizing:'border-box' }} />
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button onClick={function(){setShowCancelDlg(false);setCancelReason('')}} style={{ padding:'9px 20px', border:'1px solid #D0CEC6', borderRadius:8, background:'#fff', font:'600 13px "DM Sans",sans-serif', cursor:'pointer', color:'#5C5A54' }}>Keep Invoice</button>
              <button onClick={handleCancelInvoice} disabled={cancelling} style={{ padding:'9px 20px', border:'none', borderRadius:8, background:'#DC2626', color:'#fff', font:'600 13px "DM Sans",sans-serif', cursor:'pointer', opacity:cancelling?.7:1 }}>
                {cancelling?'Cancelling…':'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ background:'#fff', borderRadius:12, padding:40, color:'#9C9A92', fontFamily:'DM Mono,monospace', fontSize:13 }}>Loading…</div>
      ) : activeTab === 'edit' ? (

        /* ══════════ EDIT TAB ══════════ */
        <div style={{ width:'100%', maxWidth:760, background:'#fff', borderRadius:16, boxShadow:'0 8px 28px rgba(0,0,0,.10)', fontFamily:'"DM Sans",system-ui,sans-serif', display:'flex', flexDirection:'column' }}>

          <div style={{ background:'linear-gradient(90deg,#534AB7,#6F66CC)', padding:'18px 26px', borderRadius:'16px 16px 0 0', flexShrink:0 }}>
            <div style={{ font:'800 17px "DM Sans",sans-serif', color:'#fff', marginBottom:3 }}>Edit Invoice — {order.invoice_no}</div>
            <div style={{ font:'500 10px "DM Mono",monospace', color:'rgba(255,255,255,.7)', textTransform:'uppercase', letterSpacing:'.1em' }}>Items · Parties · Charges · Notes</div>
          </div>

          <div style={{ padding:'22px 26px', display:'flex', flexDirection:'column', gap:26, overflowY:'auto' }}>

            {/* ── ITEMS ── */}
            <section>
              <SectionHead color="#534AB7" label="Order Items &amp; Rates" />
              <div style={{ border:'1px solid #E2E0D8', borderRadius:10, overflow:'hidden', marginBottom:10 }}>
                {/* header */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 70px 70px 90px 32px', gap:8, padding:'7px 12px', background:'#534AB7', color:'#fff', font:'700 9px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.07em' }}>
                  <div>SKU / Item</div><div style={{textAlign:'right'}}>Qty</div><div style={{textAlign:'right'}}>Sent</div><div style={{textAlign:'right'}}>Rate (₹)</div><div/>
                </div>
                {editItems.map(function(item, idx) {
                  const courseName = item.skus?.courses?.group_name || ''
                  const levelName  = item.skus?.level_name || item.inventory_items?.name || ''
                  return (
                    <div key={idx} style={{ display:'grid', gridTemplateColumns:'1fr 70px 70px 90px 32px', gap:8, padding:'7px 12px', borderBottom:'1px solid #F0EEE9', background: idx%2===1?'#FAFAF8':'#fff', alignItems:'center' }}>
                      {item._new || !item.id ? (
                        <select value={item.sku_id} onChange={function(e){updateItemSku(idx,e.target.value)}}
                          style={{ font:'12px "DM Sans",sans-serif', border:'1px solid #D0CEC6', borderRadius:6, padding:'4px 6px', width:'100%', color:'#1A1916' }}>
                          <option value="">— select SKU —</option>
                          {allSkus.map(function(s){ return <option key={s.id} value={s.id}>{s.courses?.group_name} — {s.level_name}</option> })}
                        </select>
                      ) : (
                        <div style={{ font:'600 11px "DM Sans",sans-serif', color:'#1A1916', lineHeight:1.2 }}>
                          {courseName ? courseName+' — '+levelName : levelName}
                        </div>
                      )}
                      <input type="number" min="1" value={item.ordered_qty||''} onChange={function(e){updateItem(idx,'ordered_qty',e.target.value)}}
                        style={{ textAlign:'right', font:'12px "DM Mono",monospace', border:'1px solid #D0CEC6', borderRadius:6, padding:'4px 6px', width:'100%', color:'#1A1916' }} />
                      <input type="number" min="0" value={item.sent_qty||0} onChange={function(e){updateItem(idx,'sent_qty',e.target.value)}}
                        style={{ textAlign:'right', font:'12px "DM Mono",monospace', border:'1px solid #D0CEC6', borderRadius:6, padding:'4px 6px', width:'100%', color:'#1A1916' }} />
                      <input type="number" min="0" value={item.rate||''} onChange={function(e){updateItem(idx,'rate',e.target.value)}}
                        style={{ textAlign:'right', font:'600 12px "DM Mono",monospace', border:'1px solid #D0CEC6', borderRadius:6, padding:'4px 6px', width:'100%', color:'#534AB7' }} />
                      <button onClick={function(){removeItem(idx)}} style={{ background:'rgba(220,38,38,.1)', color:'#DC2626', border:'none', borderRadius:5, width:26, height:26, cursor:'pointer', font:'700 13px sans-serif', display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
                    </div>
                  )
                })}
                {editItems.length === 0 && (
                  <div style={{ padding:'16px 12px', font:'12px "DM Mono",monospace', color:'#9C9A92', textAlign:'center' }}>No items yet — add one below</div>
                )}
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <button onClick={addItem} style={{ padding:'7px 16px', border:'1.5px dashed #534AB7', borderRadius:8, background:'#EEEDFE', color:'#534AB7', font:'600 12px "DM Sans",sans-serif', cursor:'pointer' }}>+ Add Item</button>
                <div style={{ font:'700 12px "DM Mono",monospace', color:'#534AB7' }}>Subtotal: ₹{fmtAmt(editSubtotal)}</div>
              </div>
            </section>

            {/* ── BILL TO ── */}
            <section>
              <SectionHead color="#D97706" label="Bill To — Invoice Recipient" />
              {(editBillToFr || placer) && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ font:'600 8px "DM Mono",monospace', color:'#9C9A92', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:5 }}>Currently selected</div>
                  <FrCard fr={editBillToFr||placer} selected={true} radio={false} />
                </div>
              )}
              <div style={{ marginBottom:8 }}>
                <div style={{ font:'600 8px "DM Mono",monospace', color:'#9C9A92', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:5 }}>Search &amp; change</div>
                <div style={{ position:'relative' }}>
                  <input value={billSearch} onChange={function(e){setBillSearch(e.target.value)}} placeholder="Type name to search franchisees…"
                    style={{ width:'100%', padding:'8px 32px 8px 10px', border:'1.5px solid #D0CEC6', borderRadius:8, font:'13px "DM Sans",sans-serif', color:'#1A1916', outline:'none', boxSizing:'border-box' }}
                    onFocus={function(e){e.target.style.borderColor='#534AB7'}} onBlur={function(e){e.target.style.borderColor='#D0CEC6'}} />
                  {searching && <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', font:'10px "DM Mono",monospace', color:'#9C9A92' }}>…</span>}
                </div>
              </div>
              {placer && <FrCard fr={placer} selected={editBillToId===placer.id} radio={true} onClick={function(){setEditBillToId(placer.id);setEditBillToFr(placer);setBillSearch('');setBillResults([])}} />}
              {billResults.length > 0 && (
                <div style={{ display:'flex', flexDirection:'column', gap:5, marginTop:6 }}>
                  {billResults.map(function(f){ return <FrCard key={f.id} fr={f} selected={editBillToId===f.id} radio={true} onClick={function(){setEditBillToId(f.id);setEditBillToFr(f);setBillSearch('');setBillResults([])}} /> })}
                </div>
              )}
              {billSearch.length>=2 && !searching && billResults.length===0 && <div style={{ font:'11px "DM Mono",monospace', color:'#9C9A92', padding:'6px 10px' }}>No results for "{billSearch}"</div>}
            </section>

            {/* ── SHIP TO ── */}
            <section>
              <SectionHead color="#16A34A" label="Ship To — Delivery Destination" />
              <p style={{ font:'500 11px "DM Sans",sans-serif', color:'#5C5A54', marginBottom:12, lineHeight:1.5 }}>Where goods will be physically delivered. Leave unset if shipping to the Bill To address.</p>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                <div onClick={function(){setEditShipToId(null)}} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', border:'1.5px solid '+(editShipToId===null?'#534AB7':'#E2E0D8'), borderRadius:9, cursor:'pointer', background:editShipToId===null?'#EEEDFE':'#fff' }}>
                  <div style={{ width:15, height:15, borderRadius:'50%', border:'2px solid '+(editShipToId===null?'#534AB7':'#C0BDB4'), background:editShipToId===null?'#534AB7':'#fff', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    {editShipToId===null && <div style={{ width:5, height:5, borderRadius:'50%', background:'#fff' }} />}
                  </div>
                  <div><div style={{ font:'600 12px "DM Sans",sans-serif', color:'#1A1916' }}>Not specified</div><div style={{ font:'500 9px "DM Mono",monospace', color:'#9C9A92' }}>No separate ship-to on invoice</div></div>
                </div>
                {hierarchy.length > 0 && <div style={{ font:'600 8px "DM Mono",monospace', color:'#9C9A92', textTransform:'uppercase', letterSpacing:'.06em', margin:'4px 0 4px 2px' }}>Deliver to</div>}
                {hierarchy.map(function(hFr){ return <FrCard key={hFr.id} fr={hFr} selected={editShipToId===hFr.id} radio={true} onClick={function(){setEditShipToId(hFr.id)}} /> })}
              </div>
            </section>

            {/* ── CHARGES & NOTES ── */}
            <section>
              <SectionHead color="#534AB7" label="Charges &amp; Notes" />
              <div style={{ marginBottom:16 }}>
                <label style={{ font:'600 8px "DM Mono",monospace', color:'#9C9A92', textTransform:'uppercase', letterSpacing:'.06em', display:'block', marginBottom:5 }}>Courier / Shipping Charges (₹)</label>
                <div style={{ position:'relative', display:'inline-flex', alignItems:'center' }}>
                  <span style={{ position:'absolute', left:9, font:'600 12px "DM Mono",monospace', color:'#9C9A92', pointerEvents:'none' }}>₹</span>
                  <input type="number" min="0" step="1" value={editCourier}
                    onChange={function(e){setEditCourier(parseInt(e.target.value,10)||0)}}
                    style={{ padding:'8px 10px 8px 24px', width:160, border:'1.5px solid #D0CEC6', borderRadius:8, font:'600 13px "DM Mono",monospace', color:'#1A1916', outline:'none' }}
                    onFocus={function(e){e.target.style.borderColor='#534AB7'}} onBlur={function(e){e.target.style.borderColor='#D0CEC6'}} />
                </div>
                <div style={{ font:'500 9px "DM Mono",monospace', color:'#9C9A92', marginTop:4 }}>Grand total will be ₹{fmtAmt(editGrandTotal)}</div>
              </div>
              <div>
                <label style={{ font:'600 8px "DM Mono",monospace', color:'#9C9A92', textTransform:'uppercase', letterSpacing:'.06em', display:'block', marginBottom:5 }}>Invoice Note / Remarks</label>
                <textarea value={editNotes} onChange={function(e){setEditNotes(e.target.value)}} rows={4}
                  placeholder={'e.g. Phonics kits included as part of franchise kit & training books — not charged separately.\ne.g. Rate adjusted as per agreement dated 12 May 2026.'}
                  style={{ width:'100%', padding:'9px 11px', boxSizing:'border-box', border:'1.5px solid #D0CEC6', borderRadius:8, resize:'vertical', font:'13px "DM Sans",sans-serif', color:'#1A1916', lineHeight:1.55, outline:'none' }}
                  onFocus={function(e){e.target.style.borderColor='#534AB7'}} onBlur={function(e){e.target.style.borderColor='#D0CEC6'}} />
                <div style={{ font:'500 9px "DM Mono",monospace', color:'#9C9A92', marginTop:4 }}>Prints on invoice below totals</div>
              </div>
            </section>

          </div>

          {/* sticky footer */}
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', padding:'14px 26px', borderTop:'1px solid #E2E0D8', background:'#F7F6F3', borderRadius:'0 0 16px 16px', flexShrink:0 }}>
            <button onClick={function(){setActiveTab('view')}} style={{ padding:'10px 20px', border:'1px solid #D0CEC6', borderRadius:10, background:'#fff', font:'600 13px "DM Sans",sans-serif', cursor:'pointer', color:'#5C5A54' }}>Discard</button>
            <button onClick={saveEdits} disabled={saving} style={{ padding:'10px 28px', border:'none', borderRadius:10, background:'#534AB7', color:'#fff', font:'700 13px "DM Sans",sans-serif', cursor:'pointer', opacity:saving?.7:1 }}>
              {saving?'Saving…':'✓ Save Changes'}
            </button>
          </div>
        </div>

      ) : (

        /* ══════════ PDF VIEW ══════════ */
        <div id="inv-sheet" style={{ width:'210mm', minHeight:'297mm', background:'#fff', boxShadow:'0 8px 28px rgba(0,0,0,.10)', display:'flex', flexDirection:'column', overflow:'visible', fontFamily:'"DM Sans",system-ui,sans-serif', WebkitPrintColorAdjust:'exact', printColorAdjust:'exact' }}>

          {/* ── COMPACT HEADER ── */}
          <div id="inv-hd-band" style={{ background:'linear-gradient(115deg,#FFF6D9 0%,#FFE89B 45%,#FFD234 80%,#FFB347 100%)', padding:'10px 20px 0', position:'relative', overflow:'hidden', flexShrink:0 }}>
            <svg style={{ position:'absolute', left:0, right:0, bottom:-1, width:'100%', height:20, pointerEvents:'none' }} viewBox="0 0 800 20" preserveAspectRatio="none">
              <path d="M0 20 L0 12 Q100 2,200 11 T400 11 T600 11 T800 12 L800 20 Z" fill="#fff" />
            </svg>
            <div style={{ display:'grid', gridTemplateColumns:'68px 1fr auto', alignItems:'center', gap:12, position:'relative', zIndex:2 }}>
              {/* Logo */}
              <div style={{ width:68, height:68, background:'#fff', borderRadius:10, padding:4, boxShadow:'0 3px 10px rgba(217,119,6,.2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <img src="/NLH%20Logo.png" alt="NLH" style={{ width:'100%', height:'100%', objectFit:'contain' }} />
              </div>
              {/* Title */}
              <div style={{ textAlign:'center' }}>
                <div style={{ font:'800 48px "DM Sans",sans-serif', color:'#1E40AF', letterSpacing:'-.02em', lineHeight:1, marginBottom:2 }}>INVOICE</div>
                <div style={{ font:'700 8px "DM Mono",monospace', color:'#D97706', textTransform:'uppercase', letterSpacing:'.2em' }}>Tax Invoice · Original Copy</div>
              </div>
              {/* Address */}
              <div style={{ textAlign:'right' }}>
                <span style={{ display:'inline-flex', alignItems:'center', gap:5, background:'#1E40AF', color:'#fff', padding:'3px 10px 3px 7px', borderRadius:20, font:'700 7.5px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:4, whiteSpace:'nowrap' }}>
                  <span style={{ width:5, height:5, borderRadius:'50%', background:'#FBBF24', display:'inline-block' }} />Head Office
                </span>
                <div style={{ font:'700 12px "DM Sans",sans-serif', color:'#1A1916', lineHeight:1.2 }}>New Learning Horizons</div>
                <div style={{ font:'500 8px "DM Sans",sans-serif', color:'#1A1916', lineHeight:1.6, marginTop:3 }}>
                  <div>9, Anjuman Shopping Complex, Residency Rd, Sadar, Nagpur 440 001</div>
                  <div>☎ +91 9373 111 311 · ✉ dhiral@nlhnagpur.info</div>
                </div>
              </div>
            </div>
          </div>

          {/* ── TAGLINE ── */}
          <div id="inv-hd-tag" style={{ background:'linear-gradient(90deg,#534AB7,#6F66CC)', color:'#fff', textAlign:'center', padding:'5px 20px', font:'600 8px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.14em', flexShrink:0 }}>
            New Learning Horizons · ISO 9001:2015 Certified · Enriching Children's Future
          </div>

          {/* ── META ── */}
          <div id="inv-hd-meta" style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', background:'#F7F6F3', borderBottom:'1px solid #E2E0D8', padding:'8px 20px', gap:10, flexShrink:0 }}>
            {[
              { lbl:'Invoice no.', val:order.invoice_no||'DRAFT', mono:true },
              { lbl:'Order ref.',  val:order.order_ref||('ORD-'+String(order.id).slice(0,8).toUpperCase()), mono:true },
              { lbl:'Issue date',  val:fmtDateLong(order.invoiced_at||order.created_at) },
              { lbl:'Due date',    val:dueDateStr(order.invoiced_at||order.created_at), status:payStatus },
            ].map(function(c,i) {
              return (
                <div key={i} style={{ display:'flex', flexDirection:'column', gap:2 }}>
                  <span style={{ font:'600 7.5px "DM Mono",monospace', color:'#9C9A92', textTransform:'uppercase', letterSpacing:'.07em' }}>{c.lbl}</span>
                  <span style={{ font:c.mono?'700 11px "DM Mono",monospace':'700 11px "DM Sans",sans-serif', color:'#1A1916' }}>{c.val}</span>
                  {c.status && (
                    <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 8px', borderRadius:20, font:'700 8px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.07em', alignSelf:'flex-start', marginTop:1,
                      background:c.status==='paid'?'#E6F5ED':c.status==='part'?'#FEF3E0':'rgba(220,38,38,.1)',
                      color:c.status==='paid'?'#1D7A4F':c.status==='part'?'#8A5200':'#A32D2D' }}>
                      <span style={{ width:5, height:5, borderRadius:'50%', background:'currentColor', display:'inline-block' }} />
                      {c.status==='paid'?'Paid':c.status==='part'?'Part Paid':'Unpaid'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── BODY ── */}
          <div id="inv-body" style={{ padding:'10px 20px 14px', flex:1, display:'flex', flexDirection:'column', gap:8 }}>

            {/* parties */}
            <div id="inv-parties" style={{ display:'grid', gridTemplateColumns:shipFr?'1fr 1fr 1fr':'1fr 1fr', gap:8, breakInside:'avoid' }}>
              {[
                { lbl:'From', bg:'#EEEDFE', border:'#534AB7', badgeColor:'#534AB7', badge:'Head Office',
                  name:'New Learning Horizons',
                  address:'9, Anjuman Shopping Complex, Residency Rd, Sadar, Nagpur 440 001',
                  phone:'9373 111 311', email:'dhiral@nlhnagpur.info' },
                { lbl:'Bill to', bg:'linear-gradient(135deg,#FFF7DA,#FFEAA0)', border:'#F59E0B', badgeColor:'#D97706',
                  badge:fr.tier||'UF', name:fr.business_name||'—',
                  address:[fr.address,fr.area,[fr.city,fr.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
                  phone:fr.phone, email:fr.email },
                shipFr ? { lbl:'Ship to', bg:'linear-gradient(135deg,#E6F5ED,#C6EDD8)', border:'#16A34A', badgeColor:'#16A34A',
                  badge:shipFr.tier||'UF', name:shipFr.business_name||'—',
                  address:[shipFr.address,[shipFr.city,shipFr.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
                  phone:shipFr.phone, email:shipFr.email, note:'Goods dispatched here' } : null,
              ].filter(Boolean).map(function(p,i) {
                return (
                  <div key={i} style={{ borderRadius:10, padding:'9px 12px 24px', background:p.bg, position:'relative', overflow:'hidden', minHeight:104 }}>
                    <div style={{ position:'absolute', top:0, bottom:0, left:0, width:3, background:p.border }} />
                    {/* label + phone (bold) on one line */}
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:5 }}>
                      <span style={{ font:'700 7.5px "DM Mono",monospace', color:p.border, textTransform:'uppercase', letterSpacing:'.1em' }}>{p.lbl}</span>
                      {p.phone && <span style={{ font:'700 11px "DM Sans",sans-serif', color:'#1A1916', whiteSpace:'nowrap' }}>☎ {p.phone}</span>}
                    </div>
                    {/* badge inline before the name */}
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3, flexWrap:'wrap' }}>
                      {p.badge && <span style={{ background:'rgba(0,0,0,.08)', color:p.badgeColor, padding:'2px 8px', borderRadius:20, font:'700 8px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.04em', flexShrink:0 }}>{p.badge}</span>}
                      <span style={{ font:'700 12px "DM Sans",sans-serif', color:'#1A1916', lineHeight:1.2 }}>{p.name}</span>
                    </div>
                    {/* address */}
                    <div style={{ font:'500 9px "DM Mono",monospace', color:'#5C5A54', lineHeight:1.55 }}>{p.address}</div>
                    {p.note && <div style={{ font:'700 8px "DM Mono",monospace', color:p.badgeColor, textTransform:'uppercase', marginTop:3 }}>{p.note}</div>}
                    {/* email pinned to the bottom-left corner */}
                    {p.email && <div style={{ position:'absolute', left:12, bottom:7, font:'500 9px "DM Mono",monospace', color:'#5C5A54', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'calc(100% - 18px)' }}>✉ {p.email}</div>}
                  </div>
                )
              })}
            </div>

            {/* items table — stretches to fill the page; flows to next page when long */}
            <div id="inv-items" style={{ border:'1px solid #E2E0D8', borderRadius:10, overflow:'visible', flex:1, display:'flex', flexDirection:'column', position:'relative' }}>
              {/* mascot watermark — low in the empty area; rows are transparent so nothing covers it */}
              <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'flex-end', justifyContent:'center', paddingBottom:30, pointerEvents:'none', zIndex:0 }}>
                <img src="/NLH%20Mascot.png" alt="" style={{ width:'46%', maxWidth:300, opacity:0.18, objectFit:'contain' }} />
              </div>
              <div id="inv-itemshead" style={{ position:'relative', zIndex:1, background:'linear-gradient(90deg,#534AB7,#6F66CC)', color:'#fff', padding:'9px 14px', display:'grid', gridTemplateColumns:'30px 1fr 52px 52px 80px 100px', gap:10, font:'700 10px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.07em' }}>
                <div>#</div><div>SKU / Item</div>
                <div style={{textAlign:'right'}}>Ord</div>
                <div style={{textAlign:'right'}}>Sent</div>
                <div style={{textAlign:'right'}}>Rate</div>
                <div style={{textAlign:'right'}}>Amount</div>
              </div>
              {items.map(function(item, i) {
                const course = item.skus?.courses?.group_name||''
                const level  = item.skus?.level_name||item.inventory_items?.name||item.sku_id||'—'
                const name   = course?course+' — '+level:level
                const lineAmt = (item.rate||0)*(item.ordered_qty||0)
                const sent    = item.sent_qty||0
                return (
                  <div key={item.id} className="inv-row" style={{ position:'relative', zIndex:1, breakInside:'avoid', display:'grid', gridTemplateColumns:'30px 1fr 52px 52px 80px 100px', gap:10, padding:'9px 14px', borderBottom:i<items.length-1?'1px solid #E2E0D8':'none', background:'transparent', alignItems:'center' }}>
                    <div style={{ font:'600 10px "DM Mono",monospace', color:'#9C9A92' }}>{String(i+1).padStart(2,'0')}</div>
                    <div>
                      <div style={{ font:'600 13px "DM Sans",sans-serif', color:'#1A1916', lineHeight:1.25 }}>{name}</div>
                      {item.sku_id && kitMap[item.sku_id] && kitMap[item.sku_id].length > 0 && (
                        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 6px', marginTop:4 }}>
                          <span style={{ font:'700 9px "DM Mono",monospace', color:'#9C8BD9', textTransform:'uppercase', letterSpacing:'.06em', alignSelf:'center' }}>Kit:</span>
                          {kitMap[item.sku_id].map(function(k, ki) {
                            const notSent = (item.excluded_kit_items || []).includes(k.item_id)
                            return (
                              <span key={ki} style={{ font:'600 10px "DM Mono",monospace', color:notSent?'#B0ADA4':'#534AB7', background:notSent?'#F0EFEC':'#EEEDFE', borderRadius:4, padding:'2px 7px', whiteSpace:'nowrap', textDecoration:notSent?'line-through':'none' }}>
                                {k.name}{k.quantity > 1 ? ' ×' + k.quantity : ''}{notSent ? ' · not sent' : ''}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign:'right', font:'500 12.5px "DM Mono",monospace', color:'#5C5A54' }}>{item.ordered_qty||0}</div>
                    <div style={{ textAlign:'right', font:'500 12.5px "DM Mono",monospace', color:sent===item.ordered_qty?'#16A34A':'#5C5A54', fontWeight:sent===item.ordered_qty?700:500 }}>{sent}</div>
                    <div style={{ textAlign:'right', font:'500 12.5px "DM Mono",monospace', color:'#5C5A54' }}>₹{fmtAmt(item.rate||0)}</div>
                    <div style={{ textAlign:'right', font:'700 13.5px "DM Mono",monospace', color:'#1A1916' }}>₹{fmtAmt(lineAmt)}</div>
                  </div>
                )
              })}
            </div>

            {/* payment + totals */}
            <div id="inv-summary" style={{ display:'grid', gridTemplateColumns:'1.1fr 1fr', gap:8, breakInside:'avoid' }}>
              {/* payment */}
              <div style={{ background:'linear-gradient(135deg,#FFF7DA,#FFE89B)', borderRadius:10, padding:'10px 12px', position:'relative', overflow:'hidden', display:'flex', flexDirection:'column' }}>
                <div style={{ position:'absolute', top:0, bottom:0, left:0, width:3, background:'#F59E0B' }} />
                <div style={{ font:'700 7.5px "DM Mono",monospace', color:'#D97706', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:3 }}>Payment Details</div>
                <div style={{ font:'500 9px "DM Mono",monospace', color:'#5C5A54', marginBottom:8, letterSpacing:'.02em' }}>NEFT / IMPS / UPI accepted</div>
                <div style={{ background:'#fff', borderRadius:8, padding:'14px 16px', display:'grid', gridTemplateColumns:'1fr 130px', gap:14, boxShadow:'0 1px 3px rgba(0,0,0,.06)', alignItems:'center' }}>
                  <div>
                    <div style={{ font:'700 12.5px "DM Sans",sans-serif', color:'#1E40AF', marginBottom:10 }}>🏦 IDFC First Bank</div>
                    <div style={{ font:'500 10px "DM Mono",monospace', color:'#5C5A54', marginBottom:10 }}>Byramji Town Branch, Nagpur</div>
                    <div style={{ display:'grid', gridTemplateColumns:'42px 1fr', gap:'9px 10px', alignItems:'center' }}>
                      <span style={{ color:'#9C9A92', textTransform:'uppercase', font:'600 9px "DM Mono",monospace' }}>A/C</span>
                      <span style={{ color:'#1A1916', font:'700 15px "DM Mono",monospace', letterSpacing:'.03em' }}>10278096847</span>
                      <span style={{ color:'#9C9A92', textTransform:'uppercase', font:'600 9px "DM Mono",monospace' }}>IFSC</span>
                      <span style={{ color:'#1A1916', font:'700 15px "DM Mono",monospace', letterSpacing:'.03em' }}>IDFB0042504</span>
                    </div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
                    <div style={{ font:'700 8px "DM Mono",monospace', color:'#1E40AF', textTransform:'uppercase', letterSpacing:'.08em', textAlign:'center' }}>Scan &amp; Pay</div>
                    <img src="/nlh-upi-qr.png" alt="QR" style={{ width:124, height:124, background:'#fff', borderRadius:6, padding:4, border:'2px solid #1E40AF', objectFit:'contain' }} />
                  </div>
                </div>
                {/* UPI — full-width strip at the bottom of the payment box */}
                <div style={{ marginTop:'auto', paddingTop:8 }}>
                  <div style={{ background:'#EEEDFE', borderRadius:7, padding:'8px 12px', font:'700 11px "DM Mono",monospace', color:'#534AB7', textAlign:'center', letterSpacing:'.01em' }}>📱 UPI: newlearninghorizons@idfcbank</div>
                </div>
              </div>

              {/* totals */}
              <div style={{ background:'#EEEDFE', borderRadius:10, padding:'12px 14px', position:'relative', overflow:'hidden', display:'flex', flexDirection:'column' }}>
                <div style={{ position:'absolute', top:0, bottom:0, left:0, width:3, background:'#534AB7' }} />
                <div style={{ font:'700 9px "DM Mono",monospace', color:'#534AB7', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:8 }}>Invoice Summary</div>
                {[
                  { l:'Kit subtotal',    v:'₹'+fmtAmt(subtotal) },
                  { l:'Courier charges', v:liveCourier>0?'₹'+fmtAmt(liveCourier):'—' },
                  ...(discount>0 ? [{ l:'Discount'+(order.coupon_code?' ('+order.coupon_code+')':''), v:'− ₹'+fmtAmt(discount), green:true }] : []),
                  { l:'Amount paid',     v:amtPaid>0?'₹'+fmtAmt(amtPaid):'—', muted:amtPaid===0 },
                ].map(function(row,i) {
                  return (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px dashed rgba(83,74,183,.2)' }}>
                      <span style={{ font:'500 12px "DM Sans",sans-serif', color:'#5C5A54' }}>{row.l}</span>
                      <span style={{ font:'600 12px "DM Mono",monospace', color:row.green?'#1D7A4F':(row.muted?'#9C9A92':'#1A1916'), fontWeight:row.muted?400:600 }}>{row.v}</span>
                    </div>
                  )
                })}
                {balance > 0 && (
                  <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px dashed rgba(83,74,183,.2)' }}>
                    <span style={{ font:'500 12px "DM Sans",sans-serif', color:'#5C5A54' }}>Balance due</span>
                    <span style={{ font:'600 12px "DM Mono",monospace', color:balance>0?'#A32D2D':'#1D7A4F' }}>₹{fmtAmt(balance)}</span>
                  </div>
                )}
                <div style={{ marginTop:'auto', paddingTop:12 }}>
                  <div style={{ background:'linear-gradient(135deg,#534AB7,#6F66CC)', borderRadius:8, padding:'14px 16px', display:'flex', justifyContent:'space-between', alignItems:'baseline', color:'#fff', boxShadow:'0 4px 14px rgba(83,74,183,.2)' }}>
                    <div style={{ font:'700 10px "DM Mono",monospace', textTransform:'uppercase', letterSpacing:'.12em' }}>Grand Total</div>
                    <div style={{ font:'800 26px "DM Sans",sans-serif', letterSpacing:'-.01em', lineHeight:1 }}>
                      <span style={{ font:'700 13px "DM Sans",sans-serif', marginRight:3, opacity:.85 }}>₹</span>{fmtAmt(liveGrandTotal)}
                    </div>
                  </div>
                  <div style={{ marginTop:8, font:'500 9px "DM Mono",monospace', color:'#7A75A0', lineHeight:1.5, textTransform:'uppercase', letterSpacing:'.03em' }}>
                    In words: <b style={{ color:'#534AB7' }}>{numToWords(liveGrandTotal)}</b>
                  </div>
                </div>
              </div>
            </div>

            {/* dispatch details */}
            {(order.awb_number || order.dispatched_at) && (
              <div style={{ border:'1.5px solid #D1FAE5', borderRadius:9, padding:'9px 12px', background:'#F0FDF4', position:'relative', overflow:'hidden' }}>
                <div style={{ position:'absolute', top:0, bottom:0, left:0, width:3, background:'#16A34A' }} />
                <div style={{ font:'700 7.5px "DM Mono",monospace', color:'#16A34A', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:5 }}>📦 Dispatch Info</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:'6px 20px', font:'500 9.5px "DM Mono",monospace', color:'#1A1916' }}>
                  {order.courier_partner && (
                    <span><span style={{ color:'#9C9A92', marginRight:4 }}>Courier</span>{order.courier_partner}</span>
                  )}
                  {order.awb_number && (
                    <span><span style={{ color:'#9C9A92', marginRight:4 }}>AWB</span><b>{order.awb_number}</b></span>
                  )}
                  {order.dispatch_date && (
                    <span><span style={{ color:'#9C9A92', marginRight:4 }}>Date</span>{order.dispatch_date}</span>
                  )}
                  {order.dispatch_weight != null && (
                    <span><span style={{ color:'#9C9A92', marginRight:4 }}>Weight</span>{order.dispatch_weight} kg</span>
                  )}
                  {order.dispatch_freight > 0 && (
                    <span><span style={{ color:'#9C9A92', marginRight:4 }}>Freight</span>₹{fmtAmt(order.dispatch_freight)}</span>
                  )}
                </div>
              </div>
            )}

            {/* notes */}
            {liveNotes && (
              <div style={{ border:'1.5px solid #E2E0D8', borderRadius:9, padding:'9px 12px', background:'#FAFAF8', position:'relative', overflow:'hidden' }}>
                <div style={{ position:'absolute', top:0, bottom:0, left:0, width:3, background:'#9C9A92' }} />
                <div style={{ font:'700 7.5px "DM Mono",monospace', color:'#9C9A92', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:4 }}>Note / Remarks</div>
                <div style={{ font:'500 10px "DM Sans",sans-serif', color:'#3D3B35', lineHeight:1.6, whiteSpace:'pre-wrap' }}>{liveNotes}</div>
              </div>
            )}

          </div>

          {/* ── COMPACT FOOTER — thank you + computer-generated note ── */}
          <div id="inv-foot" style={{ background:'linear-gradient(115deg,#FFE89B,#FFD234)', padding:'10px 20px', position:'relative', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexShrink:0 }}>
            <div style={{ font:'800 15px "DM Sans",sans-serif', color:'#1E40AF', letterSpacing:'-.01em' }}>Thank you for your order!</div>
            <div style={{ font:'600 7.5px "DM Mono",monospace', color:'#5B3A00', textTransform:'uppercase', letterSpacing:'.06em', textAlign:'right' }}>Computer generated invoice · No signature required</div>
          </div>

        </div>
      )}
    </div>
  )
}
