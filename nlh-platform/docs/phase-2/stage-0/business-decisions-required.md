# Business decisions required before Stages 3–4 (payment allocation, waivers, fee reductions)

Date: 2026-10-13 · Stage 0 · These are decisions for the owner. Nothing here has been implemented, and the code will not be changed until they are answered. "Today" describes current behaviour (verified in code or by test); "Suggested" is a recommendation, not a decision.

| # | Decision | Options | Today | Suggested | Blocks |
|---|---|---|---|---|---|
| **D1** | **Where does a part-payment go first** when a student owes several courses/invoices? | (a) oldest enrolment; (b) oldest invoice; (c) the course/invoice the payer names on the receipt | Three engines, three answers: course view by enrolment date, invoice view by invoice date, receipt view by statement line order | (c) when named, else (b) — one rule, one engine | Stage 2 |
| **D2** | **Un-invoiced charges** (other charges, opening balance): paid before or after invoiced course fees? | (a) first; (b) last; (c) proportionally | Invoice view: first. Course view: last. They disagree (synthetic S09: 4,000 vs 6,000 shown due) | (b) last — course fees are the primary charge; but only if the owner agrees | Stage 2 |
| **D3** | **What a waiver is** | (a) a discount that reduces the fee (current); (b) a write-off that stays visible as a receivable then cancelled | Treated as a discount: course `fee_amount` and student `fee_total` reduced, amount kept in `waived` | (a) is acceptable if the waived amount stays reportable | Stage 3 |
| **D4** | **May the fee ever fall below what was paid?** | (a) never; (b) only with an explicit refund/credit record; (c) allowed, excess becomes advance credit | Allowed silently (synthetic S16; no guard) | (b) | Stage 4 |
| **D5** | **Refunds / credit notes / voided receipts** | (a) out of scope; (b) add a refund record type; (c) allow void with reason | None exist; a payment cannot be negative; deletion is the only undo and the receipt number is not reused | (b)+(c) with reason and actor | Stage 4 |
| **D6** | **Zero-fee accounts**: may a payment be recorded? | (a) never; (b) only as an explicitly typed advance | Accepted today (cap skipped when `fee_total = 0`) | (b) | Stage 4 |
| **D7** | **Duplicate-looking payment** (same student/amount/date/mode) | (a) block; (b) warn and require confirmation; (c) allow | Only the overall cap stops it | (b) | Stage 4 |
| **D8** | **Monthly renewals**: invoiced each month, or only when paid? Does the renewal charge belong on the enrolment? | – | Renewal raises `fee_total` and creates an invoice, but not the enrolment's fee, so the course view under-reports what is owed (finding F11) | invoice every cycle at renewal | Stage 2 |
| **D9** | **The student with a NULL `fee_total`**: what is the correct fee? | – | Treated as 0 by the code | owner to supply; no change until then | Stage 0b |
| **D10** | **Source of truth for "money received"** and who signs off | receipt book / bank statement / UPI log | undefined | agree one source, then verify all 42 payments against it | independent verification |
| **D11** | **Invoice paid status**: derived (view/trigger) or removed from the table? | – | `amount_paid`/`status` never maintained; 15 of 18 invoices show 0 paid although the student paid | derive in the database | Stage 4 |

## How decisions map to behaviour

- D1/D2/D8 define the single allocation rule that Stage 2 implements and the characterisation tests then lock.
- D3/D4/D5/D6/D7 define which writes the database must reject or record in Stage 4.
- D9/D10 gate any claim that the production financial records are correct.
