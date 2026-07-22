
CREATE TABLE whatsapp_messages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_message_id TEXT        UNIQUE,
  direction     TEXT        NOT NULL CHECK (direction IN ('inbound','outbound')),
  from_number   TEXT,
  to_number     TEXT,
  message_type  TEXT,        -- text, image, document, etc.
  message_body  TEXT,
  media_id      TEXT,
  status        TEXT,        -- received, read, failed
  raw           JSONB,       -- full Meta payload for reference
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wa_messages_from_idx ON whatsapp_messages(from_number);
CREATE INDEX wa_messages_created_idx ON whatsapp_messages(created_at DESC);

ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_all" ON whatsapp_messages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE email ILIKE (auth.jwt() ->> 'email')
        AND role IN ('owner','super_admin','admin','manager','staff')
    )
  );
