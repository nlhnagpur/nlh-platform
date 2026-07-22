
CREATE OR REPLACE FUNCTION public.get_descendant_ids(root_id UUID)
RETURNS TABLE (id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE hierarchy AS (
    -- Seed: direct children of root
    SELECT f.id
    FROM   public.franchisees f
    WHERE  f.parent_id = root_id

    UNION ALL

    -- Recurse: children of each node already in the tree
    SELECT f.id
    FROM   public.franchisees f
    INNER JOIN hierarchy h ON f.parent_id = h.id
  )
  SELECT h.id FROM hierarchy h;
END;
$$;

-- Allow all authenticated users to call it (RLS on franchisees still applies
-- for any data they can directly query; this fn only returns IDs)
GRANT EXECUTE ON FUNCTION public.get_descendant_ids(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_descendant_ids(UUID) TO anon;
