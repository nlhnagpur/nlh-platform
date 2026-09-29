import { sb } from '../supabase'

// Sale Return — for every order_items line marked fulfilled_by_franchisee_id
// (that franchisee supplied it from their own stock instead of HO), raises
// an already-approved franchisee_stock_returns credit valued at what they
// actually paid HO for it (their own most recent purchase of that SKU).
// Fully automated end to end — no manual approval step; the DB trigger
// assigns the SR-YYYY-NNNN number immediately since the row is inserted
// pre-approved. To correct one, use cancelStockReturn below (never edit the
// row directly — the whole point of cancelling is that it's audited and it
// also unwinds the matching stock correction below). Idempotent per order,
// same as the stock deduction it runs alongside — never blocks the invoice
// action itself.
//
// Shared between OrdersPage.jsx (InvoiceEditModal, invoice/proforma-convert
// handlers, DispatchModal fallback) and InvoiceView.jsx's own Edit tab —
// pulled out to its own module so both can call it without OrdersPage.jsx
// and InvoiceView.jsx importing each other (OrdersPage already imports
// InvoiceView as the "PDF" action's modal).
export async function createPendingStockReturns(order) {
  const { data: lines } = await sb.from('order_items')
    .select('id, sku_id, ordered_qty, fulfilled_by_franchisee_id').eq('order_id', order.id)
    .not('fulfilled_by_franchisee_id', 'is', null)
  if (!lines || !lines.length) return

  // Idempotent PER LINE, and only against a still-live return — not the whole
  // order, and not against a cancelled one. A line-level check means
  // clearing a line's "Fulfilled by" (which cancels its return — see
  // cancelStockReturn) and later re-marking it correctly regenerates a fresh
  // return instead of silently doing nothing because *some* row exists
  // somewhere on the order.
  const { data: liveOnOrder } = await sb.from('franchisee_stock_returns')
    .select('fulfills_order_item_id, sku_id').eq('fulfills_order_id', order.id).eq('status', 'approved')
  const liveLineIds = new Set((liveOnOrder || []).map(function (r) { return r.fulfills_order_item_id }).filter(Boolean))
  const liveSkuIds = new Set((liveOnOrder || []).filter(function (r) { return !r.fulfills_order_item_id }).map(function (r) { return r.sku_id }))

  // Has HO stock already been deducted for this order? If so, that
  // deduction assumed every line was HO-supplied — a line reassigned to a
  // franchisee's own stock AFTER that point over-deducted HO's stock by
  // exactly this line's components, and needs a compensating entry now
  // rather than someone noticing and fixing it by hand later (the exact
  // gap that let SR-2026-0003 drift out of sync with reality).
  const { data: alreadyDeducted } = await sb.from('stock_ledger').select('id').eq('ref_type', 'order').eq('ref_id', order.id).limit(1)
  const stockAlreadyOut = !!(alreadyDeducted && alreadyDeducted.length)

  for (const line of lines) {
    if (liveLineIds.has(line.id) || liveSkuIds.has(line.sku_id)) continue
    // What this franchisee actually paid HO for this SKU — their own most
    // recent order line for it, so the credit reflects a real transaction,
    // not a rate that may have since changed.
    // Excludes the order being processed itself — the fulfilling
    // franchisee can also be that order's own placer (a CF ordering on a
    // school's behalf, same as this exact case), which would otherwise
    // let the lookup circularly reference the very line it's crediting.
    const { data: source } = await sb.from('order_items')
      .select('id, order_id, rate, orders!inner(placer_id, created_at)')
      .eq('sku_id', line.sku_id).eq('orders.placer_id', line.fulfilled_by_franchisee_id)
      .neq('order_id', order.id)
      .order('created_at', { foreignTable: 'orders', ascending: false }).limit(1).maybeSingle()
    const unitValue = source?.rate || 0
    const { data: sr, error: srErr } = await sb.from('franchisee_stock_returns').insert({
      returning_franchisee_id: line.fulfilled_by_franchisee_id,
      sku_id: line.sku_id, qty: line.ordered_qty, unit_value: unitValue,
      total_credit: unitValue * line.ordered_qty,
      source_order_id: source?.order_id || null, source_order_item_id: source?.id || null,
      fulfills_order_id: order.id, fulfills_order_item_id: line.id,
      status: 'approved', requested_by: 'system (auto)', approved_by: 'system (auto)',
    }).select().single()
    if (srErr || !sr) continue

    if (stockAlreadyOut) {
      const { data: kits } = await sb.from('kit_items').select('item_id, quantity').eq('sku_id', line.sku_id)
      if (kits && kits.length) {
        await sb.from('stock_ledger').insert(kits.map(function (k) {
          return {
            item_id: k.item_id, location_type: 'ho', movement_type: 'adjustment',
            qty: line.ordered_qty * Number(k.quantity || 1),
            ref_type: 'sale_return', ref_id: sr.id,
            note: 'Stock kept by HO — ' + (sr.return_no || 'Sale Return') + ' reassigned this line to the franchisee’s own stock after HO’s stock was already deducted',
          }
        }))
      }
    }
  }
}

// Reverses a Sale Return: drops the credit from the ledger (franchiseeLedger
// only sums status='approved' rows, so a cancelled row is simply excluded —
// nothing else to touch there) and, if this return had posted a compensating
// stock entry (see above), posts the exact opposite so HO's stock is right
// again. Returns created before this existed have no linked stock entry to
// reverse automatically — those need a manual stock correction alongside.
export async function cancelStockReturn(sr, reason, cancelledBy) {
  const { data: compEntries } = await sb.from('stock_ledger').select('item_id, qty').eq('ref_type', 'sale_return').eq('ref_id', sr.id)

  // If this credit was applied against an invoice (see applyCreditToOrder),
  // pull that payment back out first — otherwise the invoice would stay
  // showing as paid/part-paid for a credit that no longer exists.
  if (sr.applied_order_payment_id) {
    const { error: delErr } = await sb.from('order_payments').delete().eq('id', sr.applied_order_payment_id)
    if (delErr) throw new Error('Could not reverse the invoice credit: ' + delErr.message)
  }

  const { error } = await sb.from('franchisee_stock_returns')
    .update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: cancelledBy || null, cancel_reason: (reason || '').trim() || null,
      applied_order_id: null, applied_order_payment_id: null, applied_amount: null,
    })
    .eq('id', sr.id)
  if (error) throw error

  if (compEntries && compEntries.length) {
    await sb.from('stock_ledger').insert(compEntries.map(function (e) {
      return {
        item_id: e.item_id, location_type: 'ho', movement_type: 'adjustment', qty: -e.qty,
        ref_type: 'sale_return', ref_id: sr.id,
        note: 'Reversing ' + (sr.return_no || 'Sale Return') + ' (cancelled)' + (reason ? ': ' + reason : ''),
      }
    }))
    return { stockReversed: true }
  }
  return { stockReversed: false }
}

// Live (non-cancelled) returns tied to a specific order line's "Fulfilled by"
// flag — used to warn/confirm before that flag is cleared or reassigned,
// since doing so should cancel the return, not leave it behind uncredited-for.
export async function liveReturnsForLine(orderId, orderItemId, skuId) {
  const { data } = await sb.from('franchisee_stock_returns')
    .select('*, franchisees:returning_franchisee_id(business_name)')
    .eq('status', 'approved').eq('kind', 'cf_fulfillment')
    .or('fulfills_order_item_id.eq.' + orderItemId + ',and(fulfills_order_item_id.is.null,fulfills_order_id.eq.' + orderId + ',sku_id.eq.' + skuId + ')')
  return data || []
}

// Applies an approved, not-yet-applied return's credit against a specific
// invoice — same mechanism as Record Payment (an order_payments row; the DB
// trigger recomputes that order's amount_paid/status automatically), so the
// invoice stops showing a balance due instead of the credit sitting unused
// in the franchisee's general ledger. Caps at the invoice's own balance —
// any leftover stays as ledger credit, applicable elsewhere later.
export async function applyCreditToOrder(sr, orderId, appliedBy) {
  const { data: order, error: oErr } = await sb.from('orders').select('id, grand_total, amount_paid').eq('id', orderId).single()
  if (oErr || !order) throw new Error(oErr ? oErr.message : 'Invoice not found')
  const balance = Math.max(0, (order.grand_total || 0) - (order.amount_paid || 0))
  const amount = Math.min(sr.total_credit, balance)
  if (amount <= 0) throw new Error('That invoice has no balance due to apply this credit against.')

  const { data: payment, error: pErr } = await sb.from('order_payments').insert({
    order_id: orderId, amount: amount, mode: 'credit_note',
    reference: sr.return_no || null, note: 'Credit from Sale Return ' + (sr.return_no || sr.id),
    recorded_by: appliedBy || null,
  }).select().single()
  if (pErr) throw pErr

  const { error: uErr } = await sb.from('franchisee_stock_returns')
    .update({ applied_order_id: orderId, applied_order_payment_id: payment.id, applied_amount: amount })
    .eq('id', sr.id)
  if (uErr) throw uErr
  return amount
}

// Manual entry for a genuine physical return — a franchisee ships a kit/book
// back to HO. Unlike createPendingStockReturns above, this isn't fulfilling
// anyone else's order (fulfills_order_id stays null); it's just goods coming
// back into HO's own stock, with a credit to whoever sent them back. addBack
// controls whether the physical stock is actually usable again (uncheck for
// a damaged/unsellable return that still merits a credit).
export async function createManualStockReturn(opts) {
  const { franchiseeId, skuId, qty, unitValue, reason, addBack, createdBy, applyToOrderId } = opts
  const { data: sr, error } = await sb.from('franchisee_stock_returns').insert({
    returning_franchisee_id: franchiseeId, sku_id: skuId, qty: qty, unit_value: unitValue,
    total_credit: qty * unitValue, kind: 'physical_return', reason: (reason || '').trim() || null,
    fulfills_order_id: null, status: 'approved', requested_by: createdBy || null, approved_by: createdBy || null,
  }).select().single()
  if (error) throw error

  if (applyToOrderId) {
    try { await applyCreditToOrder(sr, applyToOrderId, createdBy) } catch (e) { console.warn('[sale return] could not apply to invoice:', e.message) }
  }

  if (addBack) {
    const { data: kits } = await sb.from('kit_items').select('item_id, quantity').eq('sku_id', skuId)
    if (kits && kits.length) {
      await sb.from('stock_ledger').insert(kits.map(function (k) {
        return {
          item_id: k.item_id, location_type: 'ho', movement_type: 'receipt',
          qty: qty * Number(k.quantity || 1), ref_type: 'sale_return', ref_id: sr.id,
          note: (sr.return_no || 'Sale Return') + ' — kit returned to HO',
        }
      }))
    }
  }
  return sr
}
