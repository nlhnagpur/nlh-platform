-- Same placer_id-only gap as orders/order_items (previous two migrations):
-- order_payments_select only checked the parent order's placer_id, so a
-- bill-to franchisee (e.g. a school whose CF placed and paid the order)
-- could see the order and its items but not the actual payment record
-- against it, once the previous two migrations landed.
drop policy order_payments_select on order_payments;
create policy order_payments_select on order_payments for select
  using (nlh_is_admin() or exists (
    select 1 from orders o where o.id = order_payments.order_id
      and (o.placer_id = any (nlh_accessible_franchisee_ids())
        or o.bill_to_franchisee_id = any (nlh_accessible_franchisee_ids()))
  ));
