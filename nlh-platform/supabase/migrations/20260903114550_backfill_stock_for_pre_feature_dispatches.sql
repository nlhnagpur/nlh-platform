-- The second, older stock gap flagged after the invoice-time backfill:
-- ORD-2026-0001 through 0006 (the platform's earliest orders, all
-- dispatched 5-27 May 2026) show dispatched_at set but zero stock_ledger
-- rows. Every order from #0007 onward (created mid-June) has real stock
-- movements, so this isn't a bug in current deduction logic — these 6
-- simply predate the auto-deduct-on-dispatch feature existing at all.
-- Checked stock_ledger for any manual entry covering them in that window
-- (none found) before backfilling, so this can't double-count against a
-- manual "given to" entry someone already made.
--
-- Same kit-expansion logic as the app/the invoice-time backfill. Dated
-- today (no better signal than "should have been deducted back then, but
-- wasn't, so land it now").

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
    where o.dispatched_at is not null
    and not exists (select 1 from stock_ledger sl where sl.ref_type='order' and sl.ref_id=o.id)
  )
  group by 1, 2
  having case when true then (case when oi.item_id is not null then oi.item_id else ki.item_id end) end is not null
)
insert into stock_ledger (item_id, location_type, movement_type, qty, ref_type, ref_id, franchisee_id, note)
select n.item_id, 'ho', 'issue_to_franchisee', -n.qty, 'order', n.order_id, o.placer_id,
  'Dispatch ' || coalesce(o.invoice_no, o.order_ref) || ' (backfill — predates auto-deduct feature)'
from need n
join orders o on o.id = n.order_id
where n.item_id is not null and n.qty > 0;
