-- A day on which a student has no class (a personal off day), as opposed to a
-- batch holiday or an unmarked day. It is not a class for that student: it is
-- left out of their sessions held, absences and cycle target.
create table if not exists student_no_class (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  class_date date not null,
  batch_id uuid references batches(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (enrollment_id, class_date)
);
create index if not exists student_no_class_date_idx on student_no_class (class_date);
alter table student_no_class enable row level security;

create policy student_no_class_select on student_no_class for select to authenticated
  using (nlh_is_admin() or exists (select 1 from enrollments e where e.id = student_no_class.enrollment_id and e.franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy student_no_class_insert on student_no_class for insert to authenticated
  with check (nlh_is_admin() or exists (select 1 from enrollments e where e.id = student_no_class.enrollment_id and e.franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy student_no_class_delete on student_no_class for delete to authenticated
  using (nlh_is_admin() or exists (select 1 from enrollments e where e.id = student_no_class.enrollment_id and e.franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy staff_perm_select_student_no_class on student_no_class for select to authenticated
  using (nlh_staff_can('{students.view}'::text[]));
create policy staff_perm_insert_student_no_class on student_no_class for insert to authenticated
  with check (nlh_staff_can('{students.edit}'::text[]));
create policy staff_perm_delete_student_no_class on student_no_class for delete to authenticated
  using (nlh_staff_can('{students.edit}'::text[]));
