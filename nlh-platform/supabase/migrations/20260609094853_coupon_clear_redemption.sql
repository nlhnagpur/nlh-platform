
-- Admin-only: remove any redemption(s) for an order/student ref (used when an
-- admin changes or removes the coupon at invoicing) and recompute counters.
CREATE OR REPLACE FUNCTION public.clear_coupon_redemption(p_context text, p_ref uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cids uuid[];
BEGIN
  IF NOT nlh_is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT array_agg(DISTINCT coupon_id) INTO cids FROM coupon_redemptions WHERE context = p_context AND ref_id = p_ref;
  DELETE FROM coupon_redemptions WHERE context = p_context AND ref_id = p_ref;
  IF cids IS NOT NULL THEN
    UPDATE coupons SET used_count = (SELECT count(*) FROM coupon_redemptions WHERE coupon_id = coupons.id)
    WHERE id = ANY(cids);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.clear_coupon_redemption(text, uuid) TO authenticated;
