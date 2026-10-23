# CI payroll and batches — rules and what to do when something looks wrong

Last updated 2026-10-23. The app now checks for most of these itself: the **Batch health check** (Batches page, admins) and the **Payroll check** (a CI's Payroll tab). Each message carries a "What to do" line; this page explains the reasoning behind them.

## One payroll system for every pay basis

Whatever the CI's appointment says (per session, per student, per student a month, per cycle, monthly fixed), the Payroll tab produces the **same kind of line** and handles it the same way:

> **name · the dates it covers (From / To, editable) · the classes counted in those dates · the amount (editable)**

- Changing a line's dates re-counts the classes in them and re-prices the line by one rule (`recountLine` in `src/utils/ciPayroll.js`): per session = classes taken × rate; per student = rate × the CI's share of classes held; per cycle = pro-rata to 25 classes; fixed = the dates are only a record.
- One flow after that: **Save payroll → Post to accounts → Record bank payment**, one "paid up to … next pay starts …" note, one **Payroll check**, one printed payment sheet.
- Conveyance, office salary, incentive, misc and anything you add are plain lines with an amount.
- There are no separate per-basis blocks any more; the lines are the calculation.

## The rules the system follows

| Topic | Rule |
|---|---|
| What a CI is paid for | The **programme** (Phonics, Tuitions …), never the student's level. Levels are separate records; a student moves up as they finish one, so every student on the batch counts under the CI's appointment for that programme. |
| Which appointment applies | A CI may hold several appointments for one programme (one per level, entered over time). The **latest appointed on or before the month end** is the one in force for that month. |
| Per Student (on completion) | Rate × students who completed a level in the month, scaled by the share of the batch's classes the CI took. |
| Per Student / Month | Rate × students on the batch at any point in the month, scaled the same way. |
| Per Session | Classes the CI took × rate. Holidays and substitute classes are not counted. |
| Per Student / Cycle | Rate per completed 25-class cycle per student; a cycle belongs to the month it starts in; a short last cycle is paid pro-rata once the student has left. |
| Next pay start | The day after the last date paid, or the 1st of the next month if paid to the 30th/31st (or the month's last day). |
| When a CI starts on a batch | The later of the batch start and the date the CI took it over (`Change Instructor → New CI takes over from`) — unless a class was actually recorded earlier. |
| Money | Posting a month: **Dr 6001 Staff Salaries / Cr the CI's account**. Paying: a **bank payment, Dr the CI's account / Cr the bank**. A saved payroll keeps your edited amounts; a posted one is locked (reopen it only until it is paid). |

## Situations and the action to take

| What you see | Usual cause | Action |
|---|---|---|
| A CI's month shows **₹0** | The batch's students are on a programme the CI has no appointment for; or the basis is *Per Student* and nobody completed a level that month | Read the **Payroll check**. Add the missing appointment (Instructors → CI → Courses) with the correct date, or correct the basis. If the pay really is nil, nothing to do. |
| "No appointment covers *Programme*" | The CI teaches the programme but only holds appointments for other programmes, or the appointment starts after this month | Add/adjust the appointment. Until then add a manual line for those students. |
| "The basis changes on *date*" | A new appointment for the programme (different pay basis) starts mid-month | The later basis applies to the whole month. If part of the month belongs to the earlier basis, edit the amounts or add a line, with a note. |
| "The calculation is now ₹X, saved at ₹Y" | Attendance, batches or appointments changed after saving | Compare the lines with **Reset to calculated**, then save again — or keep your own figure on purpose. |
| A CI left | The batch must be handed over or closed | **Batches → Change Instructor**, with the date the new CI takes over (past classes keep the old CI). Set the CI's status and Left-on date. Then open their final month: unfinished cycles are paid pro-rata. |
| A student who finished a level is missing from an on-completion month | The level was finished by changing the student's level in place; the finished level is a separate completed record that is not on the batch | The payroll now counts these records for the CI whose batch the student is on (same programme, student on the batch by then). If one still doesn't appear, check the student is on the batch and the completion date is in the month. |
| A closed batch's students disappeared from the attendance register | The register once hid closed batches | It now shows a closed batch for any month it ran classes. If a month still looks empty, check the classes were recorded. |
| A teacher row is blank for days you expected | Those days are before the CI had the batch | Check the batch start date and the CI assignment date; correct them if the data is wrong. |
| Batch health: classes dated before the batch start | Start date entered later than the first class | **Edit batch** and set the start date to the first class date. |
| Batch health: a class by a different CI | A substitute was not marked as one | **Batches → History**: mark the class as a substitute, or fix the instructor. |
| Batch health: student on two open batches for one programme | Student moved but the old roster row was left | Remove the student from one batch. |
| Mark as paid / bank payment fails | Posting rules not met (e.g. closed fiscal year, locked period, no ledger linked to the bank) | The message names the cause. Fix it (fiscal years and bank ledger live in Accounting) and retry; nothing is half-posted. |

## Monthly routine for payroll (about five minutes per CI)

1. Open the CI's **Payroll** tab for the month. Read the **Payroll check** — fix anything marked *Fix*, think about anything marked *Check*.
2. Check the **attendance panel** (days taken, absences, holidays) and the student names listed under each pay line.
3. Edit amounts or From/To dates where your own working differs; add a line for anything else; add a note.
4. **Save payroll**, then **Post to accounts**, then **Record bank payment** when paid.
5. Once a quarter, open the **Batch health check** and clear everything it lists; the read-only audit queries are in `docs/phase-2/batch-health-queries.sql`.

## Where the rules are enforced in code (so they are tested, not remembered)

- `src/utils/ciPayroll.js` — programme matching, cycles, next-pay start. Tests: `tests/ci-payroll.test.mjs`.
- `src/utils/payrollCheck.js` — the payroll check and its actions. Tests: `tests/payroll-check.test.mjs`.
- `src/utils/batchHealth.js` — the batch check, the shared "which batches does a month list" rule. Tests: `tests/batch-health.test.mjs`.
- `src/utils/teacherAttendance.js` — a CI's start day on a batch.

If a rule changes, change it there and the tests show every place it affects.
