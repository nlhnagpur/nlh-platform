
-- Sequential receipt numbers for student payments: RCP-YYYY-XXXX
ALTER TABLE public.student_payments ADD COLUMN IF NOT EXISTS receipt_no text;

CREATE SEQUENCE IF NOT EXISTS public.receipt_seq;

CREATE OR REPLACE FUNCTION public.assign_receipt_no()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.receipt_no IS NULL THEN
    NEW.receipt_no := 'RCP-' || to_char(now(), 'YYYY') || '-' ||
                      lpad(nextval('public.receipt_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_receipt_no ON public.student_payments;
CREATE TRIGGER trg_receipt_no BEFORE INSERT ON public.student_payments
  FOR EACH ROW EXECUTE FUNCTION public.assign_receipt_no();
