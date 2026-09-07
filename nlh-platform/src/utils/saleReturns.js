import { sb } from '../supabase'

// Sale Return — for every order_items line marked fulfilled_by_franchisee_id
// (that franchisee supplied it from their own stock instead of HO), raises
// an already-approved franchisee_stock_returns credit valued at what they
// actually paid HO for it (their own most recent purchase of that SKU).
// Fully automated end to end — no manual approval step; the DB trigger
// assigns the SR-YYYY-NNNN number immediately since the row is inserted
// pre-approved. If a value on a voucher needs correcting, that's a direct
// manual edit to the franchisee_stock_returns row, not an approval action
// here. Idempotent per order, same as the stock deduction it runs
// alongside — never blocks the invoice action itself.
//
// Shared between OrdersPage.jsx (InvoiceEditModal, invoice/proforma-convert
// handlers, DispatchModal fallback) and InvoiceView.jsx's own Edit tab —
// pulled out to its own module so both can call it without OrdersPage.jsx
// and InvoiceView.jsx importing each other (OrdersPage already imports
// InvoiceView as the "PDF" action's modal).
export async function createPendingStockReturns(order) {
  const { data: already } = await sb.from('franchisee_stock_returns').select('id').eq('fulfills_order_id', order.id).limit(1)
  if (already && already.length > 0) return

  const { data: lines } = await sb.from('order_items')
    .select('id, sku_id, ordered_qty, fulfilled_by_franchisee_id').eq('order_id', order.id)
    .not('fulfilled_by_franchisee_id', 'is', null)
  if (!lines || !lines.length) return

  for (const line of lines) {
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
    await sb.from('franchisee_stock_returns').insert({
      returning_franchisee_id: line.fulfilled_by_franchisee_id,
      sku_id: line.sku_id, qty: line.ordered_qty, unit_value: unitValue,
      total_credit: unitValue * line.ordered_qty,
      source_order_id: source?.order_id || null, source_order_item_id: source?.id || null,
      fulfills_order_id: order.id,
      status: 'approved', requested_by: 'system (auto)', approved_by: 'system (auto)',
    })
  }
}
