create or replace function public.wa_update_status(p_wa_message_id text, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_wa_message_id is null or p_status is null then return; end if;
  update whatsapp_messages
     set status = p_status
   where wa_message_id = p_wa_message_id;
end $function$;

revoke all on function public.wa_update_status(text, text) from public;
grant execute on function public.wa_update_status(text, text) to anon, authenticated;
