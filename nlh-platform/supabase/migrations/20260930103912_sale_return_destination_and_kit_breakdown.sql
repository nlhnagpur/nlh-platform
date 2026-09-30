-- A manual "Record a Kit / Book Return" can now be physically supplied to a
-- destination other than HO (another franchisee/school), not just HO. It's
-- still the sender who gets credited (the receiver settles with HO
-- separately) — destination is only recorded for audit; there is no
-- per-franchisee stock ledger, so a non-HO destination never touches
-- stock_ledger. excluded_kit_items (jsonb, same convention as
-- order_items.excluded_kit_items) lets the admin record a partial-kit
-- breakdown — which components were actually supplied vs retained by the
-- sender — so the Sale Return voucher and credit note can show the split and
-- the amount can be hand-adjusted accordingly (no standalone per-item price
-- exists yet to compute this automatically).

alter table franchisee_stock_returns
  add column destination_franchisee_id uuid references franchisees(id),
  add column excluded_kit_items jsonb not null default '[]';

create index franchisee_stock_returns_destination_idx on franchisee_stock_returns (destination_franchisee_id);
