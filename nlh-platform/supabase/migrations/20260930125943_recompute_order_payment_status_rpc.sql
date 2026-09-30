-- sync_order_payment_total() (trigger on order_payments) is the only thing
-- that ever recomputes orders.status among invoiced/part_paid/closed — but
-- InvoiceEditModal updates orders.grand_total directly with a plain
-- .update(), never touching order_payments, so editing an invoice's items
-- AFTER payments were already recorded (or in a way that makes the new
-- total exactly match what's already paid) never re-triggers that status
-- recompute. Two real orders were found stuck at 'invoiced' with
-- amount_paid == grand_total (ORD-2026-0008, ORD-2026-0018) because of
-- exactly this. This RPC reuses the trigger's own logic as a single source
-- of truth, callable from any client code that changes grand_total outside
-- the payments-insert path.

create or replace function public.recompute_order_payment_status(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total  integer;
  v_grand  integer;
  v_status text;
begin
  select coalesce(sum(amount),0) into v_total from order_payments where order_id = p_order_id;
  select grand_total, status into v_grand, v_status from orders where id = p_order_id;
  if v_status not in ('invoiced','part_paid','closed') then return; end if;

  perform set_config('nlh.syncing', 'on', true);
  update orders set
    status = case
      when v_grand > 0 and v_total >= v_grand then 'closed'
      when v_total > 0 then 'part_paid'
      else 'invoiced'
    end,
    payment_verified_at = case
      when v_grand > 0 and v_total >= v_grand then coalesce(payment_verified_at, now())
      else payment_verified_at
    end
  where id = p_order_id;
  perform set_config('nlh.syncing', 'off', true);
end $function$;

grant execute on function public.recompute_order_payment_status(uuid) to authenticated;
