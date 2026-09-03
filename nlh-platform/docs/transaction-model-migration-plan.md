# Transaction Model Migration Plan

Status: **draft — not yet applied to any environment.** This document is the plan only. No schema changes have been made.

## Why now

Current row counts (checked live, 2026-09-03):

| Table | Rows |
|---|---|
| `orders` | 21 |
| `order_items` | 104 |
| `order_payments` | 6 |
| `student_invoices` | 9 |
| `student_payments` | 34 |
| `franchisee_payments` | 27 |
| `franchisee_credit_notes` | 0 |

This is the cheapest this migration will ever be. Every week of running the current five-table model adds rows that have to be backfilled later, and adds more UI code written against the old shape that has to be rewritten. There's no volume-driven urgency, but there's a compounding cost to waiting.

## What's being merged

| Old table | Becomes |
|---|---|
| `orders` + `order_items` | `transactions` (type `kit_order`) + `transaction_items` |
| `order_payments` | `transaction_payments` |
| `student_invoices` (+ its `items` jsonb) | `transactions` (type `course_fee`) + `transaction_items` |
| `student_payments` | `transaction_payments` |
| `franchisee_payments` | `transactions` (type `franchise_fee`, one row per franchisee, created once) + `transaction_payments` |
| `franchisee_credit_notes` | `transactions` (type `commission_payout`) — 0 rows today, so this one migrates for free |

`enrollments`, `students`, `franchisees`, `skus`, `batches`, `instructors` are **untouched**. This migration is scoped to money-movement only.

## New schema

```sql
create table transactions (
  id                uuid primary key default gen_random_uuid(),
  type              text not null check (type in ('kit_order','course_fee','franchise_fee','commission_payout')),

  -- who owes / who's owed. Always a franchisee (party); person_id is set
  -- only for course_fee (the student). bill_to_party_id is almost always
  -- party_id — it differs only for a school order billed through its CF,
  -- same case that caused the bill-to-party bugs fixed this session.
  party_id          uuid not null references franchisees(id),
  bill_to_party_id  uuid references franchisees(id),
  person_id         uuid references students(id),

  -- placer, for kit_order: who actually placed it (may differ from
  -- bill_to_party_id — same school-via-CF case)
  placer_id         uuid references franchisees(id),
  placer_tier       text,

  status            text not null default 'draft'
                     check (status in ('draft','confirmed','part_paid','paid','cancelled')),

  subtotal          integer not null default 0,
  discount_amount   integer not null default 0,
  coupon_id         uuid references coupons(id),
  coupon_code       text,
  tax_amount        integer not null default 0,
  total             integer not null default 0,
  amount_paid       integer not null default 0,   -- kept denormalized, synced by trigger from transaction_payments, exactly like orders.amount_paid today

  -- one document-numbering column instead of three (invoice_no/proforma_no
  -- on orders, invoice_no on student_invoices, receipt_no scattered across
  -- three payment tables) — document_type says which kind this number is
  document_type     text check (document_type in ('invoice','proforma','credit_note')),
  document_no       text,

  paid_at           timestamptz,
  payment_verified_at timestamptz,
  payment_submitted_at timestamptz,

  -- type-specific fields that don't apply to every row live in metadata
  -- rather than as columns that are null 90% of the time. kit_order uses
  -- dispatch/courier/deliver_to/ship_to; commission_payout uses
  -- suggested_amount/reason/requested_by/approved_by; franchise_fee uses
  -- none extra today.
  metadata          jsonb not null default '{}'::jsonb,

  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table transaction_items (
  id                uuid primary key default gen_random_uuid(),
  transaction_id    uuid not null references transactions(id) on delete cascade,
  sku_id            uuid references skus(id),
  item_id           uuid references inventory_items(id),   -- kit_order raw-item lines
  enrollment_id     uuid references enrollments(id),        -- course_fee lines
  name              text,                                   -- snapshot label, for course_fee lines built from a jsonb blob today
  qty               integer not null default 1,
  sent_qty          integer,                                 -- kit_order only
  rate              integer not null default 0,
  amount            integer,
  excluded_kit_items uuid[] not null default '{}',
  cf_commission_rate integer
);

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
```

Numbering sequences (`invoice_seq`, `proforma_seq`, the three separate receipt-number generators) stay exactly as they are — `document_no`/`receipt_no` keep using the existing `assign_*` trigger functions, just retargeted at the new tables. No renumbering, no risk to anything a franchisee has already been shown.

## Rollout — five phases, each independently reversible

**Phase 1 — Additive.** Create `transactions`, `transaction_items`, `transaction_payments` alongside the existing six tables. Nothing reads or writes them yet. Zero risk — this phase alone changes nothing observable.

**Phase 2 — Backfill.** One-time `insert ... select` from each of the six old tables into the new ones, preserving `id`, `created_at`, and every receipt/invoice number as-is (so a document already sent to a franchisee or parent keeps the exact same number if it's ever reprinted). Verify with a reconciliation query: `sum(transactions.total) by type` must equal `sum` of the corresponding old tables, and `count(transaction_payments)` must equal `6 + 34 + 27` exactly. Run this on a Supabase **branch**, not production, first.

**Phase 3 — Dual-write.** Update the app's write paths (`OrdersPage.jsx`, `StudentsPage.jsx`, `FranchiseesPage.jsx`) to write to both old and new tables in the same transaction, while every screen still *reads* from the old tables. Run for a soak period (a couple of weeks of real usage is enough at this volume) with a scheduled reconciliation check comparing old vs. new. This is the phase that catches anything the backfill/mapping missed, with zero user-facing risk — if dual-write ever disagrees, the old tables are still the source of truth and nothing downstream is affected yet.

**Phase 4 — Cut over reads, one screen at a time.** Point Orders, then Students, then Franchisees at the new tables (via compatibility views shaped like the old tables, so each page's query changes minimally). This is also where the UI consolidation from the blueprint actually happens — once a screen reads from `transactions`, the "one Ledger, one Record Payment, one Notify" behavior becomes possible for that screen. Each screen is its own reversible step: if something's wrong, point it back at the old table's view.

**Phase 5 — Retire the old tables.** Once every screen reads and writes only the new tables and a safety window has passed (I'd suggest one full month of clean dual-write agreement before this), drop the dual-write code, then drop the old six tables. Keep a final SQL dump of them in `supabase/migrations/` history regardless — dropped, not destroyed.

## Open questions before Phase 1 starts

1. **`franchise_fee` today has no `orders`-style item lines** — it's a single running balance. Does it get one `transactions` row per franchisee (matching today), or one row per payment (matching `kit_order`'s shape)? I'd default to *one row per franchisee*, created at onboarding, to match current behavior — but flagging it since it's the one type that doesn't naturally fit the "one transaction = one invoice" pattern the other three do.
2. **`student_invoices.items` is a jsonb blob today** (kit + course lines mixed in one array) — migrating it into real `transaction_items` rows is the one non-mechanical part of the backfill and needs a bit of parsing logic, not a straight column copy. Only 9 rows currently, so worth doing properly rather than keeping the jsonb shape.
3. **Confirm the `metadata` jsonb approach** for dispatch/courier fields is acceptable, versus keeping them as real nullable columns on `transactions` (simpler queries, but brings back the "columns that are null 90% of the time" problem this migration is meant to fix for the type-specific stuff). I'd default to `metadata` for anything not shared across all four types.

## What I need from you to proceed

Nothing yet for Phase 1 (it's additive and reversible — I can start on it once you say go). Before Phase 2 (backfill), I'd want to run it against a Supabase **branch** first and show you the reconciliation numbers, not production directly.
