ALTER TABLE public.franchisee_agreements
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'unit_franchise',
  ADD COLUMN IF NOT EXISTS service_model text,
  ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.franchisee_agreements DROP CONSTRAINT IF EXISTS franchisee_agreements_kind_check;
ALTER TABLE public.franchisee_agreements ADD CONSTRAINT franchisee_agreements_kind_check CHECK (kind IN ('unit_franchise','school'));
ALTER TABLE public.franchisee_agreements DROP CONSTRAINT IF EXISTS franchisee_agreements_service_model_check;
ALTER TABLE public.franchisee_agreements ADD CONSTRAINT franchisee_agreements_service_model_check CHECK (service_model IS NULL OR service_model IN ('inhouse','full_service'));
