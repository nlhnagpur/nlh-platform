-- Service (CI) invoices live in `orders` (kind='service'), one per school per month.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'kit',
  ADD COLUMN IF NOT EXISTS service_month date;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_kind_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_kind_check CHECK (kind IN ('kit','service'));
CREATE UNIQUE INDEX IF NOT EXISTS orders_service_month_uq
  ON public.orders (bill_to_franchisee_id, service_month)
  WHERE kind = 'service' AND invoice_cancelled_at IS NULL;

-- Service lines have a description instead of a SKU / stock item.
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_sku_or_item;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_sku_or_item
  CHECK (sku_id IS NOT NULL OR item_id IS NOT NULL OR description IS NOT NULL);

-- CIs NLH appoints to a Full-Service school, with what the school is charged.
-- Readable by the school and its CF (it is on their invoices / agreement anyway).
CREATE TABLE IF NOT EXISTS public.school_ci_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES public.franchisees(id) ON DELETE CASCADE,
  instructor_id  uuid REFERENCES public.instructors(id) ON DELETE SET NULL,
  ci_name        text NOT NULL,
  program        text NOT NULL,
  level_label    text,
  monthly_charge integer NOT NULL CHECK (monthly_charge >= 0),
  frequency      text NOT NULL DEFAULT 'Monthly',
  starts_on      date NOT NULL DEFAULT CURRENT_DATE,
  ends_on        date,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS school_ci_assignments_school_idx ON public.school_ci_assignments (school_id);
ALTER TABLE public.school_ci_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sci_select ON public.school_ci_assignments;
CREATE POLICY sci_select ON public.school_ci_assignments FOR SELECT TO authenticated
  USING (nlh_is_admin() OR school_id = ANY (nlh_accessible_franchisee_ids()));
DROP POLICY IF EXISTS sci_write ON public.school_ci_assignments;
CREATE POLICY sci_write ON public.school_ci_assignments FOR ALL TO authenticated
  USING (nlh_is_admin()) WITH CHECK (nlh_is_admin());

-- What NLH pays the CF per school. ADMIN ONLY — schools and CFs must never read this.
-- kit: fixed Rs per kit for a SKU; ci: fixed Rs per month for one CI appointment.
CREATE TABLE IF NOT EXISTS public.cf_commission_terms (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES public.franchisees(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('kit','ci')),
  sku_id             uuid REFERENCES public.skus(id) ON DELETE CASCADE,
  ci_assignment_id   uuid REFERENCES public.school_ci_assignments(id) ON DELETE CASCADE,
  share_amount       integer NOT NULL DEFAULT 0 CHECK (share_amount >= 0),
  updated_by         text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'kit' AND sku_id IS NOT NULL AND ci_assignment_id IS NULL)
      OR (kind = 'ci'  AND ci_assignment_id IS NOT NULL AND sku_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cf_commission_kit_uq ON public.cf_commission_terms (school_id, sku_id) WHERE kind = 'kit';
CREATE UNIQUE INDEX IF NOT EXISTS cf_commission_ci_uq  ON public.cf_commission_terms (ci_assignment_id) WHERE kind = 'ci';
ALTER TABLE public.cf_commission_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cft_admin ON public.cf_commission_terms;
CREATE POLICY cft_admin ON public.cf_commission_terms FOR ALL TO authenticated
  USING (nlh_is_admin()) WITH CHECK (nlh_is_admin());

-- Commission stamped when an invoice is issued, so later edits to the terms never
-- rewrite it. qty NULL = use the order line's sent/ordered qty at credit time.
CREATE TABLE IF NOT EXISTS public.order_commission_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id  uuid REFERENCES public.order_items(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('kit','ci')),
  description    text,
  qty            integer,
  share_amount   integer NOT NULL CHECK (share_amount >= 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_commission_lines_order_idx ON public.order_commission_lines (order_id);
ALTER TABLE public.order_commission_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ocl_admin ON public.order_commission_lines;
CREATE POLICY ocl_admin ON public.order_commission_lines FOR ALL TO authenticated
  USING (nlh_is_admin()) WITH CHECK (nlh_is_admin());

-- Staff: restrictive gates on the new tables (same model as staff_granular_permissions).
DROP POLICY IF EXISTS staff_perm_select_school_ci ON public.school_ci_assignments;
CREATE POLICY staff_perm_select_school_ci ON public.school_ci_assignments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.nlh_staff_can('{franchisees.view}'::text[]));
DROP POLICY IF EXISTS staff_perm_write_school_ci ON public.school_ci_assignments;
CREATE POLICY staff_perm_write_school_ci ON public.school_ci_assignments AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.nlh_staff_can('{accounting.edit}'::text[])) WITH CHECK (public.nlh_staff_can('{accounting.edit}'::text[]));
DROP POLICY IF EXISTS staff_perm_cf_terms ON public.cf_commission_terms;
CREATE POLICY staff_perm_cf_terms ON public.cf_commission_terms AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.nlh_staff_can('{accounting.edit}'::text[])) WITH CHECK (public.nlh_staff_can('{accounting.edit}'::text[]));
DROP POLICY IF EXISTS staff_perm_order_commission ON public.order_commission_lines;
CREATE POLICY staff_perm_order_commission ON public.order_commission_lines AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.nlh_staff_can('{accounting.edit}'::text[])) WITH CHECK (public.nlh_staff_can('{accounting.edit}'::text[]));
