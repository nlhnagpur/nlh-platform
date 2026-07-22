-- chat-attachments only had an INSERT policy, so any upsert/read path tripped RLS.
drop policy if exists chat_attach_update on storage.objects;
create policy chat_attach_update on storage.objects
  for update to authenticated
  using (bucket_id = 'chat-attachments')
  with check (bucket_id = 'chat-attachments');

drop policy if exists chat_attach_select on storage.objects;
create policy chat_attach_select on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-attachments');
