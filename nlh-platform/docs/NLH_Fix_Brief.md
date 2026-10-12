# NLH Platform — Fix Brief for Claude

*Addressed to: Claude (coding agent).  Source of truth: `docs/NLH_Program_Audit.md` @ commit `332a4f3` (2026-10-12).  Finding IDs (F1–F37) and question IDs (Q1–Q17) refer to that audit.*

You are to correct the deficiencies the audit identified — nothing else. No new features, no redesign of areas the audit did not flag. Work in the phase order below; inside a phase, do the fixes in the order given.

---

## 0. Ground rules

1. **Do not commit or push** until the user says "commit and push". Build (`npx vite build`) must pass before you report a fix done.
2. **Database changes** go through `apply_migration`, and the same file is written to `supabase/migrations/<version>_<name>.sql` using the version the database assigned (see `CLAUDE.md`). **Test every DB change on a Supabase branch**, not the live project — rolled-back tests still consume sequences (receipt / invoice numbers).
3. **Code style:** plain `function` declarations (no arrow functions), inline styles + CSS variables as in the surrounding file, amounts are whole rupees (integers), email lookups use `.ilike()`.
4. **Money changes are gated.** Anything marked **💰 MONEY** below changes a balance, a charge, a receipt/invoice figure or numbering. Stop after implementing and show the user the before/after diff (§4) before it is applied to the live project.
5. **One fix = one change set** (migration + code + a one-line note in the final summary). Keep functions small; do not reformat or refactor beyond what the fix requires.
6. **Take a baseline first** (Phase 0). Every verification below is a comparison against it.

## 1. Decisions and assumptions (apply unless the user overrides)

| # | Decision | Basis | Departs from audit? |
|---|---|---|---|
| D1 | `students.fee_total` stays authoritative; it must be **explainable** as `Σ student_invoices.total + other_charges + Σ student_fee_adjustments.amount` | Q1, F1–F2 | No — makes the assumption enforceable |
| D2 | Payments are held against the student and allocated oldest charge first, after discounts | Q11 | No |
| D3 | The "gap" between course fees and `fee_total` is recorded as an explicit adjustment with a reason, never inferred as "discount" | Q2, F2 | Yes — Q2's "treat as discount for display" is replaced by an explicit record |
| D4 | Receipt numbers follow the **receipt (issue) date** year, not the payment date | F8, Q6 | **Yes** — Q6 assumed payment date; F8 shows that back-dated payments land in an earlier series |
| D5 | Parent e-mail is **optional** at admission (warn, don't block) | F24, Q17 | **Yes** — Q17 assumed "intentional" |
| D6 | Attendance with no row means **not marked**; no screen defaults a student to present | F13, Q4 | No |
| D7 | Batch management stays head-office only | Q5 | No |
| D8 | "Change course / level" is a *correction* tool; moving up a level is Add Course | F15 | Clarifies |
| D9 | A batch joining date is independent of the student's registration date | F12 | Decision (audit lists three meanings) |
| D10 | Legacy columns are deprecated by comment, not dropped | F33, Q9 | No |

---

## 2. Phase 0 — Safety net (do first, changes nothing)

**P0.1 Snapshot.** Run and save the result (CSV in your scratchpad **and** the totals in your summary). Every later verification diffs against it.

```sql
-- per-student money snapshot
select s.id, s.full_name, s.is_active, s.fee_total, s.fee_paid, s.payment_status,
       coalesce((select sum(total) from student_invoices i where i.student_id=s.id),0) as invoices_total,
       coalesce((select sum(amount) from student_payments p where p.student_id=s.id),0) as payments_total,
       coalesce((select sum(fee_amount) from enrollments e where e.student_id=s.id),0) as enrolment_fees
from students s order by s.id;

-- counts that must not change unless a step says so
select (select count(*) from students) students,
       (select count(*) from enrollments) enrolments,
       (select count(*) from batches) batches,
       (select count(*) from batch_sessions) sessions,
       (select count(*) from session_attendance) attendance_rows,
       (select count(*) from student_invoices) invoices,
       (select count(*) from student_payments) payments,
       (select sum(fee_total) from students) sum_fee_total,
       (select sum(fee_paid) from students) sum_fee_paid;
```

Expected at audit time: 37 / 81 / 30 / 917 / 2,172 / 18 / 42. Also observed 2026-10-12: students with an invoice **13**, without **24**; `fee_total ≠ Σ invoices + other_charges` for **26**; `fee_total ≠ Σ enrolment fee + other_charges` for **18**; `fee_paid > fee_total` for **0**; duplicate active SMF/CF territories **0**; stale `payment_status` **0**.

**P0.2** Create a Supabase branch for all DB work. **P0.3** Add `scripts/verify-money.sql` containing the integrity view query from Fix A and the snapshot queries above, so the checks can be re-run.

---

## 3. Fixes

### H-severity block (do first)

#### Fix A — One guarded, atomic path for every money write  ·  F31, F1, F2, F7  ·  H  ·  💰 MONEY

**Required behaviour**

1. **Explainable total.** Add `student_fee_adjustments` (`id`, `student_id`, `enrollment_id` nullable, `kind` ∈ `legacy_opening | discount | coupon | waiver | correction`, `amount` signed integer — negative lowers what is owed, `reason` text not null, `created_by`, `created_at`). Same RLS pattern as `student_invoices` (admin, or centre in `nlh_accessible_franchisee_ids()`, plus staff-perm policies). Invariant **I1**: `fee_total = Σ invoices.total + other_charges + Σ adjustments.amount`.
2. **No direct edits.** A `BEFORE UPDATE OF fee_total ON students` trigger raises an exception unless `current_setting('nlh.money_rpc', true) = 'on'`. The RPCs below set it with `set_config('nlh.money_rpc','on', true)`. The same trigger raises when the new `fee_total` is **below** `fee_paid` (F7): *"Fee total ₹x is below ₹y already received — adjust the receipt first."* Payments keep their existing cap trigger.
3. **Atomic RPCs** (each one transaction, `SECURITY DEFINER`, first line checks `nlh_is_admin()` or the student's centre ∈ `nlh_accessible_franchisee_ids()`, and `nlh_staff_can` for staff). The browser calls them instead of chaining table writes:

| RPC | Replaces (client sequence) |
|---|---|
| `admit_student(p jsonb)` | `AddStudentModal.save`: student → enrolments → fee fix → invoice → stock → batches (+ optional first payment, Fix N) |
| `add_courses(p_student, p_lines jsonb, p_date, p_coupon)` | `StudentsPage.addEnrollments` |
| `renew_cycles(p_rows jsonb, p_payment jsonb)` | `renewCycle` (+ Fix M) |
| `edit_invoice(p_invoice, p_lines jsonb, p_date, p_notes)` | `InvoiceEditModal.save` (amount, level, kit, added course) |
| `record_payment` / `edit_payment` / `delete_payment` | `StudentReceiptModal.save/saveEdit`, `deletePayment` |
| `adjust_fee(p_student, p_kind, p_amount, p_reason, p_enrollment)` | `saveFeeOnly`, `applyFeeDiscount`, `saveOtherCharges` |
| `discontinue_course`, `restore_course`, `close_account`, `reopen_account` | the same-named functions (write waiver adjustments; reopen reverses them) |

   Each RPC writes `student_fee_events` through the existing triggers, creates invoice / adjustment rows so I1 still holds, and returns the new ids. A failure leaves nothing behind.
4. **UI.** The free "Agreed Fee" input on the Profile becomes read-only text plus an **Adjust fee…** dialog (kind, amount, reason, required) calling `adjust_fee`. `saveCourseFee` (course pencil) keeps changing only `enrollments.fee_amount` and never touches `fee_total` (unchanged rule R6).

**Touches:** new migration (table, trigger, RPCs, view `v_student_fee_integrity`); `src/pages/StudentsPage.jsx` (handlers listed above become thin wrappers); remove the corresponding multi-call code.

**Backfill (no balance change):** one `legacy_opening` adjustment per student where `fee_total − Σ invoices − other_charges ≠ 0`, reason `"Legacy balance carried forward 2026-10-12 — unreviewed"`. Expected **26 rows** (24 students have no invoice at all). Produce `docs/review/fee-adjustments.csv` listing the 13 invoice-holding students with a non-zero residual (manual edits that need a human decision) sorted by size.

**Assumption:** the 24 invoice-less students are migrated legacy accounts; their opening balance is correct as stored.

**Verify**
- `select count(*) from v_student_fee_integrity` → **0** (view returns students violating I1).
- Snapshot diff on `fee_total`, `fee_paid`, `payment_status`: **empty**. `sum_fee_total` / `sum_fee_paid` unchanged. Counts 37 / 81 / 30 / 917 / 2,172 / 18 / 42 unchanged; `student_fee_adjustments` = 26.
- `update students set fee_total = fee_total + 1` from an authenticated non-RPC session → exception.
- Try `adjust_fee` that would take `fee_total` below `fee_paid` → rejected with the message above.
- Force a failure inside `admit_student` (invalid sku in the 3rd line) → no student, enrolment, invoice or stock row remains.

**Money:** 💰 backfill moves no balance; the **guard changes behaviour** (direct Agreed-Fee edits stop working; below-paid edits are blocked). Needs review before rollout.

---

#### Fix B — One allocation engine; stored statuses always equal derived  ·  F3, F4, F5  ·  H/H/M  ·  💰 MONEY (display)

**Required behaviour**

1. Replace the three client engines (`StudentsPage.computeCoverage`, `utils/feeStatement.js › allocateReceipt / receiptPreview`, `utils/studentLedger.js › invoiceSettlement`) with **one** database function pair:
   - `student_charges(p_student)` → ordered charges: invoice lines (with `period_label`, kind), `other_charges`, positive adjustments.
   - `student_allocation(p_student)` → per charge: `net` (after discounts), `paid`, `due`; per payment: amount applied to which charge.
   Rules (D2): payments ordered by `paid_at, created_at, id`; charges by `invoice_date, created_at, line order`; negative adjustments reduce the named enrolment's oldest open charge, else the oldest open charge.
2. The client calls these and renders; `feeStatement.js` keeps only presentation (month labels, "Balance ₹x / Part ₹x" wording). Delete `computeCoverage` and `invoiceSettlement`.
3. **Stored = derived.** An `AFTER` trigger on payments / invoices / adjustments / `students.fee_total` refreshes `student_invoices.status` and `amount_paid` from `student_allocation`, and `students.payment_status` (none / pending / partial / paid). Profile "Invoice history" then shows the stored value correctly (F4). The client **never writes** `payment_status` or invoice status.
4. One vocabulary: students `none | pending | partial | paid`; invoices `unpaid | part | paid`. A closed account is displayed as "Closed" from `is_active = false`, not stored as `waived`. The `transactions.status` map stays inside the DB mirror (Fix E).

**Touches:** migration (functions, triggers); `StudentsPage.jsx` (Courses cards, receipt screen, Profile lists), `StudentLedgerView.jsx`, `StudentInvoicesRegister`, `studentReceipts.js`, `feeStatement.js`.

**Backfill:** run the refresh once for all students and invoices; map any `payment_status = 'waived'` to the derived value.

**Assumption:** I1 holds (Fix A) so allocation totals reconcile to `fee_total − fee_paid`.

**Verify**
- For every student: `Σ due over charges = fee_total − fee_paid` (query in `scripts/verify-money.sql`), 37/37.
- **Parity test:** for all 42 payments, compare old JS output (course/month/amount rows) with SQL rows; the only allowed differences are the 13 invoice-holding students' wording — list them for review.
- Profile and Accounts tab show the same Paid/Part/Unpaid for each of the 18 invoices.
- Snapshot diff: only `payment_status` may change, and only where the audit already showed a stale value (expected none).

**Money:** 💰 no balance changes; **printed receipt wording and course-wise dues may change** for students whose history includes manual edits — review the parity list before rollout.

---

#### Fix C — Attendance: one write path, no default "present"  ·  F13, F19  ·  H/M

**Required behaviour**

1. Add `record_session(p_batch, p_date, p_holiday, p_instructor, p_substitute, p_marks jsonb, p_no_class jsonb)` — upserts the session, replaces attendance rows for **marked students only**, replaces `student_no_class` rows, recomputes `batches.sessions_done`. `AttendanceRegister.saveBatch` calls it.
2. `BatchesPage.BulkAttendanceModal` and `InstructorsPage.AttendanceModal`: initial state is **blank** for every student (not `!== false`); keep an explicit **All present** button; save through `record_session`. They read `student_no_class` and show N / H exactly as the register does (shared small component or a link into the register for that batch/date — choose the smaller change).
3. Unmarked students never get a `session_attendance` row (D6).

**Touches:** migration (RPC); `AttendanceRegister.jsx`, `BatchesPage.jsx` (L37–300), `InstructorsPage.jsx` (L1957–2120).

**Backfill:** none. Historical default-present rows cannot be told apart from real marks; leave them.

**Verify:** counts 917 sessions / 2,172 attendance rows unchanged after deploy; on the branch, save a 3-student session with one P → exactly **1** new row (previously 3); a student marked N on the register appears as N in the Batches modal; `v_student_fee_integrity` unaffected.

**Money:** none. (Cycle targets use attendance — re-run the Courses-card S/P/A counts for 3 students before/after; unchanged.)

---

#### Fix D — Stop the fixed password  ·  F29  ·  H  ·  security (not money)

**Required behaviour**

1. Remove `genTempPass()` (StudentsPage L189, FranchiseesPage L330) and `const tempPass = 'NLH@123'` (AccessRequestsPage L310). `api/create-user.js` creates the user with a **random** 24-character password generated server-side and never returned or e-mailed.
2. The welcome e-mail carries a **set-password link** (Supabase `auth.admin.generateLink({ type: 'recovery' })` or `inviteUserByEmail`), not a password. `sendWelcomeEmail(email, name, role, password)` loses the `password` argument; the credentials dialog in `AccessRequestsPage` becomes "Invitation sent to …".
3. `AddStudentModal` stops generating a password (it creates no login).

**Touches:** `api/create-user.js`, `api/send-email.js` (`welcome` template), `src/services/email.js`, `AccessRequestsPage.jsx`, `FranchiseesPage.jsx` (3 call sites: L819, L1888, L2097), `StudentsPage.jsx`, `UsersPage.AddUserModal` (keeps an admin-typed password only if the user explicitly sets one).

**Backfill:** produce the list of logins created through these paths (`users` rows with `auth.users.last_sign_in_at is null` or created via approval) and, **only after the owner approves**, send them a reset link. Do not change any password directly.

**Verify:** grep for `NLH@123` → 0 hits in `src/` and `api/`; creating a franchisee on the branch sends an e-mail with a link and no password; the new login cannot sign in with `NLH@123`.

---

### M-severity block

#### Fix E — Mirror to `transactions` by trigger, not by client  ·  F6  ·  M

**Behaviour:** delete `mirrorStudentToTransaction` / `mirrorStudentPayment` and every call (10 sites in `StudentsPage.jsx`). Add DB trigger function `sync_student_transaction(student)` run `AFTER` insert/update/delete on `student_invoices`, `student_payments`, `student_fee_adjustments` and on `students.fee_total`, upserting the `course_fee` transaction, its items and payments exactly as the client did. Keep `transaction_payments` receipt numbers in step (already renumbered once).
**Touches:** migration; `StudentsPage.jsx`. **Backfill:** rebuild every student's `course_fee` transaction. **Verify:** for the 37 students, `transactions.total = fee_total` and `Σ transaction_payments = fee_paid` (0 mismatches); after a renewal on the branch the mirror updates (it previously did not). **Money:** none (mirror only; nothing reads it).

#### Fix F — Receipt year follows the receipt date  ·  F8  ·  M  ·  💰 numbering only
**Behaviour:** `assign_student_receipt_no` uses `extract(year from coalesce(NEW.receipt_date, current_date))`. The Receipts register shows both dates unchanged. **Backfill:** none — existing numbers are not touched. **Verify:** insert a payment with `paid_at` in 2025 and `receipt_date` today on the branch → number carries the current year; the 42 existing receipt numbers unchanged. **Assumption:** D4.

#### Fix G — Invoice edit keeps the enrolment's own fee in step  ·  F9, F28  ·  M  ·  💰 MONEY
**Behaviour:** in `edit_invoice`, when a **non-renewal** course line that has an `enrollment_id` changes amount, also set `enrollments.fee_amount` to the new amount (not `list_price`; no effect on `fee_total` beyond the invoice delta already applied). Renewal lines never change `fee_amount`. **Touches:** the RPC. **Backfill:** none. **Verify:** edit a first-invoice line 3,500 → 3,000 on the branch: invoice 3,000, `fee_total` −500, enrolment `fee_amount` 3,000, next renewal default 3,000. **Money:** 💰 course-level dues shown on cards change for edited lines; review.

#### Fix H — One batch picker, one batch form, one assignment RPC  ·  F10, F11, F12  ·  M
**Behaviour**
1. `assign_enrollment_to_batch(p_enrollment, p_batch, p_joined_on)` (re-activates an existing row, closes the old one, as `assignToBatch` does today) is the only writer of `batch_students`; `create_batch(p jsonb)` the only writer of `batches` (sets `franchisee_id` from the instructor, as fixed).
2. Candidate list (everywhere): active batches of the student's centre, **continuing batch first**, then batches of CIs appointed for the level, then the rest. **Never filter on `batches.sku_id`** (12 of 30 are empty).
3. One `BatchFormFields` component replaces the five copies (Batches New, Instructors ▸ Batches, student card panel, Add Course, New Student).
4. Remove the `registered_at → assigned_at` rewrite in `StudentDetailModal.save` (D9); joining date is edited only in the Roster.
**Touches:** `StudentsPage.jsx`, `BatchesPage.jsx`, `InstructorsPage.jsx`, migration. **Backfill:** none. **Verify:** `batch_students` row count unchanged; the two students with Level 3 and no batch (Sai Pichkate, Shivansh Kitukale) see "Mon-Fri 5 to 6 pm" first; changing a student's registration date leaves their `assigned_at` untouched. **Money:** none.

#### Fix I — One completion path  ·  F14, F27  ·  M
**Behaviour:** `complete_enrollment(p_enrollment, p_date, p_marks jsonb)` implements the existing student-side logic including the SCHOOL marks / `pending_review` branch; `BatchesPage.markComplete` is removed and its roster button opens the same dialog. After a successful completion the Certificate dialog opens preselected for that course (one follow-up, not a new feature). **Touches:** `StudentsPage.jsx`, `BatchesPage.jsx`, migration. **Verify:** completed enrolments count unchanged; completing a SCHOOL-tier enrolment from Batches now yields `cert_status = 'pending_review'`. **Money:** none.

#### Fix J — "Next level" has one meaning  ·  F15  ·  M
**Behaviour:** `saveChangeLevel` refuses when the enrolment already has attendance rows or an invoice line, with: *"This course has classes recorded. To move up a level use Add Course."* It remains available to correct a mistaken level before any class. Session-billed counts therefore never inherit an earlier level's attendance. **Touches:** `StudentsPage.saveChangeLevel`, `InvoiceEditModal` (level dropdown follows the same rule when the line's enrolment has attendance). **Verify:** change-level on an enrolment with 11 attendance rows (e.g. Ashna Khan, Chess L1) is refused; on a fresh enrolment it works. **Assumption:** D8. **Money:** none.

#### Fix K — Single kit checklist  ·  F26  ·  M
**Behaviour:** one `KitChecklist` component + RPC `set_enrollment_kit(p_enrollment, p_items jsonb)` (idempotent against `stock_ledger` issue rows) used by the invoice line, the card badge panel and Change level. **Verify:** stock ledger issue rows per enrolment equal the ticked items; no duplicates after saving twice. **Money:** none (stock).

#### Fix L — Territory uniqueness in the database  ·  F30  ·  M
```sql
create unique index franchisees_one_smf_per_state on franchisees (lower(country), lower(state))
  where tier='SMF' and status='active' and lower(country)='india';
create unique index franchisees_one_smf_per_country on franchisees (lower(country))
  where tier='SMF' and status='active' and lower(country)<>'india';
create unique index franchisees_one_cf_per_city on franchisees (lower(country), lower(city))
  where tier='CF' and status='active';
```
Keep the client messages; map the unique-violation error to the same text. **Backfill:** none needed (0 duplicates at audit). **Verify:** inserting a second active SMF for Maharashtra on the branch fails; 28 franchisees unchanged.

#### Fix M — Renewal: bulk, and optionally with payment  ·  F16  ·  M  ·  💰 MONEY
**Behaviour:** (a) On *Needs attention*, rows with a renewal reason get a checkbox and **Renew selected** which calls `renew_cycles` with the defaults already used by the dialog (start = due date, fee = `enrollments.fee_amount`, days = current). (b) The Renew dialog gets an optional **Amount received now** (default empty) + mode; when filled, `renew_cycles` creates the payment in the same transaction and returns the receipt. Nothing else changes. **Touches:** `StudentsPage.jsx`, RPC. **Verify:** renewing 2 students of the branch snapshot creates 2 invoices, raises each `fee_total` by the fee, and (with amounts) 2 receipts whose numbers continue the series; I1 still 0 violations. **Money:** 💰 creates charges and receipts — rollout only after review.

#### Fix N — Fewer re-entries at admission  ·  F20, F21, F22, F24, F25  ·  M
**Behaviour**
1. One `AddressFields` component (country → state → city, area, pincode, address) used by the 8 forms; New Student pre-fills country/state/city from the chosen centre.
2. On a phone match, **Use details from <name>** copies parent name, e-mail, address into the form (fields only; no linking).
3. Optional **Payment received now** block under the admission invoice (amount, mode, paid on) → passed to `admit_student`; empty by default.
4. Parent e-mail optional (D5): inline note "No receipt / certificate by e-mail without it".
5. The admission WhatsApp confirmation is sent through `WhatsAppSendConfirm` after save (number confirmed), like every other send.
**Touches:** `StudentsPage.jsx`, `AccessRequestsPage.jsx`, `OnboardingPage.jsx`, `FranchiseesPage.jsx`, `InstructorsPage.jsx`, new `src/components/AddressFields.jsx`. **Verify:** admission without e-mail succeeds; with a payment amount, `student_payments` = 43 on the branch and receipt printed; field set per form unchanged in the saved row. **Money:** 💰 item 3 creates a payment (only when filled).

#### Fix O — Page the student list  ·  F32  ·  M
**Behaviour:** load students (and their enrolments) with `fetchAllRows` (stable `.order('id')`, 1,000-row pages) instead of one unpaged select; same in `exportCSV`. **Verify:** with `pageSize = 10` temporarily, list still shows 37; no duplicates or gaps. **Money:** none.

#### Fix P — Deep links  ·  F36  ·  M
**Behaviour:** `AppShell` keeps `currentPage` but mirrors it to `history.pushState` (`/students`, `/orders` …); the Students page mirrors `viewTab` and `selected` (`/students?tab=receipts`, `/students/<id>`). Reload restores the same view; browser Back steps back through them. `vercel.json` already rewrites all paths to `index.html` — no change. **Touches:** `AppShell.jsx`, `StudentsPage.jsx`. **Verify:** open a student, copy the URL, reload → same student; Back returns to the list. **Money:** none.

### L-severity block (small, or deliberately deferred)

| ID | Action |
|---|---|
| F33 | `comment on column` marking `enrollments.fee_paid/payment_ref/payment_mode/next_level_unlocked` and `students.payment_mode` deprecated; remove the dead `payment_mode` form state in `StudentDetailModal`. No drops. |
| F35 | Update `docs/whatsapp-templates.md`: `payment_receipt_v2` is live (`WA_TEMPLATES.paymentReceiptImage`). |
| F23 | Remember the last-used receipt mode per login (`localStorage`, wrapped in try/catch). |
| F17, F18 | **Defer.** `batches.sessions_done` is recomputed by `record_session`; the manual ± buttons stay. Batches without days stay on the Mon–Sat fallback until the user sets their days. |
| F19 | Covered by Fix C. |
| F34 | **Defer** — a per-parent thread view is a new feature. |
| F37 | **No refactor.** New code goes in `src/domain/money/` and `src/components/` as above; do not split `StudentsPage.jsx` further than the fixes require. |

---

## 4. Rollout order and review gates

| Step | Fixes | Gate |
|---|---|---|
| 1 | Phase 0 snapshot + branch | — |
| 2 | **A**, **B** (DB only, behind the old UI) | 💰 show: adjustment list (26), parity list, integrity view = 0 |
| 3 | A/B client switch-over, **E**, **F**, **G** | 💰 user approves money behaviour |
| 4 | **C**, **D** (D needs owner approval for the reset e-mails) | security review |
| 5 | **H, I, J, K** | — |
| 6 | **M**, **N** | 💰 user approves |
| 7 | **L, O, P**, L-block | — |

**Money-affecting register** (review before rollout): Fix A (guard + backfill rows), Fix B (receipt wording / dues), Fix F (numbering rule), Fix G (enrolment fee on edit), Fix M (renew + receipt), Fix N item 3 (payment at admission).

## 5. Global acceptance checklist (run after each step; all must hold)

```sql
-- I1 holds for everyone
select count(*) from v_student_fee_integrity;                                   -- 0
-- payments never exceed what is owed
select count(*) from students where coalesce(fee_paid,0) > coalesce(fee_total,0); -- 0
-- status is never stale
select count(*) from students s where s.is_active and s.payment_status is distinct from
  case when coalesce(s.fee_total,0)=0 then 'none' when coalesce(s.fee_paid,0)<=0 then 'pending'
       when s.fee_paid>=s.fee_total then 'paid' else 'partial' end;              -- 0
-- fee_paid equals Σ payments
select count(*) from students s where s.fee_paid is distinct from
  (select coalesce(sum(amount),0) from student_payments p where p.student_id=s.id); -- 0
```

Counts that must equal the baseline unless the step says otherwise: **37 students · 81 enrolments · 30 batches · 917 sessions · 2,172 attendance rows · 18 student invoices · 42 student payments**, and `sum_fee_total` / `sum_fee_paid` identical to the snapshot. New rows appear only on the branch during tests.

Finish each fix by reporting: finding IDs, files changed, migration version, verification results against §5, and whether any 💰 item is ready for the user's review.
