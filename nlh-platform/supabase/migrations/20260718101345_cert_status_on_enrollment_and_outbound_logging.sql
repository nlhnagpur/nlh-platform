-- 1) Keep the certificate's WhatsApp status on the enrollment itself, so
--    franchisees see delivered/failed without needing to read whatsapp_messages.
alter table enrollments add column if not exists cert_wa_status text;

-- 2) The webhook RPC now advances BOTH the message log and the enrollment badge.
create or replace function public.wa_update_status(p_wa_message_id text, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_wa_message_id is null or p_status is null then return; end if;
  update whatsapp_messages set status = p_status where wa_message_id = p_wa_message_id;
  update enrollments   set cert_wa_status = p_status where cert_wa_message_id = p_wa_message_id;
end $function$;

revoke all on function public.wa_update_status(text, text) from public;
grant execute on function public.wa_update_status(text, text) to anon, authenticated;

-- 3) Let any signed-in user log an OUTBOUND send (franchisees included) so every
--    certificate/receipt they send is captured for HO oversight. Reading stays
--    admin-only via the existing admins_all policy — this grants no visibility.
drop policy if exists wa_outbound_insert on whatsapp_messages;
create policy wa_outbound_insert on whatsapp_messages
  for insert to authenticated
  with check (direction = 'outbound');

-- 4) Backfill status for certificates already sent.
update enrollments e
   set cert_wa_status = m.status
  from whatsapp_messages m
 where e.cert_wa_message_id = m.wa_message_id
   and e.cert_wa_status is distinct from m.status;
