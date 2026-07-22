
-- 1) Pin search_path on the 9 flagged functions
ALTER FUNCTION public.is_ho_admin()                                              SET search_path = public;
ALTER FUNCTION public.generate_order_ref()                                       SET search_path = public;
ALTER FUNCTION public.generate_invoice_no()                                      SET search_path = public;
ALTER FUNCTION public.next_journal_no()                                          SET search_path = public;
ALTER FUNCTION public.recalc_order_totals()                                      SET search_path = public;
ALTER FUNCTION public.next_order_ref()                                           SET search_path = public;
ALTER FUNCTION public.get_descendant_ids(uuid)                                   SET search_path = public;
ALTER FUNCTION public._coupon_discount(text, numeric, integer, numeric)          SET search_path = public;
ALTER FUNCTION public.assign_receipt_no()                                        SET search_path = public;

-- 2) Trigger functions should never be callable from the public API
REVOKE EXECUTE ON FUNCTION public.align_user_id_to_auth()         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_franchisee_role()        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_receipt_no()            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_invoice_no()         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_order_ref()          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_order_update()          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_user_update()           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_franchisee_escalation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_role_escalation()     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalc_order_totals()         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_student_fee_paid()  FROM PUBLIC;

-- 3) Sensitive admin/coupon RPCs: signed-in users only, never anon
REVOKE EXECUTE ON FUNCTION public.admin_change_email(text, text, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_change_email(text, text, text, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.user_last_signins()  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_last_signins()  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.users_id_mismatches() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.users_id_mismatches() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_coupon(text, text, numeric, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.validate_coupon(text, text, numeric, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.redeem_coupon(text, text, numeric, uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.redeem_coupon(text, text, numeric, uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_coupon_redemption(text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.clear_coupon_redemption(text, uuid) TO authenticated;

-- 4) Tighten the WhatsApp webhook insert policy: anon may only add INBOUND rows
--    (prevents spoofing outbound/tracking data; webhook still works on either key)
DROP POLICY IF EXISTS webhook_insert ON public.whatsapp_messages;
CREATE POLICY webhook_insert ON public.whatsapp_messages
  FOR INSERT TO anon
  WITH CHECK (direction = 'inbound');

-- 5) Public chat-attachments bucket: stop allowing clients to LIST all files
--    (objects remain reachable by their direct public URL)
DROP POLICY IF EXISTS "chat_attach_read" ON storage.objects;
