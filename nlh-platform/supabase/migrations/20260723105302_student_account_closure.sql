-- Closing a student who left mid-course. Three facts to record, none of which
-- the schema could express before: the courses were discontinued (not
-- completed, so no certificate), the balance was written off (a waiver, never a
-- payment), and the student is no longer active.
alter table students add column if not exists closed_at     timestamptz;
alter table students add column if not exists close_reason  text;
alter table students add column if not exists waived_amount integer not null default 0;

-- The fee-rollup trigger recomputes payment_status on any payment change. A
-- closed student is settled by waiver, so an incidental edit to a past receipt
-- must not drag them back to 'partial'. fee_paid stays accurate either way.
create or replace function recompute_student_fee_paid() returns trigger
language plpgsql security definer set search_path = public as $$
DECLARE
  v_student uuid;
  v_paid    integer;
  v_total   integer;
  v_status  text;
  v_active  boolean;
BEGIN
  v_student := COALESCE(NEW.student_id, OLD.student_id);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.student_payments WHERE student_id = v_student;
  SELECT COALESCE(fee_total, 0), is_active INTO v_total, v_active FROM public.students WHERE id = v_student;

  IF    v_total = 0        THEN v_status := 'none';
  ELSIF v_paid  <= 0       THEN v_status := 'pending';
  ELSIF v_paid  >= v_total THEN v_status := 'paid';
  ELSE  v_status := 'partial';
  END IF;

  -- Only move a live student's status; leave a closed/waived one settled.
  IF v_active = false THEN
    UPDATE public.students SET fee_paid = v_paid WHERE id = v_student;
  ELSE
    UPDATE public.students SET fee_paid = v_paid, payment_status = v_status WHERE id = v_student;
  END IF;
  RETURN NULL;
END $$;
