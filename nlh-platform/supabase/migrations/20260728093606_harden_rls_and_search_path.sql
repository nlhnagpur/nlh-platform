-- Two tables created this session were exposed to the public API without RLS.
-- Both are only ever read/written through SECURITY DEFINER functions (city_code,
-- next_receipt_no), which run as owner and bypass RLS — so enabling RLS with no
-- policy denies all *direct* API access while the app is unaffected.
alter table public.city_codes       enable row level security;
alter table public.receipt_counters enable row level security;

-- assign_student_invoice_no was the one trigger function left without a pinned
-- search_path — set it so a rogue schema on the path can't shadow its calls.
create or replace function public.assign_student_invoice_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.invoice_no is null then
    NEW.invoice_no := 'SINV-' || to_char(now(), 'YYYY') || '-' ||
                      lpad(nextval('public.student_invoice_seq')::text, 4, '0');
  end if;
  return NEW;
end $$;
