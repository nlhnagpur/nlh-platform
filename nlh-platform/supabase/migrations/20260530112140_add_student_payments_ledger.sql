
-- ── Student fee payment ledger ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  franchisee_id uuid,
  amount        integer NOT NULL,
  mode          text,
  reference     text,
  paid_at       date NOT NULL DEFAULT current_date,
  note          text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_payments_student ON public.student_payments(student_id);

ALTER TABLE public.student_payments ENABLE ROW LEVEL SECURITY;

-- Same scoping as students: admins see all; franchisees see their own tree
CREATE POLICY student_payments_select ON public.student_payments
  FOR SELECT USING (nlh_is_admin() OR franchisee_id = ANY (nlh_accessible_franchisee_ids()));
CREATE POLICY student_payments_insert ON public.student_payments
  FOR INSERT WITH CHECK (nlh_is_admin() OR franchisee_id = ANY (nlh_accessible_franchisee_ids()));
CREATE POLICY student_payments_update ON public.student_payments
  FOR UPDATE USING (nlh_is_admin() OR franchisee_id = ANY (nlh_accessible_franchisee_ids()));
CREATE POLICY student_payments_delete ON public.student_payments
  FOR DELETE USING (nlh_is_admin() OR franchisee_id = ANY (nlh_accessible_franchisee_ids()));

-- ── Keep students.fee_paid + payment_status in sync with the ledger ───────────
CREATE OR REPLACE FUNCTION public.recompute_student_fee_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_student uuid;
  v_paid    integer;
  v_total   integer;
  v_status  text;
BEGIN
  v_student := COALESCE(NEW.student_id, OLD.student_id);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid  FROM public.student_payments WHERE student_id = v_student;
  SELECT COALESCE(fee_total, 0)   INTO v_total FROM public.students         WHERE id = v_student;
  IF    v_total = 0     THEN v_status := 'none';
  ELSIF v_paid  <= 0    THEN v_status := 'pending';
  ELSIF v_paid  >= v_total THEN v_status := 'paid';
  ELSE  v_status := 'partial';
  END IF;
  UPDATE public.students SET fee_paid = v_paid, payment_status = v_status WHERE id = v_student;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_recompute_fee_paid ON public.student_payments;
CREATE TRIGGER tr_recompute_fee_paid
AFTER INSERT OR UPDATE OR DELETE ON public.student_payments
FOR EACH ROW EXECUTE FUNCTION public.recompute_student_fee_paid();

-- ── Backfill: turn each student's existing fee_paid into an opening entry ──────
INSERT INTO public.student_payments (student_id, franchisee_id, amount, mode, paid_at, note)
SELECT id, franchisee_id, fee_paid,
       COALESCE(payment_mode, 'opening'),
       COALESCE(registered_at, created_at::date, current_date),
       'Opening balance (migrated)'
FROM public.students
WHERE COALESCE(fee_paid, 0) > 0;
