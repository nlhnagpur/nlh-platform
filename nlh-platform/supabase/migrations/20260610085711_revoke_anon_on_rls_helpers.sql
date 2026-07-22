
-- These return only the caller's own status and are used by RLS for signed-in
-- users. anon never hits a policy that calls them, so revoke anon (keep authenticated).
REVOKE EXECUTE ON FUNCTION public.nlh_is_admin()                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.nlh_is_manager_or_above()       FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_franchisee_id()              FROM anon;
REVOKE EXECUTE ON FUNCTION public.nlh_my_franchisee_id()          FROM anon;
REVOKE EXECUTE ON FUNCTION public.nlh_accessible_franchisee_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_ho_admin()                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_descendant_ids(uuid)        FROM anon;
