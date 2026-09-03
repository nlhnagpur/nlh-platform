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

**Phase 2 — Backfill.** One-time `insert ... select` from each of the six old tables into the new ones, preserving `id`, `created_at`, and every receipt/invoice number as-is (so a document already sent to a franchisee or parent keeps the exact same number if it's ever reprinted). Verify with a reconciliation query: `sum(transactions.total) by type` must equal `sum` of the corresponding old tables, and every payment count/sum must match exactly.

*Ran directly against production, not a branch* — Supabase branches don't copy production data ("production data will not carry over" per the branching tool itself), so a branch would only have tested that the SQL runs without a syntax error, not that the mapping is actually correct against real rows. Safe to do directly because this phase is still purely additive: it only ever writes to the three new, still-unused tables — it never updates or deletes anything in the six old ones, and nothing downstream reads the new tables yet. Fully re-runnable (wipe the new tables, redo the insert) if the reconciliation had turned up wrong — which it did once, see below.

**Phase 3 — Dual-write.** Update the app's write paths (`OrdersPage.jsx`, `StudentsPage.jsx`, `FranchiseesPage.jsx`) to write to both old and new tables in the same transaction, while every screen still *reads* from the old tables. Run for a soak period (a couple of weeks of real usage is enough at this volume) with a scheduled reconciliation check comparing old vs. new. This is the phase that catches anything the backfill/mapping missed, with zero user-facing risk — if dual-write ever disagrees, the old tables are still the source of truth and nothing downstream is affected yet.

**Phase 4 — Cut over reads, one screen at a time.** Point Orders, then Students, then Franchisees at the new tables (via compatibility views shaped like the old tables, so each page's query changes minimally). This is also where the UI consolidation from the blueprint actually happens — once a screen reads from `transactions`, the "one Ledger, one Record Payment, one Notify" behavior becomes possible for that screen. Each screen is its own reversible step: if something's wrong, point it back at the old table's view.

**Phase 5 — Retire the old tables.** Once every screen reads and writes only the new tables and a safety window has passed (I'd suggest one full month of clean dual-write agreement before this), drop the dual-write code, then drop the old six tables. Keep a final SQL dump of them in `supabase/migrations/` history regardless — dropped, not destroyed.

## Decisions made during Phase 1 + 2 (superseding the "open questions" below)

- **`franchise_fee`: one `transactions` row per franchisee**, matching today's single running-balance model. Confirmed correct — going per-payment would have meant re-deriving a balance the app already tracks natively on the `franchisees` row.
- **`student_invoices.items` jsonb → real `transaction_items` rows**: mechanical after all — the jsonb shape is consistent (`{kind, sku_id, item_id, enrollment_id, name, qty, rate, amount}`), unpacked with `jsonb_array_elements`. No custom parsing needed beyond that.
- **`metadata` jsonb for kit_order-only fields** (courier/dispatch/AWB/etc.) — went with this as planned; kept `order_ref` there too rather than in `document_no`, since `document_no` is reserved for invoice/proforma/credit-note numbers specifically.
- **New decision, not anticipated in the original plan: `course_fee` is one `transactions` row per STUDENT, not per invoice.** The app already pools a student's balance on the `students` row (`fee_total`/`fee_paid`), with payments recorded against the *student*, not any one invoice — a student can have multiple invoices (e.g. one per add-on course) all feeding the same balance. A per-invoice Transaction would have fragmented a balance the app treats as one thing. Individual invoice numbers are preserved in `metadata.invoice_nos` since `document_no` can only hold one value.

### A real gap the backfill caught, and how it was fixed

The first backfill pass joined `students` to `student_invoices` with an inner join — 9 students had an invoice row, so only 9 `course_fee` transactions were created. But **34 students have a non-zero `fee_total`**: most students' fees were set directly on the student record without a formal invoice ever being generated (older data, or fee set without the invoice step). That left 25 students, and 27 of their 34 payment rows, un-migrated.

Caught by the reconciliation step itself (`course_fee_payments: 7` vs `student_payments_count: 34` didn't match) before anything downstream depended on it. Fixed with a follow-up migration (`20260903071934_fix_course_fee_backfill_coverage.sql`) that wipes and redoes only the `course_fee` slice, this time including any student with an invoice, a payment, *or* a non-zero fee. Re-reconciled clean:

| Check | Old tables | `transactions` | Match |
|---|---|---|---|
| kit_order count | 21 orders | 21 | ✓ |
| kit_order total / paid | ₹77,295 / ₹22,895 | same | ✓ |
| order_items → transaction_items | 104 | 104 | ✓ |
| order_payments → transaction_payments | 6, ₹22,895 | same | ✓ |
| course_fee count | 34 students w/ activity | 34 | ✓ |
| course_fee total / paid | ₹1,85,400 / ₹1,62,000 | same | ✓ |
| student_payments → transaction_payments | 34, ₹1,62,000 | same | ✓ |
| franchise_fee count | 27 franchisees w/ payments | 23 (one row per franchisee, not per payment) | ✓ |
| franchise_fee total / paid | ₹27,06,500 / ₹25,98,500 | same | ✓ |
| franchisee_payments → transaction_payments | 27 | 27 | ✓ |

Every sum and count reconciles exactly. `franchisee_credit_notes` had 0 rows — nothing to migrate.

## What I need from you to proceed

Phase 1 and Phase 2 are both done, on production, verified. Nothing downstream reads the new tables yet, so this remains fully reversible — the six old tables are still the only source of truth for every screen. Phase 3 (dual-write) is next whenever you want to proceed; it starts touching app code, so I'd want to do it one write-path at a time (Orders, then Students, then Franchisees) rather than all at once.
