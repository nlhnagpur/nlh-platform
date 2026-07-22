ALTER TABLE students ADD COLUMN IF NOT EXISTS registered_at date DEFAULT NULL;
-- Back-fill existing students with their created_at date
UPDATE students SET registered_at = created_at::date WHERE registered_at IS NULL;
