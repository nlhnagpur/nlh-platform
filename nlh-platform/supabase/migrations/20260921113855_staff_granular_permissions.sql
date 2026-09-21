-- Per-login permission checklist for role='staff'. NULL/absent key = denied.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.nlh_is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT role = 'staff' FROM users WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1), false)
$$;

CREATE OR REPLACE FUNCTION public.nlh_is_senior() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT role IN ('owner','super_admin','admin') FROM users WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1), false)
$$;

-- true for every non-staff caller; for staff, true only if ANY listed key is ticked
CREATE OR REPLACE FUNCTION public.nlh_staff_can(keys text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((
    SELECT CASE WHEN u.role <> 'staff' THEN true
      ELSE EXISTS (SELECT 1 FROM unnest(keys) k WHERE COALESCE((u.permissions ->> k)::boolean, false))
    END
    FROM users u WHERE u.email ILIKE (auth.jwt() ->> 'email') LIMIT 1
  ), true)
$$;

-- Nobody may change their own role / permissions / active flag; only owner, super_admin, admin can change anyone's.
CREATE OR REPLACE FUNCTION public.users_guard_privileged_cols() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;  -- service role / dashboard
  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.permissions IS DISTINCT FROM OLD.permissions
      OR NEW.is_active IS DISTINCT FROM OLD.is_active)
     AND NOT (public.nlh_is_senior() OR (public.nlh_is_admin() AND NOT public.nlh_is_staff() AND NEW.role NOT IN ('owner','super_admin','admin') AND OLD.role NOT IN ('owner','super_admin','admin')))
  THEN
    RAISE EXCEPTION 'Not allowed to change role, permissions or active status';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_users_guard_privileged_cols ON public.users;
CREATE TRIGGER trg_users_guard_privileged_cols BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_guard_privileged_cols();

-- Restrictive policies: AND-ed with the existing ones, and only ever bite role='staff'.
DO $$
DECLARE
  r record; cmd text; pol text;
  cfg jsonb := '[
   ["franchisees","select","franchisees.view"],["franchisees","insert","franchisees.edit"],["franchisees","update","franchisees.edit"],["franchisees","delete","franchisees.delete"],
   ["franchisee_agreements","select","franchisees.view"],["franchisee_agreements","insert","franchisees.edit"],["franchisee_agreements","update","franchisees.edit"],["franchisee_agreements","delete","franchisees.delete"],
   ["orders","select","orders.view"],["orders","insert","orders.edit"],["orders","update","orders.edit,orders.invoice,orders.payments,orders.dispatch"],["orders","delete","orders.delete"],
   ["order_items","select","orders.view"],["order_items","insert","orders.edit"],["order_items","update","orders.edit,orders.invoice,orders.dispatch"],["order_items","delete","orders.edit"],
   ["order_payments","select","orders.view"],["order_payments","insert","orders.payments"],["order_payments","update","orders.payments"],["order_payments","delete","orders.payments"],
   ["students","select","students.view"],["students","insert","students.edit"],["students","update","students.edit,students.complete"],["students","delete","students.delete"],
   ["enrollments","select","students.view"],["enrollments","insert","students.edit"],["enrollments","update","students.edit,students.complete"],["enrollments","delete","students.delete"],
   ["student_invoices","select","students.view"],["student_invoices","insert","students.edit"],["student_invoices","update","students.edit"],["student_invoices","delete","students.delete"],
   ["student_payments","select","students.view"],["student_payments","insert","students.edit"],["student_payments","update","students.edit"],["student_payments","delete","students.delete"],
   ["student_fee_events","select","students.view"],
   ["session_attendance","select","students.view"],["session_attendance","insert","students.edit"],["session_attendance","update","students.edit"],["session_attendance","delete","students.edit"],
   ["instructors","select","instructors.view"],["instructors","insert","instructors.edit"],["instructors","update","instructors.edit"],["instructors","delete","instructors.delete"],
   ["instructor_courses","select","instructors.view"],["instructor_courses","insert","instructors.edit"],["instructor_courses","update","instructors.edit"],["instructor_courses","delete","instructors.edit"],
   ["instructor_payments","select","instructors.view"],["instructor_payments","insert","instructors.edit"],["instructor_payments","update","instructors.edit"],
   ["instructor_payment_items","select","instructors.view"],["instructor_payment_items","insert","instructors.edit"],["instructor_payment_items","update","instructors.edit"],
   ["batches","select","batches.view"],["batches","insert","batches.edit"],["batches","update","batches.edit"],["batches","delete","batches.edit"],
   ["batch_sessions","select","batches.view"],["batch_sessions","insert","batches.edit"],["batch_sessions","update","batches.edit"],["batch_sessions","delete","batches.edit"],
   ["batch_students","select","batches.view"],["batch_students","insert","batches.edit"],["batch_students","update","batches.edit"],["batch_students","delete","batches.edit"],
   ["transactions","select","accounting.view"],["transactions","insert","accounting.edit"],["transactions","update","accounting.edit"],["transactions","delete","accounting.delete"],
   ["transaction_items","select","accounting.view"],["transaction_items","insert","accounting.edit"],["transaction_items","update","accounting.edit"],["transaction_items","delete","accounting.delete"],
   ["transaction_payments","select","accounting.view"],["transaction_payments","insert","accounting.edit"],["transaction_payments","update","accounting.edit"],["transaction_payments","delete","accounting.delete"],
   ["franchisee_payments","select","accounting.view"],["franchisee_payments","insert","accounting.edit"],["franchisee_payments","update","accounting.edit"],["franchisee_payments","delete","accounting.delete"],
   ["franchisee_credit_notes","select","accounting.view"],["franchisee_credit_notes","insert","accounting.edit"],["franchisee_credit_notes","update","accounting.edit"],["franchisee_credit_notes","delete","accounting.delete"],
   ["franchisee_stock_returns","select","accounting.view"],["franchisee_stock_returns","insert","accounting.edit"],["franchisee_stock_returns","update","accounting.edit"],["franchisee_stock_returns","delete","accounting.delete"],
   ["payroll_overrides","select","accounting.view"],["payroll_overrides","insert","accounting.edit"],["payroll_overrides","update","accounting.edit"],["payroll_overrides","delete","accounting.delete"],
   ["messages","select","messages.view"],["messages","insert","messages.reply"],["messages","update","messages.view"],
   ["coupons","select","coupons.view"],["coupon_redemptions","select","coupons.view"],
   ["email_log","select","email-log.view"],
   ["inventory_items","select","inventory.view"],["kit_items","select","inventory.view"],["stock_ledger","select","inventory.view"],["stock_ledger","insert","inventory.edit"],["stock_ledger","update","inventory.edit"],
   ["stock_movements","select","inventory.view"],["stock_movements","insert","inventory.edit"],["stock_movements","update","inventory.edit"],["stock_movements","delete","inventory.edit"],
   ["kit_price_history","select","prices.view"],["kit_price_history","insert","prices.edit"],["kit_price_history","update","prices.edit"],["kit_price_history","delete","prices.edit"],
   ["school_sku_rates","select","courses.view"],["school_sku_rates","insert","prices.edit"],["school_sku_rates","update","prices.edit"],["school_sku_rates","delete","prices.edit"]
  ]'::jsonb;
  item jsonb;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(cfg) LOOP
    cmd := item->>0;  -- table name in [0]; command in [1]
    pol := 'staff_perm_' || (item->>1) || '_' || (item->>0);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, item->>0);
    IF item->>1 = 'select' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.nlh_staff_can(%L::text[]))', pol, item->>0, '{' || (item->>2) || '}');
    ELSIF item->>1 = 'insert' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.nlh_staff_can(%L::text[]))', pol, item->>0, '{' || (item->>2) || '}');
    ELSIF item->>1 = 'update' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.nlh_staff_can(%L::text[])) WITH CHECK (public.nlh_staff_can(%L::text[]))', pol, item->>0, '{' || (item->>2) || '}', '{' || (item->>2) || '}');
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.nlh_staff_can(%L::text[]))', pol, item->>0, '{' || (item->>2) || '}');
    END IF;
  END LOOP;
END $$;

-- Staff never manage logins or access requests; they may read/update only their own users row.
DROP POLICY IF EXISTS staff_perm_users_select ON public.users;
CREATE POLICY staff_perm_users_select ON public.users AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.nlh_is_staff() OR email ILIKE (auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS staff_perm_users_update ON public.users;
CREATE POLICY staff_perm_users_update ON public.users AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.nlh_is_staff() OR email ILIKE (auth.jwt() ->> 'email'))
  WITH CHECK (NOT public.nlh_is_staff() OR email ILIKE (auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS staff_perm_users_insert ON public.users;
CREATE POLICY staff_perm_users_insert ON public.users AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.nlh_is_staff());
DROP POLICY IF EXISTS staff_perm_users_delete ON public.users;
CREATE POLICY staff_perm_users_delete ON public.users AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.nlh_is_staff());
DROP POLICY IF EXISTS staff_perm_access_requests_select ON public.access_requests;
CREATE POLICY staff_perm_access_requests_select ON public.access_requests AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.nlh_is_staff());
DROP POLICY IF EXISTS staff_perm_access_requests_update ON public.access_requests;
CREATE POLICY staff_perm_access_requests_update ON public.access_requests AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.nlh_is_staff()) WITH CHECK (NOT public.nlh_is_staff());
