-- The date the batch's current CI took it over (the batch's own start_date is when the batch began).
alter table public.batches add column instructor_assigned_at date;

-- Existing batches: the CI has had them since the batch began.
update public.batches set instructor_assigned_at = coalesce(start_date, created_at::date) where instructor_assigned_at is null;
