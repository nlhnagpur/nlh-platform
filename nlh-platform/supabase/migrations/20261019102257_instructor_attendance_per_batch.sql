-- A teacher can be absent for one batch and present for another, so P / A marks
-- are per batch. batch_id set = that batch only; null = the whole day (O weekly
-- off) and every mark made before this existed.
alter table public.instructor_attendance
  add column batch_id uuid references public.batches(id) on delete cascade;

alter table public.instructor_attendance
  drop constraint instructor_attendance_instructor_id_att_date_key;

create unique index instructor_attendance_day_batch_key
  on public.instructor_attendance (instructor_id, att_date, coalesce(batch_id, '00000000-0000-0000-0000-000000000000'::uuid));
