
-- ── Inventory items (atomic physical stock units) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code     text UNIQUE,
  name          text NOT NULL,
  category      text NOT NULL DEFAULT 'component',   -- book|component|material|marketing|uniform|consumable|other
  unit          text NOT NULL DEFAULT 'pcs',
  hsn_code      text,
  default_cost  integer NOT NULL DEFAULT 0,
  reorder_level integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Extend SKUs: course kit vs standalone supply ───────────────────────────
ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS sku_type        text NOT NULL DEFAULT 'course_kit',  -- course_kit | supply
  ADD COLUMN IF NOT EXISTS supply_category text;
ALTER TABLE public.skus ALTER COLUMN course_id DROP NOT NULL;
UPDATE public.skus SET sku_type = 'course_kit' WHERE sku_type IS NULL;

-- ── Kit contents = bill of materials (which items make a SKU) ──────────────
CREATE TABLE IF NOT EXISTS public.kit_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id     uuid NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity   numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sku_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_kit_items_sku ON public.kit_items(sku_id);

-- ── Stock ledger (one row per movement; balance = SUM(qty)) ────────────────
CREATE TABLE IF NOT EXISTS public.stock_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  location_type text NOT NULL DEFAULT 'ho',          -- ho | franchisee
  franchisee_id uuid REFERENCES public.franchisees(id),
  movement_type text NOT NULL,                        -- receipt|issue_to_franchisee|receive_from_ho|issue_to_student|adjustment|return
  qty           integer NOT NULL,                     -- signed: +in / -out
  unit_cost     integer,
  ref_type      text,                                 -- purchase|order|enrollment|manual
  ref_id        uuid,
  note          text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_item ON public.stock_ledger(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_ref  ON public.stock_ledger(ref_type, ref_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_ledger    ENABLE ROW LEVEL SECURITY;

CREATE POLICY inv_items_read   ON public.inventory_items FOR SELECT USING ((select nlh_is_admin()));
CREATE POLICY inv_items_ins    ON public.inventory_items FOR INSERT WITH CHECK ((select nlh_is_manager_or_above()));
CREATE POLICY inv_items_upd    ON public.inventory_items FOR UPDATE USING ((select nlh_is_manager_or_above()));
CREATE POLICY inv_items_del    ON public.inventory_items FOR DELETE USING ((select nlh_is_manager_or_above()));

CREATE POLICY kit_items_read   ON public.kit_items FOR SELECT USING ((select nlh_is_admin()));
CREATE POLICY kit_items_ins    ON public.kit_items FOR INSERT WITH CHECK ((select nlh_is_manager_or_above()));
CREATE POLICY kit_items_upd    ON public.kit_items FOR UPDATE USING ((select nlh_is_manager_or_above()));
CREATE POLICY kit_items_del    ON public.kit_items FOR DELETE USING ((select nlh_is_manager_or_above()));

CREATE POLICY stock_read       ON public.stock_ledger FOR SELECT USING ((select nlh_is_admin()));
CREATE POLICY stock_ins        ON public.stock_ledger FOR INSERT WITH CHECK ((select nlh_is_admin()));
CREATE POLICY stock_del        ON public.stock_ledger FOR DELETE USING ((select nlh_is_manager_or_above()));
