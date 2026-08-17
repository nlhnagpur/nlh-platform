-- PostgREST only exposes the 'public' schema by default, so edge functions
-- (which talk to Postgres via the PostgREST/supabase-js client, same as the
-- frontend) can't select from vault.decrypted_secrets directly even with the
-- service-role key. This wrapper is the one bridge into Vault: security
-- definer so it can read vault.decrypted_secrets, and execute is revoked
-- from everyone except service_role, so only server-side code (edge
-- functions) can ever call it — never the anon/authenticated frontend.
create or replace function get_app_secret(secret_name text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = secret_name;
  return v;
end
$function$;

revoke all on function get_app_secret(text) from public, anon, authenticated;
grant execute on function get_app_secret(text) to service_role;
