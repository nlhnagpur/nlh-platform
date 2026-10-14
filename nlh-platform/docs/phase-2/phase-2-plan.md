# Phase 2 Plan (corrected) — Financial Consistency and Supabase Security

Date: 2026-10-13 · Baseline `47d4d6c` · Status: **Stage 0 complete; Stages 1–7 not started and each needs explicit approval.**

## Correction

An earlier version of this plan said Phase 1 "proved the money is correct today". **That was incorrect.** Phase 1 identified inconsistencies and established a test baseline. The stored financial figures were found to agree with one another, but they have **not** been independently verified against receipts, bank records or the parents' own records, so complete production financial correctness is **unverified**. One active student also has a NULL `fee_total`. Nothing in this plan assumes the live records are correct.

## Principle

Any step that changes database behaviour is first rehearsed on an **isolated database seeded only with synthetic data** — never on production, because even a rolled-back test permanently consumes live sequences. Production receives only read-only queries until a migration has passed that rehearsal and has been separately approved.

## Stages

| Stage | Scope | Isolated DB first? | Status |
|---|---|---|---|
| 0 | Preparation: environment options, baseline analysis, synthetic data, reconciliation queries | partly (it *prepares* it) | **complete** — see `stage-0/stage-0-report.md` |
| 0b *(proposed)* | Build the isolated environment from a baseline schema; load seed; run reconciliation and scenario scripts | creates it | awaiting your decisions |
| 1 | Remove anonymous attack surface (S-01, S-05, S-06, S-09) | **yes** | not started |
| 2 | One payment-allocation engine (F1, F7, F11) — client code only | no (tests guard it) | not started |
| 3 | Transaction consistency: atomic RPCs for admission, renewal, add-course, invoice edit, discontinue (F3, D-1) | **yes** | not started |
| 4 | Payment/invoice integrity: derived invoice paid/status, `fee_total ≥ fee_paid`, concurrency-safe cap, single status writer (F2, F4, F5, F6) | **yes** | not started |
| 5 | RLS: bind `student_id` to the centre (S-02) and role-matrix test | **yes** | not started |
| 6 | Storage + WhatsApp sender hardening (S-03, S-04) | bucket policy yes; API code local with stubs | not started |
| 7 | Production rollout: one migration at a time, backup first, before/after reconciliation | production (read-only checks + approved migration) | not started |

## Gates that apply to every stage

1. A written scope and rollback before any change.
2. Reconciliation queries (`stage-0/reconciliation-queries.sql`) run **before and after**, output attached.
3. The regression suite (`npm test`) green; behaviour changes show up as a deliberate test edit.
4. No change to authentication, temporary-password handling, or account provisioning unless separately authorised.
5. No commit or push without your instruction.

## Open decisions (see Stage 0 report §10)

Environment option and baseline method · cost approval for any branch · business answers Q1, Q2, Q5, Q6 (allocation, waiver, fee-below-paid) and Q8–Q12 (refunds, NULL-fee student, duplicates, authoritative source of truth, sign-off) · how `WHATSAPP_APP_SECRET`'s configured/missing status is to be established.
