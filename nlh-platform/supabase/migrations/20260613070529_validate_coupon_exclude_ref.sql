CREATE OR REPLACE FUNCTION public.validate_coupon(p_code text, p_context text, p_amount numeric, p_franchisee uuid DEFAULT NULL::uuid, p_exclude_ref uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Exclude this ref's own existing redemption so re-applying on the same order/student is allowed
  SELECT count(*) INTO used FROM coupon_redemptions
    WHERE coupon_id = c.id AND (p_exclude_ref IS NULL OR ref_id <> p_exclude_ref);
  IF c.usage_limit IS NOT NULL AND used >= c.usage_limit THEN
     RETURN jsonb_build_object('valid', false, 'message', 'This coupon has reached its usage limit');
  END IF;
  IF c.per_franchisee_limit IS NOT NULL AND p_franchisee IS NOT NULL THEN
     SELECT count(*) INTO fused FROM coupon_redemptions
       WHERE coupon_id = c.id AND franchisee_id = p_franchisee AND (p_exclude_ref IS NULL OR ref_id <> p_exclude_ref);
     IF fused >= c.per_franchisee_limit THEN
        RETURN jsonb_build_object('valid', false, 'message', 'This coupon has already been used');
     END IF;
  END IF;
  disc := public._coupon_discount(c.discount_type, c.discount_value, c.max_discount, p_amount);
  RETURN jsonb_build_object('valid', true, 'coupon_id', c.id, 'code', c.code, 'discount', disc,
     'discount_type', c.discount_type, 'discount_value', c.discount_value, 'description', c.description);
END $function$;
