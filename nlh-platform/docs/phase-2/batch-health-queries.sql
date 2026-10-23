-- Batch health — read-only audit queries (the same rules as the in-app "Batch health check" on the Batches page,
-- plus the historical checks the app does not look at). Safe to run on production: SELECT only.
-- Last run 2026-10-23: only two findings, both "classes dated before the batch start" (see below).

-- 1. One row per problem
with b as (
  select b.id, b.name, b.is_active, b.start_date, b.instructor_assigned_at ia, b.instructor_id, i.full_name ci, i.status ci_status,
   (select count(*) from batch_sessions s where s.batch_id = b.id) sess_all,
   (select max(session_date) from batch_sessions s where s.batch_id = b.id) last_sess,
   (select count(*) from batch_students bs where bs.batch_id = b.id and bs.removed_at is null) roster_open,
   (select count(*) from batch_sessions s where s.batch_id = b.id and s.instructor_id is distinct from b.instructor_id and not s.is_substitute) other_ci_sessions,
   (select count(*) from batch_sessions s where s.batch_id = b.id and s.session_date < coalesce(b.start_date, '1900-01-01')) before_start
  from batches b left join instructors i on i.id = b.instructor_id)
select 'active batch, CI not active' issue, name, ci from b where is_active and coalesce(ci_status, '') <> 'active'
union all select 'active batch, no CI', name, '-' from b where is_active and instructor_id is null
union all select 'active batch, no students on it', name, ci from b where is_active and roster_open = 0
union all select 'active batch, no class in 14+ days', name, ci from b where is_active and (last_sess is null or last_sess < current_date - 14)
union all select 'classes by a different CI, not marked substitute', name, ci from b where other_ci_sessions > 0
union all select 'classes dated before the batch start', name, ci from b where before_start > 0
order by 1, 2;

-- 2. Open batches whose roster has a course the CI holds no appointment for (payroll would calculate nothing). Expect no rows.
select b.name batch, i.full_name ci, c.group_name course, count(distinct e.student_id) students
from batches b join instructors i on i.id = b.instructor_id
join batch_students bs on bs.batch_id = b.id and bs.removed_at is null
join enrollments e on e.id = bs.enrollment_id and e.completed_at is null and e.status <> 'dropped'
join skus s on s.id = e.sku_id join courses c on c.id = s.course_id
where b.is_active
group by b.name, i.full_name, c.group_name, b.instructor_id, c.id
having not exists (select 1 from instructor_courses ic join skus s2 on s2.id = ic.sku_id
                   where ic.instructor_id = b.instructor_id and ic.status = 'active' and s2.course_id = c.id and ic.appointed_at <= current_date);

-- 3. A student on two open batches for the same course. Expect no rows.
select st.full_name, c.group_name course, count(distinct bs.batch_id) open_batches
from batch_students bs join batches b on b.id = bs.batch_id and b.is_active
join enrollments e on e.id = bs.enrollment_id and e.completed_at is null and e.status <> 'dropped'
join students st on st.id = e.student_id join skus s on s.id = e.sku_id join courses c on c.id = s.course_id
where bs.removed_at is null
group by st.full_name, c.group_name, e.student_id, c.id having count(distinct bs.batch_id) > 1;

-- Findings on 2026-10-23
--  * "Tution 5 TO 6 PM" (Khushi): first class 7 Sep, batch start was 8 Sep -> corrected to 7 Sep.
--  * "5-6 pm" (Darshana Ojha, closed): a class on 26 Mar 2026, batch start 15 Apr 2026 -> left for the owner to decide.
