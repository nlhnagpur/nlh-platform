# Phase 1 — Test Baseline and Regression Plan (Task E)

Date: 2026-10-13 · Baseline `abaa69d` + Phase 1 working-tree changes.

## 1. Approach

- **Framework:** Node's built-in test runner (`node:test` + `node:assert`). No new dependency, no new framework: Node 24 is already required by the toolchain and the pure modules are plain ES modules. `npm test` → `node --test tests/*.test.mjs`.
- **Data:** synthetic only, defined inline in each test. Nothing reads from or writes to Supabase, `.env` files or the network.
- **Style:** *characterisation* tests — they pin current behaviour, including known inconsistencies (labelled `KNOWN DIVERGENCE` / `KNOWN BEHAVIOUR`). A test that records a defect is deliberate: it will fail the day someone changes that behaviour, forcing a conscious decision.
- **Only behaviour-neutral extractions** were made to make code testable (`invoiceSettlement`, `deriveStatus`, `computeCoverage` moved verbatim into `src/utils/`). `npm run build` was re-run afterwards.

## 2. Results (run 2026-10-13)

| Command | Result |
|---|---|
| `npm run build` (before changes) | **passed** |
| `npm run build` (after extractions) | **passed** |
| `npm test` | **36 passed, 0 failed, 0 skipped** |

| File | Tests | Passed | Covers |
|---|---|---|---|
| `tests/financial.test.mjs` | 17 | 17 | `deriveStatus`, `computeCoverage`, `invoiceSettlement`, `buildFeeStatement`, `receiptPreview`, `allocateReceipt`, `paymentsUpTo`, one cross-engine divergence |
| `tests/attendance.test.mjs` | 11 | 11 | `addOneMonth`, `cycleDows`, `countCycleDays`, `computeCycle` (holidays, unmarked, no-class, Saturday revision), `cycleAnchor`, `renewalInfo`, `attentionReasons`, buckets |
| `tests/permissions.test.mjs` | 8 | 8 | `hasPerm`, `normalizePerms`, presets, default staff perms, `isAdminRole`, `isManagerOrAbove` |

**Honest limits:** these tests prove the *pure calculation* layer. They do **not** cover: RLS policies, DB triggers, the serverless API, React components, multi-step browser flows, or concurrency. Those are **blocked** on having a non-production database (see §4).

## 3. Test-to-risk map

| Risk (document ref) | Covered by | Status |
|---|---|---|
| Fee status thresholds (F6) | `deriveStatus` tests | covered |
| Course vs invoice allocation disagree (F1) | divergence test | covered (documents the gap) |
| Receipt "applied to" rows sum to the amount (F7) | `allocateReceipt`, `receiptPreview` | covered |
| Statement reconciles to `fee_total` | `buildFeeStatement` | covered (3 shapes) |
| Unmarked ≠ absent; `S = P + A + U` | `computeCycle` | covered |
| Staff keys cannot exist without page key | `normalizePerms` + presets | covered |
| Unknown role passes `hasPerm` (S-07) | `KNOWN BEHAVIOUR` test | covered (documents) |
| Cross-centre payment write (S-02) | – | **blocked** (needs DB branch) |
| Anonymous RPC execution (S-01) | – | **blocked** |
| Atomic renewal/admission (D) | – | **blocked** |
| Concurrent payments (F5) | – | **blocked** |

## 4. Plan for the blocked tests (needs approval; uses a Supabase branch, never production)

| Test | Method | Pass criterion |
|---|---|---|
| Cross-centre payment insert/update | branch + two synthetic centres/users; attempt insert for another centre's student | rejected by RLS |
| Anon RPC exposure | call each anon-executable function as `anon` | only intentional ones succeed |
| Payment cap under concurrency | two parallel inserts at the cap | exactly one succeeds |
| `fee_total` lowered below `fee_paid` | update as admin | rejected or explicit adjustment required (after Q6) |
| Receipt numbering gap on delete | insert/delete/insert | documented, then enforced behaviour |
| Admission failure injection | force step 4 failure | no partial student (after RPC refactor) |

## 5. How to run

```bash
npm test
```

Any future money or attendance change should extend these files before changing code.
