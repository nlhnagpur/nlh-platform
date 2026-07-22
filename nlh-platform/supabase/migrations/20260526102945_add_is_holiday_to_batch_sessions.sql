ALTER TABLE batch_sessions ADD COLUMN IF NOT EXISTS is_holiday boolean DEFAULT false;
