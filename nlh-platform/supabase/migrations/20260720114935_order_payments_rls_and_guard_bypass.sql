-- The ledger trigger writes derived totals back to orders; guard_order_update
-- must not treat that as a user hand-editing amounts.
create or replace function guard_order_update() returns trigger
language plpgsql security definer set search_path = public as $$
DECLARE
  v_role TEXT;
BEGIN
  IF current_setting('nlh.syncing', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_role FROM public.users
  WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1;

  IF v_role IN ('owner','super_admin','admin','manager','staff') THEN
    RETURN NEW;
  END IF;

  IF
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.amount_paid IS DISTINCT FROM OLD.amount_paid OR
    NEW.invoice_no IS DISTINCT FROM OLD.invoice_no OR
    NEW.invoice_url IS DISTINCT FROM OLD.invoice_url OR
    NEW.invoice_cancelled_at IS DISTINCT FROM OLD.invoice_cancelled_at OR
    NEW.invoice_cancelled_by IS DISTINCT FROM OLD.invoice_cancelled_by OR
    NEW.payment_verified_at IS DISTINCT FROM OLD.payment_verified_at OR
    NEW.courier_partner IS DISTINCT FROM OLD.courier_partner OR
    NEW.awb_number IS DISTINCT FROM OLD.awb_number OR
    NEW.courier_charges IS DISTINCT FROM OLD.courier_charges OR
    NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at OR
    NEW.dispatch_date IS DISTINCT FROM OLD.dispatch_date OR
    NEW.dispatch_weight IS DISTINCT FROM OLD.dispatch_weight OR
    NEW.dispatch_freight IS DISTINCT FROM OLD.dispatch_freight OR
    NEW.subtotal IS DISTINCT FROM OLD.subtotal OR
    NEW.gst_amount IS DISTINCT FROM OLD.gst_amount OR
    NEW.grand_total IS DISTINCT FROM OLD.grand_total OR
    NEW.placer_id IS DISTINCT FROM OLD.placer_id OR
    NEW.placer_tier IS DISTINCT FROM OLD.placer_tier OR
    NEW.supplier IS DISTINCT FROM OLD.supplier OR
    NEW.bill_to_franchisee_id IS DISTINCT FROM OLD.bill_to_franchisee_id OR
    NEW.ship_to_franchisee_id IS DISTINCT FROM OLD.ship_to_franchisee_id
  THEN
    RAISE EXCEPTION 'Permission denied: only admins can modify order status, amounts, or dispatch details';
  END IF;

  RETURN NEW;
END $$;

-- ── RLS: same visibility rules as orders; only admins may write ──────────────
alter table order_payments enable row level security;

drop policy if exists order_payments_select on order_payments;
create policy order_payments_select on order_payments for select using (
  nlh_is_admin() or exists (
    select 1 from orders o where o.id = order_payments.order_id
      and o.placer_id = any (nlh_accessible_franchisee_ids())
  )
);

drop policy if exists order_payments_insert on order_payments;
create policy order_payments_insert on order_payments for insert with check (nlh_is_admin());

drop policy if exists order_payments_update on order_payments;
create policy order_payments_update on order_payments for update using (nlh_is_admin());

drop policy if exists order_payments_delete on order_payments;
create policy order_payments_delete on order_payments for delete using (nlh_is_admin());
