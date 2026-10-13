# Phase 1 — Role, Permission and RLS Audit (Task C)

Date: 2026-10-13 · Baseline `abaa69d` · Method: repo reading + SELECT-only catalog queries (`pg_policies`, `information_schema.role_table_grants`, `pg_proc`, `pg_trigger`, `storage.*`). No function was invoked, no row written, no policy changed.

**Authentication is out of scope.** Items touching login, passwords, temp passwords, account creation or auth email are listed as *observations only* in §6 and nothing was changed.

"Verified" below means *verified by reading the live definition*. Where exploitability would need an active write test, the finding says so and gives a safe test method (Supabase branch, never the live project).

## 1. Application permission model

| Layer | Facts |
|---|---|
| Roles | `owner`, `super_admin`, `admin`, `manager`, `staff` (admin tier); `smf`, `cf`, `uf` (franchise tree); `student`; `school` (allowed by DB check, no nav). |
| Staff granularity | `users.permissions` JSON keys (`orders.view`, `students.edit`, `accounting.edit`, …). `hasPerm()` returns **true for every non-staff role** and for unknown roles (pinned by test). Page/action gating is therefore only as good as the caller checking the role first. |
| Franchise scoping | `nlh_accessible_franchisee_ids()` (SECURITY DEFINER) walks the parent tree; RLS uses it. |
| Client-side gating | Menus/buttons hidden by `NAV_ITEMS`, `isAdminRole`, `hasPerm`, `courseAccess`. These are convenience only; RLS is the enforcement layer. |

## 2. Database exposure (live)

| Observation | Detail |
|---|---|
| RLS | enabled on **all** public tables (no table without RLS) |
| Table grants | `anon` **and** `authenticated` hold `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES` on **all 62** public tables. RLS is the only barrier. (Supabase default, but wider than needed.) |
| Policies open to `anon` | `INSERT` on `access_requests` (`check true`) and on `whatsapp_messages` (inbound rows) |
| Callable functions for `anon` | 41 public functions have `EXECUTE` for `anon`; 34 are SECURITY DEFINER (most are trigger functions, which Postgres will not run as RPC; see S-01 for the callable ones) |
| Storage | one bucket, `chat-attachments`, **public**, no size or MIME limit |

## 3. Findings

Severity is my assessment of impact × likelihood in this system's context. "Not exercised" = reasoning from definitions; needs the safe test to confirm.

**Security tests NOT performed in Phase 1** (all findings below are therefore *potential* risks established from definitions and code, not demonstrated exploits): calling any `anon` RPC; cross-centre insert/update of payments or invoices; overwriting a storage object; invoking the WhatsApp sender endpoints as a low-privilege user; posting an unsigned webhook; checking Vercel environment configuration (`WHATSAPP_APP_SECRET` etc.); testing any role against live RLS with a real session. Reason: none can be done safely against the only (production) database.

### S-01 — Anonymous callers can execute SECURITY DEFINER utility functions — **High** (not exercised)
- **Module:** DB functions / PostgREST `/rpc`.
- **Evidence:** `has_function_privilege('anon', …, 'EXECUTE')` is true for, among others: `wa_log_outbound(p_to, p_body, p_type, p_wa_message_id)`, `wa_update_status(p_wa_message_id, p_status)`, `wa_should_autoreply`, `next_receipt_no(p_series, p_centre, p_year)`, `next_order_receipt_no`, `next_sale_return_no`, `recompute_order_payment_status(p_order_id)`, `centre_of_student(p_student)`, `city_code`, `nlh_is_staff/senior`, `nlh_staff_can`, plus non-definer `next_order_ref`, `next_journal_no`, `generate_*_no`.
- **Impact:** an unauthenticated caller with the public anon key could (a) burn receipt/order/journal numbers (gaps in the legal numbering sequence), (b) insert or alter WhatsApp message log rows, (c) trigger payment-status recomputation for an order, (d) map a student UUID to a centre. Trigger functions in the list cannot be invoked as RPC (Postgres refuses), so they are not exploitable directly.
- **Recommendation:** `REVOKE EXECUTE … FROM anon, public` on everything that is not deliberately public; keep `GRANT` only for `authenticated` (and `service_role` for the webhook path). Re-grant individually if the apply form needs any.
- **Safe test:** in a Supabase branch, call each RPC as `anon` and record result; confirm the app still works after the revoke.

### S-02 — Student payment/invoice RLS does not tie `student_id` to the centre — **Medium** (not exercised)
- **Module:** `student_payments`, `student_invoices` (also applies to `enrollments`-style tables keyed by `franchisee_id`).
- **Evidence:** the base INSERT/UPDATE/DELETE policies (role `public`) test the **row's `franchisee_id`** against the caller's accessible centres but never that `student_id` belongs to that centre. The UPDATE policies have no explicit `WITH CHECK`; Postgres then applies the `USING` expression to the new row, so the new `franchisee_id` is still checked — only `student_id` is unchecked. Separate `staff_perm_*` RESTRICTIVE policies add the staff permission key on top. Live data currently has 0 mismatches.
- **Impact:** a franchise user who learns another centre's student UUID could attach a payment/invoice carrying their own `franchisee_id` to that student; the SECURITY DEFINER trigger then recomputes that student's `fee_paid`/status. Exploitation needs a UUID (unguessable), hence Medium rather than High.
- **Recommendation:** add a `WITH CHECK` (or BEFORE trigger) that the referenced student's `franchisee_id` equals the row's.
- **Safe test:** branch + two synthetic centres + one synthetic student; attempt cross-centre insert/update as the second centre's user.

### S-03 — Public storage bucket with open overwrite — **Medium** (policy and bucket config verified; overwrite not exercised)
- **Evidence:** `chat-attachments` is `public = true`; policy `chat_attach_upload` lets any authenticated user INSERT; `chat_attach_update` lets **any authenticated user UPDATE any object** in the bucket; no `file_size_limit`, no `allowed_mime_types`. SELECT policy (admin only) is moot for public URLs.
- **Impact:** anyone with an object URL can read it without authentication; any logged-in user can overwrite another user's attachment; unbounded file size/type.
- **Recommendation:** make the bucket private + signed URLs, scope UPDATE/DELETE to the uploader (`owner = auth.uid()`), set size/MIME limits.
- **Safe test:** branch; upload as user A, overwrite as user B.

### S-04 — Any authenticated user can trigger WhatsApp template sends — **Medium** (code-verified)
- **Module:** `api/send-payment-whatsapp.js`, `api/send-review-whatsapp.js` (use `requireAuth`, not `requireAdmin`).
- **Evidence:** the handlers verify a valid session but not that the caller may message *that* recipient or concerns *that* student. Content is locked to approved templates, which limits abuse.
- **Impact:** a student/school login (or any franchisee) could send business-number templates to arbitrary numbers → spam, Meta quality-rating and cost risk.
- **Recommendation:** require admin or franchise tier, and verify `to` against the caller's own student records; add per-user rate limiting.
- **Safe test:** local call with a stubbed `WHATSAPP_TOKEN` (never the real one).

### S-05 — Anonymous inserts: `access_requests`, `whatsapp_messages` — **Low–Medium** (policies verified; inserts not exercised)
- `access_requests` is the public admission form (by design): no server-side rate limit/CAPTCHA, free-text PII accepted → spam and data-hygiene risk. `whatsapp_messages` anon INSERT (`direction = 'inbound'`) permits forged "inbound" messages, and policy `wa_outbound_insert` lets **any authenticated user** insert `outbound` rows (so a student/school login can forge message-log entries). The webhook uses the service key when configured (`api/whatsapp-webhook.js` falls back to the anon key otherwise), so the anon policy may be what makes the fallback work — confirm before revoking.
- **Recommendation:** keep the form but add rate limiting (edge/API) and restrict `whatsapp_messages` inserts to `service_role`.

### S-06 — Excess table privileges (`TRUNCATE`, `TRIGGER`, `REFERENCES`) for `anon`/`authenticated` — **Low** (defence in depth)
- PostgREST does not expose TRUNCATE, so this is not directly reachable, but `TRUNCATE` bypasses RLS if ever reachable through another path. **Recommendation:** revoke the three privileges; keep `SELECT/INSERT/UPDATE/DELETE` governed by RLS.

### S-07 — Client permission helper is permissive for unknown roles — **Low**
- `hasPerm('student' | 'school' | undefined, …)` is `true` (pinned by `tests/permissions.test.mjs`). Safe only because callers gate by role first. **Recommendation:** default-deny in the helper.

### S-08 — Money-critical triggers are SECURITY DEFINER with the caller's input — **Info**
- `check_student_payment_total` / `recompute_student_fee_paid` run as definer with `search_path = public` (good). Cap is skipped when `fee_total = 0` (see financial F5).

### S-09 — WhatsApp webhook signature check is optional — **Medium** (code-verified; deployed config unknown)
- **Evidence:** `api/whatsapp-webhook.js` skips HMAC verification when `WHATSAPP_APP_SECRET` is unset, and computes the HMAC over `JSON.stringify(req.body)` rather than the raw request bytes (can reject genuine events if serialisation differs).
- **Impact:** if the secret is not configured in production, anyone can POST forged inbound messages that the handler will process (and may auto-reply to, from NLH's number).
- **Recommendation:** fail closed when the secret is missing; verify against the raw body.
- **Safe test:** local call with the env var unset and a stubbed token.

## 4. Re-verification of earlier-audit items

| Earlier claim | Status after Phase 1 |
|---|---|
| RLS enabled everywhere | **Confirmed** (live) |
| Student payment/invoice policy gap | **Confirmed by definition**, 0 live mismatches, exploit not exercised |
| Anon-callable functions | **Confirmed by privilege query**, exploit not exercised |
| Service key never in the browser bundle | **Confirmed for the current build**: the freshly built `dist/` contains exactly one JWT-like token and its decoded role is `anon`; the string `service_role` does not appear. `.env.local` is untracked. |
| API endpoints authenticated | **Mostly confirmed**: `requireAdmin` on `create-user`/`send-whatsapp`, caller-token checks on `send-email`/`send-cert-whatsapp`/`change-user-email`/`create-razorpay-order`, `requireAuth` (weaker) on two WhatsApp senders (S-04) |
| Webhooks verify signatures | **Partly**: `razorpay-webhook` rejects a bad HMAC. `whatsapp-webhook` verifies `x-hub-signature-256` **only if `WHATSAPP_APP_SECRET` is set**; otherwise it logs a warning and accepts the request (see S-09). Whether the secret is set in Vercel was not checked. |

## 5. What is working well

RLS on all 62 public tables (re-confirmed); `users` protected (own row or admin); privileged-column and role-escalation guard triggers are attached; the Razorpay webhook verifies its signature; payment cap and numbering are enforced in the DB; secrets are env-only and git-ignored; the built bundle contains only the anon key.

## 6. Observations in the out-of-scope authentication area (record only, nothing changed)

- Student/parent logins are created with a generated temporary password (`genTempPass` in `StudentsPage.jsx`) — generation happens in the browser.
- `admin_change_email`, `user_last_signins`, `users_id_mismatches` are SECURITY DEFINER RPCs callable by `authenticated`; their internal admin checks were not reviewed because they belong to the auth area.
- `get_app_secret(secret_name)` is SECURITY DEFINER and correctly not granted to `anon`/`authenticated`.

These need a separate, explicitly authorised review.

## 7. Recommended order of fixes (Phase 2 candidates)

1. Revoke `EXECUTE` from `anon`/`public` on non-public functions (S-01) — one reversible migration.
2. Tighten WhatsApp sender authorisation (S-04) — code only.
3. Private bucket + owner-scoped storage policies (S-03).
4. `WITH CHECK` on student payment/invoice policies (S-02).
5. Revoke `TRUNCATE/TRIGGER/REFERENCES` (S-06), restrict `whatsapp_messages` anon insert (S-05).
