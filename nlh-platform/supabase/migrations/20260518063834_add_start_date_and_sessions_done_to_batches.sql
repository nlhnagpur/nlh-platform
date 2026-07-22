
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS start_date     date,
  ADD COLUMN IF NOT EXISTS sessions_done  integer NOT NULL DEFAULT 0;
