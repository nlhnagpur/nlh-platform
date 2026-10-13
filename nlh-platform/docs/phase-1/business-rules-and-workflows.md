# Phase 1 — Attendance, Admissions and Payments: Business Rules and Workflows (Task D)

Date: 2026-10-13 · Baseline `abaa69d` · Source: code reading (`StudentsPage.jsx`, `studentLifecycle.js`, `feeStatement.js`) and live trigger definitions. Rules marked **[inferred]** are what the code does, not necessarily what the business intends.

**Evidence legend.** *Rules* are read from code or live trigger definitions. The partial-write and race *scenarios* in the tables below are **reasoned from that code; none was reproduced** against a database (doing so safely needs a Supabase branch). Line numbers are approximate.

## 1. Attendance

### Data
`batches` → `batch_sessions` (one row per class day, `is_holiday`) → `session_attendance` (one row per student per session, `attended` true/false). `student_no_class` = a personal off day. `instructor_attendance` records trainer presence/off ("O" with substitute). `batch_students` holds each student's membership period.

### Rules in force
1. **No attendance row = not marked.** It is *not* absent. The cycle tally separates P / A / U / N, with `S = P + A + U` (pinned by test).
2. **Monthly cycle** runs from `cycle_started_at` to the same date next month (clamped to month-end); target = the student's class days in that window minus declared holidays and personal no-class days.
3. **Class days:** the student's own days (set at renewal) win, then the batch's days, else all seven. Saturday is *revision* (does not raise the target, only makes up missed weekday classes) unless Saturday is one of the student's days.
4. **Renewal states:** overdue (past due date), soon (≤ 5 days), ok.
5. **Non-monthly courses** use `skus.total_sessions` vs attended count ("Sessions done" attention flag).
6. **Batch visibility:** a batch shows only if its SKU/instructor filters match (earlier bug: `batches.sku_id` null hid batches).

### Verified by tests
`tests/attendance.test.mjs` (11 tests): month-end clamp, class-day precedence, holiday and no-class effects on target, unmarked ≠ absent, Saturday make-up cap, renewal states, attention reasons, buckets.

### Open questions
- **A1.** Should a student marked present on a trainer-off day be recorded against the substitute (current rule, via pop-up) and does the substitute's pay depend on it?
- **A2.** Is revision on Saturday always free, or only up to the number of missed classes (code: only up to misses)?
- **A3.** What is the policy when a class is held but attendance is never marked — auto-absent after N days, or stays "unmarked" indefinitely (today: indefinite, surfaced as a reminder)?
- **A4.** Do declared holidays extend the cycle end date, or only reduce the target (today: reduce target only)?

## 2. Admission (new student)

### Steps the browser performs today (`AddStudentModal.save`, ~L3656)
| # | Write | Failure handling today |
|---|---|---|
| 1 | `students` insert (fee_total = net fee, fee_paid 0) | error toast, stops |
| 2 | `enrollments` insert (one per selected SKU) | **error not surfaced** — `inserted` simply becomes empty |
| 3 | per-enrolment `enrollments.fee_amount` update (edited rate) | error ignored |
| 4 | `student_invoices` insert (course + kit lines) | **error ignored** |
| 5 | `stock_ledger` insert (kit deduction) | **error ignored** |
| 6 | `batches` insert (optional new batch) / `batch_students` insert | per-batch toast, continues |
| 7 | auth account / temp password (out of scope) | – |

### Partial-write scenarios
| Scenario | Resulting state | Detection |
|---|---|---|
| Step 2 fails | student with `fee_total > 0`, no enrolments, no invoice → balance with nothing to bill | "students without invoice/enrolment" report |
| Step 4 fails | enrolments and fee exist, no invoice; statement falls back to an `other` line | missing invoice number |
| Step 5 fails | invoice lists kit as given, stock not deducted → inventory drifts | stock vs issued report |
| Network drop after step 1 | orphan student, user retries → **duplicate student** (no uniqueness guard on name+phone) | duplicate-name query |
| Step 6 fails | student enrolled but in no batch → never appears in attendance | "enrolled, no batch" report |

**Rule [inferred]:** an admission is meant to be all-or-nothing, but nothing enforces it.

### Open questions
- **B1.** Is a coupon redeemed at admission or at first payment? (Code: at first payment.)
- **B2.** What uniquely identifies a student — phone, email, name + DOB? (nothing enforced today)
- **B3.** Should kit stock be deducted at admission or when handed over (code has both paths: auto-deduct then "confirm kit")?

## 3. Payments

### Flow (`StudentReceiptModal`, ~L4590–4640)
1. Client check: amount > 0 and ≤ outstanding (from client state `paidSoFar`).
2. `student_payments` insert (`paid_at` = date received, `receipt_date` = today). DB: `trg_receipt_no` numbers it, `trg_check_student_payment` caps the total, `tr_recompute_fee_paid` updates `fee_paid` and `payment_status`.
3. Best-effort `transactions` mirror (failure swallowed).
4. If it was the first payment: `redeem_coupon` RPC (failure becomes a toast, payment is kept).
5. UI updates from the returned row.

### Partial-write / race scenarios
| Scenario | Effect |
|---|---|
| Two receptionists record the same payment simultaneously | cap trigger reads without locking → both may pass; a transient overpayment, then `fee_paid > fee_total` |
| Payment saved, coupon redeem fails | discount recorded on the student but coupon usage not counted → limit can be exceeded |
| Payment saved, mirror fails | `transactions` drifts (mirror is write-only today, so no visible effect) |
| Payment deleted | `fee_paid` recomputed by trigger; mirror row delete is try/catch; receipt number is **not** reused (gap in numbering — see Q-P2) |
| Receipt edited | `receipt_no_previous` kept; `paid_at`/`receipt_date` may change after the receipt was already sent on WhatsApp |

### Fee-changing flows (the other half of the balance)
| Flow | Writes | Concern |
|---|---|---|
| Renewal (`~L975–1042`) | `enrollments` update → `students.fee_total` update (absolute, from client `form.fee_total`) → `student_invoices` insert | three non-atomic writes; failure between 2 and 3 leaves a charge with no invoice; stale `form.fee_total` can overwrite a concurrent change |
| Edit invoice (`~L5095–5127`) | invoice update → read `fee_total` → write `fee_total + delta` | read-modify-write race; if the second write fails the invoice and fee total disagree |
| Add course (`~L1303–1380`) | `enrollments` insert → `students.fee_total` update → invoice insert | same pattern |
| Discontinue / reinstate (`~L1524–1559`) | `enrollments` update → `students` update | same pattern |
| Delete student (`~L1577–1594`) | checks payments, deletes enrolments, deletes student, mirror delete | refuses when payments exist (good) |

### Open questions
- **P1.** Are partial payments allowed per course, or only against the account?
- **P2.** Should a deleted/voided receipt number be reusable, or must the series show a gap with a reason (audit)?
- **P3.** Who may back-date `paid_at`, and should back-dated receipts after month-close be blocked?
- **P4.** Are refunds a separate document type?

## 4. Cross-cutting recommendations

1. Wrap admission, renewal, add-course, edit-invoice and discontinue in single database functions (one transaction, increments not absolute writes, `SELECT … FOR UPDATE` on the student).
2. Surface every swallowed error (steps 2–5 above) at least as a visible warning and an audit row.
3. Add "orphan" read-only reports: students without enrolments, enrolments without batch, invoices without enrolment, payments exceeding fee.
4. Add a uniqueness/duplicate-warning rule for student creation (needs B2).
