
-- ── Users: only admins can write; everyone reads own row ──────────────────────
-- A franchisee must NOT be able to update their own role or franchisee_id.
DROP POLICY IF EXISTS users_insert ON users;
DROP POLICY IF EXISTS users_update ON users;
DROP POLICY IF EXISTS users_delete ON users;

CREATE POLICY users_insert ON users FOR INSERT TO authenticated
  WITH CHECK (nlh_is_admin());

-- Non-admins can only update harmless profile fields (name/phone).
-- Protect role, franchisee_id, is_active via a trigger instead (see below).
CREATE POLICY users_update ON users FOR UPDATE TO authenticated
  USING (nlh_is_admin() OR id = auth.uid())
  WITH CHECK (nlh_is_admin() OR id = auth.uid());

CREATE POLICY users_delete ON users FOR DELETE TO authenticated
  USING (nlh_is_admin());

-- Trigger: prevent non-admins from escalating their own role/franchisee_id
CREATE OR REPLACE FUNCTION prevent_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If caller is not an admin, block changes to sensitive columns
  IF NOT nlh_is_admin() THEN
    IF NEW.role         IS DISTINCT FROM OLD.role         THEN
      RAISE EXCEPTION 'Permission denied: cannot change role';
    END IF;
    IF NEW.franchisee_id IS DISTINCT FROM OLD.franchisee_id THEN
      RAISE EXCEPTION 'Permission denied: cannot change franchisee_id';
    END IF;
    IF NEW.is_active    IS DISTINCT FROM OLD.is_active    THEN
      RAISE EXCEPTION 'Permission denied: cannot change is_active';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_role_escalation ON users;
CREATE TRIGGER trg_prevent_role_escalation
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION prevent_role_escalation();

-- ── Franchisees: non-admins can update contact/address fields only ────────────
-- Block changes to tier, registered_courses, registered_skus, parent_id, status.
CREATE OR REPLACE FUNCTION prevent_franchisee_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT nlh_is_admin() THEN
    IF NEW.tier               IS DISTINCT FROM OLD.tier               THEN
      RAISE EXCEPTION 'Permission denied: cannot change tier';
    END IF;
    IF NEW.parent_id          IS DISTINCT FROM OLD.parent_id          THEN
      RAISE EXCEPTION 'Permission denied: cannot change parent_id';
    END IF;
    IF NEW.status             IS DISTINCT FROM OLD.status             THEN
      RAISE EXCEPTION 'Permission denied: cannot change status';
    END IF;
    IF NEW.registered_courses IS DISTINCT FROM OLD.registered_courses THEN
      RAISE EXCEPTION 'Permission denied: cannot change registered_courses';
    END IF;
    IF NEW.registered_skus    IS DISTINCT FROM OLD.registered_skus    THEN
      RAISE EXCEPTION 'Permission denied: cannot change registered_skus';
    END IF;
    IF NEW.enrollment_fee     IS DISTINCT FROM OLD.enrollment_fee     THEN
      RAISE EXCEPTION 'Permission denied: cannot change enrollment_fee';
    END IF;
    IF NEW.renewal_fee        IS DISTINCT FROM OLD.renewal_fee        THEN
      RAISE EXCEPTION 'Permission denied: cannot change renewal_fee';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_franchisee_escalation ON franchisees;
CREATE TRIGGER trg_prevent_franchisee_escalation
  BEFORE UPDATE ON franchisees
  FOR EACH ROW EXECUTE FUNCTION prevent_franchisee_escalation();
