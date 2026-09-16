alter table instructor_courses drop constraint instructor_courses_remuneration_mode_check;
alter table instructor_courses add constraint instructor_courses_remuneration_mode_check
  check (remuneration_mode = any (array['per_student'::text, 'per_session'::text, 'monthly'::text, 'per_student_month'::text]));
