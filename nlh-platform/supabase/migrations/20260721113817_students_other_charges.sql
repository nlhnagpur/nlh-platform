-- Amounts on a student's account that belong to no single course — registration
-- or admission fees. Previously these existed only as the unexplained gap
-- between the agreed fee and the courses, so the two never reconciled and the
-- shortfall looked like a bug.
alter table students add column if not exists other_charges integer not null default 0;

update students s
set other_charges = s.fee_total
                  - (select coalesce(sum(e.fee_amount),0) from enrollments e where e.student_id = s.id)
where s.fee_total > (select coalesce(sum(e.fee_amount),0) from enrollments e where e.student_id = s.id)
  and s.other_charges = 0;
