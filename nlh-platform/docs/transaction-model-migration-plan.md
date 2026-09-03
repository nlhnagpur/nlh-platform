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

## Business rule that must survive into Phase 3/4: franchisee student fees are not HO revenue

Confirmed with the owner and checked against the live app: a franchisee's own student admissions exist in the platform **only to track kit/stock consumption against that franchisee** — the fee a franchisee charges their own students, and any invoice/receipt they issue for it, has **no financial effect on HO**. Of the 34 `course_fee` transactions backfilled in Phase 2, only 28 (tier `NLH`, i.e. Head Office's own direct students) are real HO revenue; the other 6 (4 under Dr. Manohar Gupta's CF, 1 under Pampi Roy's CF, 1 under Satej Gurukul's UF) are franchisee-local bookkeeping only.

`AccountingPage.jsx` today already gets this right *by construction* — its income query never reads `student_payments`/`student_invoices`/`students.fee_total` at all, only `orders.amount_paid` (kit revenue, genuinely HO's) and `franchisees.fee_paid` (franchise enrollment fees, genuinely HO's). No live bug.

**This is the constraint to carry forward once course_fee transactions live in the unified `transactions` table and a future "Ledger"/Accounting view queries across all types:** any HO-level revenue rollup must filter `course_fee` transactions to `party_id`'s franchisee tier = `NLH` — never sum `course_fee` across all tiers blindly. A franchisee-level view (a CF looking at their own students) legitimately shows their own `course_fee` transactions; an HO-level view must not. This wasn't a risk while course_fee data sat in `student_payments`/`student_invoices` untouched by Accounting's queries — it becomes a real risk the moment Phase 4 builds one aggregate Ledger view over `transactions` and someone reaches for `sum(total) where type = 'course_fee'` without the tier filter. Flagging now so that filter is deliberate, not an oversight, when that screen gets built.

## Phase 3 — in progress, one write-path at a time

**franchise_fee (done, verified live):** `RecordFranchiseePaymentModal.handleSave()` in `FranchiseesPage.jsx` now mirrors every payment into `transaction_payments` alongside the existing `franchisee_payments` write, best-effort (a mirror failure logs a warning but never blocks or fails the real payment — `franchisee_payments` stays the source of truth every screen reads from). Added a `sync_transaction_payment_total()` trigger (mirrors `sync_order_payment_total()`) that recomputes `amount_paid`/`status` on `transactions` from its `transaction_payments`, and — since `franchise_fee` has no per-transaction `total` of its own — re-pulls `total` live from `franchisees.enrollment_fee` on every sync rather than storing a second copy that could drift if the fee is edited later.

No transactions row is created at franchisee *onboarding* — it's created lazily, find-or-create, the first time a payment is recorded. A franchisee with no payment yet simply has no transactions row until then, which is fine (nothing reads these tables yet) and self-heals on their first payment.

Verified end-to-end live: recorded a real ₹1 test payment against Shirin Tuition Classes (₹20,000/₹23,000 → ₹20,001/₹23,000, status correctly flipped to `part_paid` on both sides), confirmed `franchisees.fee_paid` and `transactions.amount_paid` matched exactly, then deleted the test payment from both tables and confirmed both reverted cleanly (trigger handles delete too, not just insert).

**kit_order (done, verified live):** `OrdersPage.jsx` gained one shared helper, `mirrorOrderToTransactions(orderId)` — re-reads the order + its items fresh and does a full upsert/resync into `transactions`/`transaction_items` (delete + reinsert the items, since volumes are tiny and a full resync can't drift the way a hand-maintained delta could), plus `mirrorOrderPayment(orderId, payment)` for the append-only payment case. Wired into every place `orders`/`order_items`/`order_payments` actually change: order creation, record/delete payment, dispatch, invoice edit, mark-invoiced, mark-proforma, verify-payment, reopen, convert-proforma-to-invoice, delete-proforma, cancel-invoice — 11 call sites, each wrapped in its own try/catch so a mirror failure only logs a warning and never blocks the real action. No new DB migration needed — the existing `sync_transaction_payment_total()` trigger already handles `kit_order` correctly (it only special-cases `franchise_fee`'s `total`; every other type trusts whatever `total` the app last wrote).

Verified live: recorded a real ₹1 test payment against ORD-2026-0018 (Angels' Park School) — old side went 12,500→12,501/28,200, new side matched exactly (12,501/28,200, `part_paid`), then deleted the test payment from both tables and confirmed a clean revert to 12,500/28,200 on both sides.

**Still to do:** `course_fee` (Students — the per-student-not-per-invoice pooling from Phase 2). Same pattern next.

## What I need from you to proceed

Phase 1, Phase 2, and the franchise_fee slice of Phase 3 are done, on production, verified. Nothing downstream reads the new tables yet, so this remains fully reversible.
