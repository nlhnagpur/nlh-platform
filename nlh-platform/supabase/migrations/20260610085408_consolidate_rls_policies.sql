
-- courses: single SELECT (read_courses) + write-only policies (no ALL overlap on SELECT)
DROP POLICY IF EXISTS courses_write ON public.courses;
CREATE POLICY courses_write_ins ON public.courses FOR INSERT WITH CHECK ((select public.nlh_is_manager_or_above()));
CREATE POLICY courses_write_upd ON public.courses FOR UPDATE USING ((select public.nlh_is_manager_or_above()));
CREATE POLICY courses_write_del ON public.courses FOR DELETE USING ((select public.nlh_is_manager_or_above()));

-- skus: same treatment
DROP POLICY IF EXISTS skus_write ON public.skus;
CREATE POLICY skus_write_ins ON public.skus FOR INSERT WITH CHECK ((select public.nlh_is_manager_or_above()));
CREATE POLICY skus_write_upd ON public.skus FOR UPDATE USING ((select public.nlh_is_manager_or_above()));
CREATE POLICY skus_write_del ON public.skus FOR DELETE USING ((select public.nlh_is_manager_or_above()));

-- franchisee_payments: one clean SELECT (admin OR own) + admin-only writes, init-plan optimised
DROP POLICY IF EXISTS admins_all          ON public.franchisee_payments;
DROP POLICY IF EXISTS franchisee_read_own ON public.franchisee_payments;
CREATE POLICY fp_select     ON public.franchisee_payments FOR SELECT
  USING ((select public.nlh_is_admin()) OR franchisee_id = (select public.my_franchisee_id()));
CREATE POLICY fp_write_ins  ON public.franchisee_payments FOR INSERT WITH CHECK ((select public.nlh_is_admin()));
CREATE POLICY fp_write_upd  ON public.franchisee_payments FOR UPDATE USING ((select public.nlh_is_admin()));
CREATE POLICY fp_write_del  ON public.franchisee_payments FOR DELETE USING ((select public.nlh_is_admin()));
