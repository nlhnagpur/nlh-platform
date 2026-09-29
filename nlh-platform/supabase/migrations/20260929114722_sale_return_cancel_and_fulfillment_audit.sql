-- Sale Return cancellation + a real audit trail for the two things that drifted
-- out of sync on SR-2026-0003: an order line's "Fulfilled by" flag being changed,
-- and a Sale Return's status changing. Also closes the gap that let a return's
-- credit outlive the fulfillment marking that created it.

ALTER TABLE public.franchisee_stock_returns
  ADD COLUMN IF NOT EXISTS cancelled_at   timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by   text,
  ADD COLUMN IF NOT EXISTS cancel_reason  text,
  ADD COLUMN IF NOT EXISTS fulfills_order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL;

ALTER TABLE public.franchisee_stock_returns DROP CONSTRAINT IF EXISTS franchisee_stock_returns_status_check;
ALTER TABLE public.franchisee_stock_returns ADD CONSTRAINT franchisee_stock_returns_status_check
  CHECK (status IN ('approved','cancelled'));

CREATE TABLE IF NOT EXISTS public.order_fulfillment_audit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id     uuid NOT NULL,
  order_id          uuid NOT NULL,
  old_franchisee_id uuid,
  new_franchisee_id uuid,
  changed_by        text,
  changed_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_fulfillment_audit_item_idx ON public.order_fulfillment_audit (order_item_id);
ALTER TABLE public.order_fulfillment_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ofa_admin_select ON public.order_fulfillment_audit;
CREATE POLICY ofa_admin_select ON public.order_fulfillment_audit FOR SELECT TO authenticated USING (nlh_is_admin());

CREATE TABLE IF NOT EXISTS public.stock_return_audit (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_return_id  uuid NOT NULL,
  action           text NOT NULL CHECK (action IN ('created','cancelled')),
  changed_by       text,
  changed_at       timestamptz NOT NULL DEFAULT now(),
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS stock_return_audit_sr_idx ON public.stock_return_audit (stock_return_id);
ALTER TABLE public.stock_return_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sra_admin_select ON public.stock_return_audit;
CREATE POLICY sra_admin_select ON public.stock_return_audit FOR SELECT TO authenticated USING (nlh_is_admin());

-- Logs every change to order_items.fulfilled_by_franchisee_id, however it happens
-- (app, direct SQL, anything) — this is what would have caught SR-2026-0003 early.
CREATE OR REPLACE FUNCTION public.log_order_fulfillment_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.fulfilled_by_franchisee_id IS DISTINCT FROM OLD.fulfilled_by_franchisee_id THEN
    INSERT INTO public.order_fulfillment_audit (order_item_id, order_id, old_franchisee_id, new_franchisee_id, changed_by)
    VALUES (NEW.id, NEW.order_id, OLD.fulfilled_by_franchisee_id, NEW.fulfilled_by_franchisee_id,
      COALESCE((SELECT email FROM public.users WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1), auth.jwt() ->> 'email'));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_log_order_fulfillment_change ON public.order_items;
CREATE TRIGGER trg_log_order_fulfillment_change AFTER UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.log_order_fulfillment_change();

-- Guard: once a live (non-cancelled) Sale Return exists for a line's fulfillment,
-- the "Fulfilled by" flag on that line can't be silently cleared or reassigned —
-- the return must be cancelled first. This is the exact hole SR-2026-0003 fell
-- through: the flag was cleared but the credit it had raised stayed behind.
CREATE OR REPLACE FUNCTION public.guard_order_fulfillment_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_live boolean;
BEGIN
  IF OLD.fulfilled_by_franchisee_id IS NOT NULL AND NEW.fulfilled_by_franchisee_id IS DISTINCT FROM OLD.fulfilled_by_franchisee_id THEN
    SELECT EXISTS (
      SELECT 1 FROM public.franchisee_stock_returns sr
      WHERE sr.status = 'approved'
        AND (sr.fulfills_order_item_id = OLD.id
             OR (sr.fulfills_order_item_id IS NULL AND sr.fulfills_order_id = OLD.order_id AND sr.sku_id = OLD.sku_id))
    ) INTO v_live;
    IF v_live THEN
      RAISE EXCEPTION 'This line has a live Sale Return crediting a franchisee for it — cancel that return first before changing who fulfilled it.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_order_fulfillment_change ON public.order_items;
CREATE TRIGGER trg_guard_order_fulfillment_change BEFORE UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_fulfillment_change();

-- Logs every Sale Return create/cancel.
CREATE OR REPLACE FUNCTION public.log_stock_return_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.stock_return_audit (stock_return_id, action, changed_by, detail)
    VALUES (NEW.id, 'created', NEW.requested_by, jsonb_build_object('qty', NEW.qty, 'unit_value', NEW.unit_value, 'total_credit', NEW.total_credit, 'returning_franchisee_id', NEW.returning_franchisee_id));
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    INSERT INTO public.stock_return_audit (stock_return_id, action, changed_by, detail)
    VALUES (NEW.id, 'cancelled', NEW.cancelled_by, jsonb_build_object('reason', NEW.cancel_reason, 'was_credit', OLD.total_credit));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_log_stock_return_insert ON public.franchisee_stock_returns;
CREATE TRIGGER trg_log_stock_return_insert AFTER INSERT ON public.franchisee_stock_returns
  FOR EACH ROW EXECUTE FUNCTION public.log_stock_return_change();
DROP TRIGGER IF EXISTS trg_log_stock_return_update ON public.franchisee_stock_returns;
CREATE TRIGGER trg_log_stock_return_update AFTER UPDATE ON public.franchisee_stock_returns
  FOR EACH ROW EXECUTE FUNCTION public.log_stock_return_change();

-- staff visibility on the audit tables, same pattern as the rest of the app
DROP POLICY IF EXISTS staff_perm_select_order_fulfillment_audit ON public.order_fulfillment_audit;
CREATE POLICY staff_perm_select_order_fulfillment_audit ON public.order_fulfillment_audit AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.nlh_staff_can('{orders.view}'::text[]));
DROP POLICY IF EXISTS staff_perm_select_stock_return_audit ON public.stock_return_audit;
CREATE POLICY staff_perm_select_stock_return_audit ON public.stock_return_audit AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.nlh_staff_can('{inventory.view}'::text[]));
