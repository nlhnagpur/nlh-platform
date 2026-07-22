
-- ── 1. Update guard_user_update to allow first-time franchisee onboarding ──
-- Adds an exception: a user may set franchisee_id once (NULL → value)
-- as long as the new role is not an admin role.
CREATE OR REPLACE FUNCTION public.guard_user_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
  FROM public.users
  WHERE email ILIKE (auth.jwt() ->> 'email')
  LIMIT 1;

  -- Admins may update anything
  IF v_role IN ('owner','super_admin','admin','manager','staff') THEN
    RETURN NEW;
  END IF;

  -- Allow first-time franchisee onboarding only:
  --   franchisee_id is being set for the first time (NULL → value)
  --   AND the new role is not an elevated admin role
  IF OLD.franchisee_id IS NULL
     AND NEW.franchisee_id IS NOT NULL
     AND NEW.role NOT IN ('owner','super_admin','admin','manager','staff')
  THEN
    RETURN NEW;
  END IF;

  -- All other role or franchisee_id changes are blocked for non-admins
  IF
    NEW.role           IS DISTINCT FROM OLD.role           OR
    NEW.franchisee_id  IS DISTINCT FROM OLD.franchisee_id
  THEN
    RAISE EXCEPTION 'Permission denied: role and franchisee_id can only be changed by an administrator';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 2. Auto-assign role + franchisee_id on franchisee onboarding insert ──
CREATE OR REPLACE FUNCTION public.assign_franchisee_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.users
  SET
    role          = lower(NEW.tier),
    franchisee_id = NEW.id
  WHERE email ILIKE NEW.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_franchisee_onboarded ON public.franchisees;
CREATE TRIGGER tr_franchisee_onboarded
AFTER INSERT ON public.franchisees
FOR EACH ROW EXECUTE FUNCTION public.assign_franchisee_role();
