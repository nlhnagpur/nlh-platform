-- The "+Add Franchisee" and "Approve Access Request" flows never set
-- contract_start/contract_end (only older, historical franchisees have
-- them, always equal to created_at and created_at + 3 years - 1 day —
-- the same convention franchiseeAgreement.js already assumes). Both app
-- flows are now fixed to set these at creation; backfill the SMF/CF/UF
-- rows that were created since without them so the Export CSV and the
-- agreement generator stop silently falling back to created_at.
update franchisees
set contract_start = created_at::date,
    contract_end   = (created_at::date + interval '3 years' - interval '1 day')::date
where contract_start is null
  and tier in ('SMF', 'CF', 'UF');
