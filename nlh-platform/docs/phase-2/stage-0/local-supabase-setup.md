# Local Supabase — preparation (nothing installed, nothing started)

Date: 2026-10-13 · Status: **prepared, not executed.** No software has been installed and no container, database or branch exists. This document is the checklist for when you confirm the install.

## 1. What must be installed (needs your confirmation)

| Item | Why | Notes |
|---|---|---|
| Docker Desktop (Windows, WSL2 backend) | Supabase's local stack runs as containers | Windows 11 Home is supported. About 4–6 GB RAM and 5–10 GB disk. Needs admin rights and a restart. |
| Supabase CLI | starts/stops the local stack | Install via Scoop, the standalone binary, or as a dev-only npm package. `npx` would download it on first use. Prefer a version pinned in the notes of the run. |
| `psql` (optional) | loading SQL files | Can be avoided by `docker exec` into the Postgres container. |

Cost: **free**. Nothing here contacts the production project.

## 2. Why a separate working directory

`D:\Claude\nlh-platform\supabase\` already holds `config.toml` (`project_id` of the *live* project) and 160 migrations that **cannot** run on an empty database. Running `supabase start` there would try to apply them and fail, and its `link`/`db push` commands point at production.

Use an **empty directory outside the repository**:

```
D:\Claude\nlh-isolated\            <- new, outside the repo and outside git
  supabase\
    config.toml                    <- created by `supabase init` there (its own project_id, e.g. nlh-isolated)
    migrations\                    <- stays EMPTY
```

Never run `supabase link`, `supabase login`, `supabase db push`, `supabase db dump` or `supabase migration repair` from the repository's `supabase` folder.

## 3. Steps (after you approve the installs)

```bash
# 1. one-off, in the new empty directory
mkdir D:\Claude\nlh-isolated && cd D:\Claude\nlh-isolated
supabase init                      # creates supabase\config.toml with its OWN project id
supabase start                     # pulls images, starts Postgres/Auth/Storage/REST on localhost

# 2. load the schema snapshot (isolated DB only; default local DB port 54322)
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f D:\Claude\nlh-platform\supabase\baseline\current_public_schema.sql

# 3. verify the schema is faithful (read-only)
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f D:\Claude\nlh-platform\docs\phase-2\stage-0\verify_isolated_environment.sql

# 4. load the synthetic data (guarded; refuses if real students/centres exist)
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "set nlh.allow_synthetic_seed = 'on';" -v ON_ERROR_STOP=1 -f D:\Claude\nlh-platform\docs\phase-2\stage-0\synthetic_seed.sql
```

Note on step 4: `set` in a separate `psql -c` does not persist to the next connection. Run both inside one session instead (`psql` interactive: `set nlh.allow_synthetic_seed='on'; \i …synthetic_seed.sql`), or prefix the file with the `set` line in a wrapper.

```bash
# 5. run the read-only reconciliation and the scenario scripts
psql ... -f D:\Claude\nlh-platform\docs\phase-2\stage-0\reconciliation-queries.sql
psql ... -f D:\Claude\nlh-platform\docs\phase-2\stage-0\branch-scenario-tests.sql

# reset to empty at any time
supabase db reset                  # (in D:\Claude\nlh-isolated) then repeat steps 2-4
supabase stop                      # when finished
```

Expected defaults for the local stack: Postgres `127.0.0.1:54322`, user `postgres`, password `postgres`, API `http://127.0.0.1:54321`. These local-only values are not secrets and are different from any production credential.

## 4. What this environment can and cannot test

| Can | Cannot / limited |
|---|---|
| Triggers, constraints, numbering, caps, concurrency (two `psql` sessions) | Real WhatsApp / e-mail / Razorpay (not configured — good) |
| RLS by `set role authenticated` + `set_config('request.jwt.claims', '{"email": "…"}', true)` against synthetic `public.users` rows | Browser login (needs an `auth.users` account — provisioning is out of scope) |
| Catalog/privilege checks for anon/authenticated | Production data volume or timing |

## 5. Guard rails

- The seed and scenario scripts abort on any database that contains non-synthetic students or centres.
- Local credentials stay in your shell or terminal history only; none are written to the repository.
- `.env.local` and the live `src/supabase.js` are not touched. Pointing the **web app** at the local stack is a separate, not-yet-approved step (see `stage-0-report.md` §7).
- The baseline file was loaded from catalog reads only; production was never written.

## 6. Open items before first load

1. Your approval to install Docker Desktop and the Supabase CLI (or to use a branch / plain PostgreSQL instead).
2. First execution of `current_public_schema.sql`: expect to fix minor syntax/ordering problems in the snapshot. Any change to it must be recorded in `supabase/baseline/README.md`.
3. Decision on how `storage.objects` policies are created locally (role ownership).
