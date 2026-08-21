-- orders had no DELETE policy at all (only insert/select/update) — deleting
-- a proforma that's not going ahead needs one. Scoped tightly at the DB
-- layer, not just in the app: admin-only, and only a proforma that was
-- never converted to a real invoice (invoice_no is null) — a real invoice
-- must always be voided via Cancel (preserves the sequential number for
-- the audit trail), never deleted outright.
create policy orders_delete on orders for delete
  using (nlh_is_admin() and status = 'proforma' and invoice_no is null);
