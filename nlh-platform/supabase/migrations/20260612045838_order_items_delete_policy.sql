
-- Allow removing order lines (admins, or a franchisee on their own-tree order).
-- Mirrors the existing select/update policies. Without this, line deletes were
-- silently blocked by RLS.
CREATE POLICY order_items_delete ON public.order_items FOR DELETE
  USING (
    nlh_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND o.placer_id = ANY (nlh_accessible_franchisee_ids())
    )
  );
