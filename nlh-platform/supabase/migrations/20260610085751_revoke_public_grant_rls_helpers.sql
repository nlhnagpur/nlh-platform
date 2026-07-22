
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'nlh_is_admin()','nlh_is_manager_or_above()','my_franchisee_id()','nlh_my_franchisee_id()',
    'nlh_accessible_franchisee_ids()','is_ho_admin()','get_descendant_ids(uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;
