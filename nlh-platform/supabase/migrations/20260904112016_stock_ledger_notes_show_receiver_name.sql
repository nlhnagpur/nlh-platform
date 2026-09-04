-- Reported live: the "(backfill — ...)" explanation cluttering every
-- backfilled stock_ledger note isn't useful info for someone reading the
-- ledger — the receiver's name is. Normalizes every order-linked note
-- (both backfill batches AND the older plain "Dispatch INV-..." notes,
-- for consistency) to "Invoice <no> — <receiver name>", where receiver is
-- the same bill_to_franchisee_id-else-placer_id resolution used
-- everywhere else in the app (OrderReceiverInfo, InvoiceView, etc).

update stock_ledger sl
set note = 'Invoice ' || coalesce(o.invoice_no, o.order_ref) || ' — ' || f.business_name
from orders o
join franchisees f on f.id = coalesce(o.bill_to_franchisee_id, o.placer_id)
where sl.ref_type = 'order' and sl.ref_id = o.id
  and (sl.note ilike 'Invoice INV-%' or sl.note ilike 'Dispatch INV-%' or sl.note ilike 'Dispatch ORD-%');
