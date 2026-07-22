ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS cert_wa_sent_at timestamptz DEFAULT NULL;
