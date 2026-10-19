-- Lets a teacher's attendance be marked A (absent: due to come but did not) as
-- well as P (present) and O (weekly off). Previously the status was limited to
-- ('P','O'), so an 'A' would have been rejected.
alter table public.instructor_attendance
  drop constraint instructor_attendance_status_check;

alter table public.instructor_attendance
  add constraint instructor_attendance_status_check
  check (status = any (array['P'::text, 'A'::text, 'O'::text]));
