
-- ══════════════════════════════════════════════════════════════
-- SECURITY HELPER FUNCTIONS
-- SECURITY DEFINER = run as postgres (bypass RLS when reading
-- users/franchisees to avoid infinite recursion)
-- ══════════════════════════════════════════════════════════════

-- 1. Is the calling user an NLH admin?
CREATE OR REPLACE FUNCTION nlh_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role IN ('owner','super_admin','admin','manager','staff')
     FROM users WHERE id = auth.uid()),
    false
  )
$$;

-- 2. Get calling user's franchisee_id
CREATE OR REPLACE FUNCTION nlh_my_franchisee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT franchisee_id FROM users WHERE id = auth.uid()
$$;

-- 3. Get all franchisee IDs the calling user may access
--    (their own + every descendant in the parent_id tree)
CREATE OR REPLACE FUNCTION nlh_accessible_franchisee_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE tree AS (
    SELECT id FROM franchisees
    WHERE id = (SELECT franchisee_id FROM users WHERE id = auth.uid())
    UNION ALL
    SELECT f.id FROM franchisees f
    INNER JOIN tree t ON f.parent_id = t.id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) FROM tree
$$;
