-- Read-only export of the migration history, so a local script can keep the
-- repo's supabase/migrations in sync without the CLI being logged in.
-- Deliberately granted to service_role ONLY: the migration SQL is the full
-- schema and security model (RLS policies, SECURITY DEFINER bodies), so it must
-- never be readable with the public anon key.
create or replace function public.export_migrations()
returns table(version text, name text, sql text)
language sql security definer set search_path = public, supabase_migrations as $$
  select version,
         coalesce(name, 'migration'),
         array_to_string(statements, E';\n\n') || E';\n'
  from supabase_migrations.schema_migrations
  order by version
$$;

revoke all on function public.export_migrations() from public, anon, authenticated;
grant execute on function public.export_migrations() to service_role;
