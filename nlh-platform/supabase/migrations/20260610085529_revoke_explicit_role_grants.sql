
-- Trigger functions: no caller needs EXECUTE (the trigger runs them). Revoke from all.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'align_user_id_to_auth()','assign_franchisee_role()','assign_receipt_no()',
    'generate_invoice_no()','generate_order_ref()','guard_order_update()','guard_user_update()',
    'prevent_franchisee_escalation()','prevent_role_escalation()','recalc_order_totals()','recompute_student_fee_paid()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon, authenticated, PUBLIC', fn);
  END LOOP;
END $$;

-- Sensitive admin + coupon RPCs: signed-in only (revoke anon, keep authenticated)
REVOKE EXECUTE ON FUNCTION public.admin_change_email(text, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_last_signins()  FROM anon;
REVOKE EXECUTE ON FUNCTION public.users_id_mismatches() FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_coupon(text, text, numeric, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.redeem_coupon(text, text, numeric, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.clear_coupon_redemption(text, uuid) FROM anon;
