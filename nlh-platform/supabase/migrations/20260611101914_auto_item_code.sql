
CREATE SEQUENCE IF NOT EXISTS public.inventory_item_seq;

CREATE OR REPLACE FUNCTION public.assign_item_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.item_code IS NULL OR NEW.item_code = '' THEN
    NEW.item_code := 'ITM-' || lpad(nextval('public.inventory_item_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_item_code ON public.inventory_items;
CREATE TRIGGER trg_item_code BEFORE INSERT ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.assign_item_code();

REVOKE EXECUTE ON FUNCTION public.assign_item_code() FROM anon, authenticated, PUBLIC;
