-- ============================================================================
-- Fidelity check for an isolated copy — READ-ONLY (catalog SELECT only).
-- Run after loading supabase/baseline/current_public_schema.sql.
-- Every row should show status = 'OK'. Expected values come from the live
-- project's catalog (read-only queries, 2026-10-13).
-- ============================================================================
with c as (
  select 'tables'              k, 62  expected, (select count(*) from pg_tables where schemaname='public')::int actual
  union all select 'sequences',          11, (select count(*) from pg_sequences where schemaname='public')::int
  union all select 'functions',          68, (select count(*) from pg_proc where pronamespace='public'::regnamespace and prokind='f')::int
  union all select 'triggers (public)',  37, (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal)::int
  union all select 'policies (public)', 305, (select count(*) from pg_policies where schemaname='public')::int
  union all select 'constraints',       267, (select count(*) from pg_constraint where connamespace='public'::regnamespace)::int
  union all select 'indexes',           162, (select count(*) from pg_indexes where schemaname='public')::int
  union all select 'tables with RLS',    62, (select count(*) from pg_tables where schemaname='public' and rowsecurity)::int
  union all select 'restrictive policies', 130, (select count(*) from pg_policies where schemaname='public' and permissive='RESTRICTIVE')::int
  union all select 'permissive policies', 175, (select count(*) from pg_policies where schemaname='public' and permissive='PERMISSIVE')::int
  union all select 'storage buckets',     1, (select count(*) from storage.buckets where id='chat-attachments')::int
  union all select 'storage.objects policies (chat_attach_*)', 3, (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'chat_attach_%')::int
  union all select 'anon-executable functions', 41, (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and has_function_privilege('anon', p.oid, 'EXECUTE'))::int
  union all select 'real students present (must be 0)', 0, (select count(*) from public.students where coalesce(notes,'') not like 'SYNTHETIC%')::int
)
select k as check, expected, actual, case when expected = actual then 'OK' else 'DIFFERENT' end as status from c order by 1;
