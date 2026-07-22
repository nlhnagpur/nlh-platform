
-- One thread per franchisee, between that franchisee and Head Office (any admin).
CREATE TABLE IF NOT EXISTS public.messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  franchisee_id      uuid NOT NULL REFERENCES public.franchisees(id) ON DELETE CASCADE,
  sender_id          uuid,
  sender_name        text,
  from_ho            boolean NOT NULL,            -- true = HO/admin, false = franchisee
  body               text NOT NULL,
  created_at         timestamptz DEFAULT now(),
  read_by_ho         boolean DEFAULT false,
  read_by_franchisee boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON public.messages(franchisee_id, created_at);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Caller's own franchisee_id (null for HO admins)
CREATE OR REPLACE FUNCTION public.my_franchisee_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT franchisee_id FROM public.users WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1 $$;

CREATE POLICY messages_select ON public.messages
  FOR SELECT USING (nlh_is_admin() OR franchisee_id = public.my_franchisee_id());
CREATE POLICY messages_insert ON public.messages
  FOR INSERT WITH CHECK (nlh_is_admin() OR franchisee_id = public.my_franchisee_id());
CREATE POLICY messages_update ON public.messages
  FOR UPDATE USING (nlh_is_admin() OR franchisee_id = public.my_franchisee_id());

-- Realtime so both sides see new messages instantly
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
