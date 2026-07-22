DROP FUNCTION IF EXISTS public.validate_coupon(text, text, numeric, uuid);
REVOKE ALL ON FUNCTION public.validate_coupon(text, text, numeric, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text, text, numeric, uuid, uuid) TO authenticated;
