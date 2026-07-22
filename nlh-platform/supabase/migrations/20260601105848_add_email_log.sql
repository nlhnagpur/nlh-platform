
CREATE TABLE IF NOT EXISTS public.email_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type           text,
  recipient      text,
  recipient_name text,
  subject        text,
  status         text NOT NULL DEFAULT 'sent',
  error          text,
  message_id     text,
  bcc            text,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_log_created ON public.email_log(created_at DESC);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- Only admins (owner→staff) can read the log
CREATE POLICY email_log_select ON public.email_log
  FOR SELECT USING (nlh_is_admin());

-- Any authenticated caller (the send-email endpoint runs with the caller's JWT) may write
CREATE POLICY email_log_insert ON public.email_log
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
