-- Revised design: a school works as a sort of UF — it's a real franchisee
-- row (tier = 'SCHOOL', parented under a CF via parent_id) and gets the
-- full existing machinery for free: students/enrollments/certificates,
-- registered_courses/registered_skus gating, its own Orders/Students/
-- Courses/Accounts tabs, GSTIN/address already on franchisees. Only the
-- kit pricing (negotiated per school, not the flat uf_rate/cf_rate/
-- smf_rate columns) and the CF-commission billing path stay custom.
--
-- This makes the standalone schools table and orders.bill_to_school_id
-- from the previous migration redundant — orders.bill_to_franchisee_id
-- already exists precisely for "who's actually billed vs who placed it".
-- Both tables were empty (0 rows in schools/school_sku_rates/credit_notes,
-- 0 orders with bill_to_school_id) since this is same-day, unshipped-to-
-- real-data work, so this is a clean swap, not a data migration.

alter table franchisees drop constraint franchisees_tier_check;
alter table franchisees add constraint franchisees_tier_check
  check (tier = any (array['SMF','CF','UF','NLH','SCHOOL']));

alter table orders drop column bill_to_school_id;

drop table school_sku_rates;
drop table schools;

-- Same shape as before, just keyed to the school's own franchisee row
-- instead of a separate schools table.
create table school_sku_rates (
  id            uuid primary key default gen_random_uuid(),
  franchisee_id uuid not null references franchisees(id) on delete cascade,
  sku_id        uuid not null references skus(id),
  rate          integer not null default 0,   -- what HO bills the school per kit
  cf_cut        integer not null default 0,   -- the introducing CF's commission per kit
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (franchisee_id, sku_id)
);

alter table school_sku_rates enable row level security;

-- Same access shape as before: the CF managing that SCHOOL-tier franchisee
-- (or anyone above them) can view; only admin can write (the rate directly
-- sets the CF's own commission — conflict of interest to let them set it).
create policy school_sku_rates_select on school_sku_rates for select
  using (nlh_is_admin() or (franchisee_id = any (nlh_accessible_franchisee_ids())));
create policy school_sku_rates_write on school_sku_rates for all
  using (nlh_is_admin()) with check (nlh_is_admin());
