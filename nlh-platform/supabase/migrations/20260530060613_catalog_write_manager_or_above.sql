
-- Manager-and-above role check (owner, super_admin, admin, manager — excludes staff)
CREATE OR REPLACE FUNCTION public.nlh_is_manager_or_above()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT role IN ('owner','super_admin','admin','manager')
     FROM users WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1),
    false
  )
$$;

-- Courses: allow catalog writes for manager-and-above (read stays open)
DROP POLICY IF EXISTS courses_write ON public.courses;
CREATE POLICY courses_write ON public.courses
  FOR ALL USING (nlh_is_manager_or_above()) WITH CHECK (nlh_is_manager_or_above());

-- SKUs: tighten existing write policy from any-admin (incl. staff) to manager-and-above
DROP POLICY IF EXISTS skus_write ON public.skus;
CREATE POLICY skus_write ON public.skus
  FOR ALL USING (nlh_is_manager_or_above()) WITH CHECK (nlh_is_manager_or_above());
