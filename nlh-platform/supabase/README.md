# Database migrations

The schema for this project lives in the hosted Supabase project
(`frnnoxudtlvhyyoqdqzx`, Mumbai). This folder mirrors that history so the
database is version-controlled alongside the code and can be rebuilt.

## First-time setup

You need a Supabase personal access token and the database password. Neither
belongs in this repo — the CLI stores them outside the working tree.

```bash
npx supabase login                                   # opens a browser
npx supabase link --project-ref frnnoxudtlvhyyoqdqzx # prompts for the DB password
```

## Pull the remote history into this folder

```bash
npx supabase migration list          # compare local vs remote
npx supabase migration fetch         # write remote migrations into ./migrations
```

`fetch` writes one file per migration as `<timestamp>_<name>.sql`. The CLI
reconciles local and remote by the version prefix in the filename, so keep
those exact.

> The 87 files present as of 21 Jul 2026 were pulled directly out of
> `supabase_migrations.schema_migrations` rather than by `migration fetch`,
> because the CLI was not logged in. The content is byte-identical to what was
> applied and the version prefixes match, so `migration list` should line them
> up. Run `migration list` once after logging in to confirm; if any row shows
> as local-only, `supabase migration repair --status applied <version>` fixes
> the bookkeeping without re-running the SQL.

## Applying a new migration

Prefer creating migrations through the CLI so local and remote stay in step:

```bash
npx supabase migration new add_something
# edit supabase/migrations/<timestamp>_add_something.sql
npx supabase db push
```

Migrations applied directly against the hosted project (via the dashboard or an
MCP tool) still land in the remote history — run `migration fetch` afterwards to
bring the files back into the repo.
