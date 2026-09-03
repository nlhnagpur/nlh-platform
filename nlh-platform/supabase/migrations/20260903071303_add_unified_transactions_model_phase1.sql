-- Phase 1 of the transaction-model migration (see
-- nlh-platform/docs/transaction-model-migration-plan.md). Purely additive:
-- creates the new tables with RLS, no data moved, no app code changes, no
-- existing table touched. orders/order_items/order_payments/
-- student_invoices/student_payments/franchisee_payments/
-- franchisee_credit_notes remain the live source of truth until Phase 4.

create table transactions (
  id                    uuid primary key default gen_random_uuid(),
  type                  text not null check (type in ('kit_order','course_fee','franchise_fee','commission_payout')),

  party_id              uuid not null references franchisees(id),
  bill_to_party_id      uuid references franchisees(id),
  person_id             uuid references students(id),
  placer_id             uuid references franchisees(id),
  placer_tier           text,

  status                text not null default 'draft'
                        check (status in ('draft','confirmed','part_paid','paid','cancelled')),

  subtotal              integer not null default 0,
  discount_amount       integer not null default 0,
  coupon_id             uuid references coupons(id),
  coupon_code           text,
  tax_amount            integer not null default 0,
  total                 integer not null default 0,
  amount_paid           integer not null default 0,

  document_type         text check (document_type in ('invoice','proforma','credit_note')),
  document_no           text,

  paid_at               timestamptz,
  payment_verified_at   timestamptz,
  payment_submitted_at  timestamptz,

  metadata              jsonb not null default '{}'::jsonb,
  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index transactions_document_no_key on transactions (document_no) where document_no is not null;
create index transactions_party_id_idx on transactions (party_id);
create index transactions_person_id_idx on transactions (person_id) where person_id is not null;
create index transactions_type_status_idx on transactions (type, status);

create table transaction_items (
  id                  uuid primary key default gen_random_uuid(),
  transaction_id      uuid not null references transactions(id) on delete cascade,
  sku_id              uuid references skus(id),
  item_id             uuid references inventory_items(id),
  enrollment_id       uuid references enrollments(id),
  name                text,
  qty                 integer not null default 1,
  sent_qty            integer,
  rate                integer not null default 0,
  amount              integer,
  excluded_kit_items  uuid[] not null default '{}',
  cf_commission_rate  integer,
  created_at          timestamptz not null default now()
);

create index transaction_items_transaction_id_idx on transaction_items (transaction_id);

create table transaction_payments (
  id                uuid primary key default gen_random_uuid(),
  transaction_id    uuid not null references transactions(id) on delete cascade,
  amount            integer not null,
  paid_on           date not null,
  mode              text,
  reference         text,
  note              text,
  recorded_by       text,
  receipt_no        text unique,
  created_at        timestamptz not null default now()
);

create index transaction_payments_transaction_id_idx on transaction_payments (transaction_id);

-- updated_at bookkeeping, same pattern already used elsewhere in this schema
create or replace function transactions_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

create trigger trg_transactions_updated_at
before update on transactions
for each row execute function transactions_set_updated_at();

-- RLS — same accessible-tree pattern as orders/enrollments. Not yet
-- load-bearing (nothing reads/writes these tables until Phase 3/4) but set
-- up now so the tables are never in a "RLS enabled, no policy" state.
alter table transactions enable row level security;
alter table transaction_items enable row level security;
alter table transaction_payments enable row level security;

create policy transactions_select on transactions for select
  using (nlh_is_admin() or party_id = any (nlh_accessible_franchisee_ids()));
create policy transactions_insert on transactions for insert
  with check (nlh_is_admin() or party_id = any (nlh_accessible_franchisee_ids()));
create policy transactions_update on transactions for update
  using (nlh_is_admin() or party_id = any (nlh_accessible_franchisee_ids()))
  with check (nlh_is_admin() or party_id = any (nlh_accessible_franchisee_ids()));
create policy transactions_delete on transactions for delete
  using (nlh_is_admin() and status = 'draft');

create policy transaction_items_select on transaction_items for select
  using (exists (select 1 from transactions t where t.id = transaction_items.transaction_id
    and (nlh_is_admin() or t.party_id = any (nlh_accessible_franchisee_ids()))));
create policy transaction_items_insert on transaction_items for insert
  with check (exists (select 1 from transactions t where t.id = transaction_items.transaction_id
    and (nlh_is_admin() or t.party_id = any (nlh_accessible_franchisee_ids()))));
create policy transaction_items_update on transaction_items for update
  using (exists (select 1 from transactions t where t.id = transaction_items.transaction_id
    and (nlh_is_admin() or t.party_id = any (nlh_accessible_franchisee_ids()))))
  with check (exists (select 1 from transactions t where t.id = transaction_items.transaction_id
    and (nlh_is_admin() or t.party_id = any (nlh_accessible_franchisee_ids()))));
create policy transaction_items_delete on transaction_items for delete
  using (nlh_is_admin());

create policy transaction_payments_select on transaction_payments for select
  using (exists (select 1 from transactions t where t.id = transaction_payments.transaction_id
    and (nlh_is_admin() or t.party_id = any (nlh_accessible_franchisee_ids()))));
create policy transaction_payments_insert on transaction_payments for insert
  with check (exists (select 1 from transactions t where t.id = transaction_payments.transaction_id
    and (nlh_is_admin() or t.party_id = any (nlh_accessible_franchisee_ids()))));
create policy transaction_payments_update on transaction_payments for update
  using (nlh_is_admin())
  with check (nlh_is_admin());
create policy transaction_payments_delete on transaction_payments for delete
  using (nlh_is_admin());
