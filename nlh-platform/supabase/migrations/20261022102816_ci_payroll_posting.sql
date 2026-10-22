-- CI payroll goes through the books: posting the month (Dr 6001 Staff Salaries / Cr the CI's
-- own account) and paying by bank payment (Dr the CI's account / Cr the bank).
-- ci_payroll_runs gets a 'posted' status and links to the two journal entries.
alter table public.ci_payroll_runs drop constraint ci_payroll_runs_status_check;
alter table public.ci_payroll_runs
  add constraint ci_payroll_runs_status_check check (status in ('draft', 'posted', 'paid'));

alter table public.ci_payroll_runs
  add column accrual_journal_id uuid references public.journal_entries(id) on delete set null,
  add column payment_journal_id uuid references public.journal_entries(id) on delete set null,
  add column accrued_at timestamptz;
