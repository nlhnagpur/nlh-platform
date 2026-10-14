# Phase 2 · Stage 0 — Preparation Report

Date: 2026-10-13 · Baseline commit `47d4d6c` · Status: **Stage 0 complete — stopped, awaiting approval for the next step. Stages 1–7 not started.**

## 0. Correction to the Phase 2 plan (and to Phase 1 wording)

The Phase 2 plan stated that Phase 1 "proved the money is correct today". That was wrong. **Phase 1 identified inconsistencies and built a test baseline; it did not independently verify the production financial records.**

What the checks actually showed: stored figures agree with each other (e.g. `fee_paid` equals the sum of that student's payment rows for all 37 students). That is an *internal-consistency* result. It was not compared with receipt books, bank statements, or parents' records, and Stage 0 found an additional anomaly (one active student has a NULL `fee_total`). Complete financial correctness is **unverified**.

I have corrected the same overclaim where it appeared in `docs/phase-1/phase-1-final-report.md` and `docs/phase-1/financial-reconciliation.md` (documentation wording only), and the corrected plan is in `docs/phase-2/phase-2-plan.md`.

## 1. What was and was not done

| Done (all local or read-only) | Not done (by instruction or by design) |
|---|---|
| Queried branching availability, existing branches and the price quote | No branch created; no paid resource; no cost incurred |
| Compared the 160 repo migrations with the live migration history | No migration, schema, data, RLS, function, trigger or storage change anywhere |
| Read-only catalog inventory of the live schema | No security or financial-engine change; no RPCs |
| Built a synthetic dataset, a seed generator, a fixture test and branch-only scenario scripts | Seed and scenario scripts have **not been executed anywhere** (no isolated DB exists yet) |
| Wrote and syntax-validated the reconciliation query by running it as a read-only SELECT (aggregate output) | No authentication / temp-password work; no user or account creation |
| Inspected how the app and API resolve the database URL (secrets redacted) | `WHATSAPP_APP_SECRET` was **not read or looked up** (see §8) |
| | Nothing pushed, deployed or modified in production |

## 2. Supabase branching — availability and suitability

| Question | Finding | Evidence |
|---|---|---|
| Is the branching API reachable? | **Yes** | `list_branches` returned `[]` — no existing branches |
| What does a branch cost? | **US$0.01344 per hour** ≈ $0.32/day ≈ **$9.70 per 30 days** if left running | `get_cost` quote only; nothing was created or confirmed |
| Plan eligibility | **Unverified** — a price was quoted, which suggests it is available, but the organisation's plan tier was not checked | – |
| Does a branch carry production data? | **No** — a branch is built from migrations, not a data copy; its Auth is separate and empty | Supabase branching model |
| Can this project's migrations build a branch? | **No, not as they stand** (see §4) | 11 core tables are created by no migration |
| Suitable now? | **Not yet.** Creating a branch now would be expected to fail at the first migration that alters `students`/`franchisees`, i.e. spend money for a broken environment. *(Inference from the migration contents; deliberately not tested because testing means creating the paid resource.)* | §4 |

**Conclusion:** branching is *available* but *unsuitable until a baseline schema exists*.

## 3. Database-environment setup plan

| Option | What it is | Setup requirements | Cost | Fidelity | Fit |
|---|---|---|---|---|---|
| **A. Supabase branch** | Hosted isolated Postgres from migrations | Baseline (§4) committed first; your cost approval; branch API keys kept out of the repo | ~$0.32/day while running; delete after use | Highest (real Supabase auth/storage/PostgREST) | Best for **final rehearsal** of each migration |
| **B. Local Supabase stack** | `supabase start` (CLI) in Docker | **Not installed here**: Docker Desktop (needs WSL2; Windows 11 Home is supported), Supabase CLI, ~4–6 GB RAM/disk; baseline | Free | High (same images) | Best for **day-to-day development** |
| **C. Plain local PostgreSQL 17** | One Postgres, no Docker | Install PostgreSQL; add small shims: roles `anon`/`authenticated`/`service_role`, `auth.jwt()`/`auth.uid()` returning settings, a stub `storage` schema; baseline | Free | Medium — good for triggers, constraints, RLS by `set role`; no PostgREST/Auth/Storage | Fallback if Docker is not an option |

**Recommendation:** B for development and the destructive/concurrency tests (free, repeatable, resettable in seconds), then A once per stage to rehearse the exact migration before it touches production. Use C only if Docker cannot be installed.

**Tooling found on this machine:** Node v24.16.0 (present); Docker, Supabase CLI and `psql` — **none installed**.

**Rules for every option:** the environment holds only the synthetic seed; its credentials never enter the repo or this session's output; it is torn down (branch deleted / volume removed) after each stage.

## 4. Migrations and dependencies

### 4.1 Can the existing migrations reproduce the schema?

| Check | Result |
|---|---|
| Repo files vs live migration history | **160 / 160 identical versions**, none missing either side |
| Tables created by some migration | 51 of 62 live tables |
| **Core tables created by NO migration** | `access_requests`, `courses`, `enrollments`, `franchisees`, `kit_price_history`, `order_items`, `orders`, `skus`, `stock_movements`, `students`, `users` |
| Created then dropped | `schools`, `sessions` |

The history begins on 2026-05-16 with `ALTER`s to tables that already existed; the original schema (created before migrations were tracked, or by hand in the dashboard) is **not in the repo**. Therefore **replaying the 160 migrations on an empty database cannot work**, and the README's "can be rebuilt" claim is not true today.

### 4.2 What must exist to build an isolated copy

| Dependency | Live inventory | Note |
|---|---|---|
| Base tables | 62 `public` tables | 11 are missing from migrations |
| Functions | 68 (34 SECURITY DEFINER callable by `anon` — Phase 1 S-01) | needed intact for fidelity; do **not** "fix" them in the copy |
| Triggers | 37 | include money triggers (cap, `fee_paid` recompute, receipt/invoice numbering, fee-change log) |
| RLS policies | 305 | RLS enabled on 62/62 |
| Sequences | 11 (`student_invoice_seq`, `receipt_seq`, …) | counters are per environment |
| Extensions | `pgcrypto`, `uuid-ossp`, `plpgsql`, `pg_stat_statements`, `supabase_vault` | `supabase_vault` backs `get_app_secret` — secrets will be absent (correct) |
| Storage | 1 bucket (`chat-attachments`) | recreate empty |
| Reference data in migrations | accounting seed (`accounting_schema_rls_and_seed`), city/centre codes | present via migrations once the base exists |

### 4.3 Recommended baseline approach

Because the original base schema cannot be recovered historically, build a **baseline of the *current* schema** and mark the 160 migrations as already applied (never replay them):

1. Produce `supabase/baseline/current_public_schema.sql` — **schema only, no data** — either (a) `supabase db dump --schema public` / `pg_dump --schema-only` (needs the DB password and Docker/`pg_dump`), or (b) read-only reconstruction from the catalogs through the SQL tool (no credentials needed; larger effort, I can do it).
2. Keep it **outside** `supabase/migrations/` so the production history is not altered.
3. Verify fidelity by re-running the Phase 1 catalog counts on the isolated copy and requiring: 62 tables, 68 functions, 37 triggers, 305 policies, 11 sequences, RLS on all.
4. Apply `synthetic_seed.sql` (§5).

*Production schema will be read, never written.*

## 5. Synthetic-data test plan

Files (all local, none connect to any database):

| File | Role |
|---|---|
| `tests/fixtures/synthetic-dataset.mjs` | single source of truth: 6 centres, 3 courses, 4 SKUs, **17 scenarios** |
| `tests/fixtures/build-seed-sql.mjs` | writes `docs/phase-2/stage-0/synthetic_seed.sql` |
| `docs/phase-2/stage-0/synthetic_seed.sql` | generated, one transaction, refuses to run on a real database |
| `docs/phase-2/stage-0/branch-scenario-tests.sql` | duplicate / zero-fee / concurrency scripts for an isolated DB |
| `tests/synthetic-fixture.test.mjs` | 9 local tests proving the fixture is arithmetically sound |

**Safety interlocks in the seed:** it aborts unless (1) `set nlh.allow_synthetic_seed = 'on'` was issued, (2) no student exists whose notes do not start `SYNTHETIC`, (3) no franchisee exists whose name does not start `SYN `. The live project holds 37 real students, so interlock 2 would stop it there. All names/phones/e-mails are placeholders (`SYN …`, `000000…`, `@example.invalid`).

| ID | Scenario | Requested category |
|---|---|---|
| S01 | Full payment, single invoice | full payment |
| S02 | Partial payment | partial payment |
| S03 | Three payments on one invoice, ends paid | **multiple payments, one invoice** |
| S04 | Two courses on one invoice, part paid | multi-course invoice |
| S05 | Course added later, second invoice, fee raised | additional charge / second invoice |
| S06 | Admission discount 1,000 | **discount** |
| S07 | Course discontinued, 4,000 waived | **waiver / discontinued course** |
| S08 | Monthly enrolment + two renewals | **renewals** |
| S09 | Un-invoiced extra charge of 2,000 | **additional charge** (engine-divergence case F1) |
| S10 | Legacy opening balance, no invoice | legacy data |
| S11 | Fully paid; duplicate must be rejected | **duplicate payment** |
| S12 | Two concurrent payments at the cap | **concurrent payment** |
| S13 | Zero-fee scholarship; payment accepted today | edge / finding F5 |
| S14 | Student at another centre | cross-centre / RLS |
| S15 | Withdrawn account with balance | closed account |
| S16 | Fee reduced below paid | **adjustment** (F4) |
| S17 | Manual −500 adjustment | **adjustment** |

**Refunds are not representable:** there is no refund or credit-note structure for student fees, and `student_payments.amount` has `CHECK (amount > 0)`. This is a documented gap (business question Q8/Q10), not an omission in the fixture.

### Results available now (local, run today)

| Check | Result |
|---|---|
| `tests/synthetic-fixture.test.mjs` | **9 / 9 passed** |
| Full suite `npm test` | **45 / 45 passed** (36 from Phase 1 + 9 new) |
| Seed SQL loaded into a database | **not run — no isolated database exists** |
| Seed SQL syntax | produced by a generator; syntactically unverified until its first load |

### Two behaviours the fixture surfaced (record only; no code changed)

- **F11 (new) — client engine C ignores renewal charges.** For S08 (monthly course, two renewals, fee_total 4,500, paid 3,000) `computeCoverage` reports **0 outstanding** against a true balance of 1,500, because renewals raise `fee_total` but not `enrollments.fee_amount`. The add-course flow (`StudentsPage.jsx` ~L1347–1353) writes `payment_status` from this value, so it could store `paid` for a monthly student who still owes renewals until the next payment re-triggers the DB recompute. *Verified on synthetic data against the real function; not yet observed in production data.*
- **N1 (new) — one active student has `fee_total IS NULL`.** The code treats NULL as 0, so the identities hold, but the column permits it and it is a data-quality gap. *Observed by aggregate query; not corrected.*

## 6. Financial reconciliation test plan

**File:** `docs/phase-2/stage-0/reconciliation-queries.sql` — one SELECT, no writes, no function calls with side effects (no `nextval`, no RPC), aggregate output only (counts, no identities). It has been executed read-only against production **to validate it parses and to record a baseline**; it will be run on the isolated database after seeding and before/after every later stage.

| ID | Check | Sev | Production baseline (violations / checked) |
|---|---|---|---|
| R01 | `fee_paid` ≠ Σ payments | error | 0 / 37 |
| R02 | `fee_paid` > `fee_total` | error | 0 / 37 |
| R03 | `payment_status` contradicts amounts | error | 0 / 37 |
| R04 | payment under a different centre than the student | error | 0 / 42 |
| R05 | invoice under a different centre | error | 0 / 18 |
| R06 | enrolment under a different centre | error | 0 / 81 |
| R07 | invoice total ≠ subtotal − discount | error | 0 / 18 |
| R08 | duplicate receipt numbers | error | 0 / 42 |
| R09 | payments with no receipt number | error | 0 / 42 |
| R10 | `fee_total` NULL or negative | error | **1 / 37** (NULL, active student — N1) |
| R11 | payment dated in the future | warn | 0 / 42 |
| R12 | possible duplicate payments (same student/amount/date/mode) | warn | 0 / 42 |
| R13 | receipt-number gaps per series | warn | 0 / 3 series |
| R14 | latest fee event ≠ `fee_total` | warn | 0 / 7 |
| R15 | `fee_total` ≠ Σ invoices (students with invoices) | warn | 4 / 13 |
| R16 | invoice `amount_paid = 0` though student paid | warn | 15 / 18 (F2) |
| R17 | inactive student with balance | info | 0 / 37 |
| R18 | enrolment at 0 fee with nothing waived | info | 0 / 81 |
| R19 | students with no invoice | info | 24 / 37 |

> **How to read this:** zero error-level violations means the *stored numbers agree with each other*. It does **not** prove the numbers are right.

### Expected results on the synthetic seed (predictions, not run)

R01 0 · R02 **1** (S16) · R03 0 · R04–R09 0 · R10 0 · R11 0 · R12 0 · R13 0 · R14 0 · R15 **4** (S07, S09, S16, S17) · R16 **18** · R17 **1** (S15) · R18 0 · R19 **2** (S10, S13). Any difference after loading is a defect in the seed or a misunderstanding of the schema, to be resolved before Stage 1.

### Independent verification (needed to claim correctness)

Internal checks cannot establish correctness. A separate, human, one-off exercise is required, and the data volume (42 payments, 18 invoices, 37 students) makes it fully feasible:

1. For every student payment, match the receipt number and amount to the **physical/PDF receipt** and to the **bank/UPI/cash record**.
2. For every student, confirm `fee_total` against the **fee agreed at admission** (admission form / invoice).
3. Sign off per centre. Disagreements go to a written list; **no record is changed** without your decision.

Owner and source documents are business questions (Q11, Q12).

## 7. Connecting the app to an isolated database — without touching production config

| Component | Today | Consequence |
|---|---|---|
| Browser app `src/supabase.js` | URL and anon key **hard-coded**; no `import.meta.env` use anywhere | the app cannot be pointed elsewhere without a code change |
| `api/_auth.js`, `create-razorpay-order.js`, `razorpay-webhook.js` | read `process.env.SUPABASE_URL` with a hard-coded production fallback | env-driven but default to production |
| `change-user-email.js`, `create-user.js`, `send-email.js`, `send-cert-whatsapp.js`, `whatsapp-webhook.js` | URL/anon key hard-coded | cannot be redirected by env |
| `scripts/sync-migrations.mjs` | uses `SUPABASE_SERVICE_KEY` | must never be run against the isolated copy by accident |
| `.env.local` | variable *names* only inspected: contains `BREVO_KEY` | no Supabase service key present locally |

**Proposed approach (not applied — it needs your go-ahead because it is a code addition):**

1. Create a *separate* file `vite.isolated.config.js` that aliases `src/supabase.js` to `src/isolated/supabase.isolated.js`. The live `vite.config.js` and `src/supabase.js` are untouched, so production builds cannot change.
2. The isolated module reads `VITE_ISOLATED_SUPABASE_URL` / `VITE_ISOLATED_SUPABASE_ANON_KEY` from a git-ignored `.env.isolated.local`, and **throws** if the URL contains the production project reference or is missing.
3. Run with `vite --config vite.isolated.config.js`. Under plain `vite`, `/api/*` does not exist, so no e-mail or WhatsApp can be sent.
4. For database-level and RLS tests no UI login is needed: tests use `set role authenticated` plus `set_config('request.jwt.claims', …)` with synthetic `public.users` rows.

**Out of scope, flagged:** logging into the UI of an isolated database needs an auth user there. Creating one is user provisioning, which is excluded; it would need your explicit, separate authorisation.

## 8. `WHATSAPP_APP_SECRET`

**Status: UNVERIFIED.** I did not read or request its value, did not query Vercel, and did not probe the live webhook. The code is conditional (signature verification only if the variable exists), so the deployed behaviour is unknown.

Safe ways to establish only configured / missing, for you to choose:

- Vercel dashboard → Project → Settings → Environment Variables: confirm the *name* is listed for Production (values are masked).
- `vercel env ls production` shows names and "Encrypted", not values.
- Or authorise a later, explicit test posting an unsigned payload to a **local** copy of the handler with the variable unset — which only tests the code path, not the deployment.

## 9. Costs and external resources requiring approval

| Item | Cost | Needs your approval |
|---|---|---|
| Supabase branch (Option A) | ~$0.32/day while running (US$0.01344/h); deleted after each rehearsal | **Yes** — before any creation |
| Docker Desktop + Supabase CLI install (Option B) | Free; disk/RAM; admin rights | **Yes** (software install on your machine) |
| PostgreSQL install (Option C) | Free | Yes |
| Production **schema** dump (read-only) | Free; needs DB password or Supabase token | **Yes** — credential handling |
| Supabase personal access token / DB password | – | Yes; never stored in the repo |
| Vercel env check (§8) | Free | Yes |
| Independent verification exercise (§6) | Staff time | Business decision |

## 10. Blockers and unresolved questions

### Technical blockers
| # | Blocker | Needed to clear |
|---|---|---|
| B1 | Base schema (11 tables) not in migrations → no rebuildable environment | baseline dump or catalog reconstruction (§4.3) |
| B2 | No Docker/CLI/psql on this machine | choose Option A, B or C and install/approve |
| B3 | Credentials for a schema dump or a branch | your decision on method; keep out of repo |
| B4 | App cannot be redirected to another DB | approve the isolated-config addition (§7) |
| B5 | UI login to an isolated DB = auth provisioning (out of scope) | separate authorisation, or stay DB-level only |
| B6 | `WHATSAPP_APP_SECRET` status unknown | one of the §8 checks |

### Business questions (carried over and new)
| # | Question |
|---|---|
| Q1 | When several courses/invoices are unpaid, where does a part-payment go first? |
| Q2 | Are un-invoiced fees (other charges, opening balances) paid before or after invoiced course fees? |
| Q3 | What exactly are `other_charges`; can they be discounted or waived? |
| Q4 | Is a ₹0 enrolment ever intentional (scholarship)? |
| Q5 | Is a waiver a discount (reduces `fee_total`) or a write-off? |
| Q6 | May `fee_total` fall below what was paid; what happens to the excess? |
| Q7 | Are monthly renewals invoiced monthly or only when paid? |
| Q8 | Are refunds / credit notes / voided receipts in scope? There is no structure for them today. |
| **Q9 (new)** | The student with a NULL `fee_total`: what is the correct fee? (Not to be changed without your decision.) |
| **Q10 (new)** | Is a duplicate-looking payment (same amount/day/mode) ever legitimate? Controls R12 and the duplicate rule. |
| **Q11 (new)** | What is the authoritative source for "this money was received" — receipt book, bank statement, UPI log? |
| **Q12 (new)** | Who signs off the independent verification, and per centre or in total? |

## 11. Recommendation for the next stage

**Do not start Stage 1 yet.** Stage 1 (revoking `anon` access) must be rehearsed in an isolated database, and none exists. Proceed instead with a short **Stage 0b — Environment build**, then Stage 1:

1. You choose the environment option (my recommendation: **B local Supabase**, with **A branch** reserved for a rehearsal per stage).
2. You choose the baseline method (my recommendation: catalog reconstruction through the read-only SQL tool — no credentials involved; I can produce `supabase/baseline/current_public_schema.sql`).
3. Build the isolated database, verify 62/68/37/305/11 counts, load `synthetic_seed.sql`, run `reconciliation-queries.sql` and `branch-scenario-tests.sql`, and compare with §6's predictions.
4. In parallel and independent of any code: start the **independent verification** exercise (§6) and decide Q9–Q12.
5. Then request approval for Stage 1.

## 12. Files created or changed in Stage 0 (all local, uncommitted)

| File | Type |
|---|---|
| `docs/phase-2/phase-2-plan.md` | new — corrected plan |
| `docs/phase-2/stage-0/stage-0-report.md` | new — this report |
| `docs/phase-2/stage-0/reconciliation-queries.sql` | new — read-only SELECT |
| `docs/phase-2/stage-0/synthetic_seed.sql` | new — generated, isolated-DB only |
| `docs/phase-2/stage-0/branch-scenario-tests.sql` | new — isolated-DB only, not executed |
| `tests/fixtures/synthetic-dataset.mjs` | new — fixture data |
| `tests/fixtures/build-seed-sql.mjs` | new — generator, file output only |
| `tests/synthetic-fixture.test.mjs` | new — 9 local tests |
| `docs/phase-1/phase-1-final-report.md`, `docs/phase-1/financial-reconciliation.md` | **modified** — wording corrected (no overclaim) |

No source code under `src/`, no `api/`, no `supabase/`, no `package.json` change.

## 13. Update — baseline reconstructed, local environment prepared (not started)

- `supabase/baseline/current_public_schema.sql` now exists (schema-only, built from read-only catalog queries; counts verified against live: 62 tables, 11 sequences, 68 functions, 37 triggers, 305 policies, 267 constraints, 162 indexes). **Not yet executed anywhere.** See `supabase/baseline/README.md`.
- `docs/phase-2/stage-0/local-supabase-setup.md` — install/run checklist (nothing installed), and `verify_isolated_environment.sql` — fidelity check.
- The function-body review done while building the baseline **corrected** Phase 1 finding S-01 (two number generators are admin-guarded) and **added S-10**: staff-permission policies on `instructor_attendance`, `payroll_extras`, `student_no_class` are PERMISSIVE, which — because `nlh_staff_can` is true for non-staff users — may expose them across centres. Both are in the Phase 1 security audit; S-10 has not been exercised.
