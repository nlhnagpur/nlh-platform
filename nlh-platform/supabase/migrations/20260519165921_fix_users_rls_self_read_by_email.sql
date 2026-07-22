
-- The users.id is a random UUID (uuid_generate_v4()), NOT the Supabase auth UID.
-- The previous policy "id = auth.uid()" never matched for non-admin users,
-- blocking them from reading their own row and breaking login for everyone.
-- Fix: match by email instead, which is the actual unique identifier used throughout the app.

DROP POLICY IF EXISTS users_select ON users;
DROP POLICY IF EXISTS users_update ON users;

-- SELECT: admins see all rows; every authenticated user sees their own row by email
CREATE POLICY users_select ON users
  FOR SELECT TO authenticated
  USING (
    nlh_is_admin()
    OR email ILIKE (auth.jwt() ->> 'email')
  );

-- UPDATE: admins update any row; users can update only their own row by email
CREATE POLICY users_update ON users
  FOR UPDATE TO authenticated
  USING (
    nlh_is_admin()
    OR email ILIKE (auth.jwt() ->> 'email')
  )
  WITH CHECK (
    nlh_is_admin()
    OR email ILIKE (auth.jwt() ->> 'email')
  );
