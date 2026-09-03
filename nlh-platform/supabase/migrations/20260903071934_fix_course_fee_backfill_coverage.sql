-- Fixes a real gap in the Phase 2 course_fee backfill: it only created a
-- Transaction for students who had a student_invoices row (9), but 34
-- students have fee_total > 0 — most students' fees were set directly
-- without ever generating a formal invoice document. Wipe and redo the
-- course_fee slice with a LEFT JOIN so every student with financial
-- activity (an invoice, a payment, or a non-zero fee) gets a Transaction,
-- not just the ones who happened to have an invoice.
--
-- Post-fix reconciliation (checked against the live DB):
--   course_fee transactions: 34  == students with fee_total > 0 (or a
--     payment, or an invoice): 34
--   course_fee total/paid sums == sum(students.fee_total)/sum(fee_paid) exactly
--   course_fee transaction_payments: 34 == student_payments rows: 34, sums equal
-- kit_order and franchise_fee slices from the prior migration already
-- reconciled exactly and are untouched here.

delete from transactions where type = 'course_fee';   -- cascades to its transaction_items/transaction_payments

create temporary table _t_student_map (student_id uuid primary key, transaction_id uuid not null);

insert into transactions (
  id, type, party_id, person_id, status,
  subtotal, discount_amount, coupon_id, coupon_code, total, amount_paid,
  metadata, created_at, updated_at
)
select
  gen_random_uuid(), 'course_fee', s.franchisee_id, s.id,
  case s.payment_status
    when 'paid' then 'paid'
    when 'partial' then 'part_paid'
    else 'confirmed'
  end,
  coalesce(inv.subtotal_sum, 0), coalesce(s.discount_amount, 0), s.coupon_id, s.coupon_code,
  coalesce(s.fee_total, 0), coalesce(s.fee_paid, 0),
  case when inv.invoice_nos is not null
    then jsonb_build_object('invoice_nos', inv.invoice_nos, 'invoice_ids', inv.invoice_ids)
    else '{}'::jsonb
  end,
  coalesce(inv.first_created, s.created_at), coalesce(inv.first_created, s.created_at)
from students s
left join (
  select student_id,
    sum(subtotal) subtotal_sum,
    array_agg(invoice_no order by created_at) filter (where invoice_no is not null) invoice_nos,
    array_agg(id order by created_at) invoice_ids,
    min(created_at) first_created
  from student_invoices
  group by student_id
) inv on inv.student_id = s.id
where coalesce(s.fee_total, 0) > 0
   or inv.student_id is not null
   or exists (select 1 from student_payments sp where sp.student_id = s.id);

insert into _t_student_map (student_id, transaction_id)
select t.person_id, t.id from transactions t where t.type = 'course_fee';

insert into transaction_items (transaction_id, sku_id, item_id, enrollment_id, name, qty, rate, amount, created_at)
select
  m.transaction_id,
  nullif(li->>'sku_id','')::uuid,
  nullif(li->>'item_id','')::uuid,
  nullif(li->>'enrollment_id','')::uuid,
  li->>'name',
  coalesce((li->>'qty')::int, 1),
  coalesce((li->>'rate')::int, 0),
  coalesce((li->>'amount')::int, 0),
  si.created_at
from student_invoices si
join _t_student_map m on m.student_id = si.student_id
cross join lateral jsonb_array_elements(si.items) as li;

insert into transaction_payments (transaction_id, amount, paid_on, mode, reference, note, recorded_by, receipt_no, created_at)
select m.transaction_id, sp.amount, sp.paid_at, sp.mode, sp.reference, sp.note, null, sp.receipt_no, sp.created_at
from student_payments sp
join _t_student_map m on m.student_id = sp.student_id;

drop table _t_student_map;
