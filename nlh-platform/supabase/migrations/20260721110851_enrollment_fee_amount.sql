-- Per-course fee, so a student's ledger can be read course by course instead of
-- as one undifferentiated pot. Seeded from the SKU price but editable, since
-- the agreed fee often differs from catalogue (discounts, bundles, legacy rates).
alter table enrollments add column if not exists fee_amount integer;

-- Backfill by distributing each student's AGREED fee_total across their courses
-- in proportion to SKU price — NOT the raw SKU sum, which differs from the
-- agreed total for several students and would silently restate their balances.
-- The last course absorbs the rounding remainder so the parts always sum exactly.
with base as (
  select e.id, e.student_id,
         coalesce(k.student_fee, 0) as sku_fee,
         row_number() over (partition by e.student_id order by e.enrolled_at, e.created_at, e.id) as rn,
         count(*)  over (partition by e.student_id) as n_courses,
         sum(coalesce(k.student_fee,0)) over (partition by e.student_id) as sku_sum,
         s.fee_total
  from enrollments e
  join students s on s.id = e.student_id
  left join skus k on k.id = e.sku_id
),
alloc as (
  select id, student_id, rn, n_courses, fee_total,
         case
           when fee_total is null or fee_total = 0 then 0
           when sku_sum > 0 then floor(fee_total::numeric * sku_fee / sku_sum)::int
           else floor(fee_total::numeric / n_courses)::int      -- no SKU prices: split evenly
         end as share
  from base
),
withrem as (
  select a.*,
         coalesce(a.fee_total,0) - sum(a.share) over (partition by a.student_id) as remainder
  from alloc a
)
update enrollments e
set fee_amount = w.share + case when w.rn = w.n_courses then w.remainder else 0 end
from withrem w
where e.id = w.id and e.fee_amount is null;

-- New enrolments default to the catalogue price; the UI can override.
create or replace function default_enrollment_fee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.fee_amount is null then
    select coalesce(student_fee, 0) into NEW.fee_amount from skus where id = NEW.sku_id;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_default_enrollment_fee on enrollments;
create trigger trg_default_enrollment_fee before insert on enrollments
  for each row execute function default_enrollment_fee();
