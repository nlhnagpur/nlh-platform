
-- nlh_is_admin() was using "WHERE id = auth.uid()" but users.id is a random UUID,
-- not the Supabase auth UID. So it always returned false, breaking ALL admin RLS policies.
-- Fix: match by email from the JWT claim instead.

CREATE OR REPLACE FUNCTION nlh_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role IN ('owner','super_admin','admin','manager','staff')
     FROM users
     WHERE email ILIKE (auth.jwt() ->> 'email')
     LIMIT 1),
    false
  )
$$;

-- Also fix nlh_my_franchisee_id() which may have the same issue
CREATE OR REPLACE FUNCTION nlh_my_franchisee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT franchisee_id
  FROM users
  WHERE email ILIKE (auth.jwt() ->> 'email')
  LIMIT 1
$$;
