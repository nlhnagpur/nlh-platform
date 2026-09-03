-- Stock effect now ties to invoicing, not dispatch (see the app-code
-- change moving deduction into handleMarkInvoiced/handleConvertProforma/
-- the payment-triggered auto-conversion, with DispatchModal kept only as
-- an idempotent fallback). Retroactively catch up every order that is
-- ALREADY invoiced today but was never dispatched — under the old
-- dispatch-only deduction, these 6 orders (including the one the owner
-- flagged, ORD-2026-0018) have had zero stock impact despite carrying a
-- real invoice number. Applies the exact same kit-expansion logic the app
-- uses (ordered_qty as sent_qty isn't set pre-dispatch, minus any
-- excluded_kit_items), dated today since there's no better signal for
-- exactly when between invoice and now the "real" deduction should have
-- landed.
--
-- Deliberately excludes a separate, older anomaly noticed while
-- investigating this: 6 different orders (ORD-2026-0001 through 0006,
-- roughly) show dispatched_at set but ALSO zero stock_ledger rows —
-- pre-dating even the dispatch-time deduction code path. Left alone here;
-- flagged to the owner separately, needs its own decision since backdating
-- those is a different judgment call (how far back, at what date).

with need as (
  select oi.order_id,
    case when oi.item_id is not null then oi.item_id else ki.item_id end as item_id,
    sum(
      case when oi.item_id is not null then oi.ordered_qty
           else oi.ordered_qty * coalesce(ki.quantity, 1)
      end
    ) as qty
  from order_items oi
  left join kit_items ki
    on oi.sku_id is not null and ki.sku_id = oi.sku_id
    and not (ki.item_id = any (coalesce(oi.excluded_kit_items, '{}')))
  where oi.order_id in (
    select o.id from orders o
    where o.invoice_no is not null and o.dispatched_at is null
    and not exists (select 1 from stock_ledger sl where sl.ref_type='order' and sl.ref_id=o.id)
  )
  group by 1, 2
  having case when true then (case when oi.item_id is not null then oi.item_id else ki.item_id end) end is not null
)
insert into stock_ledger (item_id, location_type, movement_type, qty, ref_type, ref_id, franchisee_id, note)
select n.item_id, 'ho', 'issue_to_franchisee', -n.qty, 'order', n.order_id, o.placer_id,
  'Invoice ' || coalesce(o.invoice_no, o.order_ref) || ' (backfill — stock now ties to invoice, not dispatch)'
from need n
join orders o on o.id = n.order_id
where n.item_id is not null and n.qty > 0;
