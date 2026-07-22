
-- ── Permanent guard: every new public.users row inherits the auth user's id ────
-- No matter which code path creates the row (login auto-provision, /api/create-user,
-- manual insert), the id is forced to match the Supabase Auth UID for that email.
CREATE OR REPLACE FUNCTION public.align_user_id_to_auth()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE v_auth uuid;
BEGIN
  SELECT id INTO v_auth FROM auth.users WHERE lower(email) = lower(NEW.email) LIMIT 1;
  IF v_auth IS NOT NULL THEN
    NEW.id := v_auth;   -- align to the auth UID
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_align_user_id ON public.users;
CREATE TRIGGER tr_align_user_id
BEFORE INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION public.align_user_id_to_auth();

-- ── One-time clean-up: re-align existing mismatched rows that nothing references ─
WITH mism AS (
  SELECT u.id AS old_id, au.id AS new_id
  FROM public.users u
  JOIN auth.users au ON lower(au.email) = lower(u.email)
  WHERE u.id <> au.id
    AND NOT EXISTS (SELECT 1 FROM stock_movements     t WHERE t.created_by   = u.id)
    AND NOT EXISTS (SELECT 1 FROM notifications        t WHERE t.recipient_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM batch_students       t WHERE t.assigned_by  = u.id)
    AND NOT EXISTS (SELECT 1 FROM sessions             t WHERE t.logged_by    = u.id)
    AND NOT EXISTS (SELECT 1 FROM instructor_payments  t WHERE t.generated_by = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.users u2 WHERE u2.id = au.id)
)
UPDATE public.users u SET id = m.new_id
FROM mism m WHERE u.id = m.old_id;

-- ── Health check function admins can run anytime ──────────────────────────────
CREATE OR REPLACE FUNCTION public.users_id_mismatches()
RETURNS TABLE(email text, users_id uuid, auth_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT u.email, u.id, au.id
  FROM public.users u
  JOIN auth.users au ON lower(au.email) = lower(u.email)
  WHERE u.id <> au.id
$$;
