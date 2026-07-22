
CREATE OR REPLACE FUNCTION public.nlh_accessible_franchisee_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH RECURSIVE tree AS (
    SELECT id FROM franchisees
    WHERE id = (
      SELECT franchisee_id FROM users
      WHERE email ILIKE (auth.jwt() ->> 'email')
      LIMIT 1
    )
    UNION ALL
    SELECT f.id FROM franchisees f
    INNER JOIN tree t ON f.parent_id = t.id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) FROM tree
$function$
;
