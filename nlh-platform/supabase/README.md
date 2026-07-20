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

`fetch` writes one file per migration as `<timestamp>_<name>.sql`, with
checksums the CLI recognises, so `supabase db push` continues to work.

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
