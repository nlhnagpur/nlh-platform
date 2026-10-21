-- Adds the pay mode "per_student_cycle": a CI is paid a rate for every student
-- cycle of 25 classes they complete.
alter table public.instructor_courses
  drop constraint instructor_courses_remuneration_mode_check;

alter table public.instructor_courses
  add constraint instructor_courses_remuneration_mode_check
  check (remuneration_mode = any (array['per_student'::text, 'per_session'::text, 'monthly'::text, 'per_student_month'::text, 'per_student_cycle'::text]));
