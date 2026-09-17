-- Same gap as orders_select/orders_update (previous migration) one level
-- down: order_items' policies only checked the parent order's placer_id,
-- so even after the orders table itself became visible to a bill-to
-- franchisee, its line items (the actual kit/course items on the invoice)
-- would still have been invisible — an order with no items showing.
drop policy order_items_select on order_items;
create policy order_items_select on order_items for select
  using (nlh_is_admin() or exists (
    select 1 from orders o where o.id = order_items.order_id
      and (o.placer_id = any (nlh_accessible_franchisee_ids())
        or o.bill_to_franchisee_id = any (nlh_accessible_franchisee_ids()))
  ));

drop policy order_items_update on order_items;
create policy order_items_update on order_items for update
  using (nlh_is_admin() or exists (
    select 1 from orders o where o.id = order_items.order_id
      and (o.placer_id = any (nlh_accessible_franchisee_ids())
        or o.bill_to_franchisee_id = any (nlh_accessible_franchisee_ids()))
  ));

drop policy order_items_delete on order_items;
create policy order_items_delete on order_items for delete
  using (nlh_is_admin() or exists (
    select 1 from orders o where o.id = order_items.order_id
      and (o.placer_id = any (nlh_accessible_franchisee_ids())
        or o.bill_to_franchisee_id = any (nlh_accessible_franchisee_ids()))
  ));
