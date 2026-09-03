-- Phase 2 of the transaction-model migration (see
-- nlh-platform/docs/transaction-model-migration-plan.md). One-time backfill
-- from the six legacy tables into transactions/transaction_items/
-- transaction_payments. Purely additive — nothing is deleted or modified in
-- orders, order_items, order_payments, student_invoices, student_payments,
-- franchisee_payments. Nothing reads the new tables yet, so this is fully
-- re-runnable (wipe the three new tables and re-run) if anything's wrong.
--
-- NOTE: the course_fee slice below has a known coverage gap, fixed in the
-- very next migration (20260903071934_fix_course_fee_backfill_coverage.sql)
-- — kept as originally applied for an accurate history rather than edited
-- after the fact.
--
-- Design notes settled during this backfill (updates the plan doc):
--  - kit_order: one Transaction per order, id REUSED from orders.id so any
--    future reference by the old id still resolves.
--  - course_fee: one Transaction per STUDENT, not per invoice. The app
--    already tracks a student's balance as one pooled fee_total/fee_paid
--    on the students row, with payments recorded against the student, not
--    against any one invoice — multiple invoices (e.g. one per add-on
--    course) all feed the same balance. Individual invoice numbers are
--    preserved in metadata.invoice_nos since document_no can only hold one
--    value and there isn't a single governing invoice per student.
--  - franchise_fee: one Transaction per franchisee, matching today's single
--    running-balance model (enrollment_fee / fee_paid on the franchisees
--    row), same reasoning as course_fee.
--  - commission_payout (franchisee_credit_notes): 0 rows today — nothing to
--    backfill.

-- ── kit_order ────────────────────────────────────────────────────────────
insert into transactions (
  id, type, party_id, bill_to_party_id, placer_id, placer_tier, status,
  subtotal, discount_amount, coupon_id, coupon_code, tax_amount, total, amount_paid,
  document_type, document_no,
  paid_at, payment_verified_at, payment_submitted_at,
  metadata, notes, created_at, updated_at
)
select
  o.id, 'kit_order', coalesce(o.bill_to_franchisee_id, o.placer_id), o.bill_to_franchisee_id,
  o.placer_id, o.placer_tier,
  case o.status
    when 'pending' then 'draft'
    when 'proforma' then 'draft'
    when 'invoiced' then 'confirmed'
    when 'payment_submitted' then 'confirmed'
    when 'part_paid' then 'part_paid'
    when 'closed' then 'paid'
    else 'draft'
  end,
  coalesce(o.subtotal,0), coalesce(o.discount_amount,0), o.coupon_id, o.coupon_code,
  coalesce(o.gst_amount,0), coalesce(o.grand_total,0), coalesce(o.amount_paid,0),
  case when o.invoice_no is not null then 'invoice' when o.proforma_no is not null then 'proforma' else null end,
  coalesce(o.invoice_no, o.proforma_no),
  o.paid_at, o.payment_verified_at, o.payment_submitted_at,
  jsonb_strip_nulls(jsonb_build_object(
    'order_ref', o.order_ref, 'courier_partner', o.courier_partner, 'awb_number', o.awb_number,
    'courier_charges', o.courier_charges, 'deliver_to', o.deliver_to, 'ship_to', o.ship_to,
    'ship_to_franchisee_id', o.ship_to_franchisee_id, 'dispatch_date', o.dispatch_date,
    'dispatch_weight', o.dispatch_weight, 'dispatch_freight', o.dispatch_freight,
    'dispatched_at', o.dispatched_at, 'invoice_url', o.invoice_url,
    'invoice_cancelled_at', o.invoice_cancelled_at, 'invoice_cancelled_by', o.invoice_cancelled_by,
    'last_reminded_at', o.last_reminded_at, 'reminder_count', o.reminder_count,
    'supplier', o.supplier, 'bill_to_name', o.bill_to_name
  )),
  o.notes, o.created_at, coalesce(o.updated_at, o.created_at)
from orders o;

insert into transaction_items (
  transaction_id, sku_id, item_id, qty, sent_qty, rate, amount, excluded_kit_items, cf_commission_rate, created_at
)
select
  oi.order_id, oi.sku_id, oi.item_id, oi.ordered_qty, oi.sent_qty, oi.rate,
  coalesce(oi.line_total, oi.rate * oi.ordered_qty), oi.excluded_kit_items, oi.cf_commission_rate,
  coalesce(oi.created_at, now())
from order_items oi;

insert into transaction_payments (
  transaction_id, amount, paid_on, mode, reference, note, recorded_by, receipt_no, created_at
)
select op.order_id, op.amount, op.paid_on, op.mode, op.reference, op.note, op.recorded_by, op.receipt_no, op.created_at
from order_payments op;

-- ── course_fee — one Transaction per student that has been invoiced ───────
-- (superseded by the coverage fix in the next migration)
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
  jsonb_build_object('invoice_nos', inv.invoice_nos, 'invoice_ids', inv.invoice_ids),
  inv.first_created, inv.first_created
from students s
join (
  select student_id,
    sum(subtotal) subtotal_sum,
    array_agg(invoice_no order by created_at) filter (where invoice_no is not null) invoice_nos,
    array_agg(id order by created_at) invoice_ids,
    min(created_at) first_created
  from student_invoices
  group by student_id
) inv on inv.student_id = s.id;

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

-- ── franchise_fee — one Transaction per franchisee with a fee history ─────
create temporary table _t_franchisee_map (franchisee_id uuid primary key, transaction_id uuid not null);

insert into transactions (id, type, party_id, status, total, amount_paid, created_at, updated_at)
select
  gen_random_uuid(), 'franchise_fee', f.id,
  case
    when coalesce(f.enrollment_fee,0) > 0 and coalesce(f.fee_paid,0) >= f.enrollment_fee then 'paid'
    when coalesce(f.fee_paid,0) > 0 then 'part_paid'
    else 'confirmed'
  end,
  coalesce(f.enrollment_fee, 0), coalesce(f.fee_paid, 0),
  fp.first_created, fp.first_created
from franchisees f
join (select franchisee_id, min(created_at) first_created from franchisee_payments group by franchisee_id) fp
  on fp.franchisee_id = f.id;

insert into _t_franchisee_map (franchisee_id, transaction_id)
select party_id, id from transactions where type = 'franchise_fee';

insert into transaction_payments (transaction_id, amount, paid_on, mode, reference, note, recorded_by, receipt_no, created_at)
select m.transaction_id, fp.amount, fp.payment_date, fp.payment_mode, fp.reference_no, fp.notes, fp.recorded_by, fp.receipt_no, fp.created_at
from franchisee_payments fp
join _t_franchisee_map m on m.franchisee_id = fp.franchisee_id;

drop table _t_student_map;
drop table _t_franchisee_map;
