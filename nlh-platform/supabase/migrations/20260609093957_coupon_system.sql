
-- ── Coupons ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coupons (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text UNIQUE NOT NULL,
  description          text,
  discount_type        text NOT NULL CHECK (discount_type IN ('percent','flat')),
  discount_value       numeric NOT NULL CHECK (discount_value > 0),
  applies_to           text NOT NULL DEFAULT 'both' CHECK (applies_to IN ('orders','students','both')),
  min_amount           integer NOT NULL DEFAULT 0,
  max_discount         integer,                       -- cap (for % coupons), null = no cap
  usage_limit          integer,                       -- total redemptions, null = unlimited
  per_franchisee_limit integer,                       -- per-franchisee cap, null = unlimited
  used_count           integer NOT NULL DEFAULT 0,
  valid_from           timestamptz,
  valid_until          timestamptz,
  active               boolean NOT NULL DEFAULT true,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ── Redemption ledger ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id        uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  context          text NOT NULL CHECK (context IN ('order','student')),
  ref_id           uuid NOT NULL,                     -- order id or student id
  order_id         uuid,
  student_id       uuid,
  franchisee_id    uuid,
  base_amount      integer NOT NULL DEFAULT 0,
  discount_amount  integer NOT NULL DEFAULT 0,
  redeemed_by      uuid,
  redeemed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_redemption_ref ON public.coupon_redemptions(coupon_id, context, ref_id);
CREATE INDEX IF NOT EXISTS idx_redemption_coupon ON public.coupon_redemptions(coupon_id);

-- ── Discount columns on orders & students ──────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS coupon_id uuid,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS discount_amount integer NOT NULL DEFAULT 0;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS coupon_id uuid,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS discount_amount integer NOT NULL DEFAULT 0;

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coupons_read   ON public.coupons;
DROP POLICY IF EXISTS coupons_write  ON public.coupons;
DROP POLICY IF EXISTS coupons_update ON public.coupons;
DROP POLICY IF EXISTS coupons_delete ON public.coupons;
CREATE POLICY coupons_read   ON public.coupons FOR SELECT USING (nlh_is_admin());
CREATE POLICY coupons_write  ON public.coupons FOR INSERT WITH CHECK (nlh_is_manager_or_above());
CREATE POLICY coupons_update ON public.coupons FOR UPDATE USING (nlh_is_manager_or_above());
CREATE POLICY coupons_delete ON public.coupons FOR DELETE USING (nlh_is_manager_or_above());

DROP POLICY IF EXISTS redemptions_read ON public.coupon_redemptions;
CREATE POLICY redemptions_read ON public.coupon_redemptions FOR SELECT USING (nlh_is_admin());

-- ── Discount math (shared) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._coupon_discount(p_type text, p_value numeric, p_max integer, p_amount numeric)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(0, LEAST(
    CASE WHEN p_type = 'percent' THEN round(p_amount * p_value / 100.0) ELSE p_value END,
    COALESCE(p_max, 2147483647),
    p_amount
  ))::integer
$$;

-- ── Validate (read-only preview) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_coupon(p_code text, p_context text, p_amount numeric, p_franchisee uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.coupons; used int; fused int; disc int;
BEGIN
  SELECT * INTO c FROM coupons WHERE code = upper(trim(p_code)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'message', 'Coupon not found'); END IF;
  IF NOT c.active THEN RETURN jsonb_build_object('valid', false, 'message', 'This coupon is inactive'); END IF;
  IF c.valid_from  IS NOT NULL AND now() < c.valid_from  THEN RETURN jsonb_build_object('valid', false, 'message', 'This coupon is not active yet'); END IF;
  IF c.valid_until IS NOT NULL AND now() > c.valid_until THEN RETURN jsonb_build_object('valid', false, 'message', 'This coupon has expired'); END IF;
  IF c.applies_to <> 'both' AND c.applies_to <> p_context || 's' THEN
     RETURN jsonb_build_object('valid', false, 'message', 'This coupon cannot be used here');
  END IF;
  IF p_amount < COALESCE(c.min_amount, 0) THEN
     RETURN jsonb_build_object('valid', false, 'message', 'Requires a minimum of ' || c.min_amount);
  END IF;
  SELECT count(*) INTO used FROM coupon_redemptions WHERE coupon_id = c.id;
  IF c.usage_limit IS NOT NULL AND used >= c.usage_limit THEN
     RETURN jsonb_build_object('valid', false, 'message', 'This coupon has reached its usage limit');
  END IF;
  IF c.per_franchisee_limit IS NOT NULL AND p_franchisee IS NOT NULL THEN
     SELECT count(*) INTO fused FROM coupon_redemptions WHERE coupon_id = c.id AND franchisee_id = p_franchisee;
     IF fused >= c.per_franchisee_limit THEN
        RETURN jsonb_build_object('valid', false, 'message', 'This coupon has already been used');
     END IF;
  END IF;
  disc := public._coupon_discount(c.discount_type, c.discount_value, c.max_discount, p_amount);
  RETURN jsonb_build_object('valid', true, 'coupon_id', c.id, 'code', c.code, 'discount', disc,
     'discount_type', c.discount_type, 'discount_value', c.discount_value, 'description', c.description);
END $$;

-- ── Redeem (idempotent per order/student, records ledger, bumps counter) ────
CREATE OR REPLACE FUNCTION public.redeem_coupon(p_code text, p_context text, p_amount numeric, p_franchisee uuid, p_ref uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.coupons; v jsonb; disc int; uid uuid; existing boolean;
BEGIN
  SELECT * INTO c FROM coupons WHERE code = upper(trim(p_code)) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'message', 'Coupon not found'); END IF;
  SELECT EXISTS (SELECT 1 FROM coupon_redemptions WHERE coupon_id = c.id AND context = p_context AND ref_id = p_ref) INTO existing;
  v := public.validate_coupon(p_code, p_context, p_amount, p_franchisee);
  IF NOT (v->>'valid')::boolean AND NOT existing THEN RETURN v; END IF;
  disc := public._coupon_discount(c.discount_type, c.discount_value, c.max_discount, p_amount);
  uid  := (SELECT id FROM users WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1);
  INSERT INTO coupon_redemptions(coupon_id, context, ref_id, order_id, student_id, franchisee_id, base_amount, discount_amount, redeemed_by)
  VALUES (c.id, p_context, p_ref,
          CASE WHEN p_context = 'order'   THEN p_ref END,
          CASE WHEN p_context = 'student' THEN p_ref END,
          p_franchisee, p_amount::int, disc, uid)
  ON CONFLICT (coupon_id, context, ref_id)
  DO UPDATE SET base_amount = EXCLUDED.base_amount, discount_amount = EXCLUDED.discount_amount;
  UPDATE coupons SET used_count = (SELECT count(*) FROM coupon_redemptions WHERE coupon_id = c.id) WHERE id = c.id;
  RETURN jsonb_build_object('valid', true, 'coupon_id', c.id, 'code', c.code, 'discount', disc);
END $$;

GRANT EXECUTE ON FUNCTION public.validate_coupon(text, text, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_coupon(text, text, numeric, uuid, uuid) TO authenticated;
