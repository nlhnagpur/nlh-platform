-- Teacher (CI) attendance. One row per teacher per day they are NOT in:
-- status 'O' = off. A blank day means nothing recorded; 'P' = marked present.
-- When a teacher is off, the day's class is taken by a substitute, recorded on
-- batch_sessions (instructor_id + is_substitute).
create table if not exists instructor_attendance (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references instructors(id) on delete cascade,
  att_date date not null,
  status text not null check (status in ('P', 'O')),
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (instructor_id, att_date)
);
create index if not exists instructor_attendance_date_idx on instructor_attendance (att_date);
alter table instructor_attendance enable row level security;

create policy instructor_attendance_select on instructor_attendance for select to authenticated
  using (nlh_is_admin() or exists (select 1 from instructors i where i.id = instructor_attendance.instructor_id and i.franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy instructor_attendance_insert on instructor_attendance for insert to authenticated
  with check (nlh_is_admin() or exists (select 1 from instructors i where i.id = instructor_attendance.instructor_id and i.franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy instructor_attendance_update on instructor_attendance for update to authenticated
  using (nlh_is_admin() or exists (select 1 from instructors i where i.id = instructor_attendance.instructor_id and i.franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy instructor_attendance_delete on instructor_attendance for delete to authenticated
  using (nlh_is_admin() or exists (select 1 from instructors i where i.id = instructor_attendance.instructor_id and i.franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy staff_perm_select_instructor_attendance on instructor_attendance for select to authenticated
  using (nlh_staff_can('{batches.view}'::text[]));
create policy staff_perm_insert_instructor_attendance on instructor_attendance for insert to authenticated
  with check (nlh_staff_can('{batches.edit}'::text[]));
create policy staff_perm_update_instructor_attendance on instructor_attendance for update to authenticated
  using (nlh_staff_can('{batches.edit}'::text[])) with check (nlh_staff_can('{batches.edit}'::text[]));
create policy staff_perm_delete_instructor_attendance on instructor_attendance for delete to authenticated
  using (nlh_staff_can('{batches.edit}'::text[]));
