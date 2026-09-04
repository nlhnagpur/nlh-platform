-- Both stock backfills (invoice-time gap + pre-feature dispatches) dated
-- their entries "today" (the day the backfill ran) — reported live as
-- wrong: the ledger should show the date stock actually left, which per
-- the "stock ties to invoice, not dispatch" policy is each order's real
-- invoiced_at, not the day the fix happened to run. Re-dates every
-- backfilled row (both batches, identified by their '(backfill ...)' note
-- suffix) to its order's invoiced_at. All 12 backfilled orders had a
-- usable invoiced_at, so none are left on today's date.

update stock_ledger sl
set created_at = o.invoiced_at
from orders o
where sl.ref_type = 'order' and sl.ref_id = o.id
  and sl.note ilike '%(backfill%'
  and o.invoiced_at is not null;

-- The pre-feature-dispatch batch's note said "Dispatch INV-..." — now
-- dated by invoice time like the other batch, so reword it to match
-- rather than leave a note that contradicts its own date.
update stock_ledger
set note = replace(note, 'Dispatch INV-', 'Invoice INV-')
where note ilike 'Dispatch INV-%(backfill — predates auto-deduct feature)%';
