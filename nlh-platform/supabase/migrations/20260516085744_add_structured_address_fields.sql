
-- Franchisees: add area (locality) and country
ALTER TABLE public.franchisees
  ADD COLUMN IF NOT EXISTS area    TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'India';

-- Students: add structured home-address fields
-- (address column already exists for street/building line)
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'India',
  ADD COLUMN IF NOT EXISTS state   TEXT,
  ADD COLUMN IF NOT EXISTS city    TEXT,
  ADD COLUMN IF NOT EXISTS area    TEXT;
