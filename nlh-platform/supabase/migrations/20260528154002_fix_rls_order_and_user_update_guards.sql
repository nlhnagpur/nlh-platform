
-- ══════════════════════════════════════════════════════════════════
-- Finding #5: Prevent franchisees from self-verifying orders
-- Finding #2: Prevent any user from escalating their own role
-- ══════════════════════════════════════════════════════════════════

-- ── ORDERS: column-level update guard ─────────────────────────────
-- Franchisees may only touch payment submission fields.
-- All other columns (status, amount_paid, invoice_no, dispatch, etc.)
-- are admin-only. This is enforced at trigger level because RLS
-- with_check cannot inspect OLD column values.

CREATE OR REPLACE FUNCTION public.guard_order_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Determine the caller's role
  SELECT role INTO v_role
  FROM public.users
  WHERE email ILIKE (auth.jwt() ->> 'email')
  LIMIT 1;

  -- Admins (owner → staff) may update anything
  IF v_role IN ('owner','super_admin','admin','manager','staff') THEN
    RETURN NEW;
  END IF;

  -- Non-admins: only payment submission columns may change
  IF
    NEW.status                  IS DISTINCT FROM OLD.status                  OR
    NEW.amount_paid             IS DISTINCT FROM OLD.amount_paid             OR
    NEW.invoice_no              IS DISTINCT FROM OLD.invoice_no              OR
    NEW.invoice_url             IS DISTINCT FROM OLD.invoice_url             OR
    NEW.invoice_cancelled_at    IS DISTINCT FROM OLD.invoice_cancelled_at    OR
    NEW.invoice_cancelled_by    IS DISTINCT FROM OLD.invoice_cancelled_by    OR
    NEW.payment_verified_at     IS DISTINCT FROM OLD.payment_verified_at     OR
    NEW.courier_partner         IS DISTINCT FROM OLD.courier_partner         OR
    NEW.awb_number              IS DISTINCT FROM OLD.awb_number              OR
    NEW.courier_charges         IS DISTINCT FROM OLD.courier_charges         OR
    NEW.dispatched_at           IS DISTINCT FROM OLD.dispatched_at           OR
    NEW.dispatch_date           IS DISTINCT FROM OLD.dispatch_date           OR
    NEW.dispatch_weight         IS DISTINCT FROM OLD.dispatch_weight         OR
    NEW.dispatch_freight        IS DISTINCT FROM OLD.dispatch_freight        OR
    NEW.subtotal                IS DISTINCT FROM OLD.subtotal                OR
    NEW.gst_amount              IS DISTINCT FROM OLD.gst_amount              OR
    NEW.grand_total             IS DISTINCT FROM OLD.grand_total             OR
    NEW.placer_id               IS DISTINCT FROM OLD.placer_id               OR
    NEW.placer_tier             IS DISTINCT FROM OLD.placer_tier             OR
    NEW.supplier                IS DISTINCT FROM OLD.supplier                OR
    NEW.bill_to_franchisee_id   IS DISTINCT FROM OLD.bill_to_franchisee_id   OR
    NEW.ship_to_franchisee_id   IS DISTINCT FROM OLD.ship_to_franchisee_id
  THEN
    RAISE EXCEPTION 'Permission denied: only admins can modify order status, amounts, or dispatch details';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_order_update ON public.orders;
CREATE TRIGGER trg_guard_order_update
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_order_update();


-- ── USERS: prevent role / franchisee_id self-escalation ───────────
-- Any authenticated user matches the users_update RLS policy for
-- their own row, so they could write role='owner'. This trigger
-- blocks changes to sensitive columns for non-admins.

CREATE OR REPLACE FUNCTION public.guard_user_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Determine the caller's CURRENT role (from the OLD row, not NEW)
  SELECT role INTO v_role
  FROM public.users
  WHERE email ILIKE (auth.jwt() ->> 'email')
  LIMIT 1;

  -- Admins may update anything
  IF v_role IN ('owner','super_admin','admin','manager','staff') THEN
    RETURN NEW;
  END IF;

  -- Non-admins cannot change their own role or franchisee assignment
  IF
    NEW.role           IS DISTINCT FROM OLD.role           OR
    NEW.franchisee_id  IS DISTINCT FROM OLD.franchisee_id
  THEN
    RAISE EXCEPTION 'Permission denied: role and franchisee_id can only be changed by an administrator';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_user_update ON public.users;
CREATE TRIGGER trg_guard_user_update
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_user_update();
