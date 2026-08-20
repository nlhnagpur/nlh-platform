-- CF-managed schools: a CF can bring in an institutional customer (a school)
-- that HO bills and supplies kits to directly, with the CF earning a
-- per-kit commission for facilitating/servicing the relationship. See
-- README/session notes for the full design discussion.

create table schools (
  id               uuid primary key default gen_random_uuid(),
  cf_franchisee_id uuid not null references franchisees(id),
  name             text not null,
  contact_name     text,
  phone            text,
  email            text,
  address          text,
  city             text,
  state            text,
  country          text default 'India',
  pincode          text,
  gstin            text,
  status           text not null default 'active' check (status in ('active','inactive')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index schools_cf_idx on schools(cf_franchisee_id);

-- Price + CF commission per kit, negotiated once per school per SKU and
-- reused on every subsequent order for that school (order_items snapshots
-- cf_commission_rate at order time so a later renegotiation doesn't
-- retroactively change commission already earned on past orders).
create table school_sku_rates (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references schools(id) on delete cascade,
  sku_id     uuid not null references skus(id),
  rate       integer not null default 0,   -- what HO bills the school per kit
  cf_cut     integer not null default 0,   -- CF's commission per kit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, sku_id)
);

-- Orders: a school order bills the school (not the placing CF). Proforma is
-- a general option on ANY order (school or not) — a preliminary, non-tax
-- document with its own numbering, used when payment isn't assured yet;
-- the real invoice_no (and therefore dispatch) is only assigned once
-- payment is verified and the order is converted to a real invoice.
alter table orders add column bill_to_school_id uuid references schools(id);
alter table orders add column proforma_no text;
alter table orders add column proforma_generated_at timestamptz;
create index orders_bill_to_school_idx on orders(bill_to_school_id);

alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check
  check (status = any (array['pending','proforma','invoiced','part_paid','payment_submitted','dispatched','closed']));

alter table order_items add column cf_commission_rate integer;

create sequence proforma_seq start 1;
create sequence credit_note_seq start 1;

create or replace function generate_proforma_no()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.status = 'proforma' and old.status = 'pending' and new.proforma_no is null then
    new.proforma_no := 'PF-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('proforma_seq')::text, 4, '0');
    new.proforma_generated_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_proforma_no
before update on orders
for each row execute function generate_proforma_no();

-- The real invoice trigger only ever fired pending -> invoiced; extend it
-- to also cover proforma -> invoiced (payment verified, proforma converted
-- to a real tax invoice) without touching its pending -> invoiced behavior.
create or replace function generate_invoice_no()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.status = 'invoiced' and old.status in ('pending','proforma') and new.invoice_no is null then
    new.invoice_no := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

-- CF commission payout — admin-only, two-step (raised then approved) for
-- an audit trail even though the same role does both. Only once approved
-- does it become a credit line in the CF's ledger (loadFranchiseeLedger).
create table franchisee_credit_notes (
  id               uuid primary key default gen_random_uuid(),
  franchisee_id    uuid not null references franchisees(id),
  order_id         uuid references orders(id),
  suggested_amount integer,                 -- system-computed default, kept for audit
  amount           integer not null,        -- what was actually raised/approved (editable)
  reason           text,
  credit_note_no   text,
  status           text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by     text,
  requested_at     timestamptz not null default now(),
  approved_by      text,
  approved_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index credit_notes_franchisee_idx on franchisee_credit_notes(franchisee_id);

create or replace function generate_credit_note_no()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.status = 'approved' and old.status = 'pending' and new.credit_note_no is null then
    new.credit_note_no := 'CN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('credit_note_seq')::text, 4, '0');
    new.approved_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_credit_note_no
before update on franchisee_credit_notes
for each row execute function generate_credit_note_no();

-- RLS
alter table schools enable row level security;
alter table school_sku_rates enable row level security;
alter table franchisee_credit_notes enable row level security;

-- Schools: admin, or the managing CF (and anyone above them in the tree,
-- same accessibility rule used everywhere else) can see/manage their own.
create policy schools_select on schools for select
  using (nlh_is_admin() or (cf_franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy schools_insert on schools for insert
  with check (nlh_is_admin() or (cf_franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy schools_update on schools for update
  using (nlh_is_admin() or (cf_franchisee_id = any (nlh_accessible_franchisee_ids())))
  with check (nlh_is_admin() or (cf_franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy schools_delete on schools for delete
  using (nlh_is_admin());

-- School SKU rates: CF can view the negotiated rate/cut for their own
-- schools, but only admin can set or change it — the rate directly
-- determines the CF's own commission, so letting a CF write it themselves
-- would be a conflict of interest.
create policy school_sku_rates_select on school_sku_rates for select
  using (nlh_is_admin() or exists (
    select 1 from schools s where s.id = school_sku_rates.school_id
    and s.cf_franchisee_id = any (nlh_accessible_franchisee_ids())
  ));
create policy school_sku_rates_write on school_sku_rates for all
  using (nlh_is_admin()) with check (nlh_is_admin());

-- Credit notes: CF can see their own (once it exists — it only affects
-- their ledger once approved, but they can see pending ones too), only
-- admin can create/approve/reject.
create policy credit_notes_select on franchisee_credit_notes for select
  using (nlh_is_admin() or (franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy credit_notes_write on franchisee_credit_notes for all
  using (nlh_is_admin()) with check (nlh_is_admin());
