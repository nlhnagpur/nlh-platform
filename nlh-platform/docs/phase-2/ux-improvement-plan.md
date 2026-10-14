# NLH Platform — Phase 2 UX & Workflow Improvement Plan (approval gate)

Date: 2026-10-14 · Baseline `30830f9` · Status: **plan only — no implementation started.**
Supersedes the earlier draft `ux-and-workflow-plan.md`.

Priority order: **1 Safety & data integrity → 2 Navigation & hierarchy → 3 Consistency → 4 Ease of use → 5 Visual polish.**

## 0. What the inspection found (facts, not opinions)

| Area | Finding | Evidence |
|---|---|---|
| Size | 22 pages, ~27,200 lines; `StudentsPage` 6,098 lines, `OrdersPage` 4,468 | `wc -l` |
| Navigation | Admin tier sees **17 flat items**; the sidebar then regroups them into three clusters. Three pages deal with kit pricing/stock (`Inventory & Kits`, `Kit prices`, `Price change log`) | `roles.js`, `Sidebar.jsx` |
| Labels | The same page has different names per role: *Orders* / *State orders* / *City orders* / *My orders*; *Courses & SKUs* / *Course catalogue* / *My courses*; *Franchisee chat* / *Head Office* | `roles.js` |
| Dialogs | `modal-bg` used on ~18 files (≈ 80 modal instances); `window.confirm` used in 6 files (8 in `StudentsPage`) with no consequence text | grep |
| Dates | At least 10 separate `toLocaleDateString` implementations (`InvoiceView`, `SaleReturnView`, `studentDocs`, `BatchesPage`, …); labels vary (*Date*, *Paid on*, *Receipt date*) | grep |
| Money | `toLocaleString('en-IN')` repeated inline across `InstructorsPage`, `Dashboard`, `Accounting`, … plus a `fmtAmt` helper elsewhere | grep |
| Styles | ~1,330 inline `style={{…}}` objects in four pages against ~450 CSS classes | grep |
| Payments | `StudentReceiptModal` is mounted from **three** places in `StudentsPage` (lines ~1987, ~5854, ~6072); order and franchisee receipts have separate flows | code |
| Documents | Student/order/franchisee receipts and student invoices come from `studentDocs.js` (A5, own template each); order invoices from `InvoiceView.jsx` (A4, its own pagination); capture helpers duplicated (`captureReceipt`, `captureInvoice`) | code |
| Feedback | 100+ ad-hoc `showToast` calls in `StudentsPage` and `OrdersPage`; error wording and severity vary | grep |
| Guards | Duplicate-submit guards exist (`setSaving`) but multi-step saves still half-complete and swallow some errors (Phase 1 D-1) | code |

**Implication:** most inconsistency comes from *repeated local implementations of the same few things* (confirm, date, money, status chip, modal header, payment entry, document template). Extracting those gives the biggest gain for the least risk — no rebuild needed.

---

## A. Recommended navigation hierarchy

Same pages, same permissions, regrouped by *job*. No page is removed; nothing becomes reachable by a role that cannot reach it today (navigation is still built from `NAV_ITEMS` filtered by `hasPerm`).

### Head-office roles (owner / super_admin / admin / manager / staff)

| Group | Items (existing pages) | Notes |
|---|---|---|
| **Home** | Dashboard (with a **Needs attention** inbox) | |
| **People** | Students · Franchisees · Instructors | |
| **Teaching** | Batches (attendance lives inside) · Courses & levels | |
| **Money** | Orders & invoices · **Receipts & payments** (register across students/orders/franchise fees) · HO Accounting · Discount coupons | Receipts register is today a tab inside Orders; it becomes reachable from Money and from every student/order |
| **Stock & pricing** | Inventory & kits · Kit prices (the *Price change log* becomes a tab of Kit prices) | merges 3 entries into 2 |
| **Messages** | WhatsApp inbox · Franchisee chat · Email log | |
| **Admin** (senior only) | Manage logins · Access requests | unchanged visibility |

### Franchise and student roles

| Role | Menu |
|---|---|
| SMF / CF | Home · Students · Franchisees · Orders · Courses · My account · Head Office |
| UF | Home · Students · Orders · Courses · My account · Head Office |
| Student | Home · My courses |

- **Labels become uniform** (*Orders*, *Courses*, *Head Office*); the scope is shown as a page subtitle ("State-wide", "City", "Your centre") rather than a different menu name.
- **Pathways between records** — every record name is a link that opens the related record and remembers where you came from (Back returns to the same list, filters and scroll position):
  - Student → enrolments → invoices → receipts
  - Receipt → its invoice / student / order
  - Order → invoice → payments → franchisee
  - Batch → students → attendance
  - Franchisee → students / orders / ledger
- **Global search** (one box in the header): student name/phone, receipt no., invoice no., order ref, franchisee — results grouped by type, respecting each role's visibility.

---

## B. Proposed common screen and form patterns

Built as a small shared set in `src/components/ui/`, reusing the existing CSS classes (`.card`, `.tbl`, `.btn-p`, `.modal-bg`, `.badge`) so no visual rewrite is needed and pages can adopt them one at a time.

| Pattern | Standard |
|---|---|
| **List / search screen** | Page header (title, count, primary "New …" button) · search box · filter chips with a visible "clear filters" · sortable headers showing the sort arrow · one **primary column** · one **status chip** · a row **action menu** · pagination or "load more" · empty state with a call to action · loading skeleton · error with Retry |
| **Detail screen** | Header: identity + status chip + the **one primary action** for the current state · summary strip (the 3–4 numbers that matter) · tabs for sections · related-record links · activity/history at the bottom |
| **Create / edit** | The **same form component** for create, view and edit (view = read-only mode of the same layout). Money forms use the invoice-entry layout already built for New Student / Add course. Sections with headings · inline field errors · sticky footer (Save / Cancel) · unsaved-changes guard · fields that are never editable shown read-only with the reason |
| **Confirmation dialog** | One `ConfirmDialog`: states *what will happen and what depends on it*, destructive actions in red, Cancel is the default focus, optional "type the number to confirm" for irreversible actions. Replaces all `window.confirm` |
| **Messages** | Success toast names the record and links to it ("Receipt ST-NGP01-2026-0007 saved — View"); validation errors inline; blocking failures in a dialog with Retry; never a silent failure |
| **States** | Shared `Loading`, `Empty`, `ErrorState` components |
| **Modal vs drawer** | Modal for short decisions and money entry; right-hand drawer for viewing/editing a related record without losing the list |
| **Formatting** | One `fmtDate` (e.g. *05 Oct 2026*), one `fmtMoney` (₹ with Indian grouping), one `StatusChip` palette: green settled · amber needs action · red overdue/blocked · grey inactive · blue info |
| **Responsive** | Tables turn into cards below ~600 px, keeping number, date, amount and status visible |

---

## C. Proposed student → enrolment → invoice → payment workflow

### Current behaviour (mapped before any change)

| Step | Where | What it writes |
|---|---|---|
| Admission | New Student modal | student → enrolments → fee fix-ups → invoice → stock → batch (5+ writes, several errors swallowed) |
| Add course | Student → Courses | enrolment → `fee_total` (absolute) → invoice → batch |
| Renewal / next level | Student → Courses | enrolment cycle dates → `fee_total` (absolute) → invoice |
| Edit invoice | Student → Accounts | invoice → `fee_total` (read-modify-write) |
| Record payment | Students → Receipts modal (3 entry points) | payment (DB trigger numbers it, caps it, recomputes `fee_paid`) → best-effort mirror → coupon lock |
| Discontinue / reinstate | Student → Courses | enrolment → student |

### Proposed flow (one chain, always visible on the student)

```
Student ─► Enrolments (course cards) ─► Charges (invoices) ─► Receipts ─► Balance
```

1. **Student account view** shows the whole chain top-to-bottom. Each card carries its own next action:
   - *course card*: Renew · Next level · Change level · Discontinue
   - *invoice row*: View · Edit · Print
   - *balance*: **Record payment** (pre-filled with student, balance, today, last-used mode)
2. **One payment component** used from the students list, the student view and the receipts register. It previews "this receipt will be applied to …" using the existing allocation preview (no calculation change).
3. **Enter once, reuse everywhere**: guardian/contact and centre details come from the student record into every invoice, receipt and WhatsApp message; kit and level defaults come from the course.
4. **Duplicate prevention**: the submit button locks; a request id stops a re-submitted form; a warning appears when an identical receipt (student, amount, date, mode) already exists; renewals warn when the cycle is already invoiced.
5. **Traceability**: nothing financial is silently overwritten. Corrections show *who/when/why*; deletions of payments/invoices ask for a reason (stored once the audit table exists — needs an approved migration, listed under dependencies).
6. **Multi-step saves** run through a visible step runner: *Student saved ✓ · Enrolment saved ✓ · Invoice ✗ (Retry) · Stock pending*.

*No financial calculation changes in this workflow.* Allocation order (D1–D4) remains a separate approval.

---

## D. Proposed standard invoice and receipt layouts

One document module producing **A4 invoices** and **A5 receipts**, used for student, order and franchisee documents (today: four templates plus `InvoiceView`'s own pagination).

### Invoice (A4)

```
[Logo]  NEW LEARNING HORIZONS                         INVOICE
        Address · phone · e-mail · (GSTIN if applicable)
-------------------------------------------------------------------
Invoice no.   SINV-2026-0012      Invoice date   05 Oct 2026
Centre        Nagpur A (NGP01)    Due date       20 Oct 2026
Bill to       <student / parent / franchisee> · phone
-------------------------------------------------------------------
#  Description                          Qty   Rate      Amount
1  Abacus — Level 2                      1    6,000     6,000
   · Kit: abacus, workbook (included)
-------------------------------------------------------------------
                               Subtotal                 6,000
                               Discount                  −500
                               Total                    5,500
                               Paid to date             2,000
                               BALANCE DUE              3,500
Notes · payment instructions · authorised signatory · page n of N
```

### Receipt (A5)

```
[Logo]  NEW LEARNING HORIZONS                  PAYMENT RECEIPT
Receipt no.  ST-NGP01-2026-0007       Receipt date  05 Oct 2026
Received from  <name>                 Paid on       03 Oct 2026
Mode / reference  UPI · 4821…         Centre        Nagpur A
-------------------------------------------------------------------
Against        Abacus — Level 2 (Invoice SINV-2026-0012) · Oct 2026
Amount received               ₹ 2,000   (Rupees two thousand only)
-------------------------------------------------------------------
Fee total 5,500 · Paid earlier 0 · This receipt 2,000 · BALANCE 3,500
Authorised signatory                          Computer-generated
```

Rules: same header and fonts on every document; **Receipt date** and **Paid on** always both present (already the case for student/order/franchisee after the recent change); numbering shown exactly as stored; amounts with Indian grouping and in words; the on-screen preview is the same template as print/PDF/PNG/WhatsApp; a **Share** menu (Print · PDF · Image · WhatsApp) replaces separate buttons.

---

## E. The five highest-value improvements

| # | Improvement | Why it ranks here | Pages affected | Safety risk | Dependencies | Acceptance criteria |
|---|---|---|---|---|---|---|
| **1** | **Shared UI kit**: `ConfirmDialog`, `PageHeader`, `StatusChip`, `EmptyState/ErrorState`, `fmtDate`, `fmtMoney`, `EntityLink` | One extraction removes ~8 bare confirms, ≥10 date formatters and the scattered money formatting everywhere; improves safety (consequence text) and consistency at once | all 22 | Low — presentation only; adopt page by page | none | Helpers unit-tested; no `window.confirm` left in migrated pages; dates and amounts render identically on all migrated pages; `npm test`/`build` green |
| **2** | **One "Record payment" component + one receipt document** across students list/profile, receipts register, orders and franchisee fees | Highest-frequency money workflow; today three entry points and four templates; central place for duplicate warning and traceability | Students, Orders, Franchisees, Receipts register | **Medium** — touches money entry (no calculation change) | #1 | Same fields, validation and result screen from every entry point; duplicate warning works; receipt shows Receipt date + Paid on; existing receipts still reprint identically; `studentDocs` output byte-compared before/after on sample data |
| **3** | **Student account view + Needs-attention strip** (chain: enrolments → invoices → receipts → balance, one primary action) | Directly addresses "nothing shows what attention is needed"; cuts clicks for renewal/payment | Students (list + profile), Dashboard | Low–medium | #1; money figures reuse existing engines unchanged | Every attention reason is clickable to its fix; primary action varies by state; no calculation altered (golden-value test on synthetic students) |
| **4** | **Navigation regroup + cross-record links + global search** | Fewer menu items, predictable labels, 1-click paths between related records, context preserved | Sidebar, AppShell, all list/detail pages | Low — permissions untouched | #1 | A role sees exactly the pages it sees today (test over `NAV_ITEMS` × `hasPerm`); labels uniform; Back restores list state |
| **5** | **Safe multi-step saves**: visible step runner with Retry for admission, add course, renewal, edit invoice, plus a stale-data check before fee-changing saves | Closes the partial-write/swallowed-error risk found in Phase 1 without waiting for database RPCs | Students (admission, courses, accounts) | **Medium** — changes control flow of money saves; no new writes | #1; later superseded by Stage 3 RPCs | Failure injection on the isolated DB (or mocked client) shows each failed step surfaced with Retry and no silent loss; successful path writes exactly what it writes today |

### Dependencies that need your approval before they are used
- **Audit trail for deletions/voids** (who/when/why) needs a new table → a migration, to be rehearsed in the isolated environment first. Until then dialogs ask for a reason but only the client log keeps it.
- **Duplicate/idempotency key** on payments is client-side first; a database unique key is a Stage 4 item.
- **Allocation order (D1–D4)** is untouched by this plan.

### How this will be implemented (if approved)

1. Increment 1: shared UI kit + `ConfirmDialog`, pilot on the **Receipts register** (small, already worked on) — walk-through on desktop and 375 px.
2. Increment 2: Record-payment component and document module (#2).
3. Increment 3: Student account view and attention strip (#3).
4. Increment 4: navigation and links (#4).
5. Increment 5: step runner (#5).
6. Visual polish pass last.

After each increment: `npm test` (45 tests today, extended for each new helper), `npm run build`, and a browser walk-through of the affected workflow; you review before any commit; push only on your instruction.

### What this plan does **not** do
- No change to authentication, login, password or account creation.
- No change to financial calculations, allocation order or fee rules.
- No database migration, RLS or production-data change.
- No feature removed to "simplify" a screen — infrequent options move behind "More".
- No rewrite: existing architecture, hand-rolled routing and CSS tokens (`--purple`, DM Sans/Mono) stay.

### Decisions needed from you
1. Approve (or amend) the navigation grouping in **A**, especially moving *Receipts & payments* to the Money group and merging *Price change log* into *Kit prices*.
2. Approve the **pattern set** in **B** and the **document layouts** in **D**.
3. Confirm the **order** of the five improvements (my recommendation: 1 → 2 → 3 → 4 → 5, with 5 pulled earlier if you prefer safety first).
4. Whether the audit-trail table (for void/delete reasons) may be designed for a later, separately approved migration.
