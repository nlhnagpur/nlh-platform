# Accounting engine — proper double-entry for every money event

Date: 2026-10-22 · Status: **design for sign-off. Nothing here is built. Each stage needs explicit approval.**
Fits Phase 2 as a new stage after Stage 4 (payment/invoice integrity), because the journal must post from payments that are already consistent.

## 1. Where it stands (read-only check of the live database, 22 Oct 2026)

| Fact | Value |
|---|---|
| Journal entries / lines | **0 / 0** — nothing has ever been posted two ways |
| `expenses` rows | 0 |
| Revenue splits, vendor transactions, bank transactions | 0 / 0 / 0 |
| Money that has actually moved (operational tables only) | 45 student payments ₹2,03,500 · 29 invoiced/closed orders, ₹74,295 paid · 32 franchise fee payments |
| What the Accounting Overview shows | Adds up closed orders + franchise fees paid − expenses, **from the operational tables**, not from the journal |
| Only place that tries to post a journal entry | "Add expense", from the browser: not atomic, no balance check (it left an empty entry on 22 Oct) |
| Current fiscal year flag | FY 2025-26 (October 2026 falls in FY 2026-27) |

CI payroll (built 22 Oct) is the first thing that posts properly: Dr 6001 Staff Salaries / Cr the CI's own account, then Dr the CI / Cr the bank.

## 2. Principles

1. **One posting function in the database** (`post_journal`) — the only way an entry is written. It checks Σ debit = Σ credit, accounts exist and are active, the period is open, and writes the entry and its lines in one transaction. The browser can no longer insert into `journal_entries` / `journal_lines`.
2. **Posting happens where the money event is recorded** (database function/trigger on the payment or invoice), so an event and its entry can never disagree or be skipped.
3. **Entries are never edited or deleted.** A correction is a reversing entry; `voided` entries stay visible.
4. **Control accounts tie to sub-ledgers.** Receivable – Franchisees = sum of franchisee balances; Payable – CIs = sum of CI balances; vendors likewise. A daily check proves it.
5. **Reports come from the journal** (trial balance, ledgers, P&L, balance sheet). The Overview stops reading operational tables.
6. Rehearsed on an isolated database first; production receives one approved migration at a time (Phase 2 gates apply).

## 3. Event → entry map (recommended; GST lines added once decision A4 is made)

| Event | Debit | Credit |
|---|---|---|
| Kit order invoiced to a franchisee | 1110 Receivable – Franchisees | 4001 Kit Sales Revenue (+ courier income/GST output) |
| Order payment verified | Bank (1015) or Cash (1001) | 1110 Receivable – Franchisees |
| Sale return / credit note | 4001 Sales returns | 1110 Receivable – Franchisees |
| Franchise enrolment invoice | 1110 | 4002 Franchise Enrollment Fees |
| Franchise fee payment | Bank | 1110 |
| Student fee received at an NLH-owned centre | Bank / Cash | 4004 Training Fees |
| Student fee received at a franchise centre | *(not HO income — see decision A2)* | |
| Revenue split (CF 50 % / SMF 25 % / NLH 25 %, when built) | Per decision A2 | 2100 / 2200 payable, 4003 royalty |
| Student refund / waiver | Training Fees (or a waiver account) | Bank / Receivable |
| Expense paid | the expense ledger | Bank |
| Vendor bill (credit) / payment | Expense or 1200 Inventory / 2001 Payable – Vendors | 2001 / Bank |
| CI payroll posted / paid | **done:** 6001 / CI account · CI account / Bank | |
| CI caution deposit | Bank | Caution deposits (liability) |
| Opening balances | per ledger | per ledger (against 3001 Capital) |

## 4. Bringing in history and cut-over

- Choose a **cut-over date** (recommended 1 Apr 2026, the financial year start). Opening balances (bank, cash, receivables) are entered once.
- Replay the existing 45 student payments, 29 orders and 32 franchise payments through the same function, marked `backfill`, so history is in the books.
- Every backfilled entry is checked against its source row (amount, date) and the totals are reconciled before sign-off.

## 5. Controls and reports

- Trial balance; ledger per account; P&L; balance sheet; bank reconciliation against statements.
- Daily check (read-only): debits = credits; every payment/invoice has an entry; sub-ledger totals = control accounts. Failures are listed, not hidden.
- Period lock: closing a month blocks postings dated in it.
- Correct the current fiscal year (decision A6) and keep one open year at a time.

## 6. Stages

| Step | What | Isolated DB first? |
|---|---|---|
| E0 | Sign-off on this design; answers to A1–A6 | — |
| E1 | `post_journal`, balance + period checks, lock the journal tables from the browser, fiscal-year fix | **yes** |
| E2 | Post from order invoices/payments and franchise fees; backfill; reconcile | **yes** |
| E3 | Student fee events and the revenue-split rule (needs A2) | **yes** |
| E4 | Expenses, vendors, refunds/waivers, caution deposits through the engine | **yes** |
| E5 | Reports from the journal; switch the Overview; daily control check | no (read-only) |
| E6 | Production rollout, one migration at a time with before/after reconciliation | production, approved |

## 7. Decisions needed (recommended answer first)

| # | Decision | Recommended |
|---|---|---|
| **A1** | Whose books? | **HO (NLH) only** first; per-franchisee ledgers later if wanted |
| **A2** | Student fees: which count as HO income, and is the 50/25/25 split built now? | Only NLH-owned centres' fees are HO income; franchise-centre fees reach HO only through the revenue split, which is built in E3 |
| **A3** | Basis | **Accrual**: income when invoiced, with receivables |
| **A4** | GST | Is NLH GST-registered and does it charge GST on kits/fees? Needed before E2 |
| **A5** | Start date | **1 Apr 2026**, with all history brought in |
| **A6** | Fiscal year | Make **FY 2026-27** the current year and keep FY 2025-26 closed |

Related Phase 2 decisions (D1–D11 in `stage-0/business-decisions-required.md`) still apply, particularly D1/D2 (how part-payments are allocated), which decide how a student payment splits across invoices before it is posted.
