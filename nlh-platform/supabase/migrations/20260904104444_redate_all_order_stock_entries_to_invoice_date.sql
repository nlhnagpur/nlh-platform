-- The same date problem just fixed for the two backfill batches also
-- exists on every order deducted through the OLD dispatch-time code
-- before today's change (9 orders: ORD-2026-0007, 0008, 0010, 0012, 0013,
-- 0015, 0016, 0017, and the earlier 6 already covered) — their
-- stock_ledger rows are dated by when they were dispatched, not invoiced.
-- Re-date every order-linked stock_ledger row to its order's invoiced_at,
-- consistent with the "stock ties to invoice, not dispatch" policy, for
-- every order that has one (skips the handful of very early orders with
-- no invoiced_at signal at all, none of which remain after this — see
-- the invoiced_at backfill from earlier).
--
-- Verified after running: zero orders left where the ledger date and
-- invoiced_at date disagree.

update stock_ledger sl
set created_at = o.invoiced_at
from orders o
where sl.ref_type = 'order' and sl.ref_id = o.id
  and o.invoiced_at is not null
  and sl.created_at is distinct from o.invoiced_at;
