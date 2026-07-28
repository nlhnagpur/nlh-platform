-- chat-attachments holds receipts, invoices and certificates (names + amounts).
-- The bucket is public, so object URLs render through the public path and need
-- no SELECT policy. The old broad SELECT let ANY signed-in user list every file
-- via the storage API — a franchisee could enumerate other centres' documents.
-- Narrow it to admins (for any future management tooling); everyone else keeps
-- upload + public-URL rendering, but can no longer enumerate the bucket.
drop policy if exists chat_attach_select on storage.objects;

create policy chat_attach_select on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-attachments' and public.nlh_is_admin());
