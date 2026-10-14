# Phase 1 — Student Financial Reconciliation (Task B)

Date: 2026-10-13 · Baseline `abaa69d` · Method: code reading + SELECT-only aggregate queries. No data was changed. Student identities are not reproduced.

## 1. Data model (as it exists today)

| Table / column | Role | Maintained by |
|---|---|---|
| `students.fee_total` | the account's running total charge | **the browser** (absolute writes in many flows); changes logged by trigger `trg_log_student_fee` into `student_fee_events` |
| `students.fee_paid` | sum of payments | trigger `tr_recompute_fee_paid` (`SUM(student_payments.amount)`) |
| `students.payment_status` | none / pending / partial / paid | the same trigger **and** browser `deriveStatus` (and a `'waived'` override in one flow) |
| `students.other_charges`, `waived_amount`, `discount_amount`, `coupon_*` | extra charge / waiver / coupon figures | browser |
| `enrollments.fee_amount`, `list_price`, `waived` | per-course charge, catalogue price, waived part | browser (+ `trg_default_enrollment_fee`, `trg_log_enrollment_fee`) |
| `student_invoices` (`items` jsonb, `subtotal`, `discount`, `total`, `amount_paid`, `status`) | billing documents `SINV-YYYY-NNNN` | browser inserts/updates; `trg_student_invoice_no` numbers them |
| `student_payments` (`amount`, `paid_at`, `receipt_date`, `receipt_no`) | money received, held **against the student, not a course/invoice** | browser inserts; `trg_receipt_no`, `trg_check_student_payment` (cap), `tr_recompute_fee_paid` |
| `student_fee_events` | audit log of `fee_total` / `fee_amount` changes | DB trigger |
| `transactions*` | dual-write mirror of payments/fees | browser, best-effort, write-only |
| `student_fee_adjustments` | **does not exist** (only proposed in the earlier fix brief) | – |

Canonical identity that holds in the live data: **balance = `fee_total − fee_paid`**, and `fee_paid = Σ payments`.

## 2. Calculation engines found

| # | Engine | Where | Output | Allocation order |
|---|---|---|---|---|
| A | DB trigger `recompute_student_fee_paid` | Postgres | `fee_paid`, `payment_status` | n/a (totals only); skips `payment_status` when `is_active = false` |
| B | `deriveStatus(total, paid)` | `src/utils/feeCoverage.js` (was `StudentsPage.jsx`) | status string | n/a; used after fee edits; one flow overrides to `'waived'` |
| C | `computeCoverage` | `src/utils/feeCoverage.js` | per-course paid/due, discount | courses by `enrolled_at`; `discount = max(0, Σfee_amount + other − fee_total)` is added to the payment pool; `other_charges` settled last |
| D | `invoiceSettlement` | `src/utils/invoiceSettlement.js` | per-invoice paid/due/status | invoices by `invoice_date`; **un-invoiced part of `fee_total` soaks up payments first**; invoice excess over `fee_total` counts as settled |
| E | `buildFeeStatement` → `receiptPreview` / `allocateReceipt` | `src/utils/feeStatement.js` | statement lines, receipt "applied to" rows, advance | rebuilt from the fee-change log + invoices; oldest charge first; discounts folded into matching course |
| F | `attentionReasons` "balance" | `src/utils/studentLifecycle.js` | boolean flag | `fee_total − fee_paid > 0` |

## 3. Formula comparison — where they agree and where they do not

| Question | A/B/F | C (course) | D (invoice) | E (receipt) | Same? |
|---|---|---|---|---|---|
| Total outstanding | `fee_total − fee_paid` | `activeOutstanding` | Σ invoice due + uninvoiced | `balance` from statement | **Yes** when all are consistent |
| Which course is still unpaid | – | oldest enrolment first | oldest **invoice** first, uninvoiced first | oldest **charge line** first | **No** — different orders |
| Effect of a discount | status only | pooled as extra credit | excess invoices counted settled | folded into matching course | Totals agree, per-course split can differ |
| `other_charges` | included in `fee_total` | settled last | "uninvoiced" → settled **first** | an `other` line, first in the statement | **No** |
| Overpayment | trigger cap blocks, but only if `fee_total > 0` | n/a | pool clamps at 0 | shown as `advance` | partly |

Proven by test (`tests/financial.test.mjs`, "KNOWN DIVERGENCE"): a student owing ₹5,000 (invoiced course) + ₹2,000 (un-invoiced charge) who has paid ₹2,000 is shown by engine D as **₹5,000 due on the invoice** and by engine C as **₹3,000 due on the course**. The student's total (₹5,000) is identical either way; the per-course/per-invoice answer differs.

## 4. Live-data reconciliation (read-only, aggregate)

| Check | Result | Reading |
|---|---|---|
| Students | 37 | – |
| `fee_paid` ≠ Σ `student_payments` | **0** | trigger is working; the canonical identity holds |
| `fee_paid` > `fee_total` (overpaid) | **0** | cap trigger + client checks hold today |
| Status "paid" but `fee_paid < fee_total` | **0** | status is consistent with amounts |
| Status not paid but fully covered | **0** | – |
| Payments whose centre ≠ student's centre | **0** | no cross-centre contamination today |
| Invoices whose centre ≠ student's centre | **0** | – |
| Enrolments whose centre ≠ student's centre | **0** | – |
| Invoices where `total ≠ subtotal − discount` | **0** | – |
| Payments with no receipt number | **0** | numbering trigger works |
| Payments where `paid_at ≠ receipt_date` | 1 | expected after the receipt-date feature; not a defect |
| `fee_total` ≠ Σ non-cancelled invoice totals | 28 of 37 | **24 students have no invoice at all** (admitted before invoicing, or imported); the other 4 differ through discounts/renewals/adjustments |
| `fee_total` ≠ Σ `enrollments.fee_amount` | 26 of 37 | explained by `other_charges`, waivers, discounts and un-enrolled legacy fees; needs business confirmation (Q3) |
| Σ invoice `amount_paid` vs Σ payments | **18 of 18 invoices are `unpaid` with `amount_paid = 0`**, although 34 students have payments | **`student_invoices.amount_paid`/`status` are never maintained**; settlement is derived in the browser (engine D). Anything that reads the DB columns (reports, exports, future APIs) will show every invoice unpaid |
| Enrolments with `fee_amount = 0` | 1 | review (Q4) |

Conclusion: **the internal-consistency checks above found no mismatch between the stored totals and the stored payment rows.** This is *not* an independent verification that the financial records are correct: nothing here was compared with receipt books, bank statements or the parents' own records, and one active student has a NULL `fee_total` (found in Stage 0). The identified risks are structural (duplicated logic, unmaintained invoice columns, non-atomic writes). Whether the live records are fully correct has not yet been established.

## 5. Discrepancies and risks (verified vs inferred)

| ID | Finding | Evidence | Verified? | Severity |
|---|---|---|---|---|
| F1 | Three browser allocation engines (C, D, E) can answer "what is unpaid" differently per course/invoice | code + synthetic test | **Verified** (test) | Medium |
| F2 | `student_invoices.amount_paid` / `status` never updated; 18/18 stale | live aggregate | **Verified** (query) | Medium |
| F3 | `fee_total` is written as an absolute value from client state (renewal uses `form.fee_total`; edit-invoice does read-then-write). Two users/tabs can overwrite each other | `StudentsPage.jsx` renewal ~L1009–1015, invoice edit ~L5120–5122 | **Verified by code**, race not exercised live | Medium |
| F4 | Nothing stops `fee_total` being lowered below `fee_paid`; the cap trigger only checks on payment insert/update | trigger definitions | **Verified by code** (0 cases live) | Medium |
| F5 | Payment cap is skipped when `fee_total = 0`; cap check reads without locking, so two simultaneous payments can both pass | `check_student_payment_total` source | **Verified by code**, race not exercised | Low–Medium |
| F6 | `payment_status` can be written both by trigger and by browser (and a `'waived'` value only the browser knows); trigger leaves status alone for inactive students | trigger + `StudentsPage.jsx` | **Verified by code** | Low |
| F7 | Statement reconstruction (`buildFeeStatement`) matches invoices to log events by "same amount within 120 s"; heuristic, can mis-attribute and falls back to an `other` line | `feeStatement.js` | **Verified by code**; behaviour pinned by tests | Low–Medium |
| F8 | 24 of 37 students have no invoice, so engine D/E fall back to "uninvoiced"/"other" for them | live aggregate | **Verified** | Info |
| F9 | `transactions*` mirror failures are swallowed (`try/catch` + `console.warn`), so the mirror can silently drift | code | **Verified by code**; mirror is write-only | Low |
| F10 | Revenue split (CF 50 / SMF 25 / NLH 25) not implemented (`revenue_splits` unused) | CLAUDE.md + grep | **Verified** | Info (known) |

## 6. Proposed single source of truth (not implemented)

1. **Totals:** keep `balance = fee_total − Σ payments` as the only authoritative number (it already reconciles 37/37). Compute `fee_paid`/`payment_status` only in the trigger; the browser should stop writing `payment_status` and use the stored value.
2. **Charges:** make `fee_total` the **sum of explicit charge/adjustment rows** (the proposed `student_fee_adjustments`, plus invoice items) maintained by a DB function, instead of an absolute number written by many screens.
3. **Allocation:** one shared module (and, ideally, one SQL view) deciding oldest-first allocation; engines C, D, E become thin wrappers. The order rule (enrolment date vs invoice date vs uninvoiced-first) must be decided by the business (Q1).
4. **Invoice paid/status:** derive in a view or maintain by trigger so DB readers see the same answer as the UI.
5. **Atomicity:** admission, renewal, add-course, edit-invoice, delete-payment become single RPCs (one transaction).

## 7. Unresolved business questions

- **Q1.** When a student has several courses/invoices and pays part, which one does the money go to first — oldest enrolment, oldest invoice, or the one the parent names?
- **Q2.** Should un-invoiced fees (opening balances, other charges) be paid before or after course invoices?
- **Q3.** What exactly is `other_charges` — a fee, a deposit, a fine? Should it ever be discounted or waived?
- **Q4.** Is a ₹0 enrolment intentional (scholarship/free trial) or a data-entry gap?
- **Q5.** Is a waiver a discount (reduces `fee_total`) or a write-off (kept as receivable and cancelled)? Today it behaves as a discount.
- **Q6.** May `fee_total` ever be reduced below what has been paid? If yes, what happens to the excess — refund, credit, advance?
- **Q7.** Do monthly renewals get invoiced every month, or only when paid?
- **Q8.** Are cancelled invoices and refunds in scope (no refund table exists)?

## 8. Remediation plan (proposed — Phase 2, requires approval)

| Step | Change | DB change? | Risk |
|---|---|---|---|
| 1 | Add the regression tests in this phase to CI; freeze behaviour | no | none |
| 2 | One shared allocation module; C/D/E call it | no | low (tests exist) |
| 3 | Stop browser writing `payment_status`; read trigger value | no | low |
| 4 | Invoice `amount_paid`/`status` derived (view/trigger) | **yes** | medium — needs a Supabase branch rehearsal |
| 5 | Atomic RPCs for renewal/admission/invoice-edit | **yes** | medium |
| 6 | Trigger: forbid `fee_total < fee_paid` unless an explicit adjustment row exists | **yes** | medium — needs Q6 |

## 9. Regression tests added

`tests/financial.test.mjs` — 17 tests over `deriveStatus`, `computeCoverage`, `invoiceSettlement`, `buildFeeStatement`, `receiptPreview`, `allocateReceipt`, `paymentsUpTo` using synthetic rows only. Results are in Task E.
