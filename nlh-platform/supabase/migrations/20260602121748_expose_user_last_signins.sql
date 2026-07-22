
-- Returns last_sign_in_at per user email. Admin-guarded: non-admins get nothing.
CREATE OR REPLACE FUNCTION public.user_last_signins()
RETURNS TABLE(email text, last_sign_in_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT au.email, au.last_sign_in_at
  FROM auth.users au
  WHERE public.nlh_is_admin()
$$;

GRANT EXECUTE ON FUNCTION public.user_last_signins() TO authenticated;
