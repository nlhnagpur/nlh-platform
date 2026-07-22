
-- Changes a login email across Auth + app rows in one transaction.
-- SECURITY DEFINER so it can touch the auth schema; guarded to admins only.
CREATE OR REPLACE FUNCTION public.admin_change_email(p_old text, p_new text, p_table text, p_row uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE v_uid uuid;
BEGIN
  IF NOT public.nlh_is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_new IS NULL OR p_old IS NULL OR position('@' in p_new) = 0 THEN
    RAISE EXCEPTION 'Invalid email';
  END IF;

  -- New email must not already belong to a different login
  IF EXISTS (SELECT 1 FROM public.users WHERE email ILIKE p_new AND NOT (email ILIKE p_old)) THEN
    RAISE EXCEPTION 'That email is already in use by another account';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email ILIKE p_new AND NOT (email ILIKE p_old)) THEN
    RAISE EXCEPTION 'That email is already in use by another account';
  END IF;

  SELECT id INTO v_uid FROM auth.users WHERE email ILIKE p_old LIMIT 1;

  IF v_uid IS NOT NULL THEN
    UPDATE auth.users
      SET email = p_new,
          email_confirmed_at = COALESCE(email_confirmed_at, now())
      WHERE id = v_uid;
    UPDATE auth.identities
      SET identity_data = jsonb_set(COALESCE(identity_data, '{}'::jsonb), '{email}', to_jsonb(p_new))
      WHERE user_id = v_uid AND provider = 'email';
    UPDATE public.users SET email = p_new WHERE id = v_uid;
  END IF;

  IF p_table = 'franchisees' AND p_row IS NOT NULL THEN
    UPDATE public.franchisees SET email = p_new WHERE id = p_row;
  ELSIF p_table = 'students' AND p_row IS NOT NULL THEN
    UPDATE public.students SET email = p_new WHERE id = p_row;
  END IF;

  RETURN json_build_object('success', true, 'had_login', v_uid IS NOT NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_change_email(text, text, text, uuid) TO authenticated;
