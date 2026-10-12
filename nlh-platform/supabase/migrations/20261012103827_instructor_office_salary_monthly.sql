-- Fixed monthly office salary for a CI who also works as office staff.
alter table instructors add column if not exists office_salary_monthly integer not null default 0;
