-- One row per CI per month: the payroll as worked out and edited (lines snapshot) and whether it is paid.
-- Admin roles only. expense_id links to the HO Accounting expense when the payment is posted.
create table public.ci_payroll_runs (
  id                uuid primary key default gen_random_uuid(),
  instructor_id     uuid not null references public.instructors(id) on delete cascade,
  month             text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  lines             jsonb not null default '[]'::jsonb,
  calculated_total  integer not null default 0,
  total             integer not null default 0 check (total >= 0),
  notes             text,
  status            text not null default 'draft' check (status in ('draft', 'paid')),
  paid_on           date,
  paid_amount       integer check (paid_amount >= 0),
  paid_mode         text,
  paid_ref          text,
  bank_account_id   uuid references public.bank_accounts(id),
  expense_id        uuid references public.expenses(id) on delete set null,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (instructor_id, month),
  check (status <> 'paid' or (paid_on is not null and paid_amount is not null))
);

create index ci_payroll_runs_month_idx on public.ci_payroll_runs (month);

alter table public.ci_payroll_runs enable row level security;

create policy ci_payroll_runs_select on public.ci_payroll_runs for select using (nlh_is_admin());
create policy ci_payroll_runs_insert on public.ci_payroll_runs for insert with check (nlh_is_admin());
create policy ci_payroll_runs_update on public.ci_payroll_runs for update using (nlh_is_admin()) with check (nlh_is_admin());
create policy ci_payroll_runs_delete on public.ci_payroll_runs for delete using (nlh_is_admin());

