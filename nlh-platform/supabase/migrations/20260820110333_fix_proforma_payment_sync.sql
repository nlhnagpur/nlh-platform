-- sync_order_payment_total() only ever advanced status out of
-- ('invoiced','part_paid','closed') — a 'proforma' order recording a full
-- payment via the admin's "Record Pmt" flow would get amount_paid/paid_at
-- updated but stay stuck at status='proforma' forever, with invoice_no
-- never assigned (trg_invoice_no only fires on an explicit transition TO
-- 'invoiced', which this trigger was never taking for a proforma order).
--
-- Fix: treat 'proforma' as an eligible source status, and when a payment
-- fully/partially settles a proforma order, first flip it through
-- 'invoiced' in its own UPDATE (so trg_invoice_no fires and assigns a
-- real invoice number) before applying the normal amount/status sync —
-- same two-step the client-side handleVerifyPayment already does for the
-- "franchisee submitted proof, admin verifies" path.
create or replace function public.sync_order_payment_total()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order   uuid := coalesce(NEW.order_id, OLD.order_id);
  v_total   integer;
  v_grand   integer;
  v_status  text;
  v_last    record;
begin
  select coalesce(sum(amount),0) into v_total from order_payments where order_id = v_order;
  select grand_total, status into v_grand, v_status from orders where id = v_order;

  select paid_on, mode, reference into v_last
  from order_payments where order_id = v_order
  order by paid_on desc, created_at desc limit 1;

  perform set_config('nlh.syncing', 'on', true);

  -- A proforma order moving into part_paid/closed needs a real invoice
  -- number first — flip it through 'invoiced' in its own statement so
  -- trg_invoice_no's old.status = 'proforma' condition actually fires.
  if v_status = 'proforma' and v_total > 0 then
    update orders set status = 'invoiced' where id = v_order and invoice_no is null;
    v_status := 'invoiced';
  end if;

  update orders set
    amount_paid  = v_total,
    paid_at      = case when v_last.paid_on is not null
                        then v_last.paid_on::timestamptz else null end,
    payment_mode = coalesce(v_last.mode, payment_mode),
    payment_ref  = v_last.reference,
    -- Only move between the payment statuses; never disturb pending/dispatched.
    status = case
      when v_status not in ('invoiced','part_paid','closed') then v_status
      when v_grand > 0 and v_total >= v_grand then 'closed'
      when v_total > 0 then 'part_paid'
      else 'invoiced'
    end,
    payment_verified_at = case
      when v_grand > 0 and v_total >= v_grand then coalesce(payment_verified_at, now())
      else null
    end
  where id = v_order;

  perform set_config('nlh.syncing', 'off', true);
  return null;
end $function$;
