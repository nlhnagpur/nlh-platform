-- The webhook runs with the anon key, which can only INSERT inbound rows and
-- cannot read the table. These SECURITY DEFINER helpers let it (a) rate-limit
-- the auto-reply and (b) log the auto-reply it sends — nothing more.

-- Only auto-reply once per number per window, so a chatty parent isn't spammed
-- and we can never get into a reply loop.
create or replace function public.wa_should_autoreply(p_number text, p_window interval default interval '6 hours')
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare recent int;
begin
  if p_number is null then return false; end if;
  select count(*) into recent
    from whatsapp_messages
   where to_number = p_number
     and direction = 'outbound'
     and message_type = 'auto_reply'
     and created_at > now() - p_window;
  return recent = 0;
end $function$;

-- Log an outbound message on the webhook's behalf (used for the auto-reply).
create or replace function public.wa_log_outbound(
  p_to text, p_body text, p_type text default 'auto_reply', p_wa_message_id text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_to is null then return; end if;
  insert into whatsapp_messages (direction, from_number, to_number, message_type, message_body, status, wa_message_id)
  values ('outbound', '917123514575', p_to, coalesce(p_type,'auto_reply'), p_body, 'sent', p_wa_message_id);
end $function$;

revoke all on function public.wa_should_autoreply(text, interval) from public;
revoke all on function public.wa_log_outbound(text, text, text, text) from public;
grant execute on function public.wa_should_autoreply(text, interval) to anon, authenticated;
grant execute on function public.wa_log_outbound(text, text, text, text) to anon, authenticated;
