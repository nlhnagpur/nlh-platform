-- orders_select/orders_update only checked placer_id — the party who
-- physically placed the order — never bill_to_franchisee_id, the party
-- actually invoiced. For any order placed on someone else's behalf (the
-- exact case for a CF placing/paying an order billed to one of its
-- schools), the bill-to party's own RLS-scoped queries silently returned
-- nothing: their My Account ledger showed ₹0 / "No transactions yet" even
-- though a real, fully-paid ₹28,200 invoice existed for them (Angels' Park
-- School, INV-2026-0024). Widen both policies to also allow the bill-to
-- franchisee (and anyone in their own accessible tree) to see and act on
-- the order.
drop policy orders_select on orders;
create policy orders_select on orders for select
  using (nlh_is_admin()
    or placer_id = any (nlh_accessible_franchisee_ids())
    or bill_to_franchisee_id = any (nlh_accessible_franchisee_ids()));

drop policy orders_update on orders;
create policy orders_update on orders for update
  using (nlh_is_admin()
    or placer_id = any (nlh_accessible_franchisee_ids())
    or bill_to_franchisee_id = any (nlh_accessible_franchisee_ids()));
