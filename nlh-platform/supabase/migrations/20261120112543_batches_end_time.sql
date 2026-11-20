-- A batch's session normally runs one hour from its start time; schedule_end_time (nullable) lets HO set a different length.
alter table public.batches add column if not exists schedule_end_time time without time zone;
comment on column public.batches.schedule_end_time is 'End of the session. NULL = one hour after schedule_time.';
