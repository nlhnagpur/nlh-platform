
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reminder_count integer DEFAULT 0;
