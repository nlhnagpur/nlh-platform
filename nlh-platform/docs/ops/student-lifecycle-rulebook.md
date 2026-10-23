# Student, batch and CI lifecycle — the rulebook

Scope: **Head Office (HO) only.** Franchisees and schools do not manage batches, CIs or levels; every action below is shown to HO admin roles only.
Date: 2026-10-24. Status: **decisions D1–D6 recorded (section 7); build under way.** "Built" means it works today; "Gap" means the system does not yet do it (section 6).
Companion: `ci-payroll-and-batch-runbook.md` (day-to-day pay checks and what each message means).

## 1. Principles (apply to every case below)

1. **One fact, one place.** Each fact has a single home (section 2); everything else is derived from it, never re-typed.
2. **One event, one guided action.** A real-world event (a child moves up, a batch ends, a CI leaves) is a single button that makes every linked change together — staff never edit several screens by hand.
3. **Dates are always explicit.** Any change of batch, CI or level has an *effective date*, and history is kept (rows are ended, not overwritten).
4. **The child is counted once, and every CI is paid for what they did.** A student is one student for a month / a course however many batches or CIs they pass through; each CI is paid **at their own rate** for the classes **they took** of the child. If two CIs' amounts overlap or differ, it is corrected by hand.
5. **A CI is paid for the programme (Phonics, Tuitions …), never the level**, and only from the day they had the student.
6. **Mistakes are stopped at entry, not found at payroll.** The system refuses an action that would create inconsistent data, and says what to do instead.
7. **Every fix is explainable.** The Payroll check, Batch health check and the student timeline (section 6, G7) tell any member of staff what happened and what to do.

## 2. Where each fact lives (single source of truth)

| Fact | Lives in | Changed only by |
|---|---|---|
| Who the child is, parent, phone | Student | Admission, Edit profile |
| Which course/level the child is on, fee, cycle, status (active / completed / dropped) | Enrolment (one per course-level; a finished level is its own completed record) | Admission, Add course, **Move to next level**, Complete, Discontinue |
| Which batch the child is on, from when to when | Batch membership (assigned / removed dates) | **Place in batch**, **Move to another batch**, **Close batch** |
| Who teaches the batch, from when | Batch → CI + the date they took over | New batch, **Change CI**, **CI leaves**, **Close batch** |
| What was actually taught, by whom, who attended | Classes (session + attendance) | Attendance register |
| What a CI is paid for and how | CI appointments (programme, basis, rate, from date) | Instructors → Courses |
| What a CI is owed for a month | Payroll month (lines) → accounts | Payroll tab: Save → Post → Bank payment |

## 3. The lifecycle at a glance

Admission → place in a batch → classes & attendance → fee renewals → (level change, batch change, CI change as needed) → completion → certificate → (or) discontinue / withdraw. Month by month, payroll turns what happened into what each CI is owed.

## 4. Situation catalogue

Legend — **Status:** Built / Partly / Gap. **Pay:** effect on CI pay.

### A. Admission

| # | Situation | Staff do | System records | Fees / pay | Status |
|---|---|---|---|---|---|
| A1 | New student, one course | Enrol Student: details, course & level, batch (existing or new), fee, kit | Student, enrolment, batch membership from the admission date, invoice | Fee + kit as per level; CI is paid from the placement date | Built |
| A2 | New student, several courses | Same form, tick each course | One enrolment per course; each placed in its own batch | Per course | Built |
| A3 | Sibling (same phone) | Add sibling on the sibling's record | Separate admission, family details copied | Separate fees | Built |
| A4 | Same phone entered again | Pick the existing student from the lookup | No duplicate | — | Built |
| A5 | Returning / closed student | Open the closed student → Re-join | Account reopened, new enrolment | New fee; CI paid from new placement | Built |
| A6 | Admission with no batch yet | Leave batch blank | Enrolment without a batch | Student shows "needs a batch"; no pay yet | Partly (no reminder) |
| A7 | Admission date is earlier than today | Set the admission date | Enrolment and placement use that date | Pay from that date | Partly (placement uses "now") |

### B. Batch placement

| # | Situation | Staff do | System records | Pay | Status |
|---|---|---|---|---|---|
| B1 | Place a student in an existing batch | Student → course → Assign batch | Membership row from the chosen date | CI paid from that date; **only CIs with an appointment for the programme can be chosen** | Partly (date is "now"; no appointment rule here) |
| B2 | Create a new batch for the student | Assign batch → new batch | Batch with CI, days, time, start date, "CI since" date | As B1 | Built |
| B3 | 1-on-1 batch | Tick individual | Batch flagged individual | Same rules | Built |
| B4 | Placed in the wrong batch | **Move to another batch** (effective date = today or earlier) | Old membership ended, new started | See F-rules | Partly (works via "switch batch", date is "now") |
| B5 | Student on two batches for the same programme | Not allowed | Batch health check flags it | Prevents double pay | Built (check) |

### C. Classes and attendance

| # | Situation | Staff do | System records | Pay | Status |
|---|---|---|---|---|---|
| C1 | Normal class | Attendance register: P / A | Class + attendance | Counts for the CI who took it | Built |
| C2 | Class cancelled for everyone (holiday) | Mark H | Holiday, no class held | **Not counted** for per-session pay or share | Built |
| C3 | One student has no class that day | Mark N | No-class day | Not counted for that student's cycle | Built |
| C4 | Student absent | A | Absent | Class still counts as held | Built |
| C5 | CI absent, another CI covers | Teacher row A/O + pick substitute | Class marked substitute | Not counted for the main CI; **substitute pay is not defined** | **Gap (G6)** |
| C6 | CI on weekly off | Teacher row O | Off day | No class, no pay for it | Built |
| C7 | Make-up class (e.g. Saturday) | Mark P on that day | Extra class | Counts for the CI who took it | Built |
| C8 | Attendance entered on a closed batch | Not allowed | View-only | — | Built |
| C9 | Attendance before the batch / CI started | Not allowed | Greyed | — | Built |

### D. Fees and renewals

| # | Situation | Staff do | System records | Pay | Status |
|---|---|---|---|---|---|
| D1 | Monthly renewal | Student → Renew | New cycle start, class days, invoice | None directly | Built |
| D2 | Session-based course (e.g. 25 classes) | Normal | Counts attended classes against the total | None directly | Built |
| D3 | Part payment / receipt | Record payment | Payment, receipt, allocation | None | Built |
| D4 | Fee differs for this student | Edit the enrolment fee | Student-specific fee kept on later changes | None | Built |
| D5 | Waiver / discount | Waive | Waived amount kept | None | Built |
| D6 | Cycle progress after a **batch change** | — | Cycle should count the child's classes in *both* batches | — | **Gap (G4)** |

### E. Level change (same CI continues)

| # | Situation | Staff do | System records | Pay | Status |
|---|---|---|---|---|---|
| E1 | Child finishes a level mid-month and carries on | **⬆ Move to next level** (confirm date, fee) | Level 2 saved as a completed record (₹0, for its certificate); the live enrolment becomes Level 3 from that date; **batch and CI untouched** | Programme unchanged → no change for the CI; on-completion basis counts the finished level as a completion | Built |
| E2 | Fee stays the child's own | Leave fee as shown | Fee not re-priced | — | Built |
| E3 | Cycle already paid for the month | Keep cycle (default) | Cycle start kept; kit is for the new level | — | Built |
| E4 | New level needs a kit | Kit prompt in the dialog | Kit issued/confirmed for the new level | — | Built |
| E5 | Last level of the course | Move to next level is hidden | — | — | Built |
| E6 | Wrong level chosen | Change level again (with the date) | Previous record corrected | — | Partly (no undo; correct by hand) |
| E7 | Session counts after the move | Automatic | Classes up to the finish date belong to the finished level | — | Built |

### F. Batch change (child moves; CI may be the same or new)

The rules for pay here are the heart of the problem; see section 5.

| # | Situation | Staff do | System records | Pay | Status |
|---|---|---|---|---|---|
| F1 | Same CI, different time/batch | Move to another batch (date) | Old membership ended, new started; student count continues | Same CI: no change | Partly |
| F2 | New CI because the old CI left; student goes into a **new** batch | Close old batch (move student → new batch) or Move to another batch | Same | **Old CI paid up to the day before, new CI from the move date; the child counts once** | Gap (G1–G3) |
| F3 | Student joins an **existing** batch with another CI | Same | Same | Same | Gap (G1–G3) |
| F4 | Whole batch changes CI | **Change CI** (date) / **CI leaves** | CI-since date on the batch; sessions keep who took them | Old CI to the day before, new CI from the date | Built |
| F5 | Merge two batches | Move each student (date), then Close batch | Same | Same | Partly |
| F6 | Split a batch | Create new batch, move students | Same | Same | Partly |

### G. CI changes

| # | Situation | Staff do | System records | Pay | Status |
|---|---|---|---|---|---|
| G1 | New CI appointed | Instructors → add CI → Courses: programme, basis, rate, from date | Appointment | Pay starts from the appointment date and the first class | Built |
| G2 | CI's pay basis changes mid-month | Add a new appointment for the programme with the new date | Latest appointment in force applies to the month; the Payroll check notes the change | Edit lines if part of the month belongs to the old basis | Built |
| G3 | CI leaves, batches already closed | Profile → Status Resigned/Inactive + Left date | Status, left date | Final month: unfinished cycles pro-rata | Built (blocked while a batch is open) |
| G4 | CI leaves with batches open | **👋 CI is leaving…** | Batches handed over or closed, then CI marked left | Old CI to last day, new CI from the next day | Built |
| G5 | CI on a long break | Status Inactive (batches handed over first) | — | No pay while inactive | Built |
| G6 | CI comes back | Status Active; appoint again if needed | — | From the new appointment date | Built |
| G7 | CI covers one class for another | Substitute on the register | Class marked substitute | **Not defined** | Gap (G6) |

### H. Completion and certificate

| # | Situation | Staff do | System records | Pay | Status |
|---|---|---|---|---|---|
| H1 | Child completes the course | Student → course → Complete (date) | Enrolment completed | On-completion basis pays the CI on the date; other bases stop | Built |
| H2 | Completion from the batch screen | Batch roster → Complete | Same | Same | Built |
| H3 | Level finished by moving up | Move to next level | Finished-level record with a completion date | Counts as a completion for pay | Built |
| H4 | Certificate (franchise / UF) | Actions → Certificate | Issued, hand-over recorded | — | Built |
| H5 | Certificate for a finished level (moved up) | Same, on the finished-level record | Certificate for that level | — | Built (manual) |
| H6 | School-tier completion needs marks | Enter marks at completion; HO reviews | Pending review → certified / rejected | — | Built |
| H7 | Rejected / re-submit | Re-submit with corrected marks | Status back to pending | — | Built |
| H8 | Completion reversed (entered by mistake) | — | — | — | **Gap (G8)** |

### I. Exits

| # | Situation | Staff do | System records | Pay | Status |
|---|---|---|---|---|---|
| I1 | One course discontinued | Discontinue course | Status dropped, unpaid fee waived | CI pay stops from then (pro-rata on cycle) | Built |
| I2 | Student withdraws entirely | Close / Withdraw | Account closed, all courses ended | Same | Built |
| I3 | Undo a discontinue / re-join | Restore / Re-join | Waiver reversed | CI pay resumes from the new placement | Built |
| I4 | Refund | — | There is no refund record today | — | Gap (G11) |
| I5 | Student moves city / centre | Not supported | — | — | Gap |

### J. Month end

| # | Situation | Staff do | System records | Status |
|---|---|---|---|---|
| J1 | Calculate a CI's month | Payroll tab; read the Payroll check | Lines per student with dates, classes, amount | Built |
| J2 | Adjust | Edit amounts / dates / add a line | Edited lines saved as the month's payroll | Built |
| J3 | Post | Post to accounts | Dr Staff Salaries / Cr the CI's account | Built |
| J4 | Pay | Record bank payment | Dr CI / Cr bank | Built |
| J5 | Whole-platform health | Batch health check; one "Month close" checklist | — | Partly (no single screen: Gap G9) |

## 5. How CI pay follows the child (decided)

**Rule P1 — each CI is paid, at their own rate, for the classes they took of the child.** A child's classes in a period (across every batch they were on, holidays left out) are counted; each CI's share is the classes *that CI* took ÷ all the classes the child had. Substitute classes are not the main CI's.
**Rule P2 — pay starts the day the CI had the child.** The new CI is paid from the date of the new or changed batch; the old CI up to the day before.
**Rule P3 — differences are corrected by hand.** The two CIs' amounts are calculated independently, so they may not add up to one monthly rate; the payment lines are editable for exactly this reason.

| Basis | How a child's line is calculated | After a batch / CI change |
|---|---|---|
| Per student / month | own monthly rate × (classes this CI took of the child ÷ the child's classes in the period) | each CI gets their own line for the child |
| Per student on completion | own rate × the same share (interim: the month's classes; the level's classes are the target) | the CI(s) who took the classes |
| Per student / cycle (25 classes) | own rate × classes this CI took ÷ 25 | already per CI |
| Per session | classes taken × own rate | already per CI |
| Monthly fixed | fixed amount | unaffected |
| **Substitute classes** | listed separately in the covering CI's payroll: number of classes, with an *approximate* amount from that CI's own appointment for the programme (zero where it cannot be estimated) | the amount is theirs to adjust |

Worked example (Ayesha in October): classes the child had — 3 under Khushi (to 19 Oct) and 4 under Sneha (from 20 Oct, one covered by a substitute) = 7. Khushi: 3/7 of her own monthly rate; Sneha: 3/7 of hers; the substitute's class appears in the substitute's payroll.

## 6. Gaps found in the current system, and the fix for each

| ID | Gap | Why it matters | Fix |
|---|---|---|---|
| **G1** | Changing a student's batch used "now" as the date; no date could be chosen | Couldn't record a move that happened earlier | **Done:** **⇄ Move to another batch** — effective date, a warning (not a block) if the new CI has no appointment, a warning if the month's payroll is already saved/posted |
| **G2** | Per student / month paid the full month to both CIs after a mid-month move | Overpaid; broke Rule P1 | **Done:** each CI's line uses the child's classes across all batches, at their own rate (P1) |
| **G3** | On-completion pay goes to whichever batch the child is on at completion | Earlier CI gets nothing for most of the level | **Partly done:** shared by classes in the month; extending to the whole level is next |
| **G4** | Cycle progress (renewal screens, "N of target") counts only the **current batch's** classes | After a batch change the child's cycle looks restarted | Count the child's classes across all batches since the cycle start |
| **G5** | Placement in a batch can be dated only "now" at admission, too | Late data entry can't be dated correctly | Date field on every placement |
| **G6** | Substitute classes paid nobody | The covering CI was unpaid | **Done:** the covering CI's payroll lists the classes with an approximate amount (D2), editable |
| **G7** | No single **student timeline** | Nobody can see "what happened to this child" | Timeline on the student record: admission, placements, level changes, CI changes, completion, certificate — from existing dates, no new data entry |
| **G8** | Completion cannot be reversed | — | **Not wanted (D5).** Left as it is |
| **G9** | No single month-end screen | Checks are spread across the Batches page and each CI's payroll | **Today / Month close** page: all checks in one list, each with its fix button |
| **G10** | A student without a batch is not flagged | A paying child with nobody being paid | Add to the Batch health check: "enrolled, no batch" |
| **G11** | No refund record | A refunded fee is not visible on the student's account or in the books | A refund action (HO only) that records the payment out, reduces the paid amount, and posts to the accounts when the engine (E1+) is in |

## 7. Decisions (recorded)

| ID | Decision | Answer |
|---|---|---|
| **D1** | Split of a child's monthly rate between CIs | Not split. **Each CI is paid at their own rate for the classes they took**; overlaps or differences are corrected by hand (Rule P1, P3). |
| **D2** | Substitute classes | Once the substitute CI is marked, the covering CI's payroll shows the **number of classes taken as a substitute with an approximate amount**, editable. |
| **D3** | On-completion pay when the CI changes mid-level | **Share by classes taken.** |
| **D4** | May a move be dated earlier than today (HO only)? | **Open question — in plain words:** if a child actually moved batch on 20 Oct but it is entered on 23 Oct, should staff be able to enter 20 Oct as the move date (so the old CI is paid up to 19 Oct and the new CI from 20 Oct), or must the date always be today? Today the Move dialog allows an earlier date and warns that the pay changes. |
| **D5** | Reverse a completion | **No.** |
| **D6** | A child placed with a CI who has no appointment for the programme | **A warning, not a block.** The CI may be given the extra responsibility and appointed afterwards; the Batch health check keeps flagging it until then. |

## 8. Build plan (HO only; no deployment without your go)

| Step | What | Database change? |
|---|---|---|
| **L1** ✅ | **Move to another batch** guided action (G1, G5, B4, F1–F3, F5–F6): effective date, warning on a missing appointment, one confirmation; from the batch roster and the student record | No |
| **L2** ✅/◐ | Payroll pays each CI at their own rate for the classes they took of the child (G2, P1–P3); on-completion over the whole level still to do (G3) | No |
| **L3** | Cycle progress across batches (G4) | No |
| **L4** ✅ | Substitute classes listed with an approximate amount (G6, D2) | No |
| **L5** | Student timeline (G7) and "enrolled, no batch" check (G10) | No |
| **L6** — | Reopen course — not wanted (D5) | — |
| **L7** | Today / Month close page (G9) | No |
| **L8** | Staff one-page guide generated from this rulebook | No |

Everything in L1–L8 is shown to HO admin roles only.
