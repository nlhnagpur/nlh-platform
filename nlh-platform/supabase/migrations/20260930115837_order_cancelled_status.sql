-- "Cancel Invoice" used to void the invoice number and send the order back to
-- Pending — implying it was still an active order waiting to be re-invoiced.
-- Rasesh wants a full cancel instead: the order itself is done, not pending
-- again. Adds a real terminal 'cancelled' status (distinct from the existing
-- invoice_cancelled_at/by audit columns, which already correctly exclude a
-- cancelled order from franchiseeLedger regardless of status value) plus a
-- reason column, since Cancel Invoice's reason textarea was being collected
-- in the UI but never actually saved.

alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check
  check (status = any (array['pending','proforma','invoiced','part_paid','payment_submitted','dispatched','closed','cancelled']));

alter table orders add column cancel_reason text;
