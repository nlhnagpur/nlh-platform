create sequence if not exists student_invoice_seq;

create table if not exists student_invoices (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade,
  franchisee_id uuid references franchisees(id),
  invoice_no    text unique,
  invoice_date  date not null default current_date,
  items         jsonb not null default '[]',   -- [{kind:'course'|'kit', name, qty, rate, amount, sku_id}]
  subtotal      int  not null default 0,
  discount      int  not null default 0,
  coupon_code   text,
  total         int  not null default 0,
  amount_paid   int  not null default 0,
  status        text not null default 'unpaid',
  notes         text,
  created_by    text,
  created_at    timestamptz default now()
);
create index if not exists idx_student_invoices_student on student_invoices(student_id);

create or replace function assign_student_invoice_no() returns trigger
language plpgsql as $$
begin
  if new.invoice_no is null then
    new.invoice_no := 'SINV-' || to_char(coalesce(new.invoice_date, current_date), 'YYYY')
                      || '-' || lpad(nextval('student_invoice_seq')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_student_invoice_no on student_invoices;
create trigger trg_student_invoice_no before insert on student_invoices
  for each row execute function assign_student_invoice_no();

alter table student_invoices enable row level security;
create policy student_invoices_select on student_invoices for select
  using (nlh_is_admin() or (franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy student_invoices_insert on student_invoices for insert
  with check (nlh_is_admin() or (franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy student_invoices_update on student_invoices for update
  using (nlh_is_admin() or (franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy student_invoices_delete on student_invoices for delete
  using (nlh_is_admin() or (franchisee_id = any (nlh_accessible_franchisee_ids())));
