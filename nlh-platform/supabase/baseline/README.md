# Schema baseline (isolated environments only)

`current_public_schema.sql` is a **schema-only snapshot of the live `public` schema** (plus the one storage bucket and its three object policies), reconstructed on 2026-10-13 from read-only catalog queries. It exists because 11 core tables — `users`, `franchisees`, `students`, `enrollments`, `courses`, `skus`, `orders`, `order_items`, `access_requests`, `kit_price_history`, `stock_movements` — were never created by any file in `supabase/migrations/`, so the migrations alone cannot build a database.

## Rules

- **Never run it against the production project.**
- It is **not a migration**: do not move it into `supabase/migrations/`.
- Load it into an **empty, isolated** database only (local Supabase or a Supabase branch), then load `docs/phase-2/stage-0/synthetic_seed.sql`.
- Do not replay the 160 migrations on top of it; the snapshot already contains their effects.

## What it contains (verified by counting the generated file)

| Object | Count | Matches live? |
|---|---|---|
| Tables | 62 | yes |
| Sequences | 11 | yes |
| Functions | 68 | yes |
| Triggers | 37 | yes |
| RLS policies (public) | 305 (175 permissive + 130 restrictive) | yes |
| Constraints (PK/UNIQUE/CHECK/FK) | 88 + 71 + 108 = 267 | yes |
| Indexes | 162 (88 constraint-backed + 74 explicit) | yes |
| RLS enabled | 62 / 62 | yes |
| Storage bucket / object policies | 1 / 3 | yes |

Counts were checked on the generated text. **The file has not yet been executed on any database**; syntax is unverified until its first load.

## Deliberate differences from production

- The business WhatsApp sender number embedded in `wa_log_outbound` is replaced with the placeholder `910000000000`.
- No data, no migration history, no secrets, no Auth objects, no vault entries.
- Counters (`receipt_counters`, sequences) start empty.

## Things to know

- Four functions and one trigger touch `auth.users` (authentication area, out of scope): `admin_change_email`, `align_user_id_to_auth` (+ trigger `tr_align_user_id`), `user_last_signins`, `users_id_mismatches`. They are reproduced so the schema is faithful; they are not exercised.
- Some policies reproduce *production defects on purpose* (e.g. PERMISSIVE `staff_perm_*` policies on `instructor_attendance`, `payroll_extras`, `student_no_class`). Do not "fix" them in the baseline; fixes belong to a later, approved stage and must be tested against this unchanged copy first.
- Creating policies on `storage.objects` may need a role that owns that table (`supabase_admin` locally). If the last section fails with a permission error, run it as that role; the rest of the file does not depend on it.
- `check_function_bodies` is switched off at the top so functions can be created before every object they mention exists.
