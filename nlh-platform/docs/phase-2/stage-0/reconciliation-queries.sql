-- ============================================================================
-- Student financial reconciliation — READ-ONLY.  Phase 2, Stage 0.
--
-- One SELECT, no writes, no temp tables, no functions with side effects
-- (it does NOT call nextval / next_receipt_no / any RPC). Safe to run on
-- production and on an isolated database; run it on BOTH and compare.
--
-- Output: one row per check
--   id          stable check id
--   what        plain-language description
--   sev         error  = must be 0 for the books to be trusted
--               warn   = should be understood / explained
--               info   = context, not a defect
--   violations  rows breaking the rule (aggregate count only — no identities)
--   checked     rows examined
--
-- Aggregate counts only, so the output carries no student names, phones or IDs.
-- To drill down on a non-zero check, copy its inner SELECT and return ids only
-- inside the isolated environment.
-- ============================================================================
with pay as (
  select student_id, sum(amount)::bigint as amt, count(*) as n
  from public.student_payments group by student_id
), inv as (
  select student_id, sum(total)::bigint as tot, count(*) as n
  from public.student_invoices where coalesce(status, '') <> 'cancelled' group by student_id
), rc as (
  -- receipt number parts: ST-<centre>-<year>-<seq>
  select split_part(receipt_no, '-', 2) as centre,
         split_part(receipt_no, '-', 3) as yr,
         split_part(receipt_no, '-', 4)::int as seq
  from public.student_payments
  where receipt_no ~ '^ST-[A-Za-z0-9]+-[0-9]{4}-[0-9]+$'
), rc_gaps as (
  select centre, yr, max(seq) - count(distinct seq) as missing
  from rc group by centre, yr
), last_ev as (
  select distinct on (student_id) student_id, new_value
  from public.student_fee_events where field = 'fee_total'
  order by student_id, at desc
)
select 'R01' as id, 'fee_paid differs from the sum of the student''s payments' as what, 'error' as sev,
       count(*) filter (where s.fee_paid is distinct from coalesce(p.amt, 0)) as violations, count(*) as checked
from public.students s left join pay p on p.student_id = s.id
union all
select 'R02', 'student has paid more than the fee total (fee_paid > fee_total)', 'error',
       count(*) filter (where coalesce(s.fee_paid, 0) > coalesce(s.fee_total, 0)), count(*)
from public.students s
union all
select 'R03', 'payment_status disagrees with the amounts (active students; "waived" allowed)', 'error',
       count(*) filter (where s.is_active and s.payment_status is distinct from 'waived'
                        and s.payment_status is distinct from
                            case when coalesce(s.fee_total, 0) = 0 then 'none'
                                 when coalesce(s.fee_paid, 0) <= 0 then 'pending'
                                 when s.fee_paid >= s.fee_total then 'paid' else 'partial' end), count(*)
from public.students s
union all
select 'R04', 'payment recorded under a different centre than the student''s', 'error',
       count(*) filter (where p.franchisee_id is distinct from s.franchisee_id), count(*)
from public.student_payments p join public.students s on s.id = p.student_id
union all
select 'R05', 'invoice recorded under a different centre than the student''s', 'error',
       count(*) filter (where i.franchisee_id is distinct from s.franchisee_id), count(*)
from public.student_invoices i join public.students s on s.id = i.student_id
union all
select 'R06', 'enrolment recorded under a different centre than the student''s', 'error',
       count(*) filter (where e.franchisee_id is distinct from s.franchisee_id), count(*)
from public.enrollments e join public.students s on s.id = e.student_id
union all
select 'R07', 'invoice total <> subtotal - discount', 'error',
       count(*) filter (where i.total <> i.subtotal - coalesce(i.discount, 0)), count(*)
from public.student_invoices i
union all
select 'R08', 'duplicate receipt numbers', 'error',
       coalesce(sum(c - 1) filter (where c > 1), 0), coalesce(sum(c), 0)
from (select receipt_no, count(*) c from public.student_payments where receipt_no is not null group by receipt_no) d
union all
select 'R09', 'payments with no receipt number', 'error',
       count(*) filter (where receipt_no is null), count(*)
from public.student_payments
union all
select 'R10', 'negative or null fee_total', 'error',
       count(*) filter (where fee_total is null or fee_total < 0), count(*)
from public.students
union all
select 'R11', 'payment dated in the future', 'warn',
       count(*) filter (where paid_at > current_date), count(*)
from public.student_payments
union all
select 'R12', 'possible duplicate payments (same student, amount, date and mode more than once)', 'warn',
       coalesce(sum(c - 1) filter (where c > 1), 0), coalesce(sum(c), 0)
from (select student_id, amount, paid_at, coalesce(mode, '') m, count(*) c
      from public.student_payments group by 1, 2, 3, 4) d
union all
select 'R13', 'receipt-number gaps per centre/year series (missing numbers)', 'warn',
       coalesce(sum(missing), 0), count(*)
from rc_gaps
union all
select 'R14', 'latest logged fee_total event does not equal the current fee_total', 'warn',
       count(*) filter (where nullif(le.new_value, '')::bigint is distinct from s.fee_total), count(*)
from last_ev le join public.students s on s.id = le.student_id
union all
select 'R15', 'fee_total differs from the sum of invoice totals (students that HAVE invoices)', 'warn',
       count(*) filter (where s.fee_total is distinct from i.tot), count(*)
from public.students s join inv i on i.student_id = s.id
union all
select 'R16', 'invoice paid amount never maintained (amount_paid = 0 although the student has paid)', 'warn',
       count(*) filter (where coalesce(i.amount_paid, 0) = 0 and coalesce(s.fee_paid, 0) > 0), count(*)
from public.student_invoices i join public.students s on s.id = i.student_id
union all
select 'R17', 'closed / inactive student still carrying a balance', 'info',
       count(*) filter (where not s.is_active and coalesce(s.fee_total, 0) > coalesce(s.fee_paid, 0)), count(*)
from public.students s
union all
select 'R18', 'enrolment with fee_amount = 0 and nothing waived', 'info',
       count(*) filter (where coalesce(fee_amount, 0) = 0 and coalesce(waived, 0) = 0), count(*)
from public.enrollments
union all
select 'R19', 'students with no invoice at all', 'info',
       count(*) filter (where i.student_id is null), count(*)
from public.students s left join inv i on i.student_id = s.id
order by 1;
