-- Month-by-month extras on a CI's payroll: incentive and misc (misc may be a
-- deduction, so it can be negative). Added to the calculated amount.
create table if not exists payroll_extras (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references instructors(id) on delete cascade,
  month text not null,                      -- 'YYYY-MM', same as payroll_overrides
  incentive integer not null default 0,
  misc integer not null default 0,
  misc_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (instructor_id, month)
);
alter table payroll_extras enable row level security;
create policy payroll_extras_select on payroll_extras for select using (nlh_is_admin());
create policy payroll_extras_insert on payroll_extras for insert with check (nlh_is_admin());
create policy payroll_extras_update on payroll_extras for update using (nlh_is_admin());
create policy payroll_extras_delete on payroll_extras for delete using (nlh_is_admin());
create policy staff_perm_select_payroll_extras on payroll_extras for select to authenticated using (nlh_staff_can('{accounting.view}'::text[]));
create policy staff_perm_insert_payroll_extras on payroll_extras for insert to authenticated with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy staff_perm_update_payroll_extras on payroll_extras for update to authenticated using (nlh_staff_can('{accounting.edit}'::text[])) with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy staff_perm_delete_payroll_extras on payroll_extras for delete to authenticated using (nlh_staff_can('{accounting.delete}'::text[]));
