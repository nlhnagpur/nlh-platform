
-- Attachment + broadcast support on messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS attachment_url  text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_type text,
  ADD COLUMN IF NOT EXISTS attachment_size integer,
  ADD COLUMN IF NOT EXISTS broadcast_id    uuid;

-- body may be blank when the message is attachment-only
ALTER TABLE public.messages ALTER COLUMN body SET DEFAULT '';
ALTER TABLE public.messages ALTER COLUMN body DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_broadcast ON public.messages(broadcast_id);

-- Storage bucket for chat files (public read, unguessable uuid paths)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "chat_attach_read"   ON storage.objects;
DROP POLICY IF EXISTS "chat_attach_upload" ON storage.objects;

CREATE POLICY "chat_attach_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'chat-attachments');

CREATE POLICY "chat_attach_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-attachments');
