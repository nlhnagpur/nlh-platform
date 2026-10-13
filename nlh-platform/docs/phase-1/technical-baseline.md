# Phase 1 — Technical Baseline (Task A)

Date: 2026-10-13 · Baseline commit: `abaa69d` on `main` (working tree clean apart from the untracked `scratch_edited_agreement.txt`, which is not part of the app) · Node v24.16.0

## 1. Scope and safety posture

Phase 1 was run inspection-first under the stated safety rules. Everything done against the hosted database was a **SELECT-only** metadata or aggregate query through the Supabase MCP `execute_sql` tool. No `apply_migration`, no `npm run db:sync` (it uses the service-role key), no email/WhatsApp sends, no deploys, no account operations, and nothing under authentication was touched. Student-level output is aggregate counts only; no names, phones, emails, IDs or keys appear in these documents.

## 2. Git state

| Item | Value |
|---|---|
| Branch | `main` (tracks `nlhnagpur/nlh-platform`) |
| HEAD | `abaa69d feat: receipt registers sorted by receipt number` |
| Tree at start | clean, one untracked scratch file |
| Phase 1 changes | uncommitted (see final report §Changes made) |

## 3. Architecture (verified from the repo)

| Layer | Facts |
|---|---|
| Frontend | React 18 + Vite 5 SPA, `src/` (pages, components, context, utils, constants). Page "routing" is hand-rolled (`AppShell.currentPage`, `AuthContext.screen`); only `/login` and `/apply` are real URLs. `vercel.json` rewrites every non-`/api` path to `index.html`. |
| API | `api/*.js` Vercel functions: `create-user`, `change-user-email`, `send-email`, `send-whatsapp`, `send-payment-whatsapp`, `send-review-whatsapp`, `send-cert-whatsapp`, `whatsapp-webhook`, `create-razorpay-order`, `razorpay-webhook`, shared `_auth.js`. |
| Database | Supabase Postgres, project `frnnoxudtlvhyyoqdqzx` (Mumbai). 62 tables in `public`, RLS enabled on all of them. Business logic lives partly in triggers (receipt/invoice numbering, `fee_paid` recompute, fee-change log, payment cap) and partly in the browser. |
| Auth | Supabase Auth (JWT). Out of scope for Phase 1 — observations only. |
| Integrations | Brevo (email), Meta WhatsApp Cloud API, Razorpay, jsPDF/html2canvas/puppeteer for documents. |
| Browser → DB | Direct from the browser with the anon key + RLS (`src/supabase.js`). The serverless layer is used only for secrets/server work. |

## 4. Available commands

| Command | Exists before Phase 1 | Safe to run | Result |
|---|---|---|---|
| `npm run dev` | yes | yes (local) | not run (not needed) |
| `npm run build` | yes | yes | **passed** (`vite build`, ~11 s) before and after Phase 1 changes |
| `npm run preview` | yes | yes | not run |
| `npm run db:sync` | yes | **no** — uses `SUPABASE_SERVICE_KEY` against production | deliberately not run |
| lint | **none** | – | no ESLint/Prettier config in the repo |
| type-check | **none** | – | plain JS, no TypeScript |
| unit tests | **none** | – | no framework; Phase 1 added `npm test` using Node's built-in runner (see Task E) |

## 5. Database connection risks

1. **Every local run talks to production.** `src/supabase.js` hard-codes the production URL and anon key; there is no env switch. Running `npm run dev` and clicking "save" writes to the live project. There is no staging project.
2. **`scripts/sync-migrations.mjs` and `.env.local`** hold/use a service-role key. `.env` and `.env.local` are git-ignored and not tracked (verified with `git ls-files`), which is correct, but the key sits on a developer machine with production-wide power.
3. **The anon key and URL are also in `CLAUDE.md`.** The anon key is public by design, so this is acceptable, but it reinforces that the key is not rotatable without a code change.
4. **The hosted DB is the only DB.** `supabase/migrations/` exists in the repo, but there is no local Supabase stack or branch configured, so DB-level behaviour can only be proven by reading definitions or by testing in a Supabase branch (documented as the safe test method throughout).
5. **Sequence side effects.** Previous work already established that even a rolled-back SQL test permanently consumes `order_ref` / receipt sequences, so write tests must never be run on the live project.

## 6. Pure, testable code vs code that needs the browser

| Module | Pure? | Notes |
|---|---|---|
| `src/utils/feeStatement.js` | yes | statement, receipt preview, receipt allocation |
| `src/utils/studentLifecycle.js` | yes | cycles, renewals, attention reasons |
| `src/constants/permissions.js`, `roles.js` | yes | client-side permission helpers |
| `src/utils/courseAccess.js` | yes | franchisee course scoping |
| `invoiceSettlement` | was inside `studentLedger.js` (imports Supabase) | **moved verbatim** to `src/utils/invoiceSettlement.js`, re-exported from `studentLedger.js` |
| `deriveStatus`, `computeCoverage` | were private to `StudentsPage.jsx` | **moved verbatim** to `src/utils/feeCoverage.js`, imported by the page |

These three moves are behaviour-neutral (cut and paste plus `export`); the build was re-run afterwards and still passes.

## 7. Size / shape of the live data (aggregate only)

37 students, 42 student payments, 18 student invoices, 2,172 attendance rows over 917 sessions, 30 personal no-class rows, 41 student fee-change events. This is a small dataset, which is why the reconciliation in Task B can be exhaustive rather than sampled.

## 8. Risks recorded for later tasks

- No automated tests existed — any change to money or attendance logic was unprotected until now.
- Money logic is duplicated between the browser (three allocation engines) and the database (one status/`fee_paid` trigger).
- Multi-step writes are done from the browser without a transaction (Task D).
- The DB exposes broad grants and callable SECURITY DEFINER functions to the `anon` role (Task C).
