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
    .select('id, sku_id, ordered_qty, fulfilled_by_franchisee_id, excluded_kit_items').eq('order_id', order.id)
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

  // One voucher (return_no) per fulfilling franchisee on this order, covering
  // every line they supplied — mirrors one invoice covering many order_items
  // — rather than a separate SR number per line.
  const pending = lines.filter(function (line) { return !liveLineIds.has(line.id) && !liveSkuIds.has(line.sku_id) })
  const byFranchisee = {}
  pending.forEach(function (l) { (byFranchisee[l.fulfilled_by_franchisee_id] = byFranchisee[l.fulfilled_by_franchisee_id] || []).push(l) })

  for (const fid of Object.keys(byFranchisee)) {
    const { data: returnNo } = await sb.rpc('next_sale_return_no')
    for (const line of byFranchisee[fid]) {
      // What this franchisee actually paid HO for this SKU — their own most
      // recent order line for it, so the credit reflects a real transaction,
      // not a rate that may have since changed.
      // Excludes the order being processed itself — the fulfilling
      // franchisee can also be that order's own placer (a CF ordering on a
      // school's behalf, same as this exact case), which would otherwise
      // let the lookup circularly reference the very line it's crediting.
      const { data: source } = await sb.from('order_items')
        .select('id, order_id, rate, orders!inner(placer_id, created_at)')
        .eq('sku_id', line.sku_id).eq('orders.placer_id', fid)
        .neq('order_id', order.id)
        .order('created_at', { foreignTable: 'orders', ascending: false }).limit(1).maybeSingle()
      const unitValue = source?.rate || 0
      const { data: sr, error: srErr } = await sb.from('franchisee_stock_returns').insert({
        return_no: returnNo || null,
        returning_franchisee_id: fid,
        sku_id: line.sku_id, qty: line.ordered_qty, unit_value: unitValue,
        total_credit: unitValue * line.ordered_qty,
        source_order_id: source?.order_id || null, source_order_item_id: source?.id || null,
        fulfills_order_id: order.id, fulfills_order_item_id: line.id,
        status: 'approved', requested_by: 'system (auto)', approved_by: 'system (auto)',
      }).select().single()
      if (srErr || !sr) continue

      if (stockAlreadyOut) {
        // Only the components this line actually asked HO for in the first
        // place (computeOrderStockNeed's own exclusion filter) were ever
        // deducted — a component unchecked as "not sent" (e.g. a reusable
        // bag the school already has) was never taken from HO's stock, so
        // there's nothing to hand back for it. Compensating for the full kit
        // regardless of exclusions would fabricate stock HO never lost.
        const excluded = line.excluded_kit_items || []
        const { data: kits } = await sb.from('kit_items').select('item_id, quantity').eq('sku_id', line.sku_id)
        const included = (kits || []).filter(function (k) { return !excluded.includes(k.item_id) })
        if (included.length) {
          await sb.from('stock_ledger').insert(included.map(function (k) {
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
}

// A "voucher" is every row sharing one return_no — one per SKU line, the same
// way order_items lines share one order/invoice. Fetches the group given any
// one row or just the return_no.
export async function fetchReturnGroup(returnNo) {
  const { data } = await sb.from('franchisee_stock_returns')
    .select('*, franchisees!franchisee_stock_returns_returning_franchisee_id_fkey(business_name, tier, phone, email, address, area, city, state), skus(level_name, courses(group_name)), ' +
      'orders!franchisee_stock_returns_fulfills_order_id_fkey(order_ref, invoice_no, invoiced_at, created_at, placer:franchisees!orders_placer_id_fkey(business_name), bill_to_fr:franchisees!orders_bill_to_franchisee_id_fkey(business_name)), ' +
      'applied_order:orders!franchisee_stock_returns_applied_order_id_fkey(order_ref, invoice_no)')
    .eq('return_no', returnNo).order('created_at')
  return data || []
}

// Reverses a Sale Return voucher (every line sharing its return_no that's
// still approved): drops the credit from the ledger (franchiseeLedger only
// sums status='approved' rows, so a cancelled one is simply excluded),
// reverses any compensating stock entry each line posted, and — if the
// voucher's credit had been applied against an invoice (see
// applyCreditToOrder) — deletes that payment so the invoice's balance goes
// back up too. Accepts either one row or an array of rows from the same
// voucher; either way every live row in the group is cancelled together.
export async function cancelStockReturn(srOrRows, reason, cancelledBy) {
  const rows = Array.isArray(srOrRows) ? srOrRows : await fetchReturnGroup(srOrRows.return_no)
  const live = rows.filter(function (r) { return r.status === 'approved' })
  if (!live.length) return { stockReversed: false }

  const paymentIds = new Set(live.map(function (r) { return r.applied_order_payment_id }).filter(Boolean))
  for (const paymentId of paymentIds) {
    const { error: delErr } = await sb.from('order_payments').delete().eq('id', paymentId)
    if (delErr) throw new Error('Could not reverse the invoice credit: ' + delErr.message)
  }

  const ids = live.map(function (r) { return r.id })
  const { error } = await sb.from('franchisee_stock_returns')
    .update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: cancelledBy || null, cancel_reason: (reason || '').trim() || null,
      applied_order_id: null, applied_order_payment_id: null, applied_amount: null,
    })
    .in('id', ids)
  if (error) throw error

  const { data: compEntries } = await sb.from('stock_ledger').select('item_id, qty, ref_id').eq('ref_type', 'sale_return').in('ref_id', ids)
  if (compEntries && compEntries.length) {
    await sb.from('stock_ledger').insert(compEntries.map(function (e) {
      return {
        item_id: e.item_id, location_type: 'ho', movement_type: 'adjustment', qty: -e.qty,
        ref_type: 'sale_return', ref_id: e.ref_id,
        note: 'Reversing ' + (live[0].return_no || 'Sale Return') + ' (cancelled)' + (reason ? ': ' + reason : ''),
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

// Applies an approved, not-yet-applied return voucher's TOTAL credit (summed
// across every line sharing its return_no) against a specific invoice — same
// mechanism as Record Payment (an order_payments row; the DB trigger
// recomputes that order's amount_paid/status automatically), so the invoice
// stops showing a balance due instead of the credit sitting unused in the
// franchisee's general ledger. Caps at the invoice's own balance — any
// leftover stays as ledger credit, applicable elsewhere later. Stamps every
// line in the group with the same applied_order_payment_id, so cancelling
// any one of them (or the whole voucher) finds and reverses it.
export async function applyCreditToOrder(srOrRows, orderId, appliedBy) {
  const rows = Array.isArray(srOrRows) ? srOrRows : await fetchReturnGroup(srOrRows.return_no)
  const live = rows.filter(function (r) { return r.status === 'approved' })
  const totalCredit = live.reduce(function (s, r) { return s + (r.total_credit || 0) }, 0)
  const returnNo = live[0] && live[0].return_no

  const { data: order, error: oErr } = await sb.from('orders').select('id, grand_total, amount_paid').eq('id', orderId).single()
  if (oErr || !order) throw new Error(oErr ? oErr.message : 'Invoice not found')
  const balance = Math.max(0, (order.grand_total || 0) - (order.amount_paid || 0))
  const amount = Math.min(totalCredit, balance)
  if (amount <= 0) throw new Error('That invoice has no balance due to apply this credit against.')

  const { data: payment, error: pErr } = await sb.from('order_payments').insert({
    order_id: orderId, amount: amount, mode: 'credit_note',
    reference: returnNo || null, note: 'Credit from Sale Return ' + (returnNo || ''),
    recorded_by: appliedBy || null,
  }).select().single()
  if (pErr) throw pErr

  const { error: uErr } = await sb.from('franchisee_stock_returns')
    .update({ applied_order_id: orderId, applied_order_payment_id: payment.id, applied_amount: amount })
    .in('id', live.map(function (r) { return r.id }))
  if (uErr) throw uErr
  return amount
}

// Manual entry for a genuine physical return — a franchisee ships one or more
// kits/books back to HO. Unlike createPendingStockReturns above, this isn't
// fulfilling anyone else's order (fulfills_order_id stays null); it's just
// goods coming back into HO's own stock, with a credit to whoever sent them
// back. One reserved return_no covers every line, the same way one invoice
// covers every order_items line. addBack controls whether the physical stock
// is actually usable again (uncheck for a damaged/unsellable return that
// still merits a credit).
export async function createManualStockReturn(opts) {
  const { franchiseeId, lines, reason, addBack, createdBy, applyToOrderId } = opts
  const { data: returnNo, error: rnErr } = await sb.rpc('next_sale_return_no')
  if (rnErr) throw rnErr

  const rows = []
  for (const line of lines) {
    const { data: sr, error } = await sb.from('franchisee_stock_returns').insert({
      return_no: returnNo || null,
      returning_franchisee_id: franchiseeId, sku_id: line.skuId, qty: line.qty, unit_value: line.unitValue,
      total_credit: line.qty * line.unitValue, kind: 'physical_return', reason: (reason || '').trim() || null,
      fulfills_order_id: null, status: 'approved', requested_by: createdBy || null, approved_by: createdBy || null,
    }).select().single()
    if (error) throw error
    rows.push(sr)

    if (addBack) {
      const { data: kits } = await sb.from('kit_items').select('item_id, quantity').eq('sku_id', line.skuId)
      if (kits && kits.length) {
        await sb.from('stock_ledger').insert(kits.map(function (k) {
          return {
            item_id: k.item_id, location_type: 'ho', movement_type: 'receipt',
            qty: line.qty * Number(k.quantity || 1), ref_type: 'sale_return', ref_id: sr.id,
            note: (returnNo || 'Sale Return') + ' — kit returned to HO',
          }
        }))
      }
    }
  }

  if (applyToOrderId) {
    try { await applyCreditToOrder(rows, applyToOrderId, createdBy) } catch (e) { console.warn('[sale return] could not apply to invoice:', e.message) }
  }
  return { return_no: returnNo, rows: rows }
}
