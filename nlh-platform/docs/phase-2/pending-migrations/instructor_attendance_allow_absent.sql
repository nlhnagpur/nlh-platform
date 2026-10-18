-- PENDING — NOT APPLIED. Needs explicit approval (and ideally a rehearsal on the
-- isolated copy) before it is run against the live project.
--
-- Lets a teacher's attendance be marked A (absent) as well as P (present) and
-- O (off). Today instructor_attendance.status is limited to ('P','O'), so
-- saving an 'A' would be rejected by the database.
--
-- After applying: set TEACHER_ABSENT_ENABLED = true in
-- src/utils/teacherAttendance.js, and add the applied migration file to
-- supabase/migrations/ with the version the database assigns.

alter table public.instructor_attendance
  drop constraint instructor_attendance_status_check;

alter table public.instructor_attendance
  add constraint instructor_attendance_status_check
  check (status = any (array['P'::text, 'A'::text, 'O'::text]));

-- Rollback (first remove or convert any 'A' rows, otherwise the constraint fails):
--   delete from public.instructor_attendance where status = 'A';   -- or: update ... set status = 'O'
--   alter table public.instructor_attendance drop constraint instructor_attendance_status_check;
--   alter table public.instructor_attendance
--     add constraint instructor_attendance_status_check
--     check (status = any (array['P'::text, 'O'::text]));
