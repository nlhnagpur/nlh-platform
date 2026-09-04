-- Sale Return system — a franchisee (Pampi Roy) fulfilled part of another
-- party's order (Angels' Park School's Abacus Jr L1 kits) directly from
-- their own already-purchased stock instead of HO shipping fresh units.
-- HO must not deduct its own stock again for that portion (it was already
-- deducted when the franchisee originally bought those kits), and the
-- franchisee is owed back what they paid HO for them — a real
-- return-and-resell, not a side commission payment.
--
-- order_items.fulfilled_by_franchisee_id marks which line/qty was sourced
-- this way; deductOrderStockIfNeeded (app code) skips HO deduction for
-- those lines. franchisee_stock_returns is the credit record, admin-only
-- raise-and-approve (matching franchisee_credit_notes' existing rule),
-- valued at what the franchisee actually paid HO for those units
-- (unit_value / source_order_item_id trace back to their own purchase).

alter table order_items add column fulfilled_by_franchisee_id uuid references franchisees(id);

create sequence sale_return_seq;

create table franchisee_stock_returns (
  id                      uuid primary key default gen_random_uuid(),
  return_no               text unique,
  returning_franchisee_id uuid not null references franchisees(id),
  sku_id                  uuid not null references skus(id),
  qty                     integer not null check (qty > 0),
  unit_value              integer not null default 0,
  total_credit            integer not null default 0,
  source_order_id         uuid references orders(id),       -- the franchisee's own order these units trace back to
  source_order_item_id    uuid references order_items(id),  -- the specific line, for the rate actually paid
  fulfills_order_id       uuid not null references orders(id),  -- the order this return is covering
  status                  text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason                  text,
  requested_by            text,
  requested_at            timestamptz not null default now(),
  approved_by             text,
  approved_at             timestamptz,
  created_at              timestamptz not null default now()
);

create index franchisee_stock_returns_returning_idx on franchisee_stock_returns (returning_franchisee_id);
create index franchisee_stock_returns_fulfills_idx on franchisee_stock_returns (fulfills_order_id);

create or replace function generate_sale_return_no()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status = 'approved' and old.status = 'pending' and new.return_no is null then
    new.return_no := 'SR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sale_return_seq')::text, 4, '0');
    new.approved_at := now();
  end if;
  return new;
end;
$function$;

create trigger trg_sale_return_no
before update on franchisee_stock_returns
for each row execute function generate_sale_return_no();

alter table franchisee_stock_returns enable row level security;

create policy stock_returns_select on franchisee_stock_returns for select
  using (nlh_is_admin() or returning_franchisee_id = any (nlh_accessible_franchisee_ids()));
create policy stock_returns_write on franchisee_stock_returns for all
  using (nlh_is_admin())
  with check (nlh_is_admin());
