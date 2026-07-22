
-- An order line can be a SKU (kit/supply) OR a raw inventory item (individual billing)
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.inventory_items(id);
ALTER TABLE public.order_items ALTER COLUMN sku_id DROP NOT NULL;
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_sku_or_item;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_sku_or_item
  CHECK (sku_id IS NOT NULL OR item_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_order_items_item ON public.order_items(item_id);
