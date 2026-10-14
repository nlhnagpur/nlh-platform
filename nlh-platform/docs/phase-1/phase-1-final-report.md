# NLH Platform — Phase 1 Final Report (Task F)

Date: 2026-10-13 · Baseline `abaa69d` (`main`) · Status: **complete, awaiting approval — Phase 2 has not been started.**

Detail documents: [technical-baseline](technical-baseline.md) · [financial-reconciliation](financial-reconciliation.md) · [security-permissions-audit](security-permissions-audit.md) · [business-rules-and-workflows](business-rules-and-workflows.md) · [test-baseline-and-regression-plan](test-baseline-and-regression-plan.md)

## 1. Executive summary

- **Internal consistency checks passed; correctness is not independently verified.** In the live data (37 students, 42 payments, 18 invoices) `fee_paid` equals the sum of payments for every student, nobody is overpaid, no status contradicts the amounts, and no payment/invoice/enrolment sits under the wrong centre. These are consistency checks between stored figures only — they were not compared with receipt books, bank statements or parents' records, so complete financial correctness has not been established. (A Stage 0 check also found one active student with a NULL `fee_total`.)
- **The risk is structural, not present corruption.** The balance is protected by one good DB trigger, but the *charge side* (`fee_total`) is written by many browser flows as absolute numbers, in several non-atomic steps, with three different allocation engines deciding "what is unpaid".
- **Security:** RLS is on everywhere and API endpoints authenticate; the Razorpay webhook verifies signatures, while the WhatsApp webhook verifies only if an env secret is set. The notable gaps are broad `anon` access to callable SECURITY DEFINER functions, a public/overwritable storage bucket, and student payment/invoice policies that do not tie the student to the centre.
- **Testing:** there were none. 36 safe local regression tests now exist and pass; DB-level behaviour remains untested because there is no non-production database.
- **Safety:** every database interaction was SELECT-only. Nothing was written, migrated, deployed, sent or committed. Authentication was not touched.

## 2. Findings by severity

| Sev | ID | Finding | Why this severity | Verified |
|---|---|---|---|---|
| **High** | S-10 | staff-permission policies on `instructor_attendance`, `payroll_extras`, `student_no_class` are PERMISSIVE and `nlh_staff_can` is true for non-staff users → possible cross-centre access (found in Phase 2 Stage 0) | payroll/attendance data across centres | policy definitions; not exercised |
| **High** | S-01 | `anon` can execute SECURITY DEFINER utility functions (WhatsApp log writers, receipt/order number generators, order-status recompute) | unauthenticated write capability on numbering and message logs | privilege query; not exercised |
| **Medium** | S-02 | student payment/invoice RLS doesn't bind `student_id` to the centre (the row's `franchisee_id` is checked, the student is not) | cross-centre financial write needs a student UUID, so exploitability is limited; impact is high | policy definitions; not exercised |
| Medium | S-03 | `chat-attachments` bucket public; any authenticated user can overwrite any object; no size/MIME limits | content exposure and tampering | policy + bucket config |
| Medium | S-04 | any logged-in user can trigger WhatsApp template sends to any number | spam/cost/quality-rating risk; templates are locked | code |
| Medium | F1 | three allocation engines can disagree per course/invoice | wrong "what is due" on a receipt/profile; totals still agree | test |
| Medium | F2 | `student_invoices.amount_paid`/`status` never maintained (18/18 stale) | any DB-side reader sees all invoices unpaid | query |
| Medium | F3 | `fee_total` written as absolute from client state / read-modify-write | lost update when two people edit | code |
| Medium | F4 | `fee_total` can be lowered below `fee_paid` | silent overpayment state | trigger definitions |
| Medium | D-1 | admission and renewal are non-atomic and swallow several errors | orphan students, missing invoices, stock drift | code |
| Low–Med | F5 | payment cap skipped at `fee_total = 0`, no locking | transient overpayment under concurrency | function source |
| Low–Med | F7 | statement rebuild matches invoices to log events by "same amount within 120 s" | mis-attribution falls back to an `other` line | code + tests |
| Medium | S-09 | WhatsApp webhook signature check is skipped if `WHATSAPP_APP_SECRET` is unset | forged inbound messages if unconfigured in prod | code; deployed config unknown |
| Low–Med | S-05 | anon INSERT on `access_requests`, `whatsapp_messages`; any authenticated user may insert outbound log rows | spam / forged message-log rows | policies |
| Low | S-06, S-07, F6, F9 | excess table privileges; permissive `hasPerm` for unknown roles; two writers of `payment_status`; mirror failures swallowed | defence in depth / hygiene | various |
| Info | F8, F10 | 24 of 37 students have no invoice; revenue split not implemented | known / historical | query |

**Critical: none found.** No finding allows unauthenticated money loss or account takeover that I could establish from definitions alone; the High item (S-01) is capped by what those functions actually do.

## 3. Financial integrity

See [financial-reconciliation](financial-reconciliation.md). Canonical identity `balance = fee_total − Σ payments` holds for 37/37 students. Per-course and per-invoice splits come from three client engines that differ in ordering rules (Q1–Q2 need the owner's decision). Invoice paid/status columns are decorative today.

## 4. Security

See [security-permissions-audit](security-permissions-audit.md). Authentication-area observations were recorded only (§6 of that document) and nothing there was altered.

## 5. Attendance / workflow

See [business-rules-and-workflows](business-rules-and-workflows.md). The attendance model is coherent (`unmarked ≠ absent`, `S = P + A + U`). Admission, renewal, add-course and edit-invoice are multi-write browser sequences without a transaction; partial-failure states and detection reports are listed there.

## 6. Test results

| Check | Result |
|---|---|
| `npm run build` before changes | passed |
| `npm run build` after extractions | passed |
| `npm test` | **36 passed / 0 failed / 0 skipped** |
| Lint / type-check | **not run — none configured** |
| DB triggers, RLS, API, UI, concurrency | **blocked** — no non-production database (planned in test doc §4) |

## 7. Changes made (all local, uncommitted)

| File | Change | Behaviour impact |
|---|---|---|
| `src/utils/feeCoverage.js` (new) | `deriveStatus`, `computeCoverage` moved verbatim out of `StudentsPage.jsx`, exported | none |
| `src/utils/invoiceSettlement.js` (new) | `invoiceSettlement` (+ local `dayOf`) moved verbatim out of `studentLedger.js` | none |
| `src/pages/StudentsPage.jsx` | removed the two function bodies, added one import | none |
| `src/utils/studentLedger.js` | imports and re-exports `invoiceSettlement` so existing importers are unaffected | none |
| `package.json` | added `"test": "node --test tests/*.test.mjs"` | none |
| `tests/*.test.mjs` (new, 3 files) | regression tests | none |
| `docs/phase-1/*.md` (new, 6 files) | the Phase 1 deliverables | none |

Not changed: database, migrations, RLS, functions, authentication, API, deployment, any data. The unrelated untracked `scratch_edited_agreement.txt` was left alone.

## 8. Deferred work

Everything in Phase 2 below; plus checking whether `WHATSAPP_APP_SECRET` is set in Vercel, review of the authentication RPCs (out of scope), and the revenue-split engine. (The bundle check for service keys was completed in the pre-commit review: only the anon key is present.)

## 9. Recommended Phase 2 (none of it started)

### 2.1 Lock down anonymous database exposure — *recommended first*
- **Objective:** remove S-01, S-06 and the unnecessary half of S-05.
- **Justification:** smallest change, largest reduction in unauthenticated surface.
- **Files:** one new migration in `supabase/migrations/`; no app code unless a revoked function is used pre-login.
- **DB changes:** `REVOKE EXECUTE … FROM anon, PUBLIC` on non-public functions; `REVOKE TRUNCATE, TRIGGER, REFERENCES`; restrict `whatsapp_messages` anon insert to `service_role`.
- **Risks:** the apply form or webhook may rely on an anon-callable function → tested first on a branch.
- **Prerequisites:** a Supabase branch; list of functions the public `/apply` page calls.
- **Acceptance:** `anon` can only call the agreed list; full app smoke test passes.
- **Tests:** anon RPC matrix; existing 36 tests.
- **Rollback:** the migration's inverse `GRANT` statements (generated alongside).

### 2.2 Single money engine and atomic writes
- **Objective:** F1–F4, D-1.
- **Files:** new `src/utils/feeAllocation.js`; thin wrappers in `feeCoverage.js`, `invoiceSettlement.js`, `feeStatement.js`; `StudentsPage.jsx` flows call RPCs.
- **DB changes:** RPCs `admit_student`, `renew_enrolment`, `edit_student_invoice`, `add_course`; trigger/view for invoice `amount_paid`/`status`; guard `fee_total >= fee_paid`.
- **Risks:** highest — touches live money flows; needs answers to Q1–Q8.
- **Prerequisites:** business decisions Q1, Q2, Q5, Q6; a branch with synthetic seed data.
- **Acceptance:** tests in plan §4 pass; reconciliation queries still show 0 mismatches.
- **Rollback:** feature-flag the client to the old path; RPCs are additive.

### 2.3 Storage and WhatsApp sender hardening
- **Objective:** S-03, S-04.
- **Files:** `api/send-payment-whatsapp.js`, `api/send-review-whatsapp.js`, chat attachment upload/read code; migration for bucket policies.
- **DB changes:** private bucket, owner-scoped UPDATE/DELETE, size/MIME limits.
- **Risks:** existing public attachment URLs stop working → migrate to signed URLs.
- **Acceptance:** user B cannot overwrite user A's file; a student login cannot send templates.

### 2.4 Student payment/invoice policy `WITH CHECK`
- **Objective:** S-02. **DB changes:** policy replacement (add the student↔centre check). **Risk:** legitimate admin cross-centre edits → test with `owner`/`admin` roles. **Acceptance:** cross-centre insert/update rejected on a branch.

## 10. Approval

**Stopping here.** Phase 2 will not start, and nothing will be committed, until you explicitly approve — and tell me which of 2.1–2.4 to take first. Two things I need from you for Phase 2: the answers to Q1, Q2, Q5, Q6 in the reconciliation document, and permission to create a Supabase branch (it may carry a cost).
